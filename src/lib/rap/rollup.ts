// ===========================================================================
// Rollup computation — pure. Given a commitment's observations, derive its
// current-state rollup (latest status, %complete, count). Used by the Streams
// aggregation Lambda (src/functions/rap-rollup.ts) so the dashboard reads ONE
// COMMIT#<id>/META item instead of scanning the observation history.
//
// percentComplete is a status proxy here (no target on the observation). A
// value-based percent (observedValue ÷ commitment.targetValue) is a refinement
// that needs the target denormalized onto the rollup or observation.
// ===========================================================================
import type { CommitmentRollup, Observation, ProgressStatus } from "./types";
import type { DataClass } from "../governance";
import { coerceDataClass } from "../governance";

export const STATUS_PERCENT: Record<ProgressStatus, number> = {
  not_started: 0,
  on_track: 50,
  delayed: 25,
  met: 100,
  missed: 0,
};

export function computeRollup(
  commitId: string,
  observations: Observation[],
  now: string = new Date().toISOString(),
  // Fallback only for the (should-not-happen) empty-observations case, where
  // there is no observation to inherit a real classification from. Callers
  // that have a Commitment on hand should prefer inheriting its dataClass
  // before falling back to this conservative default.
  fallbackDataClass: DataClass = "org_submitted",
): CommitmentRollup {
  if (observations.length === 0) {
    return { commitId, latestStatus: "not_started", percentComplete: 0, observationCount: 0, updatedAt: now, dataClass: fallbackDataClass };
  }
  // observedAt is ISO-8601 → lexical sort = chronological
  const latest = [...observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt)).at(-1)!;
  return {
    commitId,
    latestStatus: latest.status,
    percentComplete: STATUS_PERCENT[latest.status],
    observationCount: observations.length,
    updatedAt: now,
    // The rollup belongs to the same graph as the observations it summarizes
    // — inherit their classification, never re-derive it. Coerce because a
    // legacy observation (written before dataClass existed) unmarshals to
    // `undefined` at the Dynamo read boundary despite the type saying otherwise.
    dataClass: coerceDataClass(latest.dataClass),
  };
}
