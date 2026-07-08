# Enable Production Dense Retrieval (P0-2) — Design

**Date:** 2026-07-06 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases/search` + `sst.config.ts`

## Motivation

Hybrid retrieval (BM25 + dense cosine + RRF) is fully built and its vectors are
already in the production search artifact, but production runs **BM25-only**:
`EMBED_PROVIDER` is unset on the deployed Lambdas, so `getEmbedder()` returns the
stub, `build-index` skips the vectors section, and every hybrid search logs
`[hybrid] embedder/dim mismatch … → BM25-only`. The briefing-notes operational
run (2026-07-06) made the cost concrete: 2 of 5 questions were refused, both
*conceptual* — exactly where the retrieval eval (Stage 2) showed dense lifts
quality (conceptual nDCG@10 0.470→0.620, MRR→1.000) and BM25 is weak. Turning on
dense is the direct fix for both interactive `/cases` search quality and
briefing yield.

## Decisions (from brainstorm)

- **Enable on BOTH paths at once** (interactive Web search + the async BriefGen
  worker) — they share one artifact and one code path (`hybridSearch`); the
  switch is env vars.
- **Approach A: dedicated `EMBED_REGION`, env flip, no rebuild, no IAM change.**
  Everything downstream is already wired; the only real obstacle is the region
  inheritance trap, solved by decoupling the cases embedder's region from the
  RAP-extraction Bedrock region.

## What is already in place (no work needed)

- `hybridSearch` (`src/lib/cases/repo.dynamo.ts:72-91`) routes the query and, for
  `route.useDense` queries whose stored `embedderId`/`vdim` match the active
  embedder, calls `embedder.embed([query])`. **Known-item queries
  (citation / case name) skip the embed entirely** — the query router already
  bounds dense's latency/cost exposure to conceptual/topical queries.
- `getEmbedder()` (`embedder.ts:137-146`) returns the real `BedrockEmbedder`
  when `EMBED_PROVIDER` is a real provider; else the stub.
- `build-index` (`build-index.ts:57-59`) loads the vectors section only when
  `isRealProvider()`. The vectors object (`cases-index/v1/vectors.bin`) is
  **already uploaded** to the prod bucket, so flipping the env loads it on the
  next cold start — **no artifact rebuild**.
- IAM: `bedrock:InvokeModel` is in `bedrockPerms`; both the Web function and
  BriefGen already carry it — **no IAM change**.
- Model access: Titan Text Embeddings V2 in **us-east-1** is verified available
  (Wave B embedded the entire corpus with it there).

## Architecture

### 1. Decouple the embedder region — `src/lib/cases/search/embedder.ts` (the only code change)

`BedrockEmbedder` currently resolves its region from `BEDROCK_REGION ?? AWS_REGION ?? "us-east-1"`. The Web function sets `BEDROCK_REGION=ca-central-1` for RAP extraction/BDA, which the cases embedder must NOT inherit (Titan for cases lives in us-east-1, where the vectors were written; ca-central-1 model access is unverified and cross-region parity is an unnecessary bet). Add a dedicated, highest-priority variable:

```
region = EMBED_REGION ?? BEDROCK_REGION ?? AWS_REGION ?? "us-east-1"
```

The default chain is unchanged when `EMBED_REGION` is unset (local dev, tests, and the existing `cases:embed:bedrock` scripts keep working). This is a ~2-line change at the single point where `BedrockEmbedder` reads its region.

### 2. Environment — `sst.config.ts` (both functions)

Add to the **Web** function's `environment` and the **BriefGen** function's `environment`:

```
EMBED_PROVIDER=bedrock
EMBED_MODEL=amazon.titan-embed-text-v2:0
EMBED_DIM=1024
EMBED_REGION=us-east-1
```

- **Web**: `EMBED_REGION=us-east-1` overrides the inherited `BEDROCK_REGION=ca-central-1`, so RAP extraction stays on ca-central-1 while cases embedding uses us-east-1 — the two Bedrock uses no longer collide.
- **BriefGen**: already sets `BEDROCK_REGION=us-east-1` and has no ca-central-1 inheritance; `EMBED_REGION=us-east-1` is added for explicit consistency.
- These four values match the `cases:embed:bedrock` npm script (`EMBED_MODEL`/`EMBED_DIM` identical to what wrote the vectors), so the active embedder id (`bedrock:amazon.titan-embed-text-v2:0`) equals the stored id → the mismatch warning disappears and dense engages.

### 3. Behavior after the flip

- **Conceptual / topical queries** → hybrid (BM25 + dense RRF); quality per Stage 2 eval.
- **Citation / case-name queries** → BM25-only (router skips embed); known-item precision unaffected by dense (the routing design's whole point).
- Per conceptual query: one Titan embed round-trip (~50-200ms, ~$0.0001). Web memory is already 2048 MB; the vectors-included artifact load measured ~256ms (once per cold start).
- Briefing yield: the conceptual questions that were refused should now ground.
- **Rollback**: delete the four env vars → next deploy reverts to BM25-only. Zero data risk (vectors are read-only artifacts; nothing is rewritten).

## Testing

- **Offline unit** (`scripts/test-cases-embedder-region.ts`, node:assert/strict, async IIFE): assert the region-resolution precedence — `EMBED_REGION` wins over `BEDROCK_REGION` wins over `AWS_REGION` wins over the `us-east-1` default — without constructing a live client (test the pure resolver; if the region logic is inline in `BedrockEmbedder`, extract a tiny pure `resolveEmbedRegion(env)` helper and test that). No network.
- `npm run typecheck` clean; `npm run build` compiles.
- **`npm run verify` not required** (no repo-method logic change; the embedder change is additive and gated on env).
- **Post-deploy smoke (needs AWS credentials):** re-run the 2 conceptual briefing questions that were refused on 2026-07-06 (expect them to ground now); confirm a conceptual `/cases` search no longer logs `→ BM25-only` in CloudWatch; confirm a citation/case-name query still skips the embed (BM25-only, by design). Record in the spec Result.

## Governance

No change to what is displayed or how results are ranked-then-shown — dense only
improves which cases surface for conceptual queries. Extractive display,
citation anchoring, the AI-summary and briefing gates all unchanged. Query
routing keeps known-item precision intact. The dense vectors were produced by
Titan v2 over the same public court text already in the corpus.

## Success criteria

- Offline: region-precedence test green; typecheck + build clean.
- Deployed: conceptual `/cases` searches and briefings run hybrid (no
  `→ BM25-only` warning for `useDense` queries); the previously-refused
  conceptual briefings ground; citation/case-name queries still BM25-only.
- Rollback is a four-variable deletion.

## Result (deploy + verification, 2026-07-06)

PR #109 merged (`6c3489d`); auto-deploy succeeded (BriefGen + Web picked up the
four env vars). Verified with the exact prod env config against the cloud
artifact:

- **Dense engages, ID matches:** `resolveEmbedRegion()` → `us-east-1` (the
  `EMBED_REGION` override beats the inherited ca-central-1); active embedder
  `bedrock:amazon.titan-embed-text-v2:0`/1024 **== stored artifact embedderId**
  → `ID MATCH: true` → the dense gate passes (no silent no-op). A live Titan
  embed returned a 1024-dim L2-normalized vector.
- **Routing intact:** conceptual query → `useDense: true` (embeds + hybrid);
  `2014 SCC 48` citation → `useDense: false` (skips the embed, BM25-only, by
  design — known-item precision unaffected).
- **The failure mode is fixed:** the two conceptual briefing questions that were
  **refused** on 2026-07-06 under BM25-only both now **ground with 0 dropped**
  (15–19s) — dense retrieval pulled in the SCC/FCA landmark cases the model
  reached for (Clyde River / Chippewas 2017-scc-40, Trans Mountain 2018-fca-153,
  2010-scc-43, …) so its precedents survived verification. Briefing conceptual
  yield went from refused → published. New briefings render on prod with the
  AI/not-legal-advice banner; prod conceptual `/cases` search returns hits.
- **Net:** the operational-run yield gap (2/5 refused, all conceptual) is
  closed; the governance gate still refuses ungroundable output, there's just
  far less of it now that conceptual retrieval surfaces the right cases.
