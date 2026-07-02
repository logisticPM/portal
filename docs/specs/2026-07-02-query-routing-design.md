# Query-Type Routing for Hybrid Retrieval — Design

**Date:** 2026-07-02 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases`

## Motivation

Wave B Stage 2 (`docs/research/2026-06-30-retrieval-eval-results.md`) measured hybrid
(BM25 + Bedrock Titan v2 dense, RRF) against BM25 on the 18-query graded gold. The
result **diverges sharply by query layer**:

| layer | BM25 nDCG@10 | Hybrid nDCG@10 | Δ |
|---|---|---|---|
| conceptual | 0.470 | 0.620 | **+0.150** |
| topical | 0.539 | 0.621 | +0.082 |
| known_item | 0.594 | **0.492** | **−0.102** |
| overall | 0.534 | 0.578 | +0.043 |

Dense **helps** natural-language and topical queries but **hurts** exact
citation/party-name lookups: for "2014 SCC 44" or "Sparrow", BM25's exact token
match already ranks the target first, and blending dense in via RRF lets
topically-similar neighbours outrank the exact case (known-item MRR 0.597 → 0.449).

**Applying hybrid uniformly is wrong.** The fix is to route by query type: lexical
(BM25-only) for known-item lookups, hybrid for everything else.

## Decision summary

- **Hard routing**, not soft per-type RRF weighting. Mechanistically sound,
  deterministic, zero tuning → no overfitting to the small (n=6/layer) gold.
  Soft weighting is deferred until the gold is expanded.
- **Known-item detection = citation regex + corpus-grounded case-name match.**
  Citation-only would fix just 2 of the 6 known-item queries (the rest are party
  names: Delgamuukw, Sparrow, Guerin, Mikisew Cree). Corpus-grounded matching
  catches names deterministically without fuzzy proper-noun guessing.

## Architecture

### New pure module: `src/lib/cases/search/route.ts`

```
routeQuery(query: string, index: SearchIndex): { useDense: boolean; reason: RouteReason }
```

- `RouteReason = "citation" | "case_name" | "semantic"`.
- Pure and deterministic — no network, no key, unit-testable offline (matches the
  embedder/labeler stub ethos). `useDense=false` ⇒ known-item ⇒ BM25-only.
- Needs the index only for the case-name set (below); takes it as an argument so the
  function stays pure (no hidden I/O).

### Classification logic (precision-first)

1. **Citation regex** → `useDense:false, reason:"citation"`. Patterns:
   - neutral citation: `\b\d{4}\s+(SCC|SCR|FCA|FC|BCCA|BCSC|ONCA|ONSC|NSCA|NSSC|ABCA|ABQB|SKCA|MBCA|QCCA|YKCA|TCC|CHRT)\s+\d+\b`
   - SCR reporter: `\[\d{4}\]\s+\d+\s+S\.?C\.?R\.?\s+\d+`
   - slug id: `\b\d{4}-[a-z]{2,6}-\d+\b`
   (case-insensitive; list of court abbreviations lives in the module, easy to extend.)
2. **Corpus-grounded case-name match** → `useDense:false, reason:"case_name"`.
   - Precompute once (memoized alongside the index): a set of normalized party
     strings from each case's `styleOfCause` (the segment before " v. "/" c. ",
     plus the full style) and `citation`/`citation2`, lowercased and
     punctuation-stripped.
   - A query matches if, **normalized and ≤ 5 tokens**, it equals or is a contained
     token-subsequence of a case's party string. The ≤5-token cap prevents a long
     natural-language question that happens to contain a surname from being routed
     to BM25.
3. **Else** → `useDense:true, reason:"semantic"`.

### Wiring point: `hybridSearch` (`src/lib/cases/repo.dynamo.ts`)

Before embedding, call `routeQuery(query, idx)`. When `useDense===false`, keep
`queryVec=null` and **skip the Bedrock embed call entirely** (saves latency + cost on
citation lookups); otherwise embed and run hybrid exactly as today. `hybridRank` is
unchanged (it already supports `queryVec=null`). The existing embedder-mismatch /
no-vector degradation stays.

Because the portal `/cases` search already calls `hybridSearch`
(`src/app/cases/page.tsx`), this change improves the **live product** search, not just
the eval — known-item precision is protected in the portal automatically.

## Validation (`scripts/cases-eval.ts`)

- Add a third ranking per query: **Routed** — `routeQuery` decides `null` vs
  `queryVec` per query. Output **BM25 / Hybrid (uniform) / Routed**, per layer + overall.
- Report **classifier accuracy** against the gold layer labels: the 6 known-item
  queries should all route to BM25 (`useDense=false`); the 12 conceptual/topical
  should all route to hybrid. Print any misroutes.

## Testing (TDD, pure/offline)

`scripts/test-cases-route.ts` (standalone `npx tsx`, async-IIFE per repo convention):
- citations ("2014 SCC 44", "[1990] 1 SCR 1075", "2004-scc-73") → `useDense=false`.
- case names against a small fixture index ("Sparrow", "Delgamuukw", "Mikisew Cree")
  → `useDense=false`.
- natural-language ("When must government consult before a pipeline?") and topical
  ("duty to consult", "aboriginal title") → `useDense=true`.
- edge case: a long question containing a surname substring → `useDense=true`
  (token-cap guard).

## Scope / non-goals

- **In:** `route.ts` + `hybridSearch` wiring + eval third column + unit tests.
- **Out (YAGNI):** soft per-type RRF weighting (revisit after the gold is expanded);
  LLM-based classification; surfacing the route reason in the portal UI (a future
  transparency touch, not now).

## Governance / invariants

- `searchCases` and `hybridRank` untouched. The mock repo has no vectors, so routing
  is a no-op there (still keyword) → the `dynamo≡mock` golden test is unaffected
  (and `hybridSearch` is already excluded from the equivalence check).
- `npm run typecheck` must be clean (not just unit tests — tsx strips types).

## Success criteria

- Routed **known_item** nDCG@10 ≈ BM25 (recover the −0.102, back to ~0.594).
- Routed **conceptual/topical** ≈ Hybrid (keep +0.150 / +0.082).
- Routed **overall** > uniform Hybrid's 0.578.
- Classifier: 6/6 known-item routed to BM25, 0/12 conceptual·topical misrouted.
