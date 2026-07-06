# User-Differentiated Access Layer — Audience Lens (client idea #5) — Design

**Date:** 2026-07-06 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases` + `src/app/cases`

## Motivation

Client brief, Ideas to Build #5: "a user-differentiated access layer so that
Indigenous governments, legal advisors, and corporate users each see a tailored
view of the same underlying dataset, surfacing what is most relevant to their
context." Today the `/cases` browse/search/detail/activation pages are
persona-agnostic (only briefings checks login for its quota gate); PR #101
differentiated only the home-page *entry-card* copy, not the experience inside.

Standing governance (settled earlier): reads are open to all personas — public
court records, and the activation thesis requires counterparties to see the same
record. So #5 is a **relevance lens** (emphasis + ordering + framing), **not**
access control: nothing is hidden, and every user can switch lenses.

## Decisions (from brainstorm)

- **Lens depth = emphasis + ordering + framing copy.** Same data; each audience
  gets a different default ordering and framing of the identical corpus.
- **Audience taxonomy = the brief's three, with an explicit "View as" switcher.**
  `indigenous_gov` / `legal_advisor` / `corporate`. A `?lens=` URL param selects;
  the logged-in persona sets the default; anyone can switch (demo-friendly and,
  more importantly, the transparency guarantee — no view is privileged).

## Architecture

### 1. Pure lens module — `src/lib/cases/lenses.ts` (new, pure + testable)

```ts
import type { LegalCase, Theme } from "./types";
import type { Session } from "@/lib/auth";

export type Lens = "indigenous_gov" | "legal_advisor" | "corporate";
export const LENSES: Lens[] = ["indigenous_gov", "legal_advisor", "corporate"];

export interface LensConfig {
  label: string;            // switcher label, e.g. "Indigenous government"
  tagline: string;          // one-line framing shown under the switcher
  emphasisThemes: Theme[];  // themes this audience leads with ([] = none, sort by strength only)
  sortByStrength: boolean;  // legal_advisor: order by court level then citingCount
}

export function lensConfig(lens: Lens): LensConfig { /* the three configs below */ }

// URL param wins; else map from the logged-in persona; else the neutral default.
export function resolveLens(param: string | undefined, session: Session | null): Lens {
  if (param === "indigenous_gov" || param === "legal_advisor" || param === "corporate") return param;
  if (session?.kind === "indigenomics") return "indigenous_gov";
  if (session?.kind === "company" || session?.kind === "supplier") return "corporate";
  return "corporate"; // neutral default (most general audience); legal_advisor only via the switcher
}

// PURE STABLE REORDER — never drops a case (output set === input set). Cases whose
// themes intersect emphasisThemes rank first (more overlap = higher), then by
// citingCount desc; legal_advisor ignores emphasis and orders by court level
// (SCC first) then citingCount. Ties keep input order (stable).
export function applyLens(cases: LegalCase[], lens: Lens): LegalCase[] { … }
```

**The three configs:**
- `indigenous_gov` — label "Indigenous government"; emphasis `["self_determination","land_rights","resource_revenue"]`; tagline "Precedents affirming your community's economic rights and self-determination."
- `legal_advisor` — label "Legal advisor"; `sortByStrength: true`, emphasis `[]`; tagline "Precedent strength and citation lineage — highest courts and most-cited first."
- `corporate` — label "Corporate / advisory"; emphasis `["duty_to_consult","treaty","fiduciary"]`; tagline "What consultation, accommodation and treaty obligations look like in practice."

`applyLens` ranking detail: compute a key per case — for emphasis lenses, `(count of case.themes ∈ emphasisThemes, citingCount)`; for `sortByStrength`, `(courtLevelRank, citingCount)` where a small fixed map ranks `scc > fca > provincial_appeal > fc > provincial_superior > tribunal`. Stable descending sort; **no filtering** — every input case appears in the output.

### 2. Browse page — `src/app/cases/page.tsx`

- Read `getSession()` and `searchParams.lens`; `const lens = resolveLens(searchParams.lens, session)`.
- **No-query browse** (`!q`): apply `applyLens(cases, lens)` to the `listCases` result before rendering.
- **Search** (`q` present): keep the retrieval order (dense/BM25 ranking is authoritative — the lens must not fight relevance); the lens contributes only the tagline/framing, not reordering.
- Render a `LensSwitcher` (below the intro line) and the active lens's tagline.

### 3. `LensSwitcher` component — `src/app/cases/ui.tsx`

Zero client JS: three `<a>` links, one per lens, each preserving all current query params (q, tier, theme, level, winType, nation, yearFrom, yearTo) and setting `lens=`. The active lens is styled selected. A small persistent transparency note beside it:

> "View as — the same public record, reordered for your context. Anyone can switch; nothing is hidden."

Helper `lensHref(current: Record<string,string|undefined>, lens: Lens): string` builds the querystring (drops empty values, sets `lens`). Pure, testable.

### 4. Activation page — `src/app/cases/activation/page.tsx` (light touch)

Read the lens the same way and show the active lens's tagline at the top (framing only — the activation aggregates are audience-neutral and unchanged). No switcher duplication required beyond a link back; keep it minimal.

## Governance

The lens reorders and reframes; it never filters, hides, or gates. The
transparency note states this in the UI. `applyLens` is a set-preserving
permutation (a test asserts output multiset === input). This keeps idea #5
inside the settled "reads open to all" stance — differentiation is a
presentation preference, not a permission boundary.

## Testing (offline, TDD)

`scripts/test-cases-lenses.ts` (node:assert/strict, async IIFE), fixtures:
- `resolveLens`: param wins over session; each persona → its default; unknown
  param ignored; no session → corporate; `legal_advisor` reachable only via param.
- `applyLens`: **output is a permutation of input** (same ids, same length —
  the set-preserving guarantee); emphasis-matching cases precede non-matching;
  within a group, higher citingCount first; `legal_advisor` orders SCC before a
  lower court regardless of theme; stable on ties.
- `lensHref`: preserves existing params, sets/overrides `lens`, drops empties.
- `npm run typecheck` clean; `npm run build` compiles; **`npm run verify` not
  required** (additive, presentation-only; no repo-method or storage change).
- Preview verification (browser): switch all three lenses on `/cases`, confirm
  the browse order changes and no case count changes; confirm a logged-out
  visit defaults to corporate; confirm a search query keeps retrieval order
  while showing the lens tagline.

## Success criteria

- Offline: lens tests green (esp. the permutation/no-drop assertion); typecheck + build clean.
- UI: `/cases` shows a working "View as" switcher; each lens visibly reorders the
  browse list and reframes the tagline; the transparency note is present; search
  order is unaffected by lens; logged-in persona sets the default lens.
