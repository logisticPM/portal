# Human-Readable Court-Level Labels — Design

**Date:** 2026-07-14 · **Status:** approved (design), pre-implementation · **Domain:** `src/lib/cases/labels.ts`, `src/app/cases/*`

## Motivation

The `/cases` filters and the new `/cases/similar` intake show court levels as raw enum codes
(`scc`, `fca`, `fc`, `provincial_appeal`, `provincial_superior`, `tribunal`). The target users
are **non-lawyer Indigenous businesses** — `scc/fca/fc` are unreadable to them. Replace the
**displayed text** with plain names (the option **values** stay the enum, so filtering/matching
is unchanged).

## Decision

One shared, pure label helper used everywhere a court level is displayed:

```ts
// src/lib/cases/labels.ts
import type { CourtLevel } from "./types";

const COURT_LEVEL_LABELS: Record<string, string> = {
  scc: "Supreme Court of Canada (SCC)",
  fca: "Federal Court of Appeal (FCA)",
  fc: "Federal Court (FC)",
  provincial_appeal: "Provincial Court of Appeal",
  provincial_superior: "Provincial Superior Court",
  tribunal: "Tribunal (administrative)",
};

// Canonical order for the filter dropdowns (de-dupes the array currently copied in two pages).
export const COURT_LEVELS: CourtLevel[] = ["scc", "fca", "fc", "provincial_appeal", "provincial_superior", "tribunal"];

// Accepts a CourtLevel (dropdowns) or any string (methodology's Object.entries keys);
// unknown values fall back to the underscore→space form, so nothing ever renders blank.
export function courtLevelLabel(level: string): string {
  return COURT_LEVEL_LABELS[level] ?? level.replace(/_/g, " ");
}
```

Full name **+ abbreviation in parens** for the ones with a well-known code — clarifies for
non-lawyers *and* bridges to the abbreviations still shown on case cards/citations (`c.court`
= "SCC", "BCCA", …).

## Sites updated (all court-level enum displays)

| File | Change |
|---|---|
| `src/lib/cases/labels.ts` | **New.** `courtLevelLabel`, `COURT_LEVELS`. |
| `src/app/cases/page.tsx` | Import `COURT_LEVELS`/`courtLevelLabel`; drop the local `LEVELS` const; dropdown option text → `courtLevelLabel(l)`. |
| `src/app/cases/similar/page.tsx` | Same: import shared, drop local `LEVELS`, option text → `courtLevelLabel(l)`. |
| `src/app/cases/methodology/page.tsx` | "By court level" `Bar` label → `courtLevelLabel(l)`. |
| `scripts/test-cases-labels.ts` | **New** unit test. |

The option `value={l}` stays the enum in every dropdown — only the visible label changes.
`SimilarCaseCard`/case pages show `c.court` (the citation court code, e.g. "SCC"), which is
untouched (that field is not the level enum). Theme labels (underscore→space) are left as-is
(YAGNI).

## Testing (offline)

`scripts/test-cases-labels.ts`:
- `courtLevelLabel("scc") === "Supreme Court of Canada (SCC)"`, `("fca")`, `("fc")`,
  `("provincial_appeal") === "Provincial Court of Appeal"`, `("tribunal")`.
- Every `COURT_LEVELS` entry has a non-empty label distinct from its raw code.
- Fallback: `courtLevelLabel("something_else") === "something else"` (unknown → underscore→space).

Gate: `npx tsx scripts/test-cases-labels.ts` passes; `npm run typecheck` clean; `npm run build`
compiles. (`Record<string,string>` + the exhaustive `COURT_LEVELS` list keep it complete.)

## Not doing (YAGNI)

- No theme relabeling (current underscore→space is acceptable).
- No change to option values, filtering, matching, or the `c.court` display on cards.
