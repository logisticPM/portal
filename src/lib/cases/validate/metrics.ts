// Pure metric functions (spec §6). All deterministic; unit-tested against textbook values.
export function prf1(tp: number, fp: number, fn: number) {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

// Cohen's kappa for two raters over paired categorical labels.
export function cohenKappa(a: string[], b: string[]): number {
  const n = a.length;
  if (n === 0 || n !== b.length) return 0;
  let agree = 0;
  const ca: Record<string, number> = {}, cb: Record<string, number> = {};
  for (let i = 0; i < n; i++) { if (a[i] === b[i]) agree++; ca[a[i]] = (ca[a[i]] ?? 0) + 1; cb[b[i]] = (cb[b[i]] ?? 0) + 1; }
  const po = agree / n;
  let pe = 0;
  for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) pe += ((ca[k] ?? 0) / n) * ((cb[k] ?? 0) / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

export const pabak = (po: number): number => 2 * po - 1;

export function wilsonInterval(successes: number, n: number, z = 1.96) {
  const p = n === 0 ? 0 : successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
  return { p, lower: center - margin, upper: center + margin };
}

// --- Ranking metrics for retrieval evaluation (graded relevance). Pure. ---

// Discounted Cumulative Gain over the first k ranked gains: Σ gain_i / log2(i+2).
export function dcgAtK(gains: number[], k: number): number {
  let s = 0;
  for (let i = 0; i < Math.min(k, gains.length); i++) s += gains[i] / Math.log2(i + 2);
  return s;
}

// Normalized DCG@k. idealGains is the full set of judged gains; it is sorted
// descending internally to form the ideal ranking. Returns 0 when IDCG is 0.
export function ndcgAtK(rankedGains: number[], idealGains: number[], k: number): number {
  const idcg = dcgAtK([...idealGains].sort((a, b) => b - a), k);
  return idcg === 0 ? 0 : dcgAtK(rankedGains, k) / idcg;
}

// Recall = |relevant retrieved| / |relevant total|. Caller counts relevant hits
// within top-k (binarized at rel≥1) and passes the totals. 0 when nothing relevant.
export function recallAtK(retrievedRelevant: number, totalRelevant: number): number {
  return totalRelevant === 0 ? 0 : retrievedRelevant / totalRelevant;
}

// Reciprocal rank: 1/(1-based rank of the first true), else 0. MRR = mean over queries.
export function reciprocalRank(ranked: boolean[]): number {
  const i = ranked.findIndex((x) => x);
  return i === -1 ? 0 : 1 / (i + 1);
}
