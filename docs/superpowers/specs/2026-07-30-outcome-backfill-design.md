# Outcome Backfill (`winType` / `outcomeType`) — Design

**Date:** 2026-07-30 · **Status:** approved (design), pre-implementation
**Domain:** `src/lib/cases/ingest/outcome-rubric.ts`, `outcome-labeler.ts`, `scripts/cases-classify-outcome.ts`

## Motivation

A client asked the briefing tool: *"how many legal success victories for failing to consult
with nation by industry"*. It answered that the record shows "a mixed picture rather than a clear
count", and presented four precedents — three of which are **losses** for the nation.

Measured against the live corpus (2026-07-30, read-only diagnostic):

```
duty_to_consult (core): 273
  unclassified   272
  doctrine_win     1     ← Haida, the only curated one
```

**The refusal was correct.** 272 of 273 relevant cases have no outcome polarity recorded, so the
system genuinely cannot count wins. `outcome` is hardcoded empty at ingest
(`a2aj.ts:93`: `{ outcomeType: "unclassified", winType: "unclassified", whoWon: "", holding: "" }`)
and only the four curated fixtures ever received real values.

This is the bottleneck, not retrieval. It also blocks RM-8: extracting an `industry` field and
joining it against 272 `unclassified` rows still cannot answer "wins by industry".

Two other defects surfaced in the same diagnostic and are **explicitly out of scope** here, recorded
so they are not lost: Haida ranks **35** and Clyde River **78** for that query (outside the
`TOP_K = 6` window a briefing sees), and the top-6 contains a criminal case (`R. v. Martin`) and a
utility-board dispute. Those are retrieval defects with their own fix.

## What this ships

Dual-LLM classification of `outcome.winType` and `outcome.outcomeType` over the **core tier
(561 cases)**, reusing the existing theme-labelling architecture, with a windowing fix that the
theme labeller does not need and must not inherit.

### The windowing trap

`labelPrompt` (`rubric.ts:22`) ends with:

```ts
`Case text:\n"""${text.slice(0, 6000)}"""`
```

and is called with `[styleOfCause, ...allChunks].join(" ")` — **the first 6000 characters**.

For themes this is fine; a judgment states its subject early. For outcome it is precisely wrong:
the disposition ("the appeal is allowed", "THIS COURT ORDERS that the application is dismissed")
is at the **end**. Reusing this window would blind the classifier to the one sentence that decides
the answer, and it would fail *silently* — returning confident, uniformly wrong labels.

So outcome classification gets its own **head + tail** window with explicit section markers.

## Rubric — "victory" means substantive relief

Approved definition. `winType` and `outcomeType` are **orthogonal axes**, which is what lets the
strict reading work without a schema change: a quashed-and-remitted approval is
`outcomeType: "remand"` + `winType: "party_win"`, and no nuance is lost.

| `winType` | Test |
|---|---|
| `party_win` | The court granted the Indigenous party substantive relief — approval quashed, infringement declared, consultation ordered redone. |
| `doctrine_win` | The specific relief was refused but the legal principle advanced in the Indigenous party's favour. (Haida is this.) |
| `loss` | Relief refused, or the duty found not triggered / already discharged. |
| `mixed` | Substantive relief granted in part and refused in part. |
| `unclassified` | Purely procedural step (leave granted, extension, stay); no Indigenous party or interest; or the two models disagreed. |

`winType` is always **relative to the Indigenous party or interest**. Where a case has no Indigenous
party, the answer is `unclassified` — not `loss`.

A purely procedural advance (Raincoast: judicial review allowed to *proceed*) is **not** a victory.
This matches the distinction the briefing itself drew, and keeps the published count defensible.

`outcomeType` uses the existing enum (`precedent | procedural | remand | regulatory | settlement |
unclassified`) with one-line tests written in the same file.

## Architecture

Mirrors `labeler.ts` / `rubric.ts`, which are 27 and 24 lines respectively. Same shape, same size.

### `src/lib/cases/ingest/outcome-rubric.ts` (new)

```ts
export const OUTCOME_RUBRIC_VERSION = "2026-07-30.1";
export const WINTYPE_RUBRIC: Record<WinType, string>;
export const OUTCOMETYPE_RUBRIC: Record<OutcomeType, string>;

// Head + tail. Tail-weighted: the disposition lives at the end.
export function dispositionWindow(styleOfCause: string, chunks: CaseChunk[]): string;

export function outcomePrompt(styleOfCause: string, chunks: CaseChunk[]): string;
```

`dispositionWindow` takes paragraphs from the front up to `HEAD_CHARS = 2000` and from the back up
to `TAIL_CHARS = 4000` — the same 6000-character budget `labelPrompt` uses, redistributed toward
the end — and renders:

```
[CASE] Haida Nation v. British Columbia (Minister of Forests)

[OPENING]
para-1: ...
para-2: ...

[... 74 paragraphs omitted ...]

[DISPOSITION]
para-88: ...
para-89: ...
```

**The overlap case must not duplicate text.** When the two windows would meet or cross (a short
judgment), emit every paragraph exactly once under a single `[FULL TEXT]` marker and no omission
line. Paragraph ids are included so a human reviewer can locate the disposition in the source.

### `src/lib/cases/ingest/outcome-labeler.ts` (new)

```ts
export interface RawOutcome { winType: WinType; outcomeType: OutcomeType }

export function mergeOutcome(a: RawOutcome, b: RawOutcome, models: [string, string]):
  { winType: WinType; outcomeType: OutcomeType; outcomeMeta: OutcomeMeta };

export async function classifyOutcome(styleOfCause: string, chunks: CaseChunk[]):
  Promise<{ winType: WinType; outcomeType: OutcomeType; outcomeMeta: OutcomeMeta }>;
```

**Merge rule — exact agreement or abstain.** Each field independently: if both models return the
same value, take it; otherwise `unclassified`. No superclass collapsing, no tie-breaking, no third
model. Abstention is the safe direction: an `unclassified` row is a known gap, a wrong `party_win`
is a false claim in a client-facing count.

Each metadata field means exactly one thing:

- `agreement`: `"full"` both fields matched · `"partial"` one matched · `"none"` neither
- `needsReview`: `agreement !== "full"` — the models disagreed, a human should look
- `confidence`: `"high"` iff `agreement === "full"` **and** `winType !== "unclassified"`

Two models both answering `unclassified` agree, but that is not a confident classification — hence
the second clause.

### `src/lib/cases/types.ts`

Additive only:

```ts
export interface OutcomeMeta {
  method: "curated" | "dual_llm";
  models?: string[];
  agreement?: "full" | "partial" | "none";
  confidence: "high" | "low";
  needsReview: boolean;
  rubricVersion?: string;
}
```

plus `outcomeMeta?: OutcomeMeta` on `LegalCase`. A separate interface from `ThemeLabelMeta` (rather
than reuse) because it carries `rubricVersion` and because the two will drift.

## Runner — `scripts/cases-classify-outcome.ts` (new)

Modelled on `cases-summarize.ts`.

- **Core tier only** (561 cases). Substrate is out of scope.
- **Never overwrites curated.** `outcomeMeta?.method === "curated"` is skipped, as are the four
  fixtures that already carry real values. Haida keeps its curated `doctrine_win`.
- **Writes the PROFILE item only** — never CHUNK items. Rewriting chunks wipes embedded vectors
  (the promote lesson, already recorded in `cases-summarize.ts`'s header).
- **Idempotent + disk-cached** (`scripts/.cache/llm`), so re-runs and the cloud replay are free.
- `OUTCOME_FORCE=1` re-classifies rows already carrying a `dual_llm` outcome; curated stays immune.
- Skips cases with no `chunks` — there is nothing to read a disposition from. Counted and reported,
  not silently dropped.

Prints on completion (**illustrative format — these are not measured values**):

```
   classified 512 · skipped 45 (no chunks) · curated 4
   agreement: full 431 · partial 58 · none 23
   winType:  loss 214 · party_win 96 · doctrine_win 41 · mixed 34 · unclassified 127
   disagreements by field: winType 61 · outcomeType 44
```

## Verification

Dual-model agreement is a **consistency** signal, not accuracy — two models can be wrong together,
and correlated error is exactly the risk when both read the same rubric. So agreement rate is
reported but is not the gate.

### `scripts/cases-outcome-review.ts` (new, read-only)

Makes full-coverage human review tractable by compressing each case to one line:

```ts
// Last paragraph containing a disposition verb; returns the matching sentence.
export function dispositionSentence(chunks: CaseChunk[]): string | null;
```

Matches `/\b(allow|dismiss|grant|quash|set aside|declare|remit)\w*\b/i`, scanning from the end.
Sentences are split on `/(?<=[.!?])\s+/` — crude, but the disposition is almost always a short
standalone sentence, and the reviewer sees the paragraph id and can pull the full window.
Output, one line per case:

```
2019-fca-224   party_win   high  "The applications for judicial review are allowed in part..."
2023-fca-191   loss        high  "The appeal is dismissed with costs."
```

Reviewing 561 such lines is feasible in a single pass; anything that looks wrong gets its full
`dispositionWindow` pulled for a closer look. This is why the review covers **every** agreed
classification rather than a sample — the agreed rows are the ones that feed the published number,
and they are where correlated error hides.

Findings land in `docs/research/2026-07-30-outcome-review.md`, committed. Cases the disposition
cannot settle are set `needsReview: true` and left `unclassified` rather than guessed.

**The residual, stated plainly:** a reviewer who also authored the rubric cannot catch a rubric
that is conceptually wrong — that error grades as consistent. So the ~5 most consequential
borderline calls are escalated to the user with the disposition quoted, and the user adjudicates
those. Volume is delegated; rubric judgment is not.

## Testing (offline, TDD)

`scripts/test-cases-outcome.ts`:

- `dispositionWindow`: a long case emits `[OPENING]` and `[DISPOSITION]` with an omission line;
  **a short case emits `[FULL TEXT]` with every paragraph exactly once and no omission line**;
  the last paragraph of the source is always present in the output (the whole point);
  paragraph ids are preserved.
- `dispositionSentence`: finds the disposition in the last paragraph; prefers the **last** match
  when several paragraphs contain a disposition verb; returns `null` when none matches; tolerates
  empty `chunks`.
- `mergeOutcome`: identical inputs → that value, `agreement: "full"`, `confidence: "high"`;
  differing `winType` → `"unclassified"` with `needsReview: true`; one field agreeing → `"partial"`;
  **both models returning `unclassified` → `agreement: "full"` but `confidence: "low"`** (the
  clause that is easy to get wrong).
- `outcomePrompt` contains every `WinType` key and the `OUTCOME_RUBRIC_VERSION` string.
- Regression: `labelPrompt` and `RUBRIC_VERSION` are untouched — theme labelling must not change.

Gate: `npx tsx scripts/test-cases-outcome.ts` passes; `npm run typecheck` clean; `npm run build`
compiles. **`npm run verify` is NOT run** — it factory-resets the local corpus.

## Operational

- Credentialed run required: `cases:classify-outcome:cloud`, then `cases:outcome-review:cloud`.
- No re-embedding, no index rebuild. `outcome` is a filter/facet field, not part of the search
  artifact, so the vectors and BM25 artifacts are untouched.
- `listFacets` already returns `byWinType` and `CaseFilter` already accepts `winType` — once the
  data exists, the count the client asked for is a query, with no further code change.

## Explicitly NOT doing

- **No `whoWon` / `holding`.** Free text is a new hallucination surface with no verification gate.
  Closed enums bound the worst case to a misclassification rather than a fabricated fact. They stay
  empty and are a separate decision.
- **No enum change.** No `procedural_win` value; `outcomeType` carries that axis.
- **No retrieval changes.** Haida at rank 35 and the criminal case in the top-6 are real defects
  with a separate fix.
- **No facet UI or briefing changes.** Routing "how many" questions to `listFacets` is the natural
  next step, but it is worthless until this data exists, and it belongs in its own spec.
- **No substrate tier.**

## Success criteria

- `winType` is populated for the large majority of core cases, with disagreements abstaining to
  `unclassified` rather than guessing.
- `listFacets({ themes: ["duty_to_consult"] })` returns a `byWinType` breakdown that is an answer
  rather than an admission.
- Every agreed classification has been reviewed against its disposition sentence, with the findings
  committed and the borderline calls escalated.
- Theme labelling, summaries, anchors, retrieval, and both search artifacts are unchanged.
