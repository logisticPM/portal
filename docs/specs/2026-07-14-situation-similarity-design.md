# Situation → Similar Cases (guided intake + explainable similarity) — Design

**Date:** 2026-07-14 · **Status:** approved (design), pre-implementation · **Domain:** `src/lib/cases/*`, `src/app/cases/similar/*`, `scripts/`

## Motivation

Today `/cases` retrieves cases from a **short query** (keyword/concept). An Indigenous
business's *situation* is a multi-dimensional **fact pattern** (theme, jurisdiction,
government action, sector, stage) that a short query can't express, so the business can't
easily see *which prior cases are most like theirs and why*.

This feature adds a **guided situation intake** → a ranked list of the **most similar core
cases**, each with an **explainable, extractive "why similar"** breakdown. It is
**engineered similarity**, not a trained model: it uses our own corpus intensively (case
fields + a new case-level embedding + citation-ready structure) via deterministic scoring —
no supervised training (we have neither the scale, ~541 core, nor similarity labels), and
no black box.

**Red line (inherited):** similarity is **descriptive** — "these precedents are factually
closest on X/Y/Z; read them." It **never** predicts win/lose or gives advice. Reuses the
legal-information-assistant framing + advice-deflection guard.

## Scope (confirmed)

- **Intake dimensions (MVP):** themes (multi-select), jurisdiction/court level (select),
  and a free-text **situation narrative** (required). These map to fields we actually have
  (`themes[]`, `court`/`level`). We deliberately do **not** add sector / counterparty /
  government-action extraction for MVP — the narrative's semantics cover them (deferred).
- **Enabling artifact (confirmed):** a **case-level profile embedding** for each core case
  (~541), so matching is holistic ("whole case vs situation"), not best-passage.

## Architecture

### 1. Case-level profile embedding (new enrichment)

For each **core** case, precompute a profile vector and store it on the PROFILE item.

- **Assembly (pure, deterministic)** — `assembleProfileText(c)` in `similarity.ts`:
  `styleOfCause` · themes (human-readable, `_`→space) · `outcome.holding` ·
  `summary.claims[].text` (joined). Deterministic; no network.
- **Embed** — `getEmbedder().embed([text])` (Titan v2, 1024-dim, L2-normalized), same
  embedder as chunk vectors.
- **Storage** — packed `Float32Array` bytes in a Binary attribute **`pvec`** on the PROFILE
  item (mirrors the chunk `vec` packing), plus markers `pvecEmbedderId` / `pvecDim` for the
  same active-embedder mismatch guard hybridSearch uses. Written by a batch script
  (additive, core-only, idempotent — skip if `pvecEmbedderId` already matches the active
  embedder).
- **Batch script** — `scripts/cases-embed-profiles.ts` + npm `cases:embed-profiles[:cloud]`:
  scan core profiles, `assembleProfileText` → embed → `UpdateItem` set `pvec`/`pvecEmbedderId`/
  `pvecDim` (PROFILE-only, never touches CHUNK vectors). Env mirrors `cases:embed:bedrock`.
  Credentialed cloud run is an ops step (like nations/figures).

### 2. Similarity scoring (pure, `src/lib/cases/similarity.ts`)

```ts
export interface SituationInput { themes: Theme[]; level?: CourtLevel; narrative: string }
export interface SimilarityBreakdown {
  semantic: number;          // cosine(situationVec, caseVec) clamped to [0,1]; 0 if no vector
  themeOverlap: number;      // |selected ∩ case.themes| / |selected|; 0 when no themes chosen
  jurisdictionMatch: number; // 1 if level matches, else 0; 0 when no level chosen
  composite: number;         // renormalized weighted blend (see below), [0,1]
  matchedThemes: Theme[];
  sameJurisdiction: boolean;
}
export interface ScoredCase { case: LegalCase; breakdown: SimilarityBreakdown }

export function assembleProfileText(c: LegalCase): string;
export function scoreSituation(
  input: SituationInput,
  cases: LegalCase[],
  situationVec: Float32Array | null,       // null ⇒ semantic degrades to 0 (structured-only)
  caseVecs: Map<string, Float32Array>,     // caseId → profile vector (may be empty)
  topN?: number,                            // default 10
): ScoredCase[];
```

- **Weights (heuristic, documented constants, tunable, NOT learned):**
  `{ semantic: 0.6, theme: 0.3, jurisdiction: 0.1 }`.
- **Active-dimension renormalization:** narrative (semantic) is always active; theme is
  active only when the user selected ≥1 theme; jurisdiction only when a level is chosen.
  `composite = Σ_active (weight_d / Σ_active weight) · score_d` → always in [0,1] and
  meaningful regardless of which optional dimensions were provided.
- **Semantic** uses the existing `dot()` from `search/hybrid.ts` (vectors are L2-normalized,
  so dot = cosine); negatives clamped to 0. If `situationVec` is null or a case lacks a
  vector, its semantic term is 0.
- Returns cases sorted by `composite` desc (tie-break: `citingCount` desc, then `year`
  desc, then `id` asc for determinism), sliced to `topN`.

### 3. Repo method (the seam) — mirrors `hybridSearch`

Add to `CaseRepo` (`types.ts`): `findSimilarCases(input: SituationInput): Promise<ScoredCase[]>`.

- **Dynamo** (`repo.dynamo.ts`): embed `input.narrative + " " + themes` via `getEmbedder()`
  (mismatch guard vs stored `pvecEmbedderId`/`pvecDim` → degrade to structured-only, logged,
  like hybridSearch's BM25 fallback); load core cases **and** their `pvec`s via a new
  **cached** single-scan loader `coreSimilarityData()` (`cache()`-wrapped, GSI1 scan filtered
  to core `et==="Case"`, `itemToCase` for the case + unpack `pvec` Binary → `Float32Array`);
  call `scoreSituation`. 
- **Mock** (`repo.mock.ts`): structured-only over fixtures (no embed, empty `caseVecs`,
  `situationVec = null`) so offline/dev works. **Excluded from the `dynamo ≡ mock` golden
  parity checks** (documented, exactly like `hybridSearch`).

### 4. Page — `src/app/cases/similar/page.tsx` (RSC, zero client JS)

- **GET form** (`method="get"`, consistent with the browse/search pages): theme checkboxes
  (`theme` repeated), `level` select, and a `<textarea name="s">` for the narrative. Submitting
  puts everything in `searchParams` (narrative in `?s=`; long but within URL limits — MVP).
- **On render with `s` present:** parse → `casesRepo.findSimilarCases({ themes, level, narrative })`
  (embeds internally, like search) → render top-10 `ScoredCase`s.
- **Each result** (new `SimilarCaseCard` in `ui.tsx`): case link + court/year + tier badge;
  a one-line descriptor ("Closest on: duty to consult · BC"); matched-theme chips;
  "same jurisdiction" flag; and the case's **`outcome.holding`** as the extractive anchor
  ("What it established") — no passage re-ranking needed, holding is already verified/extractive.
  No score number shown by default (avoid false precision); "why similar" is the dimension list.
- **Empty state (no `s`):** the form + a short explainer.
- **Governance UI:** always show the not-advice + small-corpus disclaimer
  ("Matches are within our curated ~541-case core; no match ≠ no precedent exists. This is
  legal information, not advice — consult qualified counsel or an Indigenous legal clinic.").
  Reuse `isAdviceSeeking(narrative)` → the advice-deflection banner when the narrative reads
  as asking what to do.
- **Nav** (`layout.tsx`): add a link `Find similar` → `/cases/similar`; add a callout link on
  `/cases` ("Describe your situation to find similar cases →").

### Files

| File | Change |
|---|---|
| `src/lib/cases/similarity.ts` | **New pure.** `assembleProfileText`, `scoreSituation`, weights, types. |
| `src/lib/cases/types.ts` | Add `SituationInput`/`SimilarityBreakdown`/`ScoredCase` + `findSimilarCases` to `CaseRepo`. |
| `src/lib/cases/repo.dynamo.ts` | Implement `findSimilarCases` + cached `coreSimilarityData()` loader (embed + pvec unpack). |
| `src/lib/cases/repo.mock.ts` | Implement `findSimilarCases` (structured-only). |
| `scripts/cases-embed-profiles.ts` | **New batch** enrichment (core-only, additive, idempotent) + npm scripts. |
| `src/app/cases/similar/page.tsx` | **New** intake form + results page. |
| `src/app/cases/ui.tsx` | New `SimilarCaseCard` render component. |
| `src/app/cases/layout.tsx` | Nav link `Find similar`. |
| `src/app/cases/page.tsx` | Callout link to `/cases/similar`. |
| `src/app/cases/methodology/page.tsx` | Short "similar cases" methodology note. |
| `scripts/test-cases-similarity.ts` | **New** unit tests. |

Unchanged: chunk `vec`, hybridSearch, briefing, storage schema (pvec is an additive attribute).

## Governance / safety

- **Descriptive, not predictive/advisory.** No win/lose, no recommendations. Disclaimer +
  advice-deflection banner + small-corpus honesty, on every result view.
- **Extractive & mechanical.** The "why similar" is real matched dimensions + the verified
  `holding`; the composite score is deterministic from real fields + real vectors (no black
  box, no fabrication).
- **No fabricated similarity.** A case with no profile vector simply scores structured-only;
  nothing is invented.
- **Uses our corpus, no training.** All signals derive from our own extracted data; no
  supervised model, no similarity/outcome labels, no outcome bias.

## Testing (offline, TDD)

New `scripts/test-cases-similarity.ts`:
- `assembleProfileText`: deterministic; includes styleOfCause/themes/holding/summary-claim
  text; degrades cleanly when summary/holding absent.
- `scoreSituation`:
  - all three dims active → weights 0.6/0.3/0.1; narrative-only → semantic weight 1.0;
    narrative+themes → 0.6/0.9 & 0.3/0.9 (renormalization).
  - `themeOverlap` fraction correct; `jurisdictionMatch` 0/1; `matchedThemes` populated.
  - `situationVec = null` → semantic 0, still ranks by structured dims.
  - ranking desc + tie-break (citingCount → year → id); `topN` slice.
  - empty `caseVecs` → semantic 0 for all (no crash).

Gate: `npx tsx scripts/test-cases-similarity.ts` passes; `npm run typecheck` clean;
`npm run build` compiles. `verify` (dynamo≡mock) stays green (findSimilarCases excluded from
parity, like hybridSearch); browser spot-check optional (needs a corpus with `pvec` — a
credentialed embed-profiles run first, so it's verified on prod after the ops step).

## Operational run (post-merge, credentialed)

1. `cases:embed-profiles:cloud` — embed ~541 core profiles (Titan v2), write `pvec`. Low
   `EMBED_CONCURRENCY` + adaptive retry (Bedrock throttle discipline).
2. Spot-check `/cases/similar` on prod with 2–3 real situations; confirm sensible neighbors +
   extractive "why similar" + no advice leakage. Record a short Result note.
   (No search-artifact rebuild needed — `pvec` is read directly from the profile item, not
   from the S3 index.)

## Explicitly NOT doing (YAGNI + red line)

- No supervised training / fine-tuned classifier / outcome predictor (scale + labels + red
  line). A cross-encoder reranker on expert-adjudicated relevance pairs is a *later,
  labels-first* option, out of scope.
- No sector/counterparty/government-action extraction (narrative semantics cover them; add
  as enrichment later if the structured filter proves needed).
- No passage-level "best snippet" re-ranking (holding is the anchor); no learned weights;
  no client-side JS; no result storage.

## Success criteria

- Offline: `similarity` unit tests green; typecheck + build clean; parity/verify unaffected.
- After the credentialed embed-profiles run: `/cases/similar` takes a themes+jurisdiction+
  narrative situation and returns sensible, ranked core precedents with an extractive
  "why similar" breakdown and the standing not-advice framing; structured-only degradation
  works when vectors are absent.
