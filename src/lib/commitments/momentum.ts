// Momentum & projection from each commitment's period history. Velocity = average
// progress gained per year; projection linearly extrapolates that to the target
// year to flag commitments that won't arrive at current pace. Pure functions.
import type { Commitment } from "./types";

export interface Momentum {
  commitment: Commitment;
  delta: number; // change over the most recent period step
  velocity: number; // avg progress change per year across history (1 dp)
  projected: number; // extrapolated progress at targetYear (rounded; may exceed 100)
  shortfall: number; // max(0, 100 - projected)
  onPace: boolean; // confirmed, or projected to reach 100 by targetYear
}

function yearOf(period: string, fallback: number): number {
  const n = parseInt(period, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function commitmentMomentum(c: Commitment): Momentum {
  const h = c.history;
  const last = h[h.length - 1];
  const prev = h.length >= 2 ? h[h.length - 2] : undefined;
  const first = h[0];
  const delta = prev ? last.progressPct - prev.progressPct : 0;

  const firstYear = yearOf(first.period, 0);
  const lastYear = yearOf(last.period, firstYear);
  const span = lastYear - firstYear;
  const velocity = span > 0 ? (last.progressPct - first.progressPct) / span : 0;

  const yearsLeft = Math.max(0, c.targetYear - lastYear);
  const projected = Math.round(last.progressPct + velocity * yearsLeft);
  const onPace = c.status === "confirmed" || projected >= 100;

  return {
    commitment: c,
    delta,
    velocity: Math.round(velocity * 10) / 10,
    projected,
    shortfall: Math.max(0, 100 - projected),
    onPace,
  };
}

export interface MomentumBoard {
  gainers: Momentum[]; // biggest recent positive move, still unfinished
  offPace: Momentum[]; // not confirmed & projected to fall short, worst first
  onPaceCount: number;
  offPaceCount: number;
}

export function momentumBoard(items: Commitment[], topN = 4): MomentumBoard {
  const all = items.map(commitmentMomentum);
  const active = all.filter((m) => m.commitment.status !== "confirmed");

  const gainers = active
    .filter((m) => m.delta > 0)
    .sort((a, b) => b.delta - a.delta || a.commitment.id.localeCompare(b.commitment.id))
    .slice(0, topN);

  const offPace = active
    .filter((m) => !m.onPace)
    .sort((a, b) => b.shortfall - a.shortfall || a.commitment.id.localeCompare(b.commitment.id))
    .slice(0, topN);

  const onPaceCount = all.filter((m) => m.onPace).length;
  return { gainers, offPace, onPaceCount, offPaceCount: all.length - onPaceCount };
}
