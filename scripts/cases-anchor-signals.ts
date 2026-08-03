// Read-only: how much does the uniqueness guard cost, and could the model's own cited
// paragraph break the ties it declines?
//
// Claim recovery (#227) anchors a claim when exactly one paragraph scores >=0.95. What
// blocks progress now is strong matches that are AMBIGUOUS: 2008-scc-41 has no summary at
// all despite a 0.97 best match, because a second paragraph also cleared 0.95. Lowering the
// threshold would not help — it is already above it.
//
// The candidate tie-breaker is `citedPara`: the model's bookkeeping and our text matching are
// independent, so agreement is real corroboration. But summarizer.ts records that models
// misattribute paragraph ids about half the time. Whether they do so AMONG THE CLAIMS WHERE
// TWO PARAGRAPHS MATCH STRONGLY is what nobody has measured, and it is the only thing that
// decides whether a tie-breaker is safe.
//
// ZERO LLM calls — model responses replay from scripts/.cache/llm. Needs DynamoDB read.
// Writes nothing.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { assembleInput, buildPrompt, parseClaims, verifyClaims, RETRY_SUFFIX } from "../src/lib/cases/ingest/summarizer";
import type { ClaimDrop } from "../src/lib/cases/ingest/summarizer";

const CACHE = path.join(process.cwd(), "scripts", ".cache", "llm");
const MODEL_ID = process.env.SUMMARY_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";
const keyFor = (p: string) => createHash("sha256").update(MODEL_ID + "\n" + p).digest("hex").slice(0, 32);
const readCache = async (p: string) => {
  try { return await fs.readFile(path.join(CACHE, keyFor(p) + ".txt"), "utf8"); } catch { return null; }
};

const BANDS: [string, number, number][] = [
  [">=0.95", 0.95, 1.01],
  ["0.90-0.95", 0.90, 0.95],
  ["0.80-0.90", 0.80, 0.90],
  ["0.50-0.80", 0.50, 0.80],
  ["<0.50", 0, 0.50],
];

type Row = {
  drops: number; declined: number;
  citedIsBest: number; citedIsRival: number; citedIsAdjacent: number; citedElsewhere: number; citedNoDigits: number;
  // Overlay, NOT a bucket: counts declines whose cited value production's findCited cannot
  // resolve at all. Such a claim is still classified above by digit, so this number overlaps
  // every column and must never be added to them.
  unresolvedByProduction: number;
};
const empty = (): Row => ({
  drops: 0, declined: 0, citedIsBest: 0, citedIsRival: 0, citedIsAdjacent: 0, citedElsewhere: 0,
  citedNoDigits: 0, unresolvedByProduction: 0,
});

// The cited paragraph is free text from the model, and models wrap it: the first run saw
// "[para-96]", which findCited (summarizer.ts:128) accepts in neither of its two forms, so a
// value that IS the rival was filed as an absent paragraph. Comparing on the paragraph NUMBER
// is deliberately looser than production. That is correct here and only here: this report
// measures a CEILING for a tie-breaker, so the most generous defensible reading is the one
// that bounds it. Nothing downstream may reuse this — production's stricter behaviour is
// reported separately as `unresolvedByProduction`.
//
// First digit run only. Paragraph ids in this corpus are "para-N"; an id carrying two numbers
// would be read by its first, which is worth knowing if the corpus ever gains one.
const digits = (s: string | null) => s?.match(/\d+/)?.[0] ?? null;
const same = (cited: string, para: string | null) => {
  const c = digits(cited), p = digits(para);
  return c !== null && c === p;
};
// An off-by-one cited paragraph is a systematic numbering offset, not the coin-flip
// misattribution the "neither" column would imply. Separated so the two cannot be conflated.
const adjacent = (cited: string, para: string | null) => {
  const c = digits(cited), p = digits(para);
  return c !== null && p !== null && Math.abs(Number(c) - Number(p)) === 1;
};

async function main() {
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  const rows = new Map(BANDS.map(([n]) => [n, empty()]));
  const declinedSamples: string[] = [];
  let cases = 0, totalDrops = 0, unmeasured = 0, curated = 0;

  for (const prof of profiles) {
    const c = await dynamoCaseRepo.getCase(prof.id);
    if (!c?.chunks?.length) continue;
    // A hand-curated summary (enrichment.ts, flagship cases) was never produced by a model,
    // so by design there is no cached response to replay and no model claims to verify —
    // this case is outside the population, not a gap in the cache.
    //
    // This is not hypothetical: 2014-scc-44 is curated, and until the SCC backfill gave it
    // 62 chunks the `!chunks.length` guard above skipped it. Once it had text it reached the
    // cache lookup and aborted every replay run. Correcting the population is the fix; the
    // cache-miss guard below stays exactly as strict.
    if (c.summary && c.summaryMeta?.method !== "llm") { curated++; continue; }
    const assembled = assembleInput(c.chunks, c.outcome.holding);
    const prompt = buildPrompt(c, assembled);
    const raw = await readCache(prompt);
    let claims = raw === null ? null : parseClaims(raw);
    if (!claims) {
      const retry = await readCache(prompt + RETRY_SUFFIX);
      // A miss means the cache no longer matches the prompts the corpus would produce —
      // exactly what happened after the SCC backfill changed 19 cases' text. Measuring a
      // partial population is the failure mode this whole line of work keeps hitting.
      if (retry === null) {
        throw new Error(`cache miss for ${c.id}. Re-run cases:summarize first, or the ` +
          `distribution describes an unrepresentative subset. Do NOT interpret a partial run.`);
      }
      claims = parseClaims(retry);
    }
    if (!claims) continue;
    cases++;
    const { drops } = verifyClaims(claims, c.chunks, c.provenance.sourceUrl, { measureOverlap: true });
    for (const d of drops as ClaimDrop[]) {
      if (d.reason !== "no_span") continue;
      totalDrops++;
      if (!d.overlapMeasured) { unmeasured++; continue; }
      const band = BANDS.find(([, lo, hi]) => d.bestOverlap >= lo && d.bestOverlap < hi);
      if (!band) continue;
      const r = rows.get(band[0])!;
      r.drops++;
      if (d.declinedByGuard) {
        r.declined++;
        if (!d.citedParaFound) r.unresolvedByProduction++;
        if (same(d.citedPara, d.bestPara)) r.citedIsBest++;
        else if (same(d.citedPara, d.rivalPara)) r.citedIsRival++;
        else if (adjacent(d.citedPara, d.bestPara)) r.citedIsAdjacent++;
        else if (digits(d.citedPara) === null) r.citedNoDigits++;
        else r.citedElsewhere++;
        // Every decline, not a sample: 15 rows is small enough to read in full, and the first
        // run's misclassification was only visible because a raw cited value was printed.
        declinedSamples.push(
          `${c.id.padEnd(14)} best=${d.bestPara}@${d.bestOverlap.toFixed(2)} ` +
          `rival=${d.rivalPara}@${d.rival.toFixed(2)} cited=${JSON.stringify(d.citedPara)}` +
          (d.citedParaFound ? "" : " (production: unresolvable)"));
      }
    }
  }

  console.log(`\n${totalDrops} no_span drops across ${cases} cases${unmeasured ? ` · ${unmeasured} unmeasured` : ""}${curated ? ` · ${curated} curated-summary case(s) outside the population` : ""}\n`);
  console.log("band        drops  declined   cited=best  cited=rival  best±1  elsewhere  no-digits   (unresolvable)");
  for (const [name] of BANDS) {
    const r = rows.get(name)!;
    console.log(`${name.padEnd(11)} ${String(r.drops).padStart(5)}  ${String(r.declined).padStart(8)}   ` +
      `${String(r.citedIsBest).padStart(10)}  ${String(r.citedIsRival).padStart(11)}  ${String(r.citedIsAdjacent).padStart(6)}  ` +
      `${String(r.citedElsewhere).padStart(9)}  ${String(r.citedNoDigits).padStart(9)}   ${String(r.unresolvedByProduction).padStart(13)}`);
  }
  console.log(`\n(unresolvable) overlaps the columns to its left — it counts declines whose cited value`);
  console.log(`production's findCited cannot resolve, and is NOT additive with them.`);

  const top = rows.get(">=0.95")!;
  console.log(`\nWhat the guard costs at >=0.95: ${top.declined} claims declined for ambiguity.`);
  if (top.declined > 0) {
    const usable = top.citedIsBest + top.citedIsRival;
    console.log(`  citedPara names one of the two candidates in ${usable}/${top.declined}` +
      ` (${((usable / top.declined) * 100).toFixed(0)}%) — the CEILING for a tie-breaker, on the`);
    console.log(`  generous digit comparison. It agrees with the BEST match in ${top.citedIsBest}, the rival in ${top.citedIsRival}.`);
    // A ceiling stated without its sampling error invites reading 6:2 as a 75% success rate.
    // The two-sided binomial tail against a coin flip is the cheapest honest brake on that.
    const n = usable, k = Math.max(top.citedIsBest, top.citedIsRival);
    if (n > 0) {
      const choose = (a: number, b: number) => { let v = 1; for (let i = 0; i < b; i++) v = (v * (a - i)) / (i + 1); return v; };
      let tail = 0;
      for (let i = k; i <= n; i++) tail += choose(n, i);
      const p = Math.min(1, 2 * tail / Math.pow(2, n));
      console.log(`  On n=${n}, a ${top.citedIsBest}:${top.citedIsRival} split differs from a coin flip with two-sided p=${p.toFixed(2)}.`);
    }
    console.log(`  ${top.unresolvedByProduction}/${top.declined} carry a cited value production's findCited cannot resolve at all.`);
  }
  if (declinedSamples.length) {
    console.log(`\nall ${declinedSamples.length} declines:`);
    for (const s of declinedSamples) console.log(`  ${s}`);
  }
}
main().catch((e) => { console.error("❌ cases-anchor-signals failed:", e.message); process.exit(1); });
