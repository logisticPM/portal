// Pure view logic for the extraction queue, kept out of ReviewPanel.tsx so it
// can be tested without rendering React. `now` is injected everywhere rather
// than read from the clock, because every one of these functions is a function
// of elapsed time and would otherwise be untestable.
import type { ExtractionJob } from "@/lib/rap";

/**
 * Typical extraction is ~90s for a 17-page RAP (measured on `ca`) and several
 * minutes for a 70-page one. Past this a job is not necessarily broken, but it
 * is worth a look — and the worker's hard ceiling is the Lambda timeout of
 * 900s, after which NOTHING will ever update the record and it stays EXTRACTING
 * permanently. That silent terminal state is the reason this threshold exists.
 */
export const SLOW_EXTRACTION_MS = 6 * 60 * 1000;

/** Coarse elapsed time: "45s", "3m 12s", "1h 4m". */
export function elapsedSince(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  // A malformed or future timestamp must not render "NaNs" or a negative age.
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Has this job been running long enough to deserve a second look? */
export function isStalled(job: Pick<ExtractionJob, "createdAt">, now: number): boolean {
  const started = new Date(job.createdAt).getTime();
  if (!Number.isFinite(started)) return false;
  return now - started > SLOW_EXTRACTION_MS;
}

/**
 * PENDING (worker has not picked it up) and EXTRACTING (mid-pipeline) are both
 * "in progress" to a reviewer, so they share one list, newest first. The
 * distinction is preserved on the row itself because it localises a fault: a
 * job stuck in PENDING implicates the Lambda invoke, not the pipeline.
 */
export function orderInProgress(pending: ExtractionJob[], extracting: ExtractionJob[]): ExtractionJob[] {
  return [...pending, ...extracting].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Failures, most recently failed first — updatedAt is when markFailed ran. */
export function orderFailed(failed: ExtractionJob[]): ExtractionJob[] {
  return [...failed].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
