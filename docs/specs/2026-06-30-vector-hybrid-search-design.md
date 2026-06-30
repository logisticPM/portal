# Phase 2-B.2: Vector / Hybrid Retrieval Substrate — Design Spec

**Status:** Approved · extends the `cases` domain · stacked on `feat/legal-fulltext-fetch` (storage model B)
**Date:** 2026-06-30
**Audience:** Data group
**Purpose:** Add **semantic + lexical hybrid retrieval** over the full-text substrate that 2-B.1 stored as per-chunk items. The existing `searchCases` is exact-substring scoring over metadata; it cannot answer *"cases about revenue-sharing from resource extraction on unceded land"* unless those literal words appear. This phase adds **BM25 + dense-vector + RRF(k=60)** brute-force hybrid retrieval, behind the `CaseRepo` seam, with a **pluggable embedder that runs offline (no API key) via a deterministic stub**. RAG question-answering is explicitly out of scope (→ 2-B.3); this phase builds only the retrieval substrate.

> **Why brute-force, not ANN; why hybrid; why pluggable (the research):** `docs/research/2026-06-30-vector-search-scale-brute-force-vs-ann.md`. At our scale (~1,300 full-text judgments → tens of thousands of chunks), exact cosine over an in-memory matrix is **sub-100ms with recall = 1.0 and zero tuning** — FAISS and pgvector both classify this scale as "use exact / full scan," and their ANN recipes are dimensioned for **1M–1B** vectors. ANN here would *trade away recall* (missing an on-point precedent is a substantive failure, not a cosmetic one) for a latency win we do not need. Hybrid (BM25 + dense, fused by RRF k=60, Cormack SIGIR'09) is a peer-reviewed standard; BEIR (Thakur NeurIPS'21) shows BM25 is a hard-to-beat zero-shot baseline, and law leans on it harder because **neutral citations, section numbers, party names, and docket numbers are exact tokens that dense embeddings blur** — lexical matching guarantees they are findable. Pluggable + no-key-stub means the entire pipeline (chunking → BM25 → fusion → ranking) is verifiable offline in CI; real semantic vectors light up the moment a Bedrock / OpenAI / self-hosted bge-m3 key is provisioned.

---

## 1. Scope

**Goal:** given a query string, return cases ranked by **hybrid relevance over chunk text + chunk vectors**, computed brute-force in-process, behind a new `CaseRepo.hybridSearch` method — without disturbing the `searchCases` golden path (`dynamo ≡ mock`).

**In scope:**
- **Retrieval-sized chunking (`a2aj.ts`):** lower the chunk size target from 256 KB to a retrieval-appropriate bound (~2 KB / ~500 tokens) using the existing sentence-boundary splitter, so a single 256 KB blob (the no-blank-line pathological doc) is no longer embedded as one meaningless vector. Normal paragraphs pass through unchanged; the 256 KB hard cap remains as the absolute backstop. **No overlap** (preserves full-text fidelity: chunk concatenation still ≈ source).
- **Pluggable embedder (`search/embedder.ts`):** an `Embedder` interface (`id`, `dim`, `embed(texts) → Float32Array[]`) with a `getEmbedder()` factory. Default = a **deterministic hash stub** (offline, no key, NOT semantic — labelled `stub-hash-v1`). Real providers (Bedrock Titan / OpenAI / self-hosted bge-m3) selected via `EMBED_PROVIDER` + `EMBED_MODEL` env, mirroring the existing LLM-client pattern.
- **Vector storage (`cases-table.ts`):** each CHUNK item gains a `vec` **Binary** attribute (packed float32, little-endian, `dim×4` bytes), plus `embedderId` (S) and `vdim` (N). Vectors are NOT stored as Number-lists (DynamoDB Number is variable-length decimal — a 1024-element list bloats to tens of KB; see research §4). Pack/unpack helpers are pure + unit-tested.
- **Embed pass (`cases:embed`):** scan CHUNK items whose `vec` is missing or whose `embedderId` ≠ the active embedder, batch-embed their `text`, write `vec`/`embedderId`/`vdim`. Idempotent, resumable, batched (≤25). Stub runs offline; real provider needs a key.
- **Hybrid retrieval (`search/hybrid.ts`):** in-process **BM25** inverted index over chunk text + **exact cosine** over the in-memory vector matrix, fused by **RRF(k=60)** at chunk level, aggregated to the case by **max chunk score** (a strong single passage is the signal; sum biases toward long judgments). Pure and deterministic (id tie-break, matching the existing convention).
- **In-memory index cache (`search/index.ts`):** one scan of CHUNK items builds BOTH the BM25 index and the vector matrix; cached at module scope; DynamoDB is the source of truth. Never scanned per query (research §4).
- **Seam (`types.ts`, both repos):** new `CaseRepo.hybridSearch(query, filter?) → LegalCase[]`. Dynamo impl = real hybrid. Mock impl = delegates to keyword `searchCases` (it has no vectors). The cases search page calls `hybridSearch`.

**Out of scope (later phases):**
- **RAG / generative Q&A** (→ 2-B.3). This phase returns *ranked cases*, never generated prose.
- **Cross-encoder reranking** — improves precision but unnecessary for recall at our scale (research §2); deferred.
- **ANN (HNSW/IVF), OpenSearch, pgvector** — deferred until the trigger metric (vector count → hundreds of thousands, or high QPS) fires (research §4). Instrument the vector count; do not pre-optimize.
- **Real-key embedding in CI** — CI runs the stub only; real embedding is a keyed, manual/operational pass.
- **Embedding overlap, multi-vector / late-interaction (ColBERT-style)** — YAGNI for this iteration.

**Definition of done:**
- `npm run typecheck` exit 0; `npm run verify` green — **`searchCases` is unchanged, so the `dynamo ≡ mock` golden checks still hold**; `hybridSearch` is explicitly excluded from the equality checks (mock has no vectors).
- Pure unit tests pass offline (no network, no key): chunk windowing; float32 pack/unpack round-trip; tokenizer; BM25 ranking on a toy corpus; RRF fusion on toy ranks; cosine; stub-embedder determinism; an end-to-end stub run (embed toy corpus → build index → query → deterministic ranked order).
- With DynamoDB Local up, `cases:embed` (stub) writes `vec`/`embedderId` to CHUNK items idempotently and resumably; `hybridSearch("…")` returns ranked cases; with no vectors present it degrades to **BM25-only** (dense skipped) and logs that it did.
- The **embedder-consistency guard** works: a query embedded by embedder X never cosine-compares against vectors written by embedder Y — on mismatch, dense is skipped (BM25-only) and the skip is logged.

---

## 2. Chunking: retrieval-sized, fidelity-preserving

The full-text record stays the **chunk** (storage model B). 2-B.1's `chunkText` split on blank lines and only sub-split at 256 KB — so a normal judgment becomes many paragraph chunks (good), but a no-blank-line document becomes one 256 KB chunk (useless as a single embedding vector). The only change here: **lower the per-chunk size target to ~2 KB (~500 tokens)** using the existing `splitLarge` sentence-boundary logic, so oversized chunks are split into retrieval-sized, sentence-aligned pieces. Normal paragraphs (already under the bound) are untouched. The 256 KB hard cap stays as the last-resort backstop.

- **No overlap.** Concatenating a case's chunks still reproduces the source text (modulo whitespace) — the fidelity property `include.ts` and `getCase` rely on. Boundary-recall loss from no-overlap is absorbed by RRF over multiple chunk hits; overlap is a 2-B.3 refinement (YAGNI now).
- **Re-chunking existing data:** the bound change only affects newly written chunks. Existing substrate is re-chunked by re-running `cases:fetch-fulltext` (disk-cached → no network), which already deletes stale `CHUNK#` items before rewrite (2-B.1 spec §5). This is an operational step, not a schema change.
- **`dynamo ≡ mock` unaffected:** the golden test seeds from static fixtures (coarse chunks) and round-trips them identically; the chunker change touches only live ingestion, not fixtures.

## 3. Pluggable embedder

```ts
// src/lib/cases/search/embedder.ts
export interface Embedder {
  readonly id: string;   // identity stamped onto every vector, e.g. "bge-m3", "stub-hash-v1"
  readonly dim: number;  // 1024 default
  embed(texts: string[]): Promise<Float32Array[]>;
}
export function getEmbedder(): Embedder; // env-selected; stub if no EMBED_PROVIDER
```

- **Stub (`stub-hash-v1`, default, offline):** deterministic pseudo-vector derived from a token hash of the text (hashed tokens → seeded coordinates → L2-normalized), fixed `dim`. It is **NOT semantically meaningful** — its only jobs are (a) let the full pipeline + tests run with no key, and (b) be stable so tests are deterministic. Never promoted to a quality claim.
- **Real providers (keyed):** `EMBED_PROVIDER=bedrock|openai|bge-m3` + `EMBED_MODEL` select a real client (HTTP / SDK), mirroring `ingest/llm.ts`. Output L2-normalized, `dim` = the model's (1024 to start, research §3). Batched with provider rate limits.
- **Consistency is a correctness invariant, not a nicety.** Cosine between vectors from different embedders is meaningless. Every vector stores its `embedderId`; the query is embedded by the **active** embedder; if the active id ≠ the stored vectors' id, dense is **skipped** (BM25-only) and the mismatch is logged. `cases:embed` re-embeds any chunk whose `embedderId` is stale. This prevents the classic "stub vectors silently compared against real query vectors" garbage-retrieval bug.

## 4. Vector storage (Binary attribute on CHUNK items)

```
PK=CASE#<id>  SK=CHUNK#0001  et=CaseChunk  paragraph="para-1"  text="…"
                                            vec=<Binary dim×4 bytes>  embedderId="stub-hash-v1"  vdim=1024
```
- One vector per chunk; ~4 KB at 1024-d ≪ 400 KB item limit (research §4 ①). Stored as **Binary** (packed float32 LE), never Number-list (research §4 ②). Pack/unpack are pure helpers with a round-trip unit test.
- Adding `vec` is **additive** — PROFILE items, `reassembleCase`, `itemToCase`, and the domain `LegalCase` type are untouched (vectors are an infrastructure attribute on chunk items, not a domain field; the frontend never sees them).
- Memory budget: 50k chunks × 1024-d float32 ≈ 205 MB — fits the in-process matrix comfortably (research §4).

## 5. Embed pass (`cases:embed`)

```
embedder = getEmbedder()
scan CHUNK items where vec is absent OR embedderId != embedder.id
  → batch texts → embedder.embed(batch)
  → write vec / embedderId / vdim back to each CHUNK item (BatchWrite ≤25, flush every N)
resumable: re-run skips already-current vectors; idempotent by (PK, SK)
```
- Stub path runs fully offline (CI / dev). Real path is a keyed operational pass.
- Logs counts: embedded / skipped-current / total — and the active `embedderId`, so a stub-vs-real mixup is visible at write time.

## 6. Hybrid retrieval (brute-force, in-process)

```
buildIndex (once, cached):  scan CHUNK items → { caseId, chunkIdx, text, vec? }[]
                            → BM25 inverted index (over text) + Float32 matrix (over vec, embedderId-checked)

hybridSearch(query, filter):
  qTokens = tokenize(query)
  bm25Ranked  = BM25 score over chunk texts                          (always available)
  denseRanked = cosine(embed(query), matrix)  IF embedderId matches  (else skipped + logged)
  fused = RRF(bm25Ranked, denseRanked, k=60)        # chunk-level: Σ 1/(60+rank_m)
  perCase = max fused score over each case's chunks  # max, not sum (no long-doc bias)
  cases   = filterCases(lookup(perCase order), filter)   # core-only default, reuses query.ts filter
  return cases sorted by (perCase desc, citingCount desc, id asc)
```
- **BM25** (`k1=1.2, b=0.75`, standard): lowercase tokenizer that **keeps legal exact tokens** (neutral citations like `2014 scc 44`, section numbers) so lexical matching guarantees they're findable (research §2). Pure, offline-testable.
- **Dense:** L2-normalized cosine = dot product = one matrix-vector multiply; recall = 1.0, no tuning (research §1). Skipped cleanly when no/incompatible vectors → BM25-only, logged.
- **RRF(k=60)** (Cormack SIGIR'09): rank-based, fuses the non-comparable BM25 and cosine scales with zero tuning. Chunk-level fusion → max-per-case aggregation → case ranking.
- **Deterministic:** stable sort with `id` tie-break (matches `query.ts` convention) so results are reproducible and testable.

## 7. In-memory index cache

- A single CHUNK-item scan builds both structures; cached at module scope (`search/index.ts`). DynamoDB remains the source of truth; the cache is rebuilt on first search after process start (and can be invalidated after an embed pass).
- **Never scan per query** (research §4 ③): the matrix and inverted index are reused across queries within a process.
- **Cold-start caveat** (research §4): the first search in a fresh Lambda pays the scan + build. Acceptable for MVP and Local dev; production mitigation = provisioned concurrency / a warm long-lived service. Concurrency = one matrix copy per process (hundreds of MB; fine at low concurrency).

## 8. Seam & components

- **`types.ts`:** add `hybridSearch(query: string, filter?: CaseFilter): Promise<LegalCase[]>` to `CaseRepo`. `searchCases` stays as-is.
- **`repo.dynamo.ts`:** implement `hybridSearch` via `search/index.ts` + `search/hybrid.ts`. `searchCases` unchanged.
- **`repo.mock.ts`:** implement `hybridSearch` by delegating to keyword `searchCases` (no vectors in fixtures). **Documented exclusion** from the `dynamo ≡ mock` golden equality (the two are intentionally different here).
- **`search/` (new):** `embedder.ts` (interface + stub + real factory), `pack.ts` (float32 ↔ Buffer), `bm25.ts` (index + score), `hybrid.ts` (RRF fuse + aggregate), `index.ts` (cached builder). All pure except the real embedder + the dynamo scan.
- **`cases-table.ts`:** `vec`/`embedderId`/`vdim` on CHUNK items; pack/unpack used by the embed pass + index builder. PROFILE marshalling untouched.
- **UI (`src/app/cases/page.tsx`):** the search call site uses `hybridSearch`. Dynamo → hybrid; mock → keyword fallback. The seam keeps the page ignorant of vectors/BM25.
- **`scripts/cases-embed.ts`:** the embed pass. **`scripts/verify.ts`:** add checks that don't break `dynamo ≡ mock` (e.g., hybrid returns a non-empty ranking for a known term on seeded data; pack/unpack round-trip). New `scripts/test-cases-{chunk,pack,bm25,rrf,embedder-stub,hybrid}.ts`.

## 9. Testing (offline-first)

- **Pure units (no network/key):** chunk windowing (oversized → sentence-aligned ≤bound pieces; small untouched); pack/unpack round-trip (Float32Array → Buffer → Float32Array equal); tokenizer (keeps `2014 scc 44`); BM25 ranking on a toy corpus (known expected order); RRF fusion on toy ranks (known expected order); cosine on known vectors; stub-embedder determinism (same text → same vector); end-to-end stub (embed toy corpus → index → query → deterministic ranked order, dense path exercised).
- **Golden:** `npm run verify` green — `searchCases`/`getCase`/facets/activation all unchanged, so every `dynamo ≡ mock` check holds. `hybridSearch` is excluded from equality by design (documented).
- **Live:** `cases:embed` (stub, DynamoDB Local) + a manual `hybridSearch` smoke; real-provider embedding exercised manually when a key is present.

## 10. Mechanics & constraints

- **Additive & contract-first:** the only seam change is the *new* `hybridSearch` method; `searchCases`, `LegalCase`, PROFILE marshalling, and the golden path are untouched. Frontend imports only `@/lib/cases`.
- **Idempotent / resumable:** `cases:embed` keys by (PK, SK), re-embeds only missing/stale vectors.
- **No outbound bulk fetch:** this phase reads stored chunk text only — no A2AJ/CanLII calls. Real embedding sends chunk text to the configured embedding provider; with the stub (default) nothing leaves the process.
- **Governance unchanged:** retrieval surfaces stored, citation-anchored extractive content ranked by relevance — no generation. "Unofficial reproduction" provenance still applies; LLM labels remain metadata-only.
- **Instrument the trigger:** log/track total vector count so the B/C (OpenSearch / pgvector) migration point (research §4) is data-driven, not guessed.

## 11. Open questions

- **[Open]** Default real embedder when a key is provisioned — self-hosted **bge-m3** (open, 1024-d) vs a hosted API (Bedrock Titan / OpenAI / Voyage). Decide at provisioning; the pluggable interface defers it.
- **[Open]** Index cache invalidation in serverless — TTL vs explicit bust after `cases:embed`. MVP: rebuild on cold start; revisit if staleness bites.
- **[Open]** Whether the search page should expose a lexical-only toggle (debug/transparency) — deferred; the method already degrades to BM25-only without one.
