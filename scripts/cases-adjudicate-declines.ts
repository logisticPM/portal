// Blind adjudication of the claims the uniqueness guard declines (spec 2026-08-04).
//
// NOT GROUND TRUTH. No human reads anything here — the adjudication is LLM-only by decision,
// so whatever the judge picks we do not learn which paragraph a quotation came from. What this
// CAN establish, per spec §3, is a negative or a methodological result: whether the judge's
// answer survives swapping the presentation order, and how often it abstains. Three of the four
// possible outcomes close the tie-breaker line.
//
// Model responses for the REPLAY come from scripts/.cache/llm (zero LLM calls to re-derive the
// population). The judge calls are new but cached. Writes nothing to the table.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { assembleInput, buildPrompt, parseClaims, verifyClaims, normWs, RETRY_SUFFIX } from "../src/lib/cases/ingest/summarizer";
import { modelFromId, cachedModel } from "../src/lib/cases/ingest/llm";
import { seededShuffle } from "../src/lib/cases/caseqa-eval/rng";
import { buildAdjudicationPrompt, parsePick } from "../src/lib/cases/adjudicate/prompt";
import { tally, citedSide, FLIP_GATE, ABSTENTION_GATE, type PairRow, type Answer } from "../src/lib/cases/adjudicate/tally";
import { assertJudgeIsNotSummarizer } from "../src/lib/cases/adjudicate/guards";

const CACHE = path.join(process.cwd(), "scripts", ".cache", "llm");
const SUMMARY_MODEL = process.env.SUMMARY_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";
const JUDGE = process.env.ADJ_JUDGE_MODEL ?? "us.anthropic.claude-opus-4-5-20251101-v1:0";
const SEED = Number(process.env.ADJ_SEED ?? 1);
const JUDGE_MAX_TOKENS = 256;

const keyFor = (p: string) => createHash("sha256").update(SUMMARY_MODEL + "\n" + p).digest("hex").slice(0, 32);
const readCache = async (p: string) => {
  try { return await fs.readFile(path.join(CACHE, keyFor(p) + ".txt"), "utf8"); } catch { return null; }
};

async function main() {
  // Spec §7/§9.1, in guards.ts so it has a test.
  assertJudgeIsNotSummarizer(JUDGE, SUMMARY_MODEL);
  const judge = cachedModel(modelFromId(JUDGE, { maxTokens: JUDGE_MAX_TOKENS }));

  // --- re-derive the declined population by replaying the warm cache (spec §6) -------
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  // Paragraph TEXT is captured here, during the replay, rather than re-fetched later: the loop
  // already holds every case, and a second getCase pass per decline would re-read cases we have.
  const declines: {
    caseId: string; quote: string;
    bestPara: string; rivalPara: string; citedPara: string;
    bestText: string; rivalText: string;
    bestOverlap: number; rivalOverlap: number;
  }[] = [];
  let cases = 0, curated = 0, noClaims = 0;
  for (const prof of profiles) {
    const c = await dynamoCaseRepo.getCase(prof.id);
    if (!c?.chunks?.length) continue;
    // A hand-curated summary was never produced by a model, so there is no cached response to
    // replay — outside the population, not a gap in the cache.
    if (c.summary && c.summaryMeta?.method !== "llm") { curated++; continue; }
    const prompt = buildPrompt(c, assembleInput(c.chunks, c.outcome.holding));
    const raw = await readCache(prompt);
    let claims = raw === null ? null : parseClaims(raw);
    if (!claims) {
      const retry = await readCache(prompt + RETRY_SUFFIX);
      // A miss means the cache no longer matches the prompts the corpus would produce.
      // Measuring a partial population is the failure this line of work keeps hitting.
      if (retry === null) {
        throw new Error(`cache miss for ${c.id}. Re-run cases:summarize first, or the population ` +
          `describes an unrepresentative subset. Do NOT interpret a partial run.`);
      }
      claims = parseClaims(retry);
    }
    if (!claims) { noClaims++; continue; }
    cases++;
    // normWs, matching what `verifyClaims` scored against (spec §11's amendment) and what the
    // drop record's `quote` field already is (`normWs(cl.quote)`). Building this map from RAW
    // `ch.text` instead would show the judge a paragraph with every curly apostrophe and
    // collapsed whitespace run still in it, against a quotation that has already had both
    // stripped — a mismatch the guard itself never saw, in a task whose entire content is
    // comparing wording. Symmetric across both candidates, so not a blinding leak, but it would
    // break the link this instrument rests on: that it describes what production compares
    // rather than a re-implementation of it.
    const text = new Map(c.chunks.map((ch) => [ch.paragraph, normWs(ch.text)]));
    for (const d of verifyClaims(claims, c.chunks, c.provenance.sourceUrl, { measureOverlap: true }).drops) {
      // Filter: only claims the uniqueness guard actually declined are in this instrument's
      // population.
      if (!d.declinedByGuard) continue;
      // Narrowing, kept separate from the filter above: `declinedByGuard` is only ever true when
      // `bestOverlap >= NEAR && rival >= NEAR`, both of which require `bestPara`/`rivalPara` to
      // be set (see verifyClaims). So this branch is unreachable in fact, but it exists for TS's
      // benefit — and in a runner whose whole discipline is abort-on-anomaly, a row that somehow
      // got here without both paragraph ids must throw, not silently vanish from the population
      // via the same `continue` that filters out non-declines.
      if (!d.bestPara || !d.rivalPara) {
        throw new Error(`${c.id}: declinedByGuard=true but bestPara/rivalPara missing — ` +
          `this should be unreachable by construction`);
      }
      const bestText = text.get(d.bestPara), rivalText = text.get(d.rivalPara);
      // Both paragraphs are by construction chunks of THIS case — verifyClaims derives bestPara
      // and rivalPara from the same array. If either is missing the association is broken and a
      // blank paragraph would be handed to the judge as if it were evidence.
      if (!bestText || !rivalText) {
        throw new Error(`${c.id}: declined claim cites ${d.bestPara}/${d.rivalPara}, absent from chunks`);
      }
      declines.push({
        caseId: c.id, quote: d.quote, citedPara: d.citedPara,
        bestPara: d.bestPara, rivalPara: d.rivalPara, bestText, rivalText,
        bestOverlap: d.bestOverlap, rivalOverlap: d.rival,
      });
    }
  }
  if (!declines.length) throw new Error("the guard declines nothing in this corpus — nothing to adjudicate");

  // --- judge each pair TWICE, order swapped (spec §4) --------------------------------
  const rows: PairRow[] = [];
  // Seeded so the assignment is reproducible. This does NOT stop a position-preferring judge
  // from scoring well by itself — every pair is judged in BOTH orders, and a judge that always
  // just picks position 1 flips on every single pair and is excluded from every downstream
  // metric regardless of which candidate `bestFirst` happens to put first. `bestFirst` cannot
  // change the outcome for such a judge either way. What the seeded (rather than always
  // best-first) assignment actually buys is only what spec §4 mandates: it removes a FIXED
  // best-first presentation from the design, rather than claiming a detection mechanism it does
  // not have.
  const bestFirst = seededShuffle(declines.map((_, i) => i % 2 === 0), SEED);
  for (const [i, d] of declines.entries()) {
    const [p1, p2] = bestFirst[i] ? [d.bestText, d.rivalText] : [d.rivalText, d.bestText];
    // The two calls differ ONLY in the order the paragraphs appear.
    const one = parsePick(await judge.call(buildAdjudicationPrompt(d.quote, p1, p2)));
    const two = parsePick(await judge.call(buildAdjudicationPrompt(d.quote, p2, p1)));
    // Undo the A/B labelling. In ordering 1, "A" is the best match iff bestFirst[i]; ordering 2
    // is the inverse. Getting this backwards would silently invert every agreement result.
    const side = (pick: ReturnType<typeof parsePick>, bestIsA: boolean): Answer =>
      pick === null || pick === "unsure" ? pick : (pick === "A") === bestIsA ? "best" : "rival";
    rows.push({
      caseId: d.caseId, quote: d.quote, bestPara: d.bestPara, rivalPara: d.rivalPara,
      citedPara: d.citedPara,
      bestLen: d.bestText.length, rivalLen: d.rivalText.length,
      bestOverlap: d.bestOverlap, rivalOverlap: d.rivalOverlap,
      first: side(one, bestFirst[i]), second: side(two, !bestFirst[i]),
    });
  }

  const t = tally(rows);

  console.log(`\njudge      ${JUDGE}`);
  console.log(`summarizer ${SUMMARY_MODEL} (under test — cannot be the judge)`);
  console.log(`seed ${SEED} · replayed ${cases} cases · ${curated} curated outside the population` +
    `${noClaims ? ` · ${noClaims} with no parseable claims` : ""}`);
  console.log(`declines re-derived from the corpus: ${t.pairs} (not hardcoded — #228 published 15)`);

  console.log(`\n--- all ${rows.length} pairs ---`);
  for (const r of rows) {
    const unparseable = r.first === null || r.second === null;
    const flipped = !unparseable && r.first !== r.second;
    const abstained = !unparseable && !flipped && r.first === "unsure";
    const citedSideOf = citedSide(r.citedPara, r.bestPara, r.rivalPara);
    // "agreed" is only defined for a row that is consistent, decided, and comparable — spec
    // §9.5 requires it be printed rather than left for a reader to re-apply the digit rule by
    // eye against the aggregate.
    const agreed = !unparseable && !flipped && !abstained && citedSideOf !== null
      ? r.first === citedSideOf : null;
    console.log(`  ${r.caseId.padEnd(14)} best=${r.bestPara.padEnd(9)} rival=${r.rivalPara.padEnd(9)} cited=${r.citedPara.padEnd(11)}`);
    console.log(`        first=${r.first ?? "UNPARSEABLE"}  second=${r.second ?? "UNPARSEABLE"}  ` +
      `flipped=${flipped}  agreed=${agreed === null ? "n/a" : agreed}`);
    console.log(`        bestLen=${r.bestLen}  rivalLen=${r.rivalLen}  ` +
      `bestOverlap=${r.bestOverlap.toFixed(3)}  rivalOverlap=${r.rivalOverlap.toFixed(3)}`);
    console.log(`        quote: ${JSON.stringify(r.quote.slice(0, 130))}`);
  }

  console.log(`\n--- results (NOT ground truth: no human read any of this) ---`);
  console.log(`  flip rate        ${(t.flipRate * 100).toFixed(1)}%  (${t.flipped}/${t.readable} readable)  gate ${(FLIP_GATE * 100).toFixed(0)}%${t.flipGateTripped ? "  ** TRIPPED **" : ""}`);
  console.log(`  unparseable      ${t.unparseable}/${t.pairs}  (our failure, never counted as an abstention)`);
  console.log(`  abstention rate  ${(t.abstentionRate * 100).toFixed(1)}%  (${t.abstained}/${t.consistent} order-consistent)  gate ${(ABSTENTION_GATE * 100).toFixed(0)}%${t.abstentionGateTripped ? "  ** TRIPPED **" : ""}`);
  console.log(`  decided          ${t.decided}  · of those, citedPara names neither candidate in ${t.citedNamesNeither}`);
  // Two distinct causes for withholding (spec §8), never collapsed into one message: printing
  // "the flip gate tripped" when `comparable === 0` is instead what happened would make this
  // run's own output assert spec §3's outcome 1 while the data landed in outcome 2 or 3, which
  // §13 requires the findings doc to get right.
  if (t.agreementWithheldReason === "flip_gate_tripped") {
    console.log(`  agreement        WITHHELD — the flip gate tripped, so spec §3 does not permit computing it`);
  } else if (t.agreementWithheldReason === "no_comparable_rows") {
    console.log(`  agreement        WITHHELD — no comparable rows (decided=${t.decided}, citedNamesNeither=${t.citedNamesNeither}): ` +
      `citedPara names neither candidate in every decided row, so there is nothing to compare the judge's pick against`);
  } else {
    console.log(`  agreement        ${(t.agreementRate! * 100).toFixed(1)}%  (${t.agreed}/${t.comparable} comparable)  two-sided p=${t.p?.toFixed(2)}`);
  }
  console.log(`\n  Per spec §3, a positive here would be a reason to seek ground truth — never a reason to build.`);
}
main().catch((e) => { console.error("❌ cases-adjudicate-declines failed:", e instanceof Error ? e.message : String(e)); process.exit(1); });
