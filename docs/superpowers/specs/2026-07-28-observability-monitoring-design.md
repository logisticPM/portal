# Observability & monitoring for the `ca` extraction pipeline

**Date:** 2026-07-28 · Stage: `ca` (`ca-central-1`, account `106189426706`)

## Context

The portal has near-zero AWS observability. Logs reach CloudWatch (the Lambda default) but nothing
*watches* them: no alarms, no custom metrics, no tracing, no dead-letter capture, and log groups
never expire.

This is not hypothetical. The Textract SCP outage (`docs/ca-extraction-textract-scp.md`) was
invisible for days precisely because nothing was watching: every extraction failed in under a
second, `markFailed` wrote the error to DynamoDB, and the review queue simply rendered its empty
state. PR #193 closed the **pull** side — an operator who *looks* at the queue now sees failed and
in-progress jobs. This closes the **push** side — an operator who is *not* looking gets told.

Scope (decided with the user): **`ca` only**, **SNS→email** delivery, **built-in Lambda metrics +
a custom stuck-job detector**. One PR. `ca` is the right target: it runs the real `textlayer`
engine and is the stage the outage bit. prod runs BDA (a different failure profile) and is a small
`isProd`-gated follow-up.

## Part 1 — CloudWatch alarms → SNS → email

- **SNS topic**, `ca`-gated, with an **email subscription** to `ALERTS_EMAIL` (a new deploy env,
  defaulting to `DIGEST_RECIPIENT` when unset so no new *required* var is introduced). One-time:
  AWS emails a confirmation link that must be clicked before mail flows.
- **Alarms**, each `alarmActions: [topic.arn]`:
  - `RapExtract` `Errors >= 1`
  - `RapExtract` `Throttles >= 1`
  - `BriefGen` `Errors >= 1` (same fire-and-forget risk, cheap to add)
  - DLQ `ApproximateNumberOfMessagesVisible >= 1` (Part 2)
  - custom `StuckExtractionJobs >= 1` (Part 3)
- **Wiring:** SST v3 (Ion) `Function` does not expose alarms first-class. Create
  `aws.cloudwatch.MetricAlarm` through the Pulumi `aws` provider, referencing each function's name.
  `sst.config.ts:81` already carries a standing note to verify transform/resource keys against the
  installed SST version — run `sst diff` before apply.

## Part 2 — Dead-letter capture on the async workers

`rapExtract` and `briefGen` are invoked `InvocationType: "Event"` (fire-and-forget). If the Lambda
dies **before** `markFailed` runs, the job is stranded in `EXTRACTING` forever and the event
payload is lost.

- An **SQS queue** attached as the async **on-failure destination**
  (`aws.lambda.FunctionEventInvokeConfig` → `destinationConfig.onFailure`), the correct mechanism
  for async invokes (more context than the classic `deadLetterConfig`).
- The functions get `sqs:SendMessage` to the queue.
- **Capture-only, no auto-redrive.** The queue holds the original `{jobId, fileName, sourceS3Key}`
  so a human can inspect it or hand-retry via the #194 Retry button. Auto-redrive is out — the SCP
  failures were deterministic and would loop. DLQ depth drives the Part 1 alarm.

## Part 3 — Stuck-job detector (the case built-in metrics miss)

A job can hang without the Lambda *erroring* — a timeout, or a crash after the status write.
Built-in metrics won't catch that; a scan will. This is the exact silent-failure shape of the SCP
outage.

- **New scheduled Lambda** `StuckJobMonitor` (`sst.aws.Cron`, `rate(15 minutes)`), mirroring
  `NotifyDigest` / `CaseMonitor`.
- **Thin handler** `src/functions/stuck-job-monitor.ts` → testable core, exactly like
  `notify-digest.ts` → `runDigest()`.
- **Core** `scanStuckExtractions({ now, maxAgeMs })` in `src/lib/rap/monitor.ts`:
  - `extractionRepo.listByStatus("EXTRACTING")` — existing GSI1 point query on `STATUS#EXTRACTING`,
    not a table scan
  - count jobs whose `now - Date.parse(updatedAt) > maxAgeMs`
  - `maxAgeMs` comfortably past the 900s Lambda timeout (20 min) so a legitimately-long extraction
    is never flagged
  - returns `{ stuckCount, oldestAgeMs, jobIds }`
- **Metric via EMF** (Embedded Metric Format): the handler emits one structured-log blob →
  CloudWatch auto-extracts `StuckExtractionJobs` under namespace `Indigenomics/RapExtraction`. No
  `PutMetricData`, no extra IAM, no new dependency (hand-rolled, small).
- The Part 1 alarm on this metric sends the email. The same jobs already show in the #193
  "Extracting" UI with the "taking longer than usual" flag — this is the push half of that pull.

## Log retention

- All `ca` Lambda log groups → **30-day** retention (currently never-expire).
- Two reasons: unbounded cost, and **residency** — document text can appear in logs and living
  there indefinitely conflicts with the OCAP posture (`data-governance-ocap-residency`).
- SST v3 path (`transform` on the log group, or an explicit `aws.cloudwatch.LogGroup` with
  `retentionInDays`) verified against 4.15.2 during implementation.

## Files

- `sst.config.ts` — SNS topic + subscription, SQS DLQ + on-failure destinations, five
  `MetricAlarm`s, `StuckJobMonitor` cron, log retention. `$app.stage === "ca"` gated.
- `src/lib/rap/monitor.ts` **(new)** — `scanStuckExtractions()` + EMF-emit helper.
- `src/functions/stuck-job-monitor.ts` **(new)** — thin handler (counts only, never PII).
- `scripts/test-stuck-job-monitor.ts` **(new)** — unit tests against the mock repo, `now` injected.
- `package.json` `ca:deploy` — thread `ALERTS_EMAIL` through.

## Reuse

- `extractionRepo.listByStatus` — `src/lib/rap/index.ts` / `repo.dynamo.ts`.
- `notify-digest.ts` → `runDigest()` — the thin-handler / testable-core / cron-env pattern.
- `isProd` gating + `transform` — `sst.config.ts`.
- The `check()`-style test harness — `scripts/test-extract-queue-view.ts`, `test-validate-quotes.ts`.

## Testing & verification

**Unit:** `scripts/test-stuck-job-monitor.ts` — no EXTRACTING jobs → 0; a fresh EXTRACTING job → 0;
a job past `maxAgeMs` → 1; FAILED/PENDING_REVIEW/PENDING ignored; boundary at exactly `maxAgeMs`;
input not mutated. Plus `tsc --noEmit`, `next build`.

**Live (deploy to `ca` via `npm run ca:deploy`):**
1. Confirm the SNS subscription email (one-time click).
2. Error alarm — recreate the missing-S3-key job (#194 technique), invoke `RapExtract`, expect an
   email.
3. Stuck-job alarm — insert an `EXTRACTING` job with an old `updatedAt`, invoke `StuckJobMonitor`
   directly, expect the metric → alarm → email. Clean the row up after.
4. DLQ — verify wiring via `aws sqs get-queue-attributes` (a hard crash is hard to force).
5. Retention — `aws logs describe-log-groups --region ca-central-1` shows `retentionInDays: 30`.

## Out of scope (follow-ups)

- prod-stage alarms (small `isProd`-gated follow-up).
- X-Ray tracing and a CloudWatch dashboard.
- CloudTrail / audit (governance-framed, larger).
- DLQ auto-redrive and DLQ→`markFailed` reconciliation.
