# Economic Impact Estimator → Recorded Economic Figures (client idea #3) — Design

**Date:** 2026-07-07 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases` + `src/app/cases`

## Motivation

Client brief, Ideas to Build #3: an "economic impact estimator." Today the only
economic surface is the curated `EconomicDimension` on ~4 flagship cases, which
`buildActivation` (`query.ts:76-78`) sums into three bare dollar/percent cards on
the activation dashboard. That is sparse and — more importantly — a bare summed
total is the **Gallagher credibility trap**: it implies a representative,
complete "economic value of Indigenous wins" from a hand-picked handful, and it
adds non-commensurable figures (a settlement + an annual royalty + an equity %).

**We deliberately do not estimate or project.** A Gallagher-safe "estimator"
surfaces only the real monetary figures that literally appear in the judgments,
each lifted verbatim and citation-anchored, and never fabricates or falsely
totals. We therefore **reframe the feature from "estimator" to "recorded economic
figures"** in all UI/methodology copy (no "estimate"/"projection" language). The
mechanical verbatim-verification discipline is the same one the AI summaries use
(`summarizer.ts` `verifyClaims`), which passed fidelity spot-checks.

## Decisions (from brainstorm)

- **Per-case citation-anchored extraction + honest aggregation** (main form).
- **No cross-case or cross-kind totals.** Coverage denominator (`N / 452`) +
  per-kind range (min/median/max), computed only from figures the court actually
  **awarded/ordered**. Individual figures shown per-case with a paragraph anchor.
- **Scope = core cases only (452).** Consistent with the dashboard's existing
  "curated core cases" framing; bounded cost.
- **Approach A:** LLM extracts candidate figures with a verbatim quote + anchor +
  kind/role; a **mechanical verifier** keeps a figure only if its amount string
  and quote appear verbatim in the judgment text (re-anchored), and its amount
  parses deterministically. Fabrication cannot pass.
- **Extracted layer is non-authoritative** (implicit `needsReview`), stored
  separately from the curated `economic` field, which stays the Kay-authoritative
  record. (Mirrors how `ECON_CANDIDATE_SEEDS` stayed out of `enrichment.ts`.)
- **Reframe "estimator" → "recorded economic figures"** in UI and methodology.

## Architecture

### 1. Data model — `src/lib/cases/types.ts`

```ts
export type FigureKind = "settlement" | "compensation" | "damages" | "resource_revenue" | "equity" | "other";
export type FigureRole = "awarded" | "ordered" | "claimed" | "valuation" | "contextual";

export interface ExtractedFigure {
  raw: string;              // verbatim as it appears, e.g. "$30 million", "51%"
  amount: number;           // deterministically parsed from raw (unparseable → dropped)
  currency: string;         // "CAD" default; recorded otherwise if the judgment states it
  unit?: "percent";         // set for equity stakes expressed as a percentage
  kind: FigureKind;
  role: FigureRole;         // awarded/ordered = court granted; claimed = a party sought;
                            // valuation = appraisal; contextual = merely mentioned
  quote: string;            // clause containing `raw`, verbatim and verified in the text
  sourceParagraph: string;  // e.g. "para-42"
  sourceUrl: string;
}

export interface FiguresMeta { method: "llm"; model: string; generatedAt: string; dropped: number; }

// Honest aggregation (no cross-case/cross-kind sum):
export interface FigureRange { countCases: number; min: number; median: number; max: number; unit: string; } // unit "CAD" | "%"
export interface EconomicFigures {
  totalCases: number;                              // denominator (core count)
  casesWithFigures: number;                        // numerator
  byKind: Partial<Record<FigureKind, FigureRange>>;
}
```

`LegalCase` gains `extractedFigures?: ExtractedFigure[]` and `figuresMeta?: FiguresMeta`
(stored in the PROFILE `data`, like `summary`). `ActivationSummary.economicValue`
(the old `{settlement,resourceRevenue,equity}` sum) is **replaced** by
`economicFigures: EconomicFigures`.

**Round-trip safety:** add both new fields to `itemToCase` (`cases-table.ts`) —
TypeScript will not flag a missing field, so an omission silently drops data on
read (the exact `summaryMeta` bug fixed earlier). The `Required<LegalCase>`
kitchen-sink round-trip test guards this.

### 2. Extraction + verification — `src/lib/cases/ingest/figures.ts` (new) + `scripts/cases-extract-figures.ts` (new)

`extractFigures(c: LegalCase, model): Promise<{ figures: ExtractedFigure[]; meta: FiguresMeta } | skipReason>`
mirrors `summarizeCase`:
- **Skip rules:** not `core`, or no full text → skip (no call).
- **Assembly:** deterministic judgment text from chunks under a char budget.
- **Prompt (strict JSON):** "Extract every monetary figure that appears in the
  text. For each: the verbatim substring (`raw`), the clause it appears in
  (`quote`), the paragraph id, a `kind`, and a `role`. Do not infer, convert, sum,
  or invent any number — copy only figures present in the text." Returns a JSON
  array.
- **`parseAmount(raw)`** (pure, deterministic): parses `$1,234,567`, `$30 million`,
  `CAD 5,000`, `51%` → number (+`unit:"percent"`). Fully spelled-out amounts that
  don't parse → the figure is **dropped** (宁缺毋滥).
- **`verifyFigures`** (pure, mechanical): for each parsed figure, `raw` **and**
  `quote` must appear verbatim in the judgment text after `normWs` normalization,
  re-anchored like summaries (cited chunk → any chunk → adjacent-pair window);
  otherwise dropped. Cap at 12 kept figures/case. `meta.dropped` records how many
  were dropped.

Batch runner `cases-extract-figures.ts` mirrors `cases-summarize.ts`: PROFILE-only
`UpdateItem` writing `data.extractedFigures` + `data.figuresMeta` (DATA is a
reserved word → `#d` alias); `cachedModel` for idempotent replay; a re-run
buckets `skipped_*`; `FIGURES_MODEL` env (default `us.meta.llama3-3-70b-instruct-v1:0`).
Figures are **not** part of search `metaText`, so the search artifact does **not**
need rebuilding.

npm: `"cases:extract-figures"` (local) + `"cases:extract-figures:cloud"`.

### 3. Aggregation — `buildActivation` in `src/lib/cases/query.ts`

Replace the summed `economicValue` with `economicFigures`:
- `totalCases` = number of cases passed in (core).
- For each `kind`, gather **one amount per case** — the largest `awarded`/`ordered`
  extracted figure of that kind in the case, OR the curated `economic` amount of
  that kind if present (dedupe: a case contributes at most one amount per kind, so
  a judgment listing many line-items can't skew the range). `FigureRange` =
  `{ countCases, min, median, max, unit }` over those per-case amounts.
- `casesWithFigures` = distinct cases contributing ≥1 amount to any kind.
- **Never** sum across cases or kinds; `claimed`/`valuation`/`contextual` figures
  are excluded from aggregation (still shown per-case).

Both repos build activation through this one shared function, so `dynamo≡mock`
parity holds.

### 4. Presentation — zero client JS, reuse `StatCard`/`Bar`

**Activation dashboard** (`src/app/cases/activation/page.tsx`): replace the three
bare `$` cards with a "Recorded economic figures" section:
- Lead line: `Figures recorded in {casesWithFigures} of {totalCases} core cases`.
- One row per `kind`: `settlement — {countCases} cases · $min–$max (median $m)`;
  equity shows `%`.
- Caveat line: "Figures as recorded in the judgments — the courts' own numbers,
  extracted and citation-anchored. Not estimates, projections, or a corpus total;
  nominal amounts across different years, not inflation-adjusted."

**Case page** (`src/app/cases/[id]`): a "Recorded economic figures" block under the
summary — each figure: `raw` + a `kind`/`role` chip + the anchored `quote` + a
paragraph link, with an "AI-extracted · verify against the source" badge (mirrors
the summary badge, gated on `figuresMeta.method === "llm"`) and the standing
unofficial-reproduction disclaimer. Curated `economic` (if present) renders as
today, labeled authoritative.

## Governance

- **No fabrication.** Every displayed figure is lifted verbatim and mechanically
  verified against the judgment text; unparseable or unverifiable figures are
  dropped. The LLM cannot introduce a number that isn't in the text.
- **No false totals.** No cross-case or cross-kind sum anywhere; only per-kind
  ranges over court-`awarded`/`ordered` figures, with an explicit coverage
  denominator and a nominal/various-years caveat.
- **Authority boundary.** Extracted figures are non-authoritative (implicit
  needs-review); curated `economic` stays the Kay-authoritative record, rendered
  separately.
- **Honest framing.** UI/methodology say "recorded economic figures," never
  "estimate"/"projection."

## Testing (offline, TDD)

`scripts/test-cases-figures.ts` (node:assert/strict, async IIFE):
- **`parseAmount`:** `$1,234,567`→1234567; `$30 million`→30000000; `CAD 5,000`→5000;
  `51%`→{51,percent}; garbage/spelled-out → null (dropped).
- **`verifyFigures`:** a fabricated `raw` not in the text is dropped; a real figure
  whose quote appears in an adjacent chunk verifies (re-anchor); a figure whose
  `quote` doesn't contain `raw` is dropped.
- **`buildActivation` economicFigures:** ranges computed per kind from
  awarded/ordered only; one-amount-per-case-per-kind; `casesWithFigures`
  denominator correct; **no field sums across cases** (assert there is no total).
- **`itemToCase` round-trip:** `extractedFigures` + `figuresMeta` survive
  (Required<LegalCase> guard).
- `npm run typecheck` clean; `npm run build` compiles. **`npm run verify` NOT run.**

## Operational run (post-merge, credentialed — measured, not code)

Against the cloud table (`AWS_REGION=us-east-1 CASES_TABLE=LegalCases`):
1. `cases:extract-figures:cloud` over the 452 core cases (search artifact NOT rebuilt — figures aren't indexed).
2. Fidelity spot-check: sample ~10 cases, confirm every displayed figure appears verbatim at its cited paragraph and the role label is right.
3. Record in a Result section: `casesWithFigures / 452`, per-kind counts and ranges, total figures kept vs dropped, and confirmation that no figure is fabricated and no cross-case total appears.

## Success criteria

- **Offline:** figures/parse/aggregation/round-trip tests green; typecheck + build clean.
- **Ops (post-merge):** a meaningful share of core cases show ≥1 verified,
  citation-anchored figure; the dashboard shows coverage + per-kind ranges with the
  caveat and **no grand total**; a fidelity spot-check finds every displayed figure
  verbatim at its anchor; no fabricated numbers anywhere.

## Result (2026-07-07)

Ran `cases:extract-figures:cloud` over the 452 production core cases (PR #117
merged, `5071013`). Model `us.meta.llama3-3-70b-instruct-v1:0`. The search
artifact was **not** rebuilt (figures aren't indexed).

**Extraction:** 143 of 452 core cases carry ≥1 figure; **511 figures** total,
every one verbatim-verified against the judgment text. By role: contextual 181,
valuation 127, awarded 131, claimed 69, ordered 3. (35 cases returned unparseable
JSON twice → no figures, honest.)

**Fidelity spot-check found a real problem, and a fix.** The numbers are all real,
but the LLM's `role` label is unreliable: it tagged **contextual recitals** as
"awarded" — e.g. in `2025-fc-561`, *"Canada entered into a $23.34 billion
settlement…"* (a background mention of the historic FNCFS settlement, not an award
in that case) and funding-availability amounts (*"was advised that $25.5 million…
was available"*). Aggregating on the raw role label produced a misleading
settlement range of **$2.97M–$23.34B**.

**Fix (this branch): a mechanical grant gate** (`isCourtGranted`, query.ts) — a
figure enters the ranges only if its quote carries a grant/order verb AND no
background-recital marker. Verification already guaranteed the *number*; this gates
the *classification* mechanically instead of trusting the model. Effect:

| | raw role label | + grant gate |
|---|---|---|
| cases in aggregation | 57 | **24** |
| settlement range | $2.97M–**$23.34B** | $2.97M–**$14M** (median $8.49M) |

**Final gated dashboard aggregation (24 of 452 cases):**
- settlement — 2 cases · $2.97M–$14M (median $8.49M)
- compensation — 12 cases · $325–$34.18M (median $58.4K)
- damages — 3 cases · $1K–$150K (median $50K)
- resource_revenue — 1 case · $6.8M
- equity — 2 cases · 1.7%–50% (median 25.85%)
- other — 7 cases · $700–$850K (median $20K)

**Governance confirmed:** every figure is verbatim-real (no fabrication); no
cross-case or cross-kind total anywhere; contextual/claimed/valuation figures are
excluded from ranges but still shown per-case with their quotes so a reader can
judge. Curated `economic` remains authoritative and separate.

**Known limitations:** role classification is model-assigned (the grant gate is a
heuristic, not perfect — a genuine award phrased unusually can be dropped, and a
recital using a grant verb could slip through); ~8% of cases yield unparseable JSON
and get no figures; amounts are nominal across years. A curator (Kay) pass could
promote high-value figures to the authoritative `economic` layer.
