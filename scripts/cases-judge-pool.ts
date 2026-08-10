// Pool worklist -> graded gold (spec 2026-08-09).
//
// Run: AWS_PROFILE=bedrock npm run cases:pool:cloud > pool.json
//      AWS_PROFILE=bedrock npm run cases:judge-pool:cloud -- pool.json
//
// Rebuilds the WHOLE gold under one judge. The original judge (claude-opus-4-8) is no longer
// invocable, so the existing 140 judgments cannot be extended by their own judge — appending would
// produce a gold whose halves came from different and partly unavailable processes.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { modelFromId, cachedModel, hasCached, evictCached } from "../src/lib/cases/ingest/llm";
import { buildRelPrompt, parseRel, REL_RUBRIC_ID, type JudgeCase } from "../src/lib/cases/validate/judge-rel";
import { retryingModel } from "../src/lib/cases/sufficiency/retrying";
import { callParsed, type CacheOps } from "../src/lib/cases/nli-probe/repair";
import { seededShuffle } from "../src/lib/cases/caseqa-eval/rng";

const JUDGE = process.env.EVAL_JUDGE_MODEL ?? "us.anthropic.claude-opus-4-5-20251101-v1:0";
// Generous on purpose. The prompt asks for reasoning BEFORE the grade, and a response truncated
// mid-reasoning still returns text, so it does not throw — it just fails to parse, and an unparsed
// pair is scored 0 as if judged irrelevant. This project has already lost a run to a 64-token
// budget starving a checker. Note maxTokens is NOT part of the response-cache key, so raising this
// does not by itself repair entries already cached from a smaller budget; those must be evicted.
const JUDGE_MAX_TOKENS = 1024;
const SEED = Number(process.env.EVAL_SEED ?? 1);
const OUT = process.env.GOLD_FILE ?? "docs/research/gold/cases-retrieval-gold.jsonl";
// Size of the replay-determinism sample (see the block that uses it). This measures the endpoint
// and the cache, NOT the judge's stability — nothing is varied between the two calls.
const CONSISTENCY_SAMPLE = Number(process.env.CONSISTENCY_SAMPLE ?? 60);

let retries = 0, repairs = 0, callFailures = 0;
const CACHE_OPS: CacheOps = { hasCached, evictCached };

type Work = { qid: string; query: string; layer: string; candidates: string[] };

async function main() {
  const poolPath = process.argv[2];
  if (!poolPath) throw new Error("usage: cases-judge-pool.ts <pool.json>  (produced by `npm run cases:pool:cloud`)");
  const work: Work[] = JSON.parse(await fs.readFile(poolPath, "utf8"));
  if (!work.length) throw new Error("empty worklist — nothing to judge");

  // tier "all", NOT "core". The pool is drawn from the search index, and the index applies no tier
  // filter at all (build-index.ts admits every et === "Case"), so its ranked lists are over the full
  // corpus — 452 core plus 4,597 substrate. Loading only core here would leave ~90% of every pooled
  // candidate unresolvable, and an unresolved candidate is dropped from the gold, which by
  // scoreQuery's unjudged convention IS a grade of 0. That penalises whichever system surfaces more
  // substrate cases — precisely the difference this instrument exists to measure.
  const profiles = await dynamoCaseRepo.listCases({ tier: "all" });
  const byId = new Map<string, JudgeCase>();
  for (const p of profiles) {
    const c = await dynamoCaseRepo.getCase(p.id);
    if (!c) continue;
    byId.set(c.id, { caseId: c.id, styleOfCause: c.styleOfCause, citation: c.citation,
      court: c.court, year: c.year, holding: c.outcome?.holding ?? "" });
  }

  // Resolve every candidate BEFORE spending anything. A candidate the repo cannot produce would be
  // silently graded 0, and finding that out after ~2,000 paid calls is finding it out too late.
  // With tier "all" this should be empty; if it is not, the index artifact and the table disagree
  // and the pool must be rebuilt rather than judged.
  const unresolved = [...new Set(work.flatMap((w) => w.candidates))].filter((id) => !byId.has(id));
  if (unresolved.length) {
    throw new Error(
      `${unresolved.length} pooled candidate(s) are not in the repo, so they would be dropped from the gold and scored 0 as if judged irrelevant. ` +
      `The index artifact and the table disagree — rebuild the index and re-pool. Nothing judged, nothing written. First few: ${unresolved.slice(0, 5).join(", ")}`);
  }
  console.log(`corpus ${byId.size} case(s) (tier=all) · ${new Set(work.flatMap((w) => w.candidates)).size} distinct candidate(s) across ${work.length} queries, all resolved`);

  const judge = retryingModel(cachedModel(modelFromId(JUDGE, { maxTokens: JUDGE_MAX_TOKENS })),
    { attempts: 5, baseDelayMs: 2000, onRetry: () => retries++ });

  const grade = async (query: string, jc: JudgeCase) => {
    try {
      const { value, repaired } = await callParsed(judge, buildRelPrompt(query, jc), parseRel, CACHE_OPS);
      if (repaired) repairs++;
      return value;
    } catch (e) { callFailures++; console.warn("  [judge failed]", e instanceof Error ? e.message : String(e)); return null; }
  };

  const lines: string[] = [];
  const flat: { qid: string; query: string; jc: JudgeCase; rel: number }[] = [];
  let unparsed = 0;
  const unparsedPairs: string[] = [];
  const deadQueries: string[] = [];

  for (const [i, w] of work.entries()) {
    const judgments: { caseId: string; rel: number; why: string }[] = [];
    for (const id of w.candidates) {
      const jc = byId.get(id);
      if (!jc) throw new Error(`candidate ${id} is unresolvable — impossible after the pre-flight check, so the corpus map changed underneath this run`);
      const r = await grade(w.query, jc);
      // Dropping this pair is NOT neutral: an absent judgment is graded 0 by the pooling
      // convention, so a parse failure silently becomes "judged irrelevant". Counted here and
      // gated below rather than swallowed.
      if (!r) { unparsed++; unparsedPairs.push(`${w.qid}/${id}`); continue; }
      judgments.push({ caseId: id, rel: r.rel, why: r.why });
      flat.push({ qid: w.qid, query: w.query, jc, rel: r.rel });
    }
    // A query with no relevant case scores 0 for every system identically. It does not discriminate
    // between them, it just drags every mean down — so it is reported as a defect of the QUERY SET
    // rather than left to look like a retrieval failure.
    if (!judgments.some((j) => j.rel >= 1)) deadQueries.push(w.qid);
    lines.push(JSON.stringify({ qid: w.qid, query: w.query, layer: w.layer,
      judgedAt: new Date().toISOString().slice(0, 10), judge: JUDGE, rubric: REL_RUBRIC_ID, judgments }));
    process.stdout.write(`\rjudged ${i + 1}/${work.length} queries · ${flat.length} pairs`);
  }
  console.log("");

  // A failed call is not a data point: the request never reached the model. Rates and a gold built
  // over the survivors of an outage are not what they claim to be.
  if (callFailures > 0) {
    throw new Error(`${callFailures} judge call(s) failed outright — the gold is incomplete and would silently grade those pairs 0 by the unjudged convention. Transient throttles are already retried, so this is something else. Nothing written.`);
  }
  // Same reasoning, different failure. A call that SUCCEEDED but whose text would not parse does not
  // throw — callParsed returns a null value — so without this gate the pair is dropped and graded 0
  // by the same unjudged convention, while the process exits 0 and the gold looks complete. The
  // parser refuses to default a failure to 0 precisely so the runner must not do it either.
  if (unparsed > 0) {
    throw new Error(
      `${unparsed} judge response(s) could not be parsed. Dropping them is not neutral — an absent judgment is scored 0, i.e. "judged irrelevant", so the gold would understate relevance for whichever system surfaced those cases. ` +
      `Most likely a response truncated before its JSON: raise JUDGE_MAX_TOKENS (currently ${JUDGE_MAX_TOKENS}) and note that maxTokens is NOT part of the response-cache key, so the poisoned entries must be evicted too. Nothing written. Pairs: ${unparsedPairs.slice(0, 10).join(", ")}${unparsedPairs.length > 10 ? ` (+${unparsedPairs.length - 10} more)` : ""}`);
  }

  await fs.writeFile(OUT, lines.join("\n") + "\n", "utf8");

  // Replay determinism, which is NOT judge self-consistency — the distinction matters because the
  // number goes in a datasheet. This evicts a sample's cached response and asks again with the
  // BYTE-IDENTICAL prompt, same model, temperature 0. Bedrock Converse is stateless, so nothing has
  // been varied and there is no mechanism by which the answer could differ except endpoint
  // nondeterminism. Expect ~100%, and read it as a sanity check on the endpoint and the cache, not
  // as an error bar on the grades.
  //
  // A real error bar needs a perturbation this does not apply: a second judge model, a reordered
  // rubric, or temperature > 0. Until one of those runs, THIS GOLD HAS NO MEASURED ERROR BAR and
  // the findings doc must say so rather than cite the number below as if it were one.
  const retriesBeforeSample = retries;
  const sample = seededShuffle(flat, SEED).slice(0, Math.min(CONSISTENCY_SAMPLE, flat.length));
  let agree = 0, checked = 0, sampleUnparsed = 0;
  for (const s of sample) {
    const prompt = buildRelPrompt(s.query, s.jc);
    await evictCached(JUDGE, prompt);
    const again = await grade(s.query, s.jc);
    if (!again) { sampleUnparsed++; continue; }
    checked++;
    if (again.rel === s.rel) agree++;
    // Leave the cache without a response that contradicts the gold just written. Re-running this
    // script would otherwise regenerate a DIFFERENT gold on exactly the pairs where the two answers
    // disagreed — the sampled prompts are simply uncached, so a re-run pays for them again.
    await evictCached(JUDGE, prompt);
  }

  const dist = [0, 1, 2].map((g) => `${g}:${flat.filter((f) => f.rel === g).length}`).join(" ");
  console.log(`\ngold -> ${OUT}`);
  console.log(`  queries ${work.length} · judged pairs ${flat.length} · grade distribution ${dist}`);
  console.log(`  unparsed ${unparsed} · retries ${retriesBeforeSample} · cache repairs ${repairs}`);
  console.log(`  replay determinism: ${agree}/${checked} of ${sample.length} sampled = ${checked ? ((agree / checked) * 100).toFixed(1) : "n/a"}%`);
  console.log(`    NOT an error bar on the grades — identical prompt, same model, temperature 0, so nothing was varied.`);
  if (sampleUnparsed > 0 || retries > retriesBeforeSample)
    console.log(`    sample had ${sampleUnparsed} unparsed and ${retries - retriesBeforeSample} retry(ies); the denominator above is ${checked}, not ${sample.length}.`);
  if (deadQueries.length)
    console.log(`  ⚠ ${deadQueries.length} query(ies) with NO case graded rel>=1 — a query-set defect, not a retrieval failure: ${deadQueries.join(", ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
