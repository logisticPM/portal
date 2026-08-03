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
  // Mutually exclusive and exhaustive over `declined`; the reconciliation below asserts it.
  citedIsBest: number; citedIsRival: number;
  adjacentToBest: number; adjacentToRival: number;
  citedElsewhere: number; citedNoDigits: number;
  // Overlay, NOT a bucket: counts declines whose cited value production's findCited cannot
  // resolve at all. Such a claim is still classified above by digit, so this number overlaps
  // every column and must never be added to them.
  unresolvedByProduction: number;
  // Agreement restricted to what production could actually reach — findCited resolved the
  // value AND it names the candidate. Counted directly rather than derived by subtracting
  // `unresolvedByProduction` from the digit columns: that subtraction silently assumes every
  // unresolvable value digit-matches a candidate, which is true of this corpus by luck and
  // not true in general.
  strictBest: number; strictRival: number;
};
const empty = (): Row => ({
  drops: 0, declined: 0, citedIsBest: 0, citedIsRival: 0, adjacentToBest: 0, adjacentToRival: 0,
  citedElsewhere: 0, citedNoDigits: 0, unresolvedByProduction: 0, strictBest: 0, strictRival: 0,
});
const buckets = (r: Row) =>
  r.citedIsBest + r.citedIsRival + r.adjacentToBest + r.adjacentToRival + r.citedElsewhere + r.citedNoDigits;

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
//
// Tested against BOTH candidates. Testing only `bestPara` — as the first version did — filed
// 2003-nsca-105 (best=para-128, rival=para-19, cited="para-20") under `elsewhere`, an
// off-by-one against the RIVAL counted as random misattribution. That asymmetry contradicted
// the very claim the column exists to support.
const adjacent = (cited: string, ...paras: (string | null)[]) => {
  const c = digits(cited);
  return c !== null && paras.some((p) => {
    const d = digits(p);
    return d !== null && Math.abs(Number(c) - Number(d)) === 1;
  });
};
// Which candidate an offset points at, once one does. Needed because an offset-tolerant
// tie-breaker's best:rival split is not the exact-match split.
const adjacentSide = (cited: string, best: string | null, rival: string | null) =>
  adjacent(cited, best) ? "best" : adjacent(cited, rival) ? "rival" : null;

async function main() {
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  const rows = new Map(BANDS.map(([n]) => [n, empty()]));
  const declinedSamples: string[] = [];
  let cases = 0, totalDrops = 0, curated = 0, noClaims = 0;

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
    // Counted and printed rather than skipped in silence. cases-drop-forensics.ts reports the
    // same number; a population that shrinks without saying so is what every abort guard in
    // this script exists to prevent.
    if (!claims) { noClaims++; continue; }
    cases++;
    const { drops } = verifyClaims(claims, c.chunks, c.provenance.sourceUrl, { measureOverlap: true });
    for (const d of drops) {
      if (d.reason !== "no_span") continue;
      totalDrops++;
      // Invariants, not defensive skips. `overlapMeasured` is `measure && no_span &&
      // quote.length > 0`, and a no_span quote already cleared the 15-char floor, so it must be
      // true here. The bands tile [0, 1.01) and bestOverlap is LCS/quote.length ∈ [0, 1]. If
      // either ever fails, a drop would vanish from the table while still sitting in
      // totalDrops — a silently partial distribution, which this script refuses to produce.
      if (!d.overlapMeasured) throw new Error(`${c.id}: no_span drop with overlapMeasured=false — the invariant broke, refusing to report a partial table`);
      const band = BANDS.find(([, lo, hi]) => d.bestOverlap >= lo && d.bestOverlap < hi);
      if (!band) throw new Error(`${c.id}: bestOverlap ${d.bestOverlap} fell outside every band — refusing to report a partial table`);
      const r = rows.get(band[0])!;
      r.drops++;
      if (d.declinedByGuard) {
        r.declined++;
        if (!d.citedParaFound) r.unresolvedByProduction++;
        if (d.citedParaFound && same(d.citedPara, d.bestPara)) r.strictBest++;
        if (d.citedParaFound && same(d.citedPara, d.rivalPara)) r.strictRival++;
        const side = adjacentSide(d.citedPara, d.bestPara, d.rivalPara);
        if (same(d.citedPara, d.bestPara)) r.citedIsBest++;
        else if (same(d.citedPara, d.rivalPara)) r.citedIsRival++;
        else if (side === "best") r.adjacentToBest++;
        else if (side === "rival") r.adjacentToRival++;
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

  console.log(`\n${totalDrops} no_span drops across ${cases} cases` +
    `${curated ? ` · ${curated} curated-summary case(s) outside the population` : ""}` +
    `${noClaims ? ` · ${noClaims} case(s) with no parseable claims` : ""}\n`);
  console.log("band        drops  declined   cited=best  cited=rival  best±1  rival±1  elsewhere  no-digits   (unresolvable)");
  let banded = 0;
  for (const [name] of BANDS) {
    const r = rows.get(name)!;
    banded += r.drops;
    // Cheap, and it is the only thing standing between a mis-summed column and a published
    // headline computed on a 15-row denominator.
    if (buckets(r) !== r.declined) {
      throw new Error(`band ${name}: columns sum to ${buckets(r)} but ${r.declined} were declined — the classifier is not exhaustive`);
    }
    console.log(`${name.padEnd(11)} ${String(r.drops).padStart(5)}  ${String(r.declined).padStart(8)}   ` +
      `${String(r.citedIsBest).padStart(10)}  ${String(r.citedIsRival).padStart(11)}  ${String(r.adjacentToBest).padStart(6)}  ` +
      `${String(r.adjacentToRival).padStart(7)}  ${String(r.citedElsewhere).padStart(9)}  ` +
      `${String(r.citedNoDigits).padStart(9)}   ${String(r.unresolvedByProduction).padStart(13)}`);
  }
  if (banded !== totalDrops) throw new Error(`bands hold ${banded} drops but ${totalDrops} were counted`);
  console.log(`\n(unresolvable) overlaps the columns to its left — it counts declines whose cited value`);
  console.log(`production's findCited cannot resolve, and is NOT additive with them.`);
  console.log(`Columns reconcile: ${banded} banded = ${totalDrops} counted, and each band's buckets sum to its declined.`);

  const top = rows.get(">=0.95")!;
  console.log(`\nWhat the guard costs at >=0.95: ${top.declined} claims declined for ambiguity.`);
  if (top.declined > 0) {
    // Exact float for every (n,k) with n <= 15, checked against BigInt.
    const choose = (a: number, b: number) => { let v = 1; for (let i = 0; i < b; i++) v = (v * (a - i)) / (i + 1); return v; };
    // Two-sided binomial against p=0.5. Exact by doubling because Binomial(n, 0.5) is
    // symmetric; k is the more extreme of the two counts.
    const pValue = (best: number, rival: number) => {
      const n = best + rival, k = Math.max(best, rival);
      if (n === 0) return 1;
      let tail = 0;
      for (let i = k; i <= n; i++) tail += choose(n, i);
      return Math.min(1, 2 * tail / Math.pow(2, n));
    };
    // THREE ceilings, not one. How many claims a tie-breaker could reach depends entirely on
    // how permissively it reads the model's cited paragraph, and reporting only the middle
    // number understates the prize while reporting only the loosest overstates the signal.
    //
    // The `strict` row is production's own behaviour: findCited accepts "N" and "para-N" and
    // nothing else, so a bracket-wrapped value is unreachable to it.
    const rows3: [string, number, number, string][] = [
      ["strict (production findCited)", top.strictBest, top.strictRival, "exact id, brackets unreadable"],
      ["digit-normalised", top.citedIsBest, top.citedIsRival, "exact paragraph number"],
      ["offset-tolerant", top.citedIsBest + top.adjacentToBest, top.citedIsRival + top.adjacentToRival,
        "exact number or ±1"],
    ];
    console.log(`  A tie-breaker's reach depends on how permissively it reads citedPara:\n`);
    console.log(`  reading                        names a candidate   best:rival   two-sided p`);
    for (const [label, b, rv, note] of rows3) {
      const n = b + rv;
      console.log(`  ${label.padEnd(30)} ${String(n).padStart(6)}/${top.declined}` +
        `${` (${((n / top.declined) * 100).toFixed(0)}%)`.padEnd(11)} ${`${b}:${rv}`.padStart(7)}` +
        `      ${pValue(b, rv).toFixed(2)}   ${note}`);
    }
    console.log(`\n  ${top.unresolvedByProduction}/${top.declined} carry a cited value production's findCited cannot resolve at all.`);
  }
  if (declinedSamples.length) {
    console.log(`\nall ${declinedSamples.length} declines:`);
    for (const s of declinedSamples) console.log(`  ${s}`);
  }
}
main().catch((e) => { console.error("❌ cases-anchor-signals failed:", e.message); process.exit(1); });
