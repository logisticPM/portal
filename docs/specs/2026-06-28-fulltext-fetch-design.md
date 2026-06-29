# Phase 2-B.1: Substrate Full-Text Fetch — Design Spec

**Status:** Approved direction (pending spec review) · extends the `cases` domain
**Date:** 2026-06-28
**Audience:** Data group
**Purpose:** Upgrade the A2AJ substrate from **metadata-only** to **full-text**, fixing the Phase 2-A finding that `/search` returns metadata + snippet but not `unofficial_text_en`. This unblocks accurate inclusion filtering and is the data foundation for vector search + RAG (Phase 2-B.2/2-B.3, out of scope here).

> **Background:** Phase 2-A's `cases:ingest` harvested ~3485 substrate records via A2AJ `/search`, which returns no full text. So `chunks` are empty and `fullTextAvailable:false`, and the text-based inclusion filter excluded ~94% (`no_indigenous_signal`) because it saw near-empty text. Only `/fetch` returns `unofficial_text_en`. This spec adds a fetch pass.

---

## 1. Scope

**Goal:** for every substrate record lacking full text, fetch `unofficial_text_en` via A2AJ `/fetch` (by citation), chunk it, and update the record (`chunks`, `fullTextAvailable:true`). Then re-run core promotion so the inclusion filter operates on real text.

**In scope:**
- A pure `applyFullText(case, fetchedText)` → updated `LegalCase` (chunks populated, `fullTextAvailable:true`). Unit-tested.
- A `cases:fetch-fulltext` script: iterate substrate records where `fullTextAvailable === false`, `/fetch` each (cached, **rate-limited**, resumable), apply, upsert. **Idempotent** — records already full-text are skipped.
- Politeness: add a small sleep to `fetchCitation` in `harvest.ts` (it currently has none) so the ~3485-fetch pass doesn't hammer the open API.
- Re-run core promotion (existing `cases:ingest` promotion logic) on the now-full-text substrate; PRISMA counts become accurate (the ~94% false-exclusion resolves).

**Out of scope (Phase 2-B.2 / 2-B.3):** embeddings, vector index (OpenSearch/pgvector/brute-force), hybrid BM25+vector search, RAG Q&A, Bedrock. Also out: re-harvesting / changing the substrate membership (we fetch text for the existing ~3485, we don't add cases).

**Definition of done:** `npm run cases:fetch-fulltext` (DynamoDB Local up) populates full text for the substrate (resumable across runs); a substrate record that had `fullTextAvailable:false` now has `chunks.length > 0` and `fullTextAvailable:true`; `npm run verify` stays green; the pure `applyFullText` unit test passes; `npm run typecheck` exit 0.

---

## 2. Strategy (decided: fetch all)

Fetch full text for **all** ~3485 substrate records (Approach A). They are the topical query-harvest candidate set, so they merit full text; name-only screening would miss landmark cases whose names carry no Indigenous term (*Sparrow*, *Calder*, *Daniels*), and the snippet isn't stored. Non-Indigenous noise (e.g. corporate "fiduciary duty" cases pulled by non-Indigenous-specific queries) is filtered out at **core promotion** by the inclusion filter operating on real text — it stays in substrate but is excluded from core. Bounded (3485, not snowball-explosive), cached, resumable → a one-time ~20–30 min pass, seconds on re-run.

---

## 3. Design

```
substrate records (fullTextAvailable=false)
      │  (for each, idempotent)
      ▼
[FETCH]  fetchCitation(citation)  → A2ajRecord (now with unofficial_text_en)   [cached, rate-limited]
      │
      ▼
[APPLY]  applyFullText(case, text) → { ...case, chunks: chunkText(text), fullTextAvailable: true }   [PURE]
      │
      ▼
[UPSERT] PutCommand by CASE#id   [idempotent]
      │
      ▼
[PROMOTE] re-run existing core promotion (include filter + enrichment/label) on full-text substrate
```

- **`applyFullText` (pure, `src/lib/cases/ingest/fulltext.ts`):** `(c: LegalCase, text: string) => LegalCase`. If `text` is empty, returns the case unchanged with `fullTextAvailable:false` (record stays a metadata stub — some A2AJ `/fetch` may also return no text). Otherwise sets `chunks = chunkText(text)` and `fullTextAvailable:true`. No mutation of the input.
- **`cases:fetch-fulltext` (`scripts/cases-fetch-fulltext.ts`):** scan substrate; for each with `fullTextAvailable===false`, `fetchCitation(c.citation)` → `applyFullText` → collect → batch upsert. Logs progress every N. Resumable: already-full-text records are skipped, and `fetchCitation` is disk-cached, so re-runs continue where they stopped.
- **Rate-limit:** add `await sleep(SLEEP_MS)` (≈150 ms) after a live fetch in `fetchCitation` (only on cache miss). Keeps the open API happy across 3485 calls.
- **Promotion re-run:** reuse `cases:ingest`'s promotion (no code change needed beyond running it after the fetch pass), or expose a `cases:promote` that runs only the include+label+upsert-core step over current substrate. **Decision:** add a thin `cases:promote` script that runs only the promotion loop over the table's current substrate (so we don't re-harvest). Reuses the exact include/enrichment/label logic from `cases-ingest.ts` — factor that loop into an exported `promoteSubstrate()` so both `cases:ingest` and `cases:promote` call it (DRY).

---

## 4. Testing
- **Unit (`scripts/test-cases-fulltext.ts`, tsx):** `applyFullText` — (a) with text → chunks populated + `fullTextAvailable:true`, input not mutated; (b) empty text → unchanged, `fullTextAvailable:false`. Pure, offline.
- **Live:** `cases:fetch-fulltext` exercised manually against DynamoDB Local (resumable). Not in the unit suite.
- **Regression:** `npm run verify` must stay green (the fetch/promote scripts don't change the seam or existing checks).

## 5. Mechanics & constraints
- Idempotent upsert by `CASE#id`; skip records already `fullTextAvailable`.
- Disk cache (`scripts/.cache/a2aj/`) already gitignored; `fetch_*` entries reused.
- Server-side only; no new env/keys (A2AJ is keyless).
- Contract-first preserved: `CaseRepo`/pages unchanged. `cases:fetch-fulltext` and `cases:promote` are data-layer scripts.
- `fetch-polyfill` (Windows undici workaround) imported first, as in `cases-ingest.ts`.

## 6. Open questions
- **[Open]** Whether to prune substrate to the Indigenous-signal subset after fetch (for a cleaner RAG index later) — deferred to 2-B.2 (the vector-index design decides what to index). 2-B.1 keeps all substrate, just adds full text.
