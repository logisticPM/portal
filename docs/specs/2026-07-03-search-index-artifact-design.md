# Search-Index Artifact (S3 prebuilt) — Design

**Date:** 2026-07-03 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases/search`

## Motivation (all measured)

Production `/cases?q=…` returns **504**. Two distinct, measured causes:

1. **Cold index build = 42.8 s** (local, vectors absent; slower with them): `getSearchIndex()`
   scans the entire base table (43,443 items incl. ~160 MB packed vectors) and rebuilds the
   in-memory index. The module-scope cache is useless on serverless — **every Lambda cold
   start pays this**, blowing past the request timeout.
2. **Every query = ~2.7 s warm**: `hybridRank` constructs a fresh `Bm25` over all 43k units
   per query — re-tokenizing the whole corpus and recomputing term frequencies per document
   on each search.

Browse/stats were fixed by the GSI1 read-path change (180 s → ~1-2 s); search needs its own
architecture: the bottleneck is **loading and per-query recomputation**, not scoring math
(brute-force dense over 40k×1024-d is only tens of ms).

## Decision: prebuilt artifact on S3 (option A)

Alternatives priced and rejected for the current scale (~40k chunks):
- **OpenSearch Serverless** ~$175–350/mo floor; **managed OpenSearch** t3.small ~$26/mo but
  needs a DynamoDB→index sync pipeline anyway; **zero-ETL (OSIS)** ~$170/mo; **pgvector**
  ~$15–43/mo + ops + same sync problem. All buy ANN/distribution we don't need at 40k chunks.
- **Provisioned-concurrency warm Lambda**: pays the slow init per instance, fragile, ~$10-15/mo.

**A** serializes the index once (at pipeline end) into compact binary artifacts on S3; a cold
Lambda does one S3 GET + deserialize (seconds) instead of 43k paginated scans, and the
artifact carries a **prebuilt inverted index** so per-query BM25 drops to milliseconds.
$0/month, data stays in our account, and the build step is the seed of the future sync
pipeline (see Upgrade path).

## Upgrade triggers → option B (mechanical, not vibes)

Migrate to a managed search service when ANY of:
- chunks > **150–200k**, or packed vectors > **1 GB** (artifact cold-load becomes slow again);
- search p95 > **1.5 s** (brute-force dense ceiling);
- product needs: multi-tenancy, <100 ms retrieval, or rich filter+rank combinations.

Target then: **OpenSearch Service small cluster** (t3.small, ~$26/mo; BM25 + kNN in one),
pgvector as fallback. `cases:index-build` changes its write target from S3 to the service —
the pipeline position, triggers, and versioning survive the migration.

## Architecture

### Artifact format (binary container, versioned)

`MAGIC + header-length + JSON header + sections at header-declared byte offsets`.
Header: `{ formatVersion, builtAt, counts: {cases, units, chunks}, embedderId, vdim }`
(embedderId/vdim keep the existing query-side consistency guard semantics).

Two objects (S3 keys `cases-index/v<formatVersion>/bm25.bin` and `…/vectors.bin`):

- **BM25 artifact** (~70–90 MB): unitId table, per-unit caseIdx (into a caseId table),
  `docLen` (Uint32Array), `avgdl`, `N`, and the **inverted index**: vocab (term table) +
  postings as packed Uint32 pairs `(docIdx, tf)` per term. **Plus a profiles section**
  (~15 MB): the 3,489 `LegalCase` profiles (JSON) — ranked results are hydrated from the
  artifact, so the search path never touches DynamoDB at all.
- **Vectors artifact** (~160 MB, separate object): parallel `unitIdx` (Uint32Array) +
  packed Float32 block. **Loaded only when a query-time embedder is configured**
  (`EMBED_PROVIDER` set and id/dim match) — production today is BM25-only and never pays
  this download. (Enabling dense in prod = P0-2, out of scope here.)
- Raw chunk **text is not in the artifact** (unused at query time) — artifacts are much
  smaller than the table.

### Module decomposition

- `search/inverted.ts` (new, pure): build inverted index from tokenized docs; score with
  **exactly** the BM25 math of `bm25.ts` (same k1/b, same +1-smoothed idf, same
  score-desc/id-asc tie-break). Query walks only the query terms' postings lists → ms.
- `search/artifact.ts` (new, pure given buffers): `buildArtifact(index)` → Buffers;
  `loadArtifact(buffers)` → a ready `Searcher`.
- `search/hybrid.ts` (refactor, signature-compatible): extract a `Searcher` interface
  (`bm25Rank(query)`, `denseRank(queryVec)`, unit→case mapping). `hybridRank(units, …)`
  remains as a thin wrapper that builds an in-memory Searcher from units — **existing
  callers, tests, and eval keep working unchanged, which enforces parity by construction**.
  RRF fusion + MAX-per-case aggregation unchanged.
- `search/build-index.ts`: `getSearchIndex()` gains artifact sources — env `INDEX_FILE`
  (local path) or `INDEX_BUCKET` (S3, lazy `@aws-sdk/client-s3`) → load artifact;
  **neither set → current full-table scan fallback** (local dev zero-config; behavior
  degrades, never breaks). Module-scope memo as today.
- `scripts/cases-index-build.ts` (new): scan table (existing code path) → build artifacts →
  write local files / upload to S3. npm scripts `cases:index-build` / `:cloud`.
  **Pipeline convention** (documented, not automated): run after ingest / fulltext / embed /
  promote change the corpus.
- `sst.config.ts`: `sst.aws.Bucket("CasesIndex")` linked to Web; env `INDEX_BUCKET`;
  server memory → **2048 MB** (artifact resident + faster CPU).

### BM25 parity is a hard requirement

The inverted scorer must produce **identical rankings** (score and order) to `bm25.ts` —
otherwise every published eval number (BM25 0.534 / Hybrid 0.578 / Routed 0.612) silently
invalidates. Locked by tests: fixture-level full-ranking equality (incl. tie cases) and a
real-corpus spot check across query shapes. The old `Bm25` class stays as the reference
implementation and the fallback path.

## Scope / non-goals

- **In:** inverted searcher + parity tests, artifact build/load, S3/SST wiring, build runs
  (local + cloud), prod verification (search 504 → seconds).
- **Out:** enabling dense in production (P0-2: needs `EMBED_PROVIDER` + region check —
  `extractionEnv` pins `BEDROCK_REGION=ca-central-1`, vectors are us-east-1 Titan);
  automation hooks for rebuild; option B migration.

## Governance / invariants

- `searchCases`, storage schema, `dynamo≡mock` golden untouched (mock has no artifact path).
- Honest degradation preserved: no artifact → scan; artifact embedder mismatch → dense off
  (logged), BM25 still serves.
- Staleness: the artifact is a **projection**; the table remains the source of truth.
  Between corpus changes and the next `cases:index-build`, search serves the last-built
  artifact (methodology page stats stay live from the table). Documented, acceptable for a
  batch-updated corpus.

## Testing

- Inverted-vs-reference BM25 ranking equality (fixtures incl. ties; real-corpus spot check).
- Artifact roundtrip: build → load → identical rankings + identical profile hydration.
- Loader fallback: no env → scan path still works (existing tests cover it).
- Eval `cases:eval` numbers unchanged (wrapper construction = parity by construction).
- Prod: `?q=duty to consult` 504 → HTTP 200 in seconds cold / sub-second warm.

## Success criteria

- Local: query over the real corpus via artifact ≤ ~50 ms (BM25) after a ≤ ~5 s one-time load.
- Prod search works: cold < ~8 s (incl. S3 GET + Next overhead), warm < 1 s.
- All parity tests green; typecheck clean; `npm run verify` unchanged.

## Result (production, 2026-07-04)

Artifacts built from the cloud table (units=43,436 · cases=3,485 · bm25 58.9MB ·
vectors 160.8MB) and uploaded to the SST-provisioned bucket post-deploy.

| prod measurement | before | after |
|---|---|---|
| semantic search (cold Lambda) | **504** (60s timeout) | **200 in 5.3s** |
| semantic search (warm) | 504 | **200 in 2.0s** |
| known-item `2014 SCC 44` | 504 | **200 in 1.6s** (routed BM25; target case returned) |

Local reference numbers: artifact load 97ms (BM25-only) / 256ms (with vectors) vs
42.8s scan; query ~57ms vs ~2.7s per-query rebuild. Search results verified
relevance-ranked (Haida / Mikisew / Rio Tinto / Tsilhqot'in for "duty to consult").
