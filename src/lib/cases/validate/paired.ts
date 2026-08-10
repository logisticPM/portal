// Paired bootstrap over per-query deltas (spec 2026-08-09 §3).
//
// The two systems are scored on the SAME queries, so the right comparison is the mean of the
// per-query DIFFERENCE, not the difference of two independent means. Query difficulty varies far
// more than the systems do; pairing removes that variance instead of letting it swamp the effect.
//
// The published 18-query run reported a 0.068 gap in aggregate means and correctly refused to call
// it an effect size. This is what lets a gap be called an effect: resample the per-query deltas
// with replacement, and report the 2.5th/97.5th percentiles.
//
// Seeded, because a confidence interval that moves between runs of the same data is not a
// confidence interval anyone can cite.
import { makeRng } from "../caseqa-eval/rng";

export interface Delta { mean: number; lo: number; hi: number; separated: boolean; n: number }

export function pairedBootstrap(a: number[], b: number[], seed: number, iterations = 10_000): Delta {
  if (a.length !== b.length) throw new Error(`paired comparison needs the same length: ${a.length} vs ${b.length}`);
  if (a.length === 0) throw new Error("paired comparison over an empty query set");
  const d = a.map((x, i) => x - b[i]);
  const n = d.length;
  const mean = d.reduce((s, x) => s + x, 0) / n;
  const rng = makeRng(seed);
  const means: number[] = [];
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += d[Math.floor(rng() * n)];
    means.push(s / n);
  }
  means.sort((x, y) => x - y);
  const lo = means[Math.floor(0.025 * iterations)];
  const hi = means[Math.min(iterations - 1, Math.floor(0.975 * iterations))];
  // "Separated" means the interval excludes 0 — the pre-registered condition for describing one
  // system as better than another. A point estimate on its own never earns that word.
  return { mean, lo, hi, separated: lo > 0 || hi < 0, n };
}

// 4 decimals, not 3. "separated" is the load-bearing word and it means the interval excludes 0, so
// the bound carrying that claim must be legible: at 3 decimals a genuinely separated interval can
// print as [0.000, 0.000] next to the word "separated", which a reader cannot reconcile and cannot
// check. Rounding must never hide the sign of the bound the conclusion rests on.
export const formatDelta = (label: string, d: Delta): string =>
  `${label} = ${d.mean >= 0 ? "+" : ""}${d.mean.toFixed(4)}  95% CI [${d.lo.toFixed(4)}, ${d.hi.toFixed(4)}]  ` +
  `${d.separated ? "separated" : "NOT separated at n=" + d.n}`;
