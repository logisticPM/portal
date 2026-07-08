# Nations Extraction — populate the `nations` field (corpus depth) — Design

**Date:** 2026-07-07 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases/ingest` + `scripts`

## Motivation

The `/cases` nation filter lists only **Haida** and **Tsilhqot'in** — because
`nations` is populated on just the 2 curated flagship cases (`enrichment.ts`).
`a2ajToCase` sets `nations: []` ("enrichment fills this"), and the dual-LLM promote
extracts only `themes`, never the nation. So all ~450 A2AJ-promoted core cases have
an empty `nations` array, and the `byNation` facet / filter / activation dimension
are effectively dead.

The Indigenous nation is almost always named in the **style of cause** (case title,
e.g. *"Tsilhqot'in Nation v. British Columbia"*). Extracting it — with the same
citation-anchored discipline as the AI summaries and recorded figures — turns the
facet real without fabrication.

## Decisions (from brainstorm)

- **LLM extraction, styleOfCause-anchored, verbatim-verified** (approach A). Not
  pure regex/gazetteer (B — misses individual-name cases and diverse names) and not
  curated-only (C — doesn't scale).
- **Precision guard = prefer the style of cause.** Verbatim-in-text proves a name is
  present but not that it's the *party's* nation (a judgment may cite another
  nation's precedent). The Indigenous party is in the case title, so a name verified
  in `styleOfCause` is treated as a party nation; a body-only name is kept only if
  the model flags it as the party.
- **Fill-if-empty, never overwrite curated.** Only cases with an empty `nations`
  array are written; the curated flagships keep their authoritative nations.
- **Scope = core cases (452).** Consistent with the facet/browse.
- No new type or `itemToCase` change — `nations: string[]` already exists and
  round-trips. (No `nationsMeta` — YAGNI for a verbatim-verified name field.)

## Architecture

### 1. Extractor — `src/lib/cases/ingest/nations.ts` (new)

`extractNations(c, model): Promise<{ status; nations: string[] }>` mirrors
`extractFigures`/`summarizeCase`:
- **Skip rules:** not `core` → `skipped_not_core`; `nations.length > 0` (curated) →
  `skipped_has_nations`; no chunks → `skipped_no_fulltext`.
- **Prompt (strict JSON):** given the style of cause + judgment text, return
  `{"nations":[...]}` — only the **Indigenous party/parties** (the First Nation,
  band, tribal council, or Métis/Inuit group that is the applicant/appellant/
  plaintiff or respondent), copied **verbatim** as written. Do not include nations
  merely cited or mentioned; do not invent or normalize.
- **`verifyNations`** (pure, mechanical): for each returned name, keep it only if it
  appears verbatim (after `normWs`) in the `styleOfCause` **or** in the judgment text
  (chunks). Dedupe (case-insensitive, first surface form wins); cap at 5. This is the
  no-fabrication gate — a name the model invents can't survive.

Reuses `normWs` and `assembleInput` from `summarizer.ts`.

### 2. Batch runner — `scripts/cases-extract-nations.ts` (new)

Mirrors `cases-extract-figures.ts`:
- List `tier:"core"` profiles; skip any with `nations.length > 0` (curated /
  already-done) unless `NATIONS_FORCE=1`.
- `extractNations` → if it returns a non-empty list, PROFILE-only `UpdateItem`
  writing `data.nations` (`#d`/`#n` aliases — DATA is reserved). Never rewrites CHUNK
  items (no vector impact).
- `cachedModel` for idempotent replay; per-case; resumable; `NATIONS_MODEL` env
  (default `us.meta.llama3-3-70b-instruct-v1:0`).
- npm scripts `cases:extract-nations` (local) + `:cloud`.

### 3. Governance

- **No fabrication:** every stored nation appears verbatim in the case title or
  judgment (mechanical `verifyNations`); model-invented names are dropped.
- **Party, not mention:** styleOfCause-anchored; body-only names require the model's
  party flag. Some residual noise is acceptable (a name is at least genuinely in the
  record) — nations are a filter facet, not a Gallagher-sensitive figure.
- **Never overwrite curated:** only empty-`nations` cases are written; the 2 curated
  flagships are untouched and authoritative.

## Testing (offline, TDD)

`scripts/test-cases-nations.ts` (node:assert/strict, async IIFE):
- **`verifyNations`:** a name in the styleOfCause is kept; a name found only in a
  chunk is kept; a name in neither (fabricated) is dropped; duplicates
  (case-insensitive) collapse to one; output capped at 5.
- **`extractNations` skip rules** (fake model): `corpusTier:"substrate"` →
  `skipped_not_core`; `nations:["X"]` → `skipped_has_nations`; empty `chunks` →
  `skipped_no_fulltext`; a core empty-nations case → returns the verified list.
- `npm run typecheck` clean; `npm run build` compiles. **`npm run verify` NOT run.**

## Operational run (post-merge, credentialed — measured, not code)

Against the cloud table (`AWS_REGION=us-east-1 CASES_TABLE=LegalCases`):
1. `cases:extract-nations:cloud` — fill nations on empty-nations core cases (reports filled / skipped).
2. `cases:index-build:cloud` — **rebuild + upload the search artifact** (`nations` is
   in `metaText`, so name search reflects the new nations). **No re-embed** —
   chunks/vectors are unchanged.
3. Record in a Result section: cases filled, distinct nations now in the `byNation`
   facet (was 2), and a spot-check that each sampled nation appears in its case's
   title/text.

## Success criteria

- **Offline:** `verifyNations`/skip-rule tests green; typecheck + build clean.
- **Ops:** the `byNation` facet grows from 2 to a realistic count of distinct First
  Nations; every filled nation is verbatim in its case's title or judgment; curated
  flagships untouched; the search artifact reflects the new nations.

## Result (2026-07-07)

Ran `cases:extract-nations:cloud` over the 452 production core cases (PR #119
merged, `815af12`). Model `us.meta.llama3-3-70b-instruct-v1:0`.

**Headline: the `byNation` facet went from 2 → ~435 distinct nations.**

- **filled 412 · empty 38 · curated-skipped 2 · failed 0.** The 38 empty are cases
  with no clearly-named Indigenous party (e.g. an individual accused, or a nation
  named only obliquely) — correctly left empty rather than guessed.
- Every filled name is verbatim-verified in the case title or judgment
  (`verifyNations`); no fabrication. The 2 curated flagships were skipped
  (never overwritten).
- **Caveat (canonicalization deferred):** ~435 distinct *surface forms* includes
  variants of the same nation — e.g. "Haida Nation" / "Council of the Haida Nation"
  / "Haida". The filter is now genuinely usable across hundreds of First Nations,
  but merging variants into canonical entries is future curation work (a Kay task),
  deliberately out of scope here.
- Artifact rebuilt (`buildId 1783469848770-skhsim5n`, bm25 105.9 MB — `nations` is in
  `metaText`) and uploaded to the production bucket; **no re-embed** (vectors 297.6 MB
  unchanged). Nation search reflects the new data on the next Web Lambda cold start.

**Derived-layer refresh (same credentialed session).** Because the economic-corpus
+79 promotion (2026-07-07) post-dated the last summarize run (2026-07-05), the new
core cases lacked summaries. Re-ran the idempotent batches:
- `cases:summarize:cloud` — **generated 84** new (now ~448/452 have a summary; 3
  correctly refused — long all-paraphrase SCC judgments that can't anchor ≥2 quotes).
- `cases:extract-figures:cloud` — **+4** (415 already covered by the estimator ops run).

All three derived layers (nations / summaries / figures) are now current over the
full core. **Operational rule reaffirmed:** these derived layers should be re-run
after any core growth (promotion / backfill).
