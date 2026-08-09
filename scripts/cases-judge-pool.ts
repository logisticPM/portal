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
const JUDGE_MAX_TOKENS = 512;
const SEED = Number(process.env.EVAL_SEED ?? 1);
const OUT = process.env.GOLD_FILE ?? "docs/research/gold/cases-retrieval-gold.jsonl";
// Re-judged at a different position in the worklist to report the judge's self-consistency. A gold
// built by one model with no consistency figure has unknown error bars.
const CONSISTENCY_SAMPLE = Number(process.env.CONSISTENCY_SAMPLE ?? 60);

let retries = 0, repairs = 0, callFailures = 0;
const CACHE_OPS: CacheOps = { hasCached, evictCached };

type Work = { qid: string; query: string; layer: string; candidates: string[] };

async function main() {
  const poolPath = process.argv[2];
  if (!poolPath) throw new Error("usage: cases-judge-pool.ts <pool.json>  (produced by `npm run cases:pool:cloud`)");
  const work: Work[] = JSON.parse(await fs.readFile(poolPath, "utf8"));
  if (!work.length) throw new Error("empty worklist — nothing to judge");

  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  const byId = new Map<string, JudgeCase>();
  for (const p of profiles) {
    const c = await dynamoCaseRepo.getCase(p.id);
    if (!c) continue;
    byId.set(c.id, { caseId: c.id, styleOfCause: c.styleOfCause, citation: c.citation,
      court: c.court, year: c.year, holding: c.outcome?.holding ?? "" });
  }

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
  let unparsed = 0, missingCase = 0;
  const deadQueries: string[] = [];

  for (const [i, w] of work.entries()) {
    const judgments: { caseId: string; rel: number; why: string }[] = [];
    for (const id of w.candidates) {
      const jc = byId.get(id);
      if (!jc) { missingCase++; continue; }
      const r = await grade(w.query, jc);
      if (!r) { unparsed++; continue; }
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

  await fs.writeFile(OUT, lines.join("\n") + "\n", "utf8");

  // Self-consistency: re-judge a sample by evicting its cached response and asking again. Same
  // prompt, same model, temperature 0 — so any disagreement is the model's own instability, which
  // is the only honest error bar available for a single-judge gold.
  const sample = seededShuffle(flat, SEED).slice(0, Math.min(CONSISTENCY_SAMPLE, flat.length));
  let agree = 0, checked = 0;
  for (const s of sample) {
    const prompt = buildRelPrompt(s.query, s.jc);
    await evictCached(JUDGE, prompt);
    const again = await grade(s.query, s.jc);
    if (!again) continue;
    checked++;
    if (again.rel === s.rel) agree++;
  }

  const dist = [0, 1, 2].map((g) => `${g}:${flat.filter((f) => f.rel === g).length}`).join(" ");
  console.log(`\ngold -> ${OUT}`);
  console.log(`  queries ${work.length} · judged pairs ${flat.length} · grade distribution ${dist}`);
  console.log(`  unparsed ${unparsed} · candidates missing from the corpus ${missingCase} · retries ${retries} · cache repairs ${repairs}`);
  console.log(`  judge self-consistency: ${agree}/${checked} = ${checked ? ((agree / checked) * 100).toFixed(1) : "n/a"}%  (re-judged after eviction; reported, not a gate)`);
  if (deadQueries.length)
    console.log(`  ⚠ ${deadQueries.length} query(ies) with NO case graded rel>=1 — a query-set defect, not a retrieval failure: ${deadQueries.join(", ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
