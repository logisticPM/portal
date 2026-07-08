import assert from "node:assert/strict";
import { scoreQuery, aggregate, poolCandidates, type GoldQuery } from "../src/lib/cases/validate/retrieval";

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

console.log("✅ retrieval eval-core tests passed");
