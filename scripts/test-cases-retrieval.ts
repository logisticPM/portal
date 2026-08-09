import assert from "node:assert/strict";
import { scoreQuery, aggregate, poolCandidates, type GoldQuery } from "../src/lib/cases/validate/retrieval";
import { buildRelPrompt, parseRel, REL_RUBRIC_ID } from "../src/lib/cases/validate/judge-rel";
import { pairedBootstrap, formatDelta } from "../src/lib/cases/validate/paired";

const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// gold: caseA highly relevant (2), caseB relevant (1); others unjudged ⇒ 0
const gold: GoldQuery = {
  qid: "q1", query: "duty to consult", layer: "topical",
  judgments: [{ caseId: "caseA", rel: 2 }, { caseId: "caseB", rel: 1 }],
};

// perfect ranking: [A, B, ...] → nDCG=1, recall=1, RR=1
const perfect = scoreQuery(gold, ["caseA", "caseB", "caseX"]);
close(perfect.ndcg10, 1); close(perfect.recall10, 1); close(perfect.rr, 1);

// B first, A third: recall still 1 (both in top10); RR=1 (B is relevant at rank1); nDCG<1
const shuffled = scoreQuery(gold, ["caseB", "caseX", "caseA"]);
close(shuffled.recall10, 1); close(shuffled.rr, 1); assert.ok(shuffled.ndcg10 < 1, "imperfect order → nDCG<1");

// only irrelevant retrieved: recall 0, RR 0, nDCG 0
const miss = scoreQuery(gold, ["caseX", "caseY"]);
close(miss.recall10, 0); close(miss.rr, 0); close(miss.ndcg10, 0);

// aggregate groups by layer and averages
const agg = aggregate([perfect, { ...miss, layer: "conceptual" }]);
assert.equal(agg.overall.n, 2);
close(agg.overall.recall10, 0.5);
assert.ok(agg.byLayer.topical && agg.byLayer.conceptual, "per-layer buckets present");
close(agg.byLayer.topical.recall10, 1);

// pooling: union of top-k of each list + extras, deduped, first-seen order
assert.deepEqual(
  poolCandidates([["a", "b", "c"], ["b", "d"]], ["e", "a"], 2),
  ["a", "b", "d", "e"],
);

// --- relevance judging -------------------------------------------------------------------
assert.equal(REL_RUBRIC_ID, "rel-v1", "the rubric TEXT is unchanged from 2026-06-30 — what changed is the judge, and the gold's `judge` field records that. Bumping this id would imply the grades mean something different.");

assert.deepEqual(parseRel('{"why":"sets the justification test","rel":2}'), { rel: 2, why: "sets the justification test" });
assert.deepEqual(parseRel('```json\n{"why":"applies Sparrow","rel":1}\n```'), { rel: 1, why: "applies Sparrow" }, "fenced");
assert.deepEqual(parseRel('Thinking...\n{"why":"off topic","rel":0}'), { rel: 0, why: "off topic" }, "prose preamble tolerated");
// null means THE JUDGE FAILED. Defaulting to 0 would silently mark a case irrelevant, which is
// exactly the direction that inflates every system's apparent precision.
assert.equal(parseRel("this case is relevant"), null, "no JSON");
assert.equal(parseRel('{"why":"r"}'), null, "no grade");
assert.equal(parseRel('{"rel":"2"}'), null, "string is not a number");
assert.equal(parseRel('{"rel":3}'), null, "3 is outside the rubric");
assert.equal(parseRel('{"rel":-1}'), null, "negative is outside the rubric");
assert.equal(parseRel('{"rel":1.5}'), null, "grades are integers");

{
  const p = buildRelPrompt("QUERY_TEXT", { caseId: "c1", styleOfCause: "STYLE_TEXT", citation: "CITE_TEXT", court: "COURT_TEXT", year: 2014, holding: "HOLDING_TEXT" });
  for (const t of ["QUERY_TEXT", "STYLE_TEXT", "CITE_TEXT", "COURT_TEXT", "2014", "HOLDING_TEXT"])
    assert.ok(p.includes(t), `prompt must carry ${t}`);
  // All three grades must be defined in the prompt or the judge invents its own scale.
  for (const g of ["2", "1", "0"]) assert.ok(p.includes(`"${g}"`) || p.includes(`- ${g}`), `rubric grade ${g} must be stated`);
  // Reasoning before the grade, as everywhere else in this project (RM-5).
  const schema = p.split("\n").find((l) => l.trim().startsWith('{"')) ?? "";
  assert.ok(schema.indexOf('"why"') < schema.indexOf('"rel"'), "why must precede rel in the output schema");
  // The judge must never see a ranking or a system name — it grades a pair, not a contest.
  for (const w of ["BM25", "hybrid", "routed", "rank", "position"])
    assert.ok(!p.includes(w), `the judge must not learn which system surfaced this case: ${w}`);
}

// --- paired bootstrap --------------------------------------------------------------------
// The published run compared aggregate means on 18 queries and called 0.068 "a direction, not a
// precise effect size". That was the right call and this is what replaces it: the two systems are
// scored on the SAME queries, so the paired per-query difference has far less variance than the
// difference of two independent means.
{
  // B strictly better on every query — the CI must exclude 0 and sit above it.
  const a = [0.1, 0.2, 0.3, 0.4, 0.5], b = [0.2, 0.3, 0.4, 0.5, 0.6];
  const r = pairedBootstrap(b, a, 1, 2000);
  assert.ok(Math.abs(r.mean - 0.1) < 1e-9, "mean paired delta");
  assert.ok(r.lo > 0, "a uniform improvement must have a CI entirely above 0");
  assert.equal(r.separated, true, "separated when the CI excludes 0");

  // Identical systems: delta is exactly 0 everywhere, so every resample is 0.
  const same = pairedBootstrap(a, a, 1, 2000);
  assert.equal(same.mean, 0);
  assert.equal(same.separated, false, "a system cannot be separated from itself");

  // Mixed signs with a small mean — not separated at this n.
  const noisy = pairedBootstrap([0.5, 0.1, 0.6, 0.0, 0.4], [0.4, 0.2, 0.5, 0.1, 0.5], 1, 2000);
  assert.equal(noisy.separated, false, "a CI straddling 0 is not a separation");

  // Deterministic given the seed — a report whose CI moves between runs is not a report.
  assert.deepEqual(pairedBootstrap(b, a, 7, 500), pairedBootstrap(b, a, 7, 500), "same seed, same interval");
  // Two seeds must be compared on data with real spread. On `b` vs `a` every delta is 0.1 and the
  // resample mean takes FIVE distinct doubles in total, so seeds 7 and 8 agree on `lo` and differ
  // only in the last bit of `hi` — measured, not assumed. That passes today by one ulp and would
  // flip to a false failure on any change of seed, iteration count, or summation order.
  const spread = Array.from({ length: 20 }, (_, i) => i / 20);
  const zeros = spread.map(() => 0);
  assert.notDeepEqual(pairedBootstrap(spread, zeros, 7, 500), pairedBootstrap(spread, zeros, 8, 500), "different seed, different resamples");

  assert.throws(() => pairedBootstrap([0.1], [0.1, 0.2], 1, 100), /same length/, "unpaired input is a bug, not a wide interval");
  assert.throws(() => pairedBootstrap([], [], 1, 100), /empty/, "no queries means no interval");

  assert.ok(formatDelta("routed−hybrid", pairedBootstrap(b, a, 1, 2000)).includes("routed−hybrid"));
  // Case-insensitive: the module prints "NOT separated", and a case-sensitive /not separated/ does
  // not match it — as written this assertion failed against correct code.
  assert.ok(/not separated/i.test(formatDelta("x", same)), "an unseparated comparison must say so in words, not just in numbers");
}

console.log("✅ retrieval eval-core tests passed");
