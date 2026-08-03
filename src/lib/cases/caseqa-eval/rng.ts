// Seeded determinism is the property every objective metric in this instrument rests on:
// re-running after a prompt change must measure the SAME questions, or the before/after
// comparison is meaningless. Hence a explicit PRNG rather than Math.random.
//
// mulberry32 — 32-bit state, uniform enough for sampling, and short enough to audit.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates over a COPY. Returning a new array rather than shuffling in place matters
// here: the runner shuffles the same case list twice (once for cases, once for pairing),
// and an in-place shuffle would make the second draw depend on the first.
export function seededShuffle<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  const rng = makeRng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
