# Cases Read-Path at Scale — Design

**Date:** 2026-07-02 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases`

## Motivation (what the demo exposed)

With the full corpus loaded locally (43,443 items: ~3,489 `Case` profiles + ~39,954
`CaseChunk` items, each chunk carrying a ~4 KB packed vector), the `/cases`,
`/cases/methodology`, and `/cases/activation` pages take **~3 minutes each** to render.

Root cause: every list/stats/facets/activation path calls `scanAll()`, which runs a
**base-table `Scan`** — pulling **all 43k items including ~160 MB of chunk vectors** —
then keeps only the `et === "Case"` profiles and discards the rest. The chunk payloads
(and their vectors) are transferred and deserialized for nothing on every request. This
was invisible at fixture scale (4 mock cases) and before Stage-2 embedding added vectors;
it only surfaced now that the real, embedded corpus is loaded.

## Key discovery — the fix needs no schema change

The table already defines **GSI1** (`src/lib/dynamo/create.ts`) with
`ProjectionType: "ALL"`. Only **profile** items set `GSI1PK`/`GSI1SK`
(`src/lib/dynamo/cases-table.ts` — `caseToItems` sets them on the profile; chunk items
do **not**). By DynamoDB's rule, an item is projected into a GSI only if it has that
index's key attributes — so **GSI1 contains only the ~3,489 profile items, and none of
the chunk items or their vectors.** GSI1 is already populated (profiles have always been
written with `GSI1PK`), on both the local and cloud tables. No new index, no migration,
no backfill.

## Design

**Change `scanAll()` to `Scan` the GSI1 index instead of the base table.**

```ts
new ScanCommand({ TableName: TABLE, IndexName: "GSI1", ExclusiveStartKey: start })
```

- GSI1 (projection ALL) returns the full profile items — including the `data` attribute
  `itemToCase` reads — but **only** the ~3,489 profiles, with **zero** chunk/vector
  payload. The ~160 MB transfer disappears; a ~3-minute load becomes seconds.
- `itemToCase(it)` is unchanged (profile items carry `data`). The existing
  `if (it.et === "Case")` guard stays as a cheap safety net (now trivially always true,
  since only profiles are in GSI1).
- **One change fixes every caller of `scanAll`:** `listCases`, `searchCases`,
  `listFacets`, `getActivationSummary`, `getCorpusStats`, `getCitationGraph`,
  `exportCases`.

## Scope / non-goals

- **In:** `scanAll` → GSI1 scan, and a parity + perf test.
- **Out — `getSearchIndex` (the vector search index):** it scans the base table for
  chunk vectors because building a dense index inherently needs them. It is cached at
  module scope (built once) and only runs on a `hybridSearch` (search) request. Browse /
  methodology / activation don't touch it, so it's irrelevant to this fix. (Its
  first-search cost is a separate, later concern; note that dense is off entirely without
  a query-time embedder + credentials anyway.)
- **Out — cloud seed:** getting the corpus into the production AWS table is a separate,
  credentialed effort. This fix is code-only and applies identically once the cloud table
  is seeded (GSI1 exists there too).
- **Out — caching:** a GSI1 scan of ~3,489 small items is cheap (seconds). We deliberately
  add **no** in-process cache now — it would introduce staleness after an ingest and does
  not help serverless cold starts. Revisit only if measurement shows the per-request GSI
  scan is still too slow.

## Correctness / invariants

- **Completeness:** every case profile is written with `GSI1PK`/`GSI1SK`
  unconditionally, so GSI1 holds all profiles — none are missed. The `LegalCases` table is
  cases-only, so no foreign entity types pollute GSI1.
- **`dynamo ≡ mock` golden test unaffected:** `scanAll` returns the same set of
  `LegalCase` profiles as before (same data, sourced from GSI1 instead of the base table);
  `query.ts` logic is untouched, so `searchCases`/`listCases`/stats produce identical
  output. The mock has no GSI concept and is unchanged.
- **Eventual consistency:** GSIs are eventually consistent, so a read immediately after an
  ingest/embed write could momentarily miss the newest case. Acceptable for a read-mostly
  corpus whose writes are batch ingest steps, not concurrent with user reads.

## Testing

- **Parity (integration, offline, needs the local corpus loaded):** a standalone
  `scripts/test-cases-readpath.ts` that (a) counts base-table `et = "Case"` items and
  GSI1-scanned items and asserts they are equal and > 3,000; (b) asserts a known case
  (e.g. `2004-scc-73`) is present in the GSI1 scan and its item carries `data`. This proves
  the GSI1 access pattern is complete and equivalent to the old base-table filter.
- **Golden:** `scripts/test-cases-mock.ts` (`dynamo ≡ mock`) still passes on the 4 fixtures.
- **Typecheck:** `npm run typecheck` clean.
- **Perf (verification):** with the full local corpus, `scanAll` completes in a few
  seconds (not minutes); `/cases`, `/cases/methodology`, `/cases/activation` render in
  seconds.

## Success criteria

- `scanAll` over the real local corpus returns the same ~3,489 profiles as before, in
  **seconds**, not minutes.
- The three cases pages render in seconds.
- `dynamo ≡ mock` golden green; `npm run typecheck` clean.
