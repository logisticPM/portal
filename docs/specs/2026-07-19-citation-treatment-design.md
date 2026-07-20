# Citation Treatment (extractive citing-passage view) — Design

**Date:** 2026-07-19 · **Status:** approved (design), pre-implementation · **Domain:** `src/lib/cases/treatment.ts`, `src/app/cases/[id]/page.tsx`

## Motivation

The case-detail "Citations" section shows a bare link list — `Cited by {citingCount} case(s)`
plus two columns of case names ("Cites" / "Cited by"). Market legal-research tools
(Shepard's / KeyCite, Vincent) make **citation treatment** their moat: not just *that* a
later case cites this one, but *how*. We already hold the citation graph
(`casesCiting`/`casesCited` + `getCitationGraph`) and full text for many cases, so the
borrow-worthy upgrade is cheap: show the **verbatim passage where each later case cites this
decision**, so a non-lawyer business can read how the case has been used and judge for itself.

**Red line (confirmed in brainstorm):** purely **extractive** — the passage where a later
case cites this one, anchored to its paragraph. **No treatment-classification label**
(followed / distinguished / overruled): that is a legal conclusion and a misclassification is
dangerous. We show the record, not a verdict on whether the decision "still governs."

## Scope (confirmed)

- Enhance the existing Citations section on `/cases/[id]` — **not** a new page.
- **Extractive citing passages only**, no treatment tags.
- **On-the-fly** (render-time), **no precompute / no new storage / no credentialed ops** —
  it is pure string-matching over full text we already have.
- Cap the citing list at **N = 10**.

## Architecture

### 1. Pure module — `src/lib/cases/treatment.ts`

```ts
import type { CaseChunk } from "./types";

export interface CitingPassage { text: string; paragraph: string; truncated: boolean }

export interface CiteTarget { citation: string; citation2?: string; styleOfCause: string }

// Lead party (appellant/plaintiff) — usually the distinctive token, e.g.
// "Haida Nation v. British Columbia…" → "Haida Nation". Used as the fallback matcher.
export function leadParty(styleOfCause: string): string;

// Find, in a CITING case's chunks, the paragraph that references `target` (this case),
// and return a windowed verbatim excerpt around the reference. Match precedence:
//   1. target.citation  (e.g. "2004 SCC 73")  — most precise
//   2. target.citation2 (alt reporter cite)
//   3. leadParty(target.styleOfCause)          — fallback, ≥4 chars to avoid noise
// Returns the excerpt from the FIRST matching chunk, or null if none match.
export function findCitingPassage(chunks: CaseChunk[], target: CiteTarget): CitingPassage | null;
```

- **Windowing:** on a match at index `i` in the chunk `text`, return
  `text.slice(max(0, i-200), min(len, i+matchLen+200))`, prefixed/suffixed with `…` when
  truncated (`truncated=true`). The excerpt is a **contiguous verbatim substring** of the real
  paragraph — still extractive/anchored, just trimmed for display. `paragraph` = the chunk's
  `paragraph`.
- **Matching** is case-insensitive substring; the `leadParty` fallback is skipped when the
  lead party is shorter than 4 characters (avoids matching common short tokens).
- Pure, deterministic, no network — fully unit-testable.

### 2. Case-detail wiring — `src/app/cases/[id]/page.tsx`

The citing cases resolved by `getCitationGraph` are profile-only (`scanAll` has no chunks), so
fetch each citing case's chunks to find the passage:

```tsx
const citingTop = [...graph.citing]
  .sort((a, b) => b.year - a.year || b.citingCount - a.citingCount)
  .slice(0, 10);
const target = { citation: c.citation, citation2: c.citation2, styleOfCause: c.styleOfCause };
const treated = await Promise.all(citingTop.map(async (g) => {
  const full = await casesRepo.getCase(g.id);
  const passage = full?.chunks?.length ? findCitingPassage(full.chunks, target) : null;
  return { case: g, passage };
}));
const withSnippet = treated.filter((t) => t.passage).length;
```

Render (replacing the current bare "Cited by" column):

- **Coverage line (honest):** `Cited by {c.citingCount} case(s) · {graph.citing.length} in this
  library · {withSnippet} shown with the citing passage.` (three numbers, no pretense of full
  coverage — `citingCount` is the A2AJ total; only in-corpus citers resolve; only full-text
  citers yield a passage.)
- **"Cites" (backward)** — kept as the existing compact link list.
- **"Later cases citing this decision"** — a stacked list; each entry: citing case name
  (court, year) as a link to `/cases/{id}`, and, when found, the verbatim `passage.text`
  (with a `<span>` paragraph anchor, e.g. `({passage.paragraph})`). When no passage is found,
  the name link alone (honest — the citing case may lack full text or use a variant reference).
- **Framing (governance):** a one-line note — *"The passage where each later case cites this
  decision — read it to see how the case was used. This is the record, not a verdict on
  whether the decision still governs. Unofficial; verify against the source."*

### 3. Methodology note — `src/app/cases/methodology/page.tsx`

A short section: citation treatment is **extractive** (the verbatim citing passage + paragraph
anchor), corpus-bounded, and deliberately carries **no followed/overruled classification**.

### Files

| File | Change |
|---|---|
| `src/lib/cases/treatment.ts` | **New pure.** `findCitingPassage`, `leadParty`, `CitingPassage`/`CiteTarget`. |
| `src/app/cases/[id]/page.tsx` | Compute treatments (getCase per citing, capped 10) + restructure the Citations section. |
| `src/app/cases/methodology/page.tsx` | Short methodology note. |
| `scripts/test-cases-treatment.ts` | **New** unit tests. |

Unchanged: `getCitationGraph`, `CaseRepo` interface (page orchestrates existing `getCase`), storage, ingest. No parity impact (no new repo method).

## Governance / safety

- **Extractive & anchored** — a verbatim substring of the citing judgment + its paragraph;
  nothing generated. No LLM in this feature.
- **No legal verdict** — no followed/distinguished/overruled tag; the reader judges from the
  passage.
- **Corpus-bounded honesty** — the coverage line states total-vs-in-library-vs-passage-shown.

## Testing (offline, TDD)

`scripts/test-cases-treatment.ts`:
- `leadParty("Haida Nation v. British Columbia (Minister of Forests)") === "Haida Nation"`;
  handles `v.`/`v ` and no-`v` styles.
- `findCitingPassage`:
  - chunk containing `citation` ("2004 SCC 73") → excerpt contains it, correct `paragraph`.
  - no citation but `citation2` present → matches on citation2.
  - neither citation but lead party present → matches on lead party.
  - lead party < 4 chars → not used (no false match).
  - no reference anywhere → `null`.
  - long chunk → `truncated=true` with `…`; excerpt is a substring of the chunk text (verbatim).
  - short chunk fully containing the match → `truncated=false`, no `…`.

Gate: `npx tsx scripts/test-cases-treatment.ts` passes; `npm run typecheck` clean;
`npm run build` compiles. `verify` (dynamo≡mock) unaffected (no repo change). Browser
spot-check optional (needs a case with in-corpus, full-text citers — verify on prod, e.g.
Haida `2004-scc-73`).

## Explicitly NOT doing (YAGNI + red line)

- No treatment-classification label (followed/distinguished/overruled) — the red line.
- No precompute/enrichment/credentialed run — on-the-fly over existing full text.
- No fetching of citers outside our corpus (only `getCitationGraph`-resolved cases).
- No new repo method / interface change.

## Success criteria

- On a well-cited case (e.g. Haida), the Citations section shows later cases with the verbatim
  passage where they cite it + paragraph anchor + link; the coverage line states the three
  honest counts; cases without full text degrade to a name link.
- `findCitingPassage` unit tests green; typecheck + build clean; no ops run needed.
