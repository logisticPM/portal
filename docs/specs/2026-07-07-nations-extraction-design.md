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
