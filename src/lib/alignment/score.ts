// ===========================================================================
// Pure scoring — no I/O, fully deterministic (unit-tested). The engine feeds it
// real, explainable facts and it returns a 0..1 "fit" score.
// ===========================================================================
import type { IdentityTier } from "../repo/types";

// Tunable weights + cutoffs (single source of truth). Every term is a REAL,
// defensible signal — no stub-embedding noise, no dead region term:
//   sector    — does the supplier work in the commitment's sector (binary)
//   relevance — deterministic BM25 capability overlap (0..1), real even offline;
//               a real embedder's cosine is blended in when configured (engine)
//   tier      — ownership-certification trust (nation > ccib > self_declared)
//   ownership — degree of Indigenous ownership
// Weights sum to 1 so `score` is a true weighted match in [0,1].
export const THRESHOLD = 0.5; // keep opportunities scoring >= this
export const TOP_N = 5; // per commitment

const W = { sector: 0.45, relevance: 0.25, tier: 0.2, ownership: 0.1 } as const;

const TIER_WEIGHT: Record<IdentityTier, number> = {
  nation: 1,
  ccib: 0.9,
  self_declared: 0.4,
};

// Cosine similarity of two vectors (guards zero norm).
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

// The single 0..1 fit score. `relevance` is a precomputed 0..1 capability signal
// (BM25, optionally blended with a real embedding cosine — see engine).
export function fitScore(input: {
  sectorMatch: boolean;
  relevance: number;
  identityTier: IdentityTier;
  ownershipPct?: number;
}): number {
  const sector = input.sectorMatch ? W.sector : 0;
  const relevance = Math.max(0, Math.min(1, input.relevance)) * W.relevance;
  const tier = TIER_WEIGHT[input.identityTier] * W.tier;
  // ownershipPct defaults to 51 (the bare-majority threshold to qualify as Indigenous-owned)
  const ownership = Math.min(1, (input.ownershipPct ?? 51) / 100) * W.ownership;
  return Math.min(1, sector + relevance + tier + ownership);
}
