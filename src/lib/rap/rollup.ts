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
): CommitmentRollup {
  if (observations.length === 0) {
    return { commitId, latestStatus: "not_started", percentComplete: 0, observationCount: 0, updatedAt: now };
  }
  // observedAt is ISO-8601 → lexical sort = chronological
  const latest = [...observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt)).at(-1)!;
  return {
    commitId,
    latestStatus: latest.status,
    percentComplete: STATUS_PERCENT[latest.status],
    observationCount: observations.length,
    updatedAt: now,
  };
}
