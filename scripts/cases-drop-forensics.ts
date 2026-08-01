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
import { classifyDrop, type DropCause } from "../src/lib/cases/ingest/drop-cause";

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
  locate_bug: "BUG in locate() — investigate before reading anything else",
  marker_bleed: "recoverable — our prompt marker",
  assembly_boundary: "recoverable — our assembly seam",
  normalization: "recoverable — widen normWs",
  elision: "not a defect — legitimate quoting with the middle omitted",
  transcription: "recoverable only by span alignment",
  unseen: "NOT recoverable — the model was never shown this text",
};

async function main() {
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  const tally = Object.fromEntries(ORDER.map((c) => [c, 0])) as Record<DropCause, number>;
  const samples = Object.fromEntries(ORDER.map((c) => [c, [] as string[]])) as Record<DropCause, string[]>;
  let cases = 0, totalDrops = 0, noClaims = 0, mismatches = 0;

  for (const prof of profiles) {
    const c = await dynamoCaseRepo.getCase(prof.id);
    if (!c?.chunks?.length) continue;

    const assembled = assembleInput(c.chunks, c.outcome.holding);
    const prompt = buildPrompt(c, assembled);

    // summarizeCase's exact sequence: the base prompt, then one retry whose suffix
    // changes the cache key. Trying them in the other order would re-derive claims the
    // run never used.
    let raw = await readCache(prompt);
    let claims = raw === null ? null : parseClaims(raw);
    if (!claims) {
      const retry = await readCache(prompt + RETRY_SUFFIX);
      if (raw === null && retry === null) {
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
      if (anchors >= 6) { mine++; continue; }
      const q = normWs(cl.quote ?? "");
      if (!(cl.text ?? "").trim() || q.length < 15) { mine++; continue; }
      const v = classifyDrop(cl.quote ?? "", c.chunks, assembled);
      if (v.cause === "locate_bug") { anchors++; continue; } // it verified — not a drop
      mine++;
      tally[v.cause]++;
      totalDrops++;
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

  console.log(`\n${totalDrops} dropped claims across ${cases} cases · ${noClaims} cases had no parseable claims`);
  if (mismatches) console.log(`⚠ ${mismatches} cases where replication disagreed with verifyClaims — treat the distribution as suspect`);
  console.log("");
  for (const cause of ORDER) {
    console.log(`  ${cause.padEnd(19)} ${String(tally[cause]).padStart(4)}   ${NOTE[cause]}`);
  }
  const recoverable = tally.marker_bleed + tally.assembly_boundary + tally.normalization;
  console.log(`\n  recoverable without span alignment: ${recoverable}`);
  console.log(`  fabrication rate (unseen / total): ${totalDrops ? ((tally.unseen / totalDrops) * 100).toFixed(1) : "0"}%`);
  for (const cause of ORDER) {
    if (!samples[cause].length) continue;
    console.log(`\n### ${cause}`);
    for (const s of samples[cause]) console.log(`  - ${s}`);
  }
}
main().catch((e) => { console.error("❌ cases-drop-forensics failed:", e); process.exit(1); });
