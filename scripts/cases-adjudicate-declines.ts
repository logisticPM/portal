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
import { assembleInput, buildPrompt, parseClaims, verifyClaims, RETRY_SUFFIX } from "../src/lib/cases/ingest/summarizer";
import { modelFromId, cachedModel } from "../src/lib/cases/ingest/llm";
import { seededShuffle } from "../src/lib/cases/caseqa-eval/rng";
import { buildAdjudicationPrompt, parsePick } from "../src/lib/cases/adjudicate/prompt";
import { tally, FLIP_GATE, ABSTENTION_GATE, type PairRow, type Answer } from "../src/lib/cases/adjudicate/tally";
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
    const text = new Map(c.chunks.map((ch) => [ch.paragraph, ch.text]));
    for (const d of verifyClaims(claims, c.chunks, c.provenance.sourceUrl, { measureOverlap: true }).drops) {
      if (!d.declinedByGuard || !d.bestPara || !d.rivalPara) continue;
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
      });
    }
  }
  if (!declines.length) throw new Error("the guard declines nothing in this corpus — nothing to adjudicate");

  // --- judge each pair TWICE, order swapped (spec §4) --------------------------------
  const rows: PairRow[] = [];
  // Seeded so the assignment is reproducible; which candidate goes first is decided per pair
  // rather than always best-first, so a position-preferring judge cannot score well by default.
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
      citedPara: d.citedPara, first: side(one, bestFirst[i]), second: side(two, !bestFirst[i]),
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
    const flag = r.first === null || r.second === null ? "UNPARSEABLE"
      : r.first !== r.second ? "FLIPPED"
      : r.first === "unsure" ? "unsure" : `picked ${r.first}`;
    console.log(`  ${r.caseId.padEnd(14)} best=${r.bestPara.padEnd(9)} rival=${r.rivalPara.padEnd(9)} cited=${r.citedPara.padEnd(11)} ${flag}`);
    console.log(`        quote: ${JSON.stringify(r.quote.slice(0, 130))}`);
  }

  console.log(`\n--- results (NOT ground truth: no human read any of this) ---`);
  console.log(`  flip rate        ${(t.flipRate * 100).toFixed(1)}%  (${t.flipped}/${t.pairs})  gate ${(FLIP_GATE * 100).toFixed(0)}%${t.flipGateTripped ? "  ** TRIPPED **" : ""}`);
  console.log(`  unparseable      ${t.unparseable}/${t.pairs}  (our failure, never counted as an abstention)`);
  console.log(`  abstention rate  ${(t.abstentionRate * 100).toFixed(1)}%  (${t.abstained}/${t.consistent} order-consistent)  gate ${(ABSTENTION_GATE * 100).toFixed(0)}%${t.abstentionGateTripped ? "  ** TRIPPED **" : ""}`);
  console.log(`  decided          ${t.decided}  · of those, citedPara names neither candidate in ${t.citedNamesNeither}`);
  if (t.agreementRate === null) {
    console.log(`  agreement        WITHHELD — the flip gate tripped, so spec §3 does not permit computing it`);
  } else {
    console.log(`  agreement        ${(t.agreementRate * 100).toFixed(1)}%  (${t.agreed}/${t.comparable} comparable)  two-sided p=${t.p?.toFixed(2)}`);
  }
  console.log(`\n  Per spec §3, a positive here would be a reason to seek ground truth — never a reason to build.`);
}
main().catch((e) => { console.error("❌ cases-adjudicate-declines failed:", e instanceof Error ? e.message : String(e)); process.exit(1); });
