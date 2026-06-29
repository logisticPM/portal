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
