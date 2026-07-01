import assert from "node:assert/strict";
import { prf1, cohenKappa, pabak, wilsonInterval } from "../src/lib/cases/validate/metrics";

const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

const m = prf1(2, 1, 1); close(m.precision, 2 / 3); close(m.recall, 2 / 3); close(m.f1, 2 / 3);

// textbook: a=[y,y,n,n] b=[y,n,n,n] → po=.75, pe=.5, kappa=.5
const k = cohenKappa(["y", "y", "n", "n"], ["y", "n", "n", "n"]); close(k, 0.5);

close(pabak(0.75), 0.5); // 2*po-1

const w = wilsonInterval(192, 384); close(w.p, 0.5); close(w.lower, 0.4502, 2e-3); close(w.upper, 0.5498, 2e-3);
import { dcgAtK, ndcgAtK, recallAtK, reciprocalRank } from "../src/lib/cases/validate/metrics";

// DCG worked example (Wikipedia nDCG): gains [3,2,3,0,1,2]
close(dcgAtK([3, 2, 3, 0, 1, 2], 6), 6.8611, 2e-3);
// nDCG@6 for the same multiset → ideal order [3,3,2,2,1,0]; ndcgAtK sorts idealGains internally
close(ndcgAtK([3, 2, 3, 0, 1, 2], [3, 2, 3, 0, 1, 2], 6), 0.9608, 2e-3);
// k truncates: DCG@2 = 3 + 2/log2(3)
close(dcgAtK([3, 2], 2), 3 + 2 / Math.log2(3));
// zero ideal → 0 (no relevant docs)
close(ndcgAtK([0, 0], [0, 0], 5), 0);
// recall@k is a ratio of counts
close(recallAtK(2, 4), 0.5);
close(recallAtK(0, 0), 0);
// reciprocal rank: first relevant at index 2 (0-based) → 1/3; none → 0
close(reciprocalRank([false, false, true, true]), 1 / 3);
close(reciprocalRank([false, false]), 0);
console.log("✅ metrics tests passed");
