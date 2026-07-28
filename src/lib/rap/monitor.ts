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

export const METRIC_NAMESPACE = "Indigenomics/RapExtraction";
export const STUCK_METRIC_NAME = "StuckExtractionJobs";
export const FAILED_METRIC_NAME = "FailedExtractionJobs";

export interface HealthScan {
  stuckCount: number;
  oldestStuckAgeMs: number; // 0 when nothing is stuck
  stuckJobIds: string[]; // UUIDs — safe to log; NEVER include fileName (may echo a title)
  failedCount: number; // unresolved FAILED jobs (cleared by #194 retry/dismiss)
}

/**
 * Snapshot extraction health: jobs hung in EXTRACTING, and jobs sitting FAILED.
 *
 * BOTH matter, and they catch DIFFERENT failures. The worker CATCHES its own
 * errors (stage-extraction.ts: "Never throws" → markFailed → returns
 * {status:failed}), so the Lambda invocation SUCCEEDS. That means the built-in
 * AWS/Lambda Errors metric — and the async on-failure DLQ — never fire for a
 * handled failure, which is the SCP-outage shape (an explicit deny, caught and
 * recorded). Only a scan of the FAILED partition sees it. `stuckCount` covers
 * the other half: a crash/timeout AFTER the EXTRACTING write, which leaves no
 * terminal status at all.
 *
 * `now` is injected (epoch ms) so this is a pure function of the repo's contents
 * and a clock the test controls, like its neighbours (queue-view.ts, run.ts).
 * Both reads are GSI1 point queries on STATUS#<status>, not table scans.
 */
export async function scanExtractionHealth(opts: { now: number; maxAgeMs?: number }): Promise<HealthScan> {
  const maxAgeMs = opts.maxAgeMs ?? STUCK_MAX_AGE_MS;
  const [extracting, failed] = await Promise.all([
    extractionRepo.listByStatus("EXTRACTING"),
    extractionRepo.listByStatus("FAILED"),
  ]);

  const stuck = extracting
    .map((j) => ({ id: j.id, ageMs: opts.now - Date.parse(j.updatedAt) }))
    // A NaN age (unparseable updatedAt) must not count as stuck — that would
    // page on bad data. NaN comparisons are false, so `> maxAgeMs` already
    // excludes it; the filter is explicit for the reader.
    .filter((j) => Number.isFinite(j.ageMs) && j.ageMs > maxAgeMs);

  return {
    stuckCount: stuck.length,
    oldestStuckAgeMs: stuck.reduce((max, j) => Math.max(max, j.ageMs), 0),
    stuckJobIds: stuck.map((j) => j.id),
    // Every FAILED job is unresolved by definition — #194 retry/dismiss moves it
    // out of FAILED. So the count IS the alarm condition: >0 means "failures the
    // operator has not cleared", and it self-clears when they do.
    failedCount: failed.length,
  };
}

/**
 * Build one CloudWatch Embedded Metric Format log line carrying BOTH counts. A
 * handler that `console.log`s this string gets `StuckExtractionJobs` and
 * `FailedExtractionJobs` extracted as metrics automatically — no PutMetricData
 * and no extra IAM. `timestamp` is epoch ms; a parameter (not read from the
 * clock here) so the formatter stays pure and testable.
 *
 * https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
 */
export function emfExtractionHealth(opts: {
  stage: string;
  stuckCount: number;
  failedCount: number;
  timestamp: number;
}): string {
  return JSON.stringify({
    _aws: {
      Timestamp: opts.timestamp,
      CloudWatchMetrics: [
        {
          Namespace: METRIC_NAMESPACE,
          Dimensions: [["Stage"]],
          Metrics: [
            { Name: STUCK_METRIC_NAME, Unit: "Count" },
            { Name: FAILED_METRIC_NAME, Unit: "Count" },
          ],
        },
      ],
    },
    Stage: opts.stage,
    [STUCK_METRIC_NAME]: opts.stuckCount,
    [FAILED_METRIC_NAME]: opts.failedCount,
  });
}
