# Legal-Cases Portal — Rich Front-End — Design Spec

**Status:** Approved · extends the `cases` domain UI · branch `feat/legal-cases-portal-fe` (off `main`)
**Date:** 2026-07-01
**Audience:** Data / product group
**Purpose:** Turn the MVP `/cases` pages into a usable, client-demonstrable front-end over the real corpus (3,489 cases / 1,331 full-text / ~40k chunks). Zero external key needed — BM25 search + the stored data already work. The design carries the project's positioning (**economic-activation outward, rigorous-methodology inward**) and governance (**extractive, citation-anchored, "unofficial reproduction", no free-form generation**), and it handles the reality that the corpus is ~99% **substrate** (searchable full text, no curated fields) with a small **core** tier (curated, enriched).

> **Why now / why this shape:** the corpus and BM25 search are live but the UI is a thin MVP that only surfaces the ~6 curated core cases. Exposing the substrate haystack in search (with honest "index only" framing) makes the loaded corpus visible and useful, while the curated core stays the polished spotlight for browse + the activation story. Dense/hybrid retrieval (pending an embedding key) will improve ranking later with **no UI change** — the page already calls `hybridSearch`.

---

## 1. Scope

**Goal:** enhance the four `/cases` surfaces + add a methodology page, as Next.js **server components** reading only through the `@/lib/cases` seam, with small **additive** query-layer support. No new dependencies, no React test framework, no client-side data fetching.

**In scope (5 pieces, built in this order):**
1. **Shared layout** (`src/app/cases/layout.tsx`) — top nav (Cases · Activation · Methodology), a global "unofficial reproduction" disclaimer strip, footer. Wraps all `/cases/*` routes.
2. **Search page** (`page.tsx`) — substrate-inclusive search (`tier: "all"`), a filter row (theme + court level + year + nation + win-type via `searchParams` → `CaseFilter`), a **Core | All tiers** toggle, tier badges, and a relevance/result count.
3. **Detail page** (`[id]/page.tsx`) — metadata header + tier badge; **core** keeps its curated sections (holding / economic / value-realization / citation-anchored summary); **any case with full text** gets a `FullTextReader` (paragraph-anchored chunks, server-side query highlight, native `<details>` expand); citation graph; unofficial-reproduction footer. Empty enriched fields are not rendered (no empty sections for substrate).
4. **Activation dashboard** (`activation/page.tsx`) — add the economic **$ aggregates** (settlement / resourceRevenue / equity, formatted CAD) already in `ActivationSummary`; keep the existing theme bars, value funnel, landmarks; core-only framing (the curated economic story).
5. **Methodology page** (`methodology/page.tsx`) — live corpus stats (`getCorpusStats`) + static narrative (sources & A2AJ, two-tier corpus, PRISMA-style selection, dual-LLM labeling = metadata only, retrieval-eval summary, OCAP/CARE + unofficial-reproduction governance).

**Shared components** (`src/app/cases/ui.tsx`, all server components): `TierBadge`, `CaseListItem`, `FacetFilters`, `TierToggle`, `StatCard`, `Bar` (moved from activation), `ProvenanceFooter`, `FullTextReader`, and a pure `highlight()` helper.

**Query-layer additions (additive, pure — `dynamo ≡ mock` preserved):**
- `CaseFilter.tier` widened to `CorpusTier | "all"`; `filterCases` treats `"all"` as no tier filter, `"core"`/`"substrate"` as exact match, and **omitted as core-only (unchanged default)**.
- New pure `buildCorpusStats(cases)` in `query.ts` + `CaseRepo.getCorpusStats()` on both repos (dynamo scans all; mock over fixtures). Returns corpus counts for the methodology page.

**Out of scope (YAGNI / later):**
- **Per-result body snippets/highlight in the search list.** Results show `holding` (core) or a "full-text judgment — open to read" line (substrate); a match-centered excerpt would require threading snippet text through the search return type — deferred. (Highlight lives on the detail page's full-text reader.)
- Dense/hybrid UI changes (already transparent through `hybridSearch`), RAG/agent Q&A UI, auth/editing, saved searches, pagination beyond a sensible cap, new deps, a React testing framework.

**Definition of done:**
- `npm run build` succeeds (Next type-checks + compiles all server components); `npm run typecheck` exit 0.
- Pure additions unit-tested (`buildCorpusStats`, `filterCases` `tier:"all"`, `highlight()`) via tsx scripts; `npm run verify` green with new `getCorpusStats` `dynamo ≡ mock` + `tier:"all"` checks; existing golden checks unchanged.
- Manual pass (dynamo, corpus loaded): search returns substrate + core with correct badges and Core|All toggle; a substrate detail page renders the full-text reader with `?q=` highlight; a core detail page still shows curated sections; activation shows $ aggregates; methodology shows live stats + narrative; the unofficial-reproduction disclaimer is present globally and per-detail.

---

## 2. Architecture & data flow

All pages are **React Server Components**; state is **URL-driven** via `searchParams` (the existing pattern). No client-side fetching, no API routes — pages call `casesRepo` (server-only seam) directly. The one interactive need (expanding a long judgment) uses native `<details>`/`<summary>` — **no `"use client"` island, no JS**. Query highlight is server-side string→JSX. This keeps the whole surface RSC, SEO-friendly, and dependency-free.

```
searchParams ─▶ CaseFilter ─▶ casesRepo.{hybridSearch|listCases|listFacets|getActivationSummary|getCorpusStats|getCase|getCitationGraph}
                                     │ (server-only; @/lib/cases seam)
                                     ▼
                         query.ts pure fns (shared by mock + dynamo) ──▶ RSC renders ui.tsx components
```

## 3. Query-layer additions (pure, additive)

**`types.ts`:**
```ts
export interface CaseFilter { …; tier?: CorpusTier | "all"; }   // widened
export interface CorpusStats {
  total: number; core: number; substrate: number; fullText: number;
  byLevel: Partial<Record<CourtLevel, number>>;
  byDecade: Record<string, number>; // "1990s" → n, from year
}
export interface CaseRepo { …; getCorpusStats(): Promise<CorpusStats>; }
```
**`query.ts`:**
- `filterCases`: replace the tier predicate with — `f?.tier === "all" ? true : f?.tier ? c.corpusTier === f.tier : c.corpusTier === "core"`. Everything else unchanged. (Existing calls that omit `tier` still get core-only → golden test holds.)
- `buildCorpusStats(cases: LegalCase[]): CorpusStats` — counts over the given cases (callers pass **all** cases). `byDecade` derives from `Math.floor(year/10)*10 + "s"`. `sortKeys` for deterministic maps.

**`repo.dynamo.ts` / `repo.mock.ts`:** `getCorpusStats()` = `buildCorpusStats(await scanAll())` (dynamo) / `buildCorpusStats(caseFixtures)` (mock). Both feed the same pure fn → identical by construction.

## 4. Components (`src/app/cases/ui.tsx`, server)

- **`TierBadge({ tier, fullTextAvailable })`** — `core` (accent tint) or `index only` (amber tint); optional "full text" marker when `fullTextAvailable`.
- **`CaseListItem({ c, q })`** — result row: `styleOfCause` link (to `/cases/{id}?q={q}`), `citation · court · year`, `TierBadge`, and `holding` (core) or a muted "full-text judgment — open to read" (substrate; empty holding).
- **`FacetFilters({ facets, active })`** — theme chips (active highlighted) + court-level / year / nation / win-type as `<a>`-based dropdowns or chip rows built from `Facets` counts; each toggles a `searchParams` key. Server-rendered links (no JS).
- **`TierToggle({ active })`** — two-segment Core | All tiers, links toggling `?tier=`.
- **`StatCard`, `Bar`** — moved out of `activation/page.tsx` for reuse (activation + methodology).
- **`ProvenanceFooter({ c })`** — "Unofficial reproduction · Source: official decision · License: …".
- **`highlight(text, q)`** — pure: split `text` on case-insensitive `q`, return segments with matches wrapped in `<mark>`; unit-tested.
- **`FullTextReader({ chunks, q })`** — renders chunks with `¶N` anchors (`id="para-N"`) and `highlight()`; first ~12 paragraphs shown, the rest inside a native `<details><summary>Show all N paragraphs</summary>…</details>`. Wrapped by a "unofficial reproduction / read against source" note.

## 5. Pages

- **`layout.tsx`** — nav (`Link`s to `/cases`, `/cases/activation`, `/cases/methodology`), global disclaimer strip, footer. `max-w` container consistent with existing pages.
- **`page.tsx` (search)** — parse `searchParams { q, theme, level, year, nation, winType, tier }` → `CaseFilter`. **Tier rule:** `tier = searchParams.tier ?? (q ? "all" : "core")` — browse (no query) shows the curated **core wall**; searching flips to the **all-tiers haystack**; the `TierToggle` sets `?tier=core|all` to override either default. `q ? hybridSearch : listCases`. Render `FacetFilters` + `TierToggle` + count + `CaseListItem[]` + empty state.
- **`[id]/page.tsx` (detail)** — `getCase(id)`; header + `TierBadge`; core sections when present (guarded by `c.economic`, `c.valueRealization`, `c.summary`); `FullTextReader` when `c.chunks?.length`; citation graph; `ProvenanceFooter`. Reads `?q=` for highlight.
- **`activation/page.tsx`** — existing summary + a **$ aggregates** row (`economicValue.settlement/resourceRevenue/equity` via `Intl.NumberFormat` CAD); reuse `StatCard`/`Bar`.
- **`methodology/page.tsx`** — `getCorpusStats()` stat strip + `Bar`s for `byLevel`/`byDecade` + static narrative sections; link to `docs/research/2026-06-30-retrieval-eval-results.md` findings (summarized inline, static).

## 6. Governance (unchanged, enforced in UI)

Extractive display only — no generated legal text. The full-text reader shows **stored** public-court text verbatim with a per-page "unofficial reproduction" note + official-source link + upstream license; the global disclaimer strip repeats it. Substrate is always labeled `index only`. LLM-derived fields (themes on labeled cases) are metadata, shown as tags, never as prose claims. Citation-anchored summary claims (core) link to their source paragraph/URL.

## 7. Testing

- **Pure units (tsx, offline):** `buildCorpusStats` (counts, `byDecade` bucketing, determinism); `filterCases` `tier:"all"` vs `"core"` vs `"substrate"` vs omitted; `highlight()` (match wrapping, case-insensitive, no-match passthrough, empty q).
- **Golden (`verify.ts`):** `getCorpusStats` `mock ≡ dynamo`; `filterCases({tier:"all"})` returns both tiers on dynamo; existing checks unchanged (additive).
- **Pages:** `npm run build` (Next compiles + type-checks RSC) + `npm run typecheck`; manual pass per the DoD. No React test framework (YAGNI — the repo has none; logic worth testing lives in the pure query/helper layer).

## 8. Open questions

- **[Open]** Tier defaults — this spec sets browse→core, search→all (toggle overrides). Revisit if substrate noise overwhelms search or if the core wall feels too sparse on landing.
- **[Open]** Year filter UX (range vs decade buckets) — start with decade buckets from `getCorpusStats.byDecade`; refine later.
- **[Open]** Per-result match snippets — deferred (§1 out of scope); revisit if the substrate result rows feel too bare.
