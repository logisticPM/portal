# Labeling-Agent Wiring (dual-LLM `callProvider`) — Design

**Date:** 2026-07-03 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases/ingest`

## Motivation

The dual-LLM theme-labeling pipeline (spec 2026-06-28 §5) is complete **except** its
provider call: `callProvider` in `src/lib/cases/ingest/llm.ts` still throws
`"callProvider not configured"`. Consequence: `labelCase` throws → `promoteOne` returns
null → every inclusion-passing substrate case silently stays substrate. The live corpus
has **core = 2** (enrichment-curated flagships only) while ~476 cases pass the inclusion
filter unlabeled — so the 6-theme taxonomy covers ~0.2% of the corpus and the activation
page aggregates over a handful of cases.

Everything downstream already exists and is tested: `configuredModels` (LABEL_MODELS,
two ids, different families), `cachedCall` (disk cache → re-runs free/resumable),
`parseThemes`, `mergeLabels` (intersection + agreement + needsReview), `labelCase`,
`RUBRIC_VERSION`, and the batch entry point `cases:promote` (`promoteSubstrate` filters
→ labels → promotes). **The only missing piece is the provider call.**

## Decisions (from brainstorm)

- **Q1: Bedrock + offline stub.** Real labels come from AWS Bedrock generative models;
  a no-key deterministic stub keeps the pipeline runnable offline/CI.
- **Q2: pure test stub** (not a heuristic bootstrap). The stub is deterministic and
  semantically meaningless — it exists only so `labelCase` runs end-to-end without
  credentials and tests are stable. Real themes come **only** from the credentialed
  dual-LLM run. (Same ethos as the `stub-hash-v1` embedder.)

## Architecture

All changes in `src/lib/cases/ingest/llm.ts` — `callProvider` becomes:

1. **`stub:` prefix → deterministic test stub.** `sha256(modelId + "\n" + prompt)`
   bytes select a small subset of `ALL_THEMES`; returns a valid JSON array string.
   Different stub ids (`stub:a`, `stub:b`) deterministically produce different (usually
   overlapping) sets, which exercises the intersection/agreement logic for real.
   No network, no key.
2. **Anything else → Bedrock Converse API.** Lazy `import("@aws-sdk/client-bedrock-runtime")`
   (dependency already present), `ConverseCommand` with the prompt as a single user
   message, `inferenceConfig: { temperature: 0, maxTokens: 256 }`, region from
   `BEDROCK_REGION ?? AWS_REGION ?? "us-east-1"`. **Converse, not InvokeModel**, because
   it is uniform across model families (Claude / Nova / Llama / Mistral) — exactly what
   LABEL_MODELS' "two different families" requirement needs; no per-family body formats.
   Returns the concatenated text content of the response message.

Unchanged: `configuredModels`, `cachedCall`, `parseThemes`, `labelWithModel`,
`mergeLabels`, `labelCase`, `rubric.ts`, the promote pipeline, storage.

## Testing (offline, TDD)

New `scripts/test-cases-label-llm.ts` (node:assert/strict, async IIFE):
- stub determinism: same (id, prompt) → identical output; `stub:a` vs `stub:b` differ.
- stub output is a valid JSON array that `parseThemes` accepts (⊆ ALL_THEMES).
- end-to-end: with `LABEL_MODELS=stub:a,stub:b`, `labelCase(text)` resolves with
  `themes` = the exact intersection of the two stub outputs and
  `labelMeta.method === "dual_llm"`, correct `agreement`/`needsReview`.
- cache isolation: point the cache dir at a temp path? — No: `cachedCall`'s CACHE path
  is fixed; the test uses distinct prompt strings so cache hits are themselves
  deterministic and harmless. (Stub outputs are pure functions of id+prompt, so a cache
  hit returns the same bytes — no flakiness.)

`npm run typecheck` clean. Existing `test-cases-labelmerge.ts` untouched.

## Operational run (credentialed, separate from the code change)

1. Probe which generative models this account can invoke (candidates: a Claude family
   id + an Amazon Nova family id — two families, both cheap).
2. Local: `LABEL_MODELS="<idA>,<idB>" npm run cases:promote` → labels + promotes the
   ~476 inclusion-passing substrate cases (serial; ~20–30 min; ~$1–3; disk-cached, so
   interrupted runs resume free).
3. Cloud: re-run promote against the cloud table (`AWS_REGION=us-east-1
   CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-promote.ts`) — same cache
   makes this pass mostly free — so the production activation/browse pages get labeled
   core content.
4. Record counts (promoted N, agreement full/partial split) in the datasheet/docs.

## Governance (unchanged, restated)

Labels are **metadata only** — display stays extractive + citation-anchored. Dual-model
intersection = **consistency** signal, not accuracy (accuracy is validated only against
a human gold set, still pending). Partial agreement ⇒ `confidence:"low"` +
`needsReview:true`. `RUBRIC_VERSION` is stamped via the prompt; the stub is never
authoritative and must not be used to promote real cases (guard: stub ids are only ever
set via LABEL_MODELS in tests).

## Success criteria

- Offline: new test green with `LABEL_MODELS=stub:a,stub:b`; typecheck clean.
- Credentialed run: `cases:promote` promotes hundreds of cases to core with
  `labelMeta.method="dual_llm"`; PRISMA counts printed; activation page aggregates over
  the labeled core (local + cloud).
