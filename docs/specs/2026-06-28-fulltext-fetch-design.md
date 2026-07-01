# Phase 2-B.1: Substrate Full-Text Fetch — Design Spec

**Status:** Approved (revised to storage-model B after the 400KB finding) · extends the `cases` domain
**Date:** 2026-06-28 (revised 2026-06-29)
**Audience:** Data group
**Purpose:** Upgrade the A2AJ substrate from **metadata-only** to **full-text**, fixing the Phase 2-A finding that `/search` returns no `unofficial_text_en`. Full text is stored via **vertical partitioning** (one DynamoDB item per chunk) — not inline — because a full judgment inline exceeds DynamoDB's **400 KB item limit**.

> **Why the revision (the 400KB finding + research):** The first attempt stored the whole `LegalCase` (incl. all chunks = full judgment) inline in one item's `data` attribute; large judgments tripped `ValidationException: Item size has exceeded the maximum allowed size` (flush crashed after ~120 small records). Research (`docs/research/2026-06-29-large-document-storage-chunking.md`) — AWS "best practices for storing large items" + the legal-IR literature — converges on **per-chunk items (vertical partitioning)**: it's an AWS-endorsed remedy, the chunk is the natural RAG retrieval unit, and truncation is rejected (it would drop the ratio/holding which sits mid/end of a judgment, AND — since `include.ts` concatenates all chunk text — could flip inclusion decisions and corrupt PRISMA).

---

## 1. Scope

**Goal:** fetch `unofficial_text_en` for substrate records lacking full text, **store it as per-chunk DynamoDB items** (vertical partitioning), and decide core promotion **in-memory at fetch time** (when full text is in hand) — so the inclusion filter sees real text without an expensive reassembly pass.

**In scope:**
- **Storage model change (`cases-table.ts`):** a case is stored as a **PROFILE item** (`SK=PROFILE`, the `LegalCase` minus `chunks`, plus `chunkCount`) **+ N CHUNK items** (`SK=CHUNK#0001…`, each `{paragraph, text}`). New `caseToItems(c) → items[]` and `reassembleCase(profile, chunks) → LegalCase`. Each item stays well under 400 KB.
- **Read model (`repo.dynamo.ts`):** `getCase(id)` = GetItem PROFILE + Query `begins_with(SK, "CHUNK#")` → reassemble. `scanAll`/list/facets/activation/export/search/graph read **PROFILE items only** (chunks omitted — those paths don't need chunk text). `searchCases` scores on citation/name/holding (chunk-text search is a 2-B.2 vector concern).
- **Fused fetch→filter→store (`cases-fetch-fulltext`):** for each substrate record without full text: `/fetch` → `applyFullText` (chunks in memory) → run `includeCandidate` on the in-memory full text → write PROFILE+CHUNK items; if it passes inclusion, promote in the same pass (enrichment for flagship, else dual-LLM label if `LABEL_MODELS` set, else stays substrate). Rate-limited, cached, **resumable**, idempotent.
- Rewrite the ~120 already-stored records under the new model.

**Out of scope (2-B.2/2-B.3):** embeddings, vector index, hybrid/semantic search, RAG, S3 full-text archival (option C — composes with B later), Bedrock. Not changing substrate membership.

**Definition of done:** `cases:fetch-fulltext` (DynamoDB Local up) stores per-chunk items with **no 400KB ValidationException**, resumable; a substrate case now reassembles via `getCase` with `chunks.length > 0` and `fullTextAvailable:true`; core promotion happens in the same pass (PRISMA `no_indigenous_signal` drops sharply vs the prior ~3291); `npm run verify` green (dynamo≡mock holds — `getCase` reassembles chunks identical to the mock's inline chunks); the `caseToItems`/`reassembleCase`/`applyFullText` unit tests pass; `npm run typecheck` exit 0.

---

## 2. Storage model (vertical partitioning, AWS-endorsed)

```
Case "2014-scc-44":
  PK=CASE#2014-scc-44  SK=PROFILE      et=Case      data={...LegalCase without chunks...} chunkCount=137
  PK=CASE#2014-scc-44  SK=CHUNK#0001   et=CaseChunk paragraph="para-1" text="..."
  PK=CASE#2014-scc-44  SK=CHUNK#0002   et=CaseChunk paragraph="para-2" text="..."
  ...
```
- **PROFILE** holds the full domain object minus `chunks` (metadata, outcome, economic, summary, provenance, citation graph, corpusTier, labelMeta) + `chunkCount`. Small — never near 400 KB.
- **CHUNK#nnnn** items (zero-padded for lexical sort) each hold one paragraph — tiny.
- **Reassemble** (`getCase`): GetItem PROFILE, Query `CASE#<id>` `begins_with(SK,"CHUNK#")` (returns chunks sorted by SK), set `data.chunks = [...]`.
- **List/facets/activation/export/search/graph**: PROFILE items only (Scan filters `et==="Case"`), chunks omitted — none of these need chunk text. This keeps those reads as cheap as before.
- **GSI**: PROFILE keeps the existing GSI1/GSI2 (theme/winType). CHUNK items carry no GSI attrs (not indexed).

## 3. Fused fetch → filter → store pipeline (`cases:fetch-fulltext`)

Filtering happens **in-memory at fetch time**, avoiding any reassembly-for-filtering pass over thousands of cases:

```
for each substrate PROFILE with fullTextAvailable=false:
   rec = fetchCitation(citation)            # cached, rate-limited
   c   = applyFullText(profileCase, rec.unofficial_text_en)   # chunks in memory (PURE)
   if includeCandidate(c).include:          # filter sees REAL full text now
        promote c (enrichment | dual-LLM label | stays substrate if no keys)  # reuse promoteSubstrate logic per-case
   write caseToItems(c)  → PROFILE + CHUNK items   (batched ≤25, flush every N, resumable)
```
- `applyFullText` is unchanged (pure, populates in-memory `chunks`).
- Inclusion + promotion reuse the existing `includeCandidate` / enrichment / `labelCase` logic (factored so the fetch pass and `cases:promote` share it).
- `cases:promote` (standalone re-promotion) still exists but now must **reassemble chunks per case** to filter — used only for re-runs without re-fetch; the fused pass is the primary path.

## 4. Components & testing
- `cases-table.ts`: `caseToItems(c)`, `reassembleCase(profileItem, chunkItems)`, keep `caseKeys` (+ `chunkSk(n)`). Drop/replace the single-item `toCaseItem`/`itemToCase` with the multi-item pair; update all callers (`repo.dynamo`, `seed-cases`, `cases-ingest`, scripts, `verify`).
- `repo.dynamo.ts`: `getCase` reassembles; `upsert` writes multi-items per case; `scanAll` returns PROFILE-only cases (chunks omitted).
- **Tests:** `caseToItems`/`reassembleCase` round-trip (a case with chunks → items → reassembled equals original) — unit; `applyFullText` unit (already done). `verify` dynamo≡mock still holds because `getCase` reassembles chunks identical to mock fixtures' inline chunks.
- Live `cases:fetch-fulltext` exercised manually (resumable).

## 5. Mechanics & constraints
- Idempotent: PROFILE upsert + CHUNK upserts by deterministic SK; re-fetch skips records already `fullTextAvailable`. **Stale-chunk note:** if a case is re-fetched with fewer chunks than before, delete orphaned `CHUNK#` items above the new `chunkCount` (or write a `chunkCount` and ignore extras on read). MVP: on (re)write, delete existing CHUNK# items for that case first, then write the new set (simple + correct).
- Non-atomic across items (BatchWrite ≤25, no cross-item txn for >100) → batch + resumable; partial writes are self-healing on re-run.
- Rate-limited `fetchCitation` (Task done in the prior plan). Disk cache reused.
- Contract-first: `CaseRepo`/pages unchanged (the seam is stable; only the dynamo impl + marshalling change).

## 6. Open questions
- **[Open]** S3 full-text archival (option C) for verbatim fidelity + RAG source store — deferred to 2-B.2 (composes with B: chunk items for filter/retrieval-unit in DynamoDB, full object in S3).
- **[Open]** Whether `searchCases` should ever search chunk text (needs reassembly or a search index) — deferred to 2-B.2 (vector/hybrid search).
