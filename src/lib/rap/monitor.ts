// ===========================================================================
// Stuck-extraction detector. The async worker updates a job to a terminal
// status (PENDING_REVIEW / FAILED) when it finishes. If it instead TIMES OUT or
// crashes AFTER writing EXTRACTING but before writing a terminal status, the job
// is stranded in EXTRACTING and no CloudWatch built-in metric reflects it — the
// invocation may not even have "errored" (a timeout is an Errors data point, but
// a post-status crash inside the handler that swallows may not be). This is the
// exact silent-failure shape the Textract SCP outage had, so it gets its own
// watch: a scheduled scan that counts EXTRACTING jobs older than the worker
// could legitimately still be running, and emits that count as a metric an alarm
// can page on.
//
// Split like notify-digest: this file is the pure/testable core (scan + metric
// formatting), src/functions/stuck-job-monitor.ts is the thin handler that
// supplies the clock and writes the metric line.
// ===========================================================================
import { extractionRepo } from "./index";

// The worker's hard ceiling is the 900s (15 min) Lambda timeout (sst.config.ts).
// 20 min is comfortably past it, so a legitimately long-running extraction is
// never flagged — only a job that has outlived any possible live invocation.
export const STUCK_MAX_AGE_MS = 20 * 60 * 1000;

export const STUCK_METRIC_NAMESPACE = "Indigenomics/RapExtraction";
export const STUCK_METRIC_NAME = "StuckExtractionJobs";

export interface StuckScan {
  stuckCount: number;
  oldestAgeMs: number; // 0 when nothing is stuck
  jobIds: string[]; // UUIDs — safe to log; NEVER include fileName (may echo a title)
}

/**
 * Count EXTRACTING jobs whose last update is older than `maxAgeMs`.
 *
 * `now` is injected (epoch ms) so the scan is a pure function of the repo's
 * contents and a clock the test controls — the same shape as scanStuckExtractions'
 * neighbours (queue-view.ts, run.ts). Reads via listByStatus, a GSI1 point query
 * on STATUS#EXTRACTING, so it is O(EXTRACTING jobs), not a table scan.
 */
export async function scanStuckExtractions(opts: { now: number; maxAgeMs?: number }): Promise<StuckScan> {
  const maxAgeMs = opts.maxAgeMs ?? STUCK_MAX_AGE_MS;
  const jobs = await extractionRepo.listByStatus("EXTRACTING");

  const stuck = jobs
    .map((j) => ({ id: j.id, ageMs: opts.now - Date.parse(j.updatedAt) }))
    // A NaN age (unparseable updatedAt) must not count as stuck — that would
    // page on bad data rather than a real hang. Number comparisons with NaN are
    // false, so `> maxAgeMs` already excludes it; the filter is explicit for the
    // reader.
    .filter((j) => Number.isFinite(j.ageMs) && j.ageMs > maxAgeMs);

  return {
    stuckCount: stuck.length,
    oldestAgeMs: stuck.reduce((max, j) => Math.max(max, j.ageMs), 0),
    jobIds: stuck.map((j) => j.id),
  };
}

/**
 * Build one CloudWatch Embedded Metric Format log line. A handler that
 * `console.log`s this string gets `StuckExtractionJobs` extracted as a metric
 * automatically — no PutMetricData call and no extra IAM. `timestamp` is epoch
 * ms; kept a parameter (not read from the clock here) so the formatter stays
 * pure and testable.
 *
 * https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
 */
export function emfStuckJobs(opts: { stage: string; stuckCount: number; timestamp: number }): string {
  return JSON.stringify({
    _aws: {
      Timestamp: opts.timestamp,
      CloudWatchMetrics: [
        {
          Namespace: STUCK_METRIC_NAMESPACE,
          Dimensions: [["Stage"]],
          Metrics: [{ Name: STUCK_METRIC_NAME, Unit: "Count" }],
        },
      ],
    },
    Stage: opts.stage,
    [STUCK_METRIC_NAME]: opts.stuckCount,
  });
}
