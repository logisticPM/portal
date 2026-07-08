// ===========================================================================
// Pure scoring — no I/O, fully deterministic (unit-tested). The engine feeds it
// structured facts + a precomputed semantic cosine; it returns 0..1 scores.
// ===========================================================================
import type { IdentityTier } from "../repo/types";

// Tunable weights + cutoffs (single source of truth).
export const THRESHOLD = 0.6; // keep opportunities scoring >= this
export const TOP_N = 5; // per commitment
const W_STRUCTURED = 0.55;
const W_SEMANTIC = 0.45;

const TIER_WEIGHT: Record<IdentityTier, number> = {
  nation: 1,
  ccab: 0.9,
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

export function structuredScore(input: {
  sectorMatch: boolean;
  regionMatch: boolean;
  identityTier: IdentityTier;
  ownershipPct?: number;
}): number {
  const sector = input.sectorMatch ? 0.45 : 0;
  const region = input.regionMatch ? 0.2 : 0;
  const tier = TIER_WEIGHT[input.identityTier] * 0.25;
  const ownership = Math.min(1, (input.ownershipPct ?? 51) / 100) * 0.1;
  return Math.min(1, sector + region + tier + ownership);
}

// Combine structured + semantic into the final 0..1 score.
export function combine(structured: number, semantic: number): number {
  return Math.min(1, W_STRUCTURED * structured + W_SEMANTIC * Math.max(0, semantic));
}
