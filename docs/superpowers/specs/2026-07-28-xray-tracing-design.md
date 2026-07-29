# X-Ray tracing for the `ca` extraction worker

**Date:** 2026-07-28 · Stage: `ca` · Third observability tier, after #197 (alarms/DLQ/metrics) and
#198 (dashboard).

## Context

#197 answers "is anything broken?" and #198 "what are the trends?". Neither answers, for a single
extraction that took 90s–7min or failed, **where** the time or error went — S3, the loader, Bedrock,
or DynamoDB. That question recurs and has no answer today. X-Ray provides it: a per-invocation trace
with the downstream calls as timed subsegments.

**Why X-Ray and not CloudTrail** (the tier originally floated): the account is **AWS
Control Tower-governed**, with an org-wide baseline trail already logging management events, and a
Control Tower SCP (`p-kks2rxn5`) that denies CloudTrail configuration even to the SSO session — the
same governance-block shape as the Textract SCP (`p-9n6l6a99`). CloudTrail is therefore an external
ask to derekja@uvic.ca, not something we build. X-Ray was verified **not** SCP-blocked
(`xray:GetEncryptionConfig` / `GetTraceSummaries` succeed).

Scope, consistent with #197/#198: **`ca` only**, **RapExtract worker only** (the interesting call
chain; the Web request path is OpenNext-noisy).

## Two halves

1. **Active tracing on RapExtract.** Currently `TracingConfig.Mode = PassThrough`; set to `Active`
   via the SST transform seam so each invocation originates a trace.
2. **Instrumented SDK clients.** `aws-xray-sdk-core`'s `captureAWSv3Client()` wraps the S3, Bedrock,
   Textract, and DynamoDB clients so their calls appear as subsegments. Without this a trace shows
   only "the Lambda ran 142s" with no breakdown.

## The `traced()` helper — `src/lib/observability/xray.ts`

A one-function seam wrapping each client, with two load-bearing safety properties because it sits in
the extraction hot path:

- **Zero impact off-Lambda.** Guarded on `AWS_XRAY_DAEMON_ADDRESS`, which the Lambda runtime sets at
  init *only* when Active tracing is on. Absent in local dev, unit tests, and every untraced
  function — so `traced()` returns the client untouched and never even `require()`s the X-Ray SDK.
- **Fail-open.** A wrapping error returns the raw client. Instrumentation can never take down
  extraction; and if it degraded it, #197's alarms fire.

Both are pinned by `scripts/test-xray-traced.ts` (identity passthrough + no-throw when untraced), and
by re-running every existing suite unchanged.

## Wrapped clients

- `src/lib/dynamo/client.ts` — `ddbClient` (shared singleton; the guard limits activation to the
  traced worker)
- `src/lib/rap/storage.ts` — the `S3Client`
- `src/lib/rap/pipeline.bedrock.ts` — the `BedrockRuntimeClient`
- `src/lib/rap/doc-loader/textract.ts` — the `TextractClient`

## Infra — `sst.config.ts` (ca-gated)

- Active tracing on RapExtract via `transform.function`: `args.tracingConfig = { mode: "Active" }`.
- X-Ray IAM on the worker role: `xray:PutTraceSegments`, `PutTelemetryRecords`, `GetSamplingRules`,
  `GetSamplingTargets`.
- Both gated on `isCa`.

## Files

- `package.json` — add `aws-xray-sdk-core`.
- `src/lib/observability/xray.ts` **(new)** — `traced()`.
- The four client modules above — wrap with `traced()`.
- `sst.config.ts` — Active tracing + X-Ray IAM, `isCa`-gated.
- `scripts/test-xray-traced.ts` **(new)** — the safety unit test.

## Testing & verification

- **Unit:** `test-xray-traced.ts`; plus every existing suite still green (proves the wrapping is a
  no-op off-Lambda). `tsc --noEmit`, `next build`.
- **Infra:** `npm run ca:diff` — the tracingConfig transform + IAM plan cleanly, no mutation to
  existing infra.
- **Live on `ca`:** deploy; `get-function-configuration` shows `Mode: Active`; run a real
  extraction; `aws xray get-trace-summaries` + `batch-get-traces` show S3 / Bedrock / DynamoDB
  subsegments with per-call durations — the breakdown that answers "where did the time go".

## Out of scope

Web request-path tracing; prod tracing; BriefGen/monitor tracing; manual subsegments around the
pure-CPU loader parse (X-Ray auto-captures AWS calls only).
