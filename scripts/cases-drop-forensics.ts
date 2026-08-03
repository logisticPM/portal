// Read-only forensics over claims that failed verification. Replays the model responses
// already on disk — ZERO LLM calls — and assigns each dropped claim one cause.
//
// Needs DynamoDB READ access for chunk text. Writes nothing, anywhere.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import {
  assembleInput, buildPrompt, parseClaims, normWs, verifyClaims, RETRY_SUFFIX,
} from "../src/lib/cases/ingest/summarizer";
import { classifyDrop, type DropCause, type ElisionDiag } from "../src/lib/cases/ingest/drop-cause";

const CACHE = path.join(process.cwd(), "scripts", ".cache", "llm");
const MODEL_ID = process.env.SUMMARY_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";

// Must match cachedCall exactly: sha256(modelId + "\n" + prompt), first 32 hex.
const keyFor = (prompt: string) =>
  createHash("sha256").update(MODEL_ID + "\n" + prompt).digest("hex").slice(0, 32);
const readCache = async (prompt: string): Promise<string | null> => {
  try { return await fs.readFile(path.join(CACHE, keyFor(prompt) + ".txt"), "utf8"); }
  catch { return null; }
};

const ORDER: DropCause[] = ["locate_bug", "marker_bleed", "assembly_boundary", "normalization", "elision", "transcription", "unseen"];
const NOTE: Record<DropCause, string> = {
  locate_bug: "structurally 0 — a locate() disagreement surfaces as a replication mismatch, above",
  marker_bleed: "recoverable — our prompt marker",
  assembly_boundary: "structurally 0 — subsumed by marker_bleed, see the note in classifyDrop",
  normalization: "recoverable — widen normWs",
  elision: "NOT a defect — legitimate quoting, misfiled by the six-bucket taxonomy",
  transcription: "recoverable only by span alignment",
  unseen: "NOT recoverable — the model was never shown this text",
};
const DIAGS: ElisionDiag[] = ["cross_chunk_only", "fragment_too_short", "fragment_not_found", "out_of_order"];
// ORDER is a plain array, so tsc cannot check it covers DropCause the way NOTE's Record does.
if (ORDER.length !== Object.keys(NOTE).length) {
  throw new Error(`ORDER has ${ORDER.length} buckets but NOTE has ${Object.keys(NOTE).length} — a bucket is missing from ORDER`);
}

async function main() {
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  const tally = Object.fromEntries(ORDER.map((c) => [c, 0])) as Record<DropCause, number>;
  const samples = Object.fromEntries(ORDER.map((c) => [c, [] as string[]])) as Record<DropCause, string[]>;
  let cases = 0, totalDrops = 0, noClaims = 0, mismatches = 0, preRejected = 0, curated = 0;
  // Cross-tabulated, NOT a flat count: a cross_chunk_only claim can land in either
  // transcription or unseen, and the fabrication floor needs the unseen half specifically.
  const diagTally = Object.fromEntries(
    DIAGS.map((d) => [d, { transcription: 0, unseen: 0 } as Record<string, number>]),
  ) as Record<ElisionDiag, Record<string, number>>;
  const transcriptionOverlaps: number[] = [];

  for (const prof of profiles) {
    const c = await dynamoCaseRepo.getCase(prof.id);
    if (!c?.chunks?.length) continue;
    // A hand-curated summary (enrichment.ts) was never produced by a model, so there is no
    // cached response to replay — outside the population, not a gap in the cache. Until the
    // SCC backfill gave 2014-scc-44 its 62 chunks the guard above skipped it; once it had
    // text it reached the cache lookup and aborted every replay run.
    if (c.summary && c.summaryMeta?.method !== "llm") { curated++; continue; }

    const assembled = assembleInput(c.chunks, c.outcome.holding);
    const prompt = buildPrompt(c, assembled);

    // summarizeCase's exact sequence: the base prompt, then one retry whose suffix
    // changes the cache key. Trying them in the other order would re-derive claims the
    // run never used.
    let raw = await readCache(prompt);
    let claims = raw === null ? null : parseClaims(raw);
    if (!claims) {
      const retry = await readCache(prompt + RETRY_SUFFIX);
      // `retry === null` alone is the right test, not `raw === null && retry === null`:
      // summarizeCase ALWAYS issues the retry when the base response fails to parse, so a
      // missing retry entry proves the cache is incomplete even when the base entry exists.
      // The old guard let that case fall through to noClaims and silently shrink the
      // population — the exact failure this guard was written to prevent.
      if (retry === null) {
        // A miss means either the cache is incomplete or this script reconstructs the
        // prompt differently from the run. Both make the distribution meaningless, so
        // stop rather than silently measure a biased subset.
        throw new Error(
          `cache miss for ${c.id}. Either scripts/.cache/llm is incomplete, or the prompt ` +
          `reconstruction has drifted from summarizeCase. Do NOT interpret a partial run.`);
      }
      claims = retry === null ? null : parseClaims(retry);
    }
    if (!claims) { noClaims++; continue; }

    cases++;
    // Authoritative drop count from the shipped verifier…
    const truth = verifyClaims(claims, c.chunks, c.provenance.sourceUrl).dropped;

    // …and our own pass, which additionally tells us WHICH claim dropped.
    let anchors = 0, mine = 0;
    for (const cl of claims) {
      if (anchors >= 6) { mine++; preRejected++; continue; }
      const q = normWs(cl.quote ?? "");
      if (!(cl.text ?? "").trim() || q.length < 15) { mine++; preRejected++; continue; }
      const v = classifyDrop(cl.quote ?? "", c.chunks, assembled);
      if (v.cause === "locate_bug") { anchors++; continue; } // it verified — not a drop
      mine++;
      tally[v.cause]++;
      totalDrops++;
      if (v.elisionDiag) diagTally[v.elisionDiag][v.cause] = (diagTally[v.elisionDiag][v.cause] ?? 0) + 1;
      if (v.cause === "transcription") transcriptionOverlaps.push(v.bestOverlap);
      if (samples[v.cause].length < 3) {
        samples[v.cause].push(
          `${c.id} ${v.bestPara ?? "?"} overlap=${v.bestOverlap.toFixed(2)} divergeAt=${v.divergenceAt ?? "-"}\n` +
          `        quote: ${JSON.stringify(q.slice(0, 150))}`);
      }
    }
    // If our replication and the shipped verifier disagree, the buckets describe a
    // different population than the one the run reported.
    if (mine !== truth) {
      mismatches++;
      console.log(`   ⚠ ${c.id}: replicated ${mine} drops, verifyClaims says ${truth}`);
    }
  }

  // totalDrops counts SPAN drops only. Claims rejected for over_cap / no_text /
  // quote_too_short never reach classifyDrop, so they are outside every bucket AND outside
  // the denominator of the fabrication interval below. Printed so the reader can see whether
  // that denominator is the whole population or only part of it.
  console.log(`\n${totalDrops} span-dropped claims across ${cases} cases · ${noClaims} cases had no parseable claims${curated ? ` · ${curated} curated (outside the population)` : ""}`);
  console.log(`${preRejected} further claims rejected before classification (over_cap / no_text / quote_too_short)` +
    (preRejected ? " — the fabrication denominator below EXCLUDES these" : ""));
  // ALWAYS printed. This — not the locate_bug row — is the evidence that our classifier and
  // the shipped verifier agree on what is findable. The locate_bug row is reclassified into
  // `anchors` before the tally, so it can only ever read 0 and proves nothing on its own.
  console.log(`replication vs verifyClaims: ${mismatches} disagreement(s) across ${cases} cases` +
    (mismatches ? " — TREAT THE DISTRIBUTION AS SUSPECT" : ""));
  console.log("");
  for (const cause of ORDER) {
    console.log(`  ${cause.padEnd(19)} ${String(tally[cause]).padStart(4)}   ${NOTE[cause]}`);
  }
  // elision belongs here: its fragments match exactly, so anchoring them needs no alignment.
  const recoverable = tally.marker_bleed + tally.assembly_boundary + tally.normalization + tally.elision;
  console.log(`\n  recoverable without span alignment: ${recoverable}`);

  console.log(`\n  elision diagnostics (quotes containing an ellipsis that missed the bucket):`);
  for (const d of DIAGS) {
    console.log(`    ${d.padEnd(20)} transcription ${String(diagTally[d].transcription).padStart(4)} · unseen ${String(diagTally[d].unseen).padStart(4)}`);
  }

  // The most generous reading the evidence permits: every DIAGNOSED elision sitting in
  // `unseen` is legitimate quoting EXCEPT fragment_not_found, where a fragment appears in no
  // chunk at all and is therefore invented text by definition.
  //
  // Subtracting only cross_chunk_only — as this originally did — left out_of_order claims
  // inside a number labelled a fabrication floor, and an out_of_order claim has EVERY
  // fragment present in the corpus. It also left fragment_too_short, which is undecidable
  // and therefore belongs on the generous side of an interval, not inside the floor.
  const benignInUnseen = diagTally.cross_chunk_only.unseen + diagTally.out_of_order.unseen +
                         diagTally.fragment_too_short.unseen;
  const floor = tally.unseen - benignInUnseen;
  const pc = (n: number) => (totalDrops ? ((n / totalDrops) * 100).toFixed(1) : "0") + "%";
  console.log(`\n  fabrication rate: ${pc(floor)} (floor — only fragment_not_found and undiagnosed unseen)` +
              ` … ${pc(tally.unseen)} (ceiling — all of unseen)`);

  const sorted = [...transcriptionOverlaps].sort((a, b) => a - b);
  // Nearest-rank: ceil(f·n) − 1. Math.floor(f·n) sits one order statistic high whenever f·n
  // is an integer, which turns "p90" into the maximum on small n.
  const q = (f: number) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(f * sorted.length) - 1))] : 0;
  console.log(`\n  transcription overlap (n=${sorted.length}): ` +
    ["p10", "p25", "p50", "p75", "p90"].map((l, i) => `${l} ${q([0.1, 0.25, 0.5, 0.75, 0.9][i]).toFixed(2)}`).join(" · "));
  // Integer bin indices, NOT `lo += 0.05`: accumulated float error would leave the last bound
  // at 0.9999… and misplace values near the top. Note an overlap of exactly 1.00 is
  // impossible here — a fully contiguous quote returns locate_bug and is never a drop — so
  // the inclusive upper bound on the last bin is a guard, not a live case.
  for (let b = 10; b < 20; b++) {
    const lo = b / 20, hi = (b + 1) / 20;
    const n = sorted.filter((o) => o >= lo && (b === 19 ? o <= hi : o < hi)).length;
    if (n) console.log(`    ${lo.toFixed(2)}–${hi.toFixed(2)}  ${String(n).padStart(4)}  ${"█".repeat(Math.round((n / sorted.length) * 60))}`);
  }
  for (const cause of ORDER) {
    if (!samples[cause].length) continue;
    console.log(`\n### ${cause}`);
    for (const s of samples[cause]) console.log(`  - ${s}`);
  }
}
main().catch((e) => { console.error("❌ cases-drop-forensics failed:", e); process.exit(1); });
