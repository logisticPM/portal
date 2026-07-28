// Scheduled stuck-extraction monitor (spec 2026-07-28). Thin: all logic is in
// scanStuckExtractions / emfStuckJobs (unit-tested). Mirrors
// src/functions/notify-digest.handler — a testable core plus a handler that
// supplies the clock and emits the metric.
//
// The EMF line it logs is what a CloudWatch alarm pages on; the human-readable
// line is for debugging. STAGE comes from the cron env in sst.config.ts.
import {
  emfStuckJobs,
  scanStuckExtractions,
  STUCK_MAX_AGE_MS,
} from "../lib/rap/monitor";

export async function handler(): Promise<void> {
  const now = Date.now();
  const scan = await scanStuckExtractions({ now, maxAgeMs: STUCK_MAX_AGE_MS });

  // The metric line — CloudWatch extracts StuckExtractionJobs from this.
  console.log(emfStuckJobs({ stage: process.env.STAGE ?? "unknown", stuckCount: scan.stuckCount, timestamp: now }));

  // Human-readable, counts + UUIDs only (never fileName — it can echo a title).
  console.log(
    `[stuck-monitor] stuck=${scan.stuckCount} oldestMin=${Math.round(scan.oldestAgeMs / 60000)}` +
      (scan.jobIds.length ? ` jobs=${scan.jobIds.join(",")}` : ""),
  );
}
