# `scanAll` Request-Memoization — Design

**Date:** 2026-07-09 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases/repo.dynamo.ts`

## Motivation

The `/cases` browse page calls two repo methods per render — `listCases(filter)` and
`listFacets({ tier: "all" })` — and each runs its own full `scanAll()` (a paginated GSI1
Scan of all ~5,049 case profiles). So one browse load = **two identical full Scans**. Tier
(core vs all) does not change this (both Scan everything, then filter in memory), so the
cost is a constant floor on every load and every pagination navigation.

The already-merged pagination change fixed the *rendering* cost (10 rows instead of ~5,049);
this fixes the *data* cost by removing the duplicate Scan.

## Decision

Wrap `scanAll` in **React `cache()`** so it is memoized for the duration of a single RSC
request render. Within one browse render, `listCases` and `listFacets` then share **one**
Scan instead of two.

- **Scope:** per-request only. React `cache()` does not persist across requests → no
  cross-request staleness; each fresh page load still reads live data once.
- **Safe in every context:** the only runtime callers of `scanAll` are the RSC case pages
  (`listCases`/`listFacets`/`getActivationSummary`/`getCorpusStats`/`getCitationGraph`/
  `exportCases`/`searchCases`). `hybridSearch` (the briefing Lambda's path) uses the S3
  search index, and `getCase` uses a key GetCommand — neither touches `scanAll`. Importing
  `cache` into the module is harmless where it is never invoked (Lambda bundles).
- **No interface / parity impact:** `CaseRepo` is unchanged; the mock repo (in-memory
  fixtures) is untouched; the `dynamo ≡ mock` golden checks compare method **outputs**,
  which are identical — only the number of Scans drops.

## Change (the whole diff)

`src/lib/cases/repo.dynamo.ts`:

1. Add `import { cache } from "react";`.
2. Change `async function scanAll(): Promise<LegalCase[]> { … }` to
   `const scanAll = cache(async (): Promise<LegalCase[]> => { … });` (body unchanged), with a
   comment explaining the request-memoization.

No other file changes.

## Rejected alternatives

- **New `listBrowse()` repo method returning `{ cases, facets }` from one Scan** — adds a
  method to the `CaseRepo` interface, forcing a mock implementation + parity-test churn.
- **Page-layer memo (move `filterCases`/`buildFacets` into `page.tsx`)** — leaks repo
  internals into the page and breaks the repo abstraction.

## Explicitly NOT doing (YAGNI)

- No projection/slimming of the Scan (facets don't need full profiles) — a larger,
  separate optimization.
- No data-layer (DynamoDB-native) pagination — memory slicing after one Scan is retained.

## Testing

- `npm run verify` — the `dynamo ≡ mock` golden parity + suite stays green (outputs
  unchanged).
- `npm run typecheck` clean; `npm run build` compiles (confirms `import { cache } from "react"`
  resolves under Next.js 14).
- Behavior is identical; no new assertion is added (the change removes a duplicate Scan, not
  a behavior).

## Success criteria

- Browse baseline latency roughly halves (two full Scans → one) with no behavior change;
  core and all both benefit; combined with pagination, switching to `all` should feel much
  smoother.
- Parity/typecheck/build green; no interface or storage change; `verify` unaffected.
