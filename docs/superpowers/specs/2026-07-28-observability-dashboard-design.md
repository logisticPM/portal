# CloudWatch dashboard for the `ca` extraction pipeline

**Date:** 2026-07-28 · Stage: `ca` · Follows PR #197 (alarms/DLQ/health metrics).

## Context

PR #197 gave the `ca` extraction pipeline alarms, a dead-letter queue, and two custom health
metrics. Those are the **push** (page-me-when-broken) layer. A dashboard is the **look** layer:
one pane that answers "is extraction healthy right now, and how has it been" without hunting
through the CloudWatch console. Two audiences — the Aug-10 showcase ("here it is working") and
on-call debugging.

Same scope discipline as #197: **`ca` only**, gated on the existing `if (extractDlq)` observability
block, one resource.

## The pane (read top-to-bottom)

`aws.cloudwatch.Dashboard`, name `indigenomics-ca-extraction-health`, 24-column grid:

1. **Alarm status grid** (all 6 alarms from #197) — the green/red headline. Every alarm ARN is
   collected as it is created, so this never drifts from the alarms themselves.
2. **Extraction queue health** — the two custom EMF metrics, `FailedExtractionJobs` +
   `StuckExtractionJobs` (Stage=ca). "Is anything queued wrong."
3. **RapExtract worker** — `Invocations` / `Errors` / `Throttles` (AWS/Lambda). Throughput and hard
   failures. Note the deliberate contrast with #2: `Errors` here counts throws/timeouts, while
   `FailedExtractionJobs` above counts the *handled* failures `Errors` structurally misses.
4. **RapExtract duration** — p50 / p90 / max, against the mental ceiling of the 900s Lambda
   timeout. This is the "why did a document take 7 minutes" question made visible.
5. **Dead-letter queue depth** — `ApproximateNumberOfMessagesVisible`. Hard-crash capture.

## Wiring

- `$jsonStringify` resolves the function/queue-name Pulumi Outputs into the dashboard body — the
  same Output-interpolation problem the alarms have, solved once here.
- `region` on each widget comes from `SST_AWS_REGION` (ca-central-1 for this stage).
- The `alarm()` helper now collects each `MetricAlarm` into an array the status widget maps over, so
  adding an alarm later automatically adds it to the grid.

## Files

- `sst.config.ts` — one `aws.cloudwatch.Dashboard`, plus the one-line change to have `alarm()`
  collect the alarms it creates. Inside the existing `if (extractDlq)` block.

## Testing & verification

- `sst diff` against 4.15.2 plans the Dashboard cleanly (validates `$jsonStringify` + Output
  interpolation).
- Post-deploy: open the console URL, confirm all five widgets render and the alarm grid shows the
  live states; the `FailedExtractionJobs` datapoint from the #197 live test is still in the window,
  so the queue-health widget has real data to show.

## Out of scope

Metric Insights / SEARCH-expression widgets, cross-stage rollups, and a prod dashboard — all
follow-ons. No new metrics: this pane only visualizes what #197 already emits.
