// Scheduled extraction-health monitor (spec 2026-07-28). Thin: all logic is in
// scanExtractionHealth / emfExtractionHealth (unit-tested). Mirrors
// src/functions/notify-digest.handler — a testable core plus a handler that
// supplies the clock and emits the metrics.
//
// Emits TWO metrics: StuckExtractionJobs (hung in EXTRACTING) and
// FailedExtractionJobs (caught failures the worker recorded but nothing on the
// AWS/Lambda side reflects — the SCP-outage shape). The EMF line is what the
// CloudWatch alarms page on; the human line is for debugging. STAGE comes from
// the cron env in sst.config.ts.
import {
  emfExtractionHealth,
  scanExtractionHealth,
  STUCK_MAX_AGE_MS,
} from "../lib/rap/monitor";

export async function handler(): Promise<void> {
  const now = Date.now();
  const scan = await scanExtractionHealth({ now, maxAgeMs: STUCK_MAX_AGE_MS });

  // The metric line — CloudWatch extracts StuckExtractionJobs + FailedExtractionJobs.
  console.log(
    emfExtractionHealth({ stage: process.env.STAGE ?? "unknown", stuckCount: scan.stuckCount, failedCount: scan.failedCount, timestamp: now }),
  );

  // Human-readable, counts + UUIDs only (never fileName — it can echo a title).
  console.log(
    `[extraction-health] stuck=${scan.stuckCount} failed=${scan.failedCount}` +
      ` oldestStuckMin=${Math.round(scan.oldestStuckAgeMs / 60000)}` +
      (scan.stuckJobIds.length ? ` stuckJobs=${scan.stuckJobIds.join(",")}` : ""),
  );
}
