# RBC p4 interleaving — root cause, three rejected fixes, and the one that shipped

**Date:** 2026-07-27 · Found by the Textract cross-reference
(`docs/rap-textlayer-corpus-measurement.md`), which flagged p4 at **28.6% within-page order
disagreement** — the worst page in the corpus.

**Status: FIXED** — `MIN_BAND_FILL_RATIO` recalibrated 0.65 → 0.57 against real geometry.

Three earlier candidates were rejected first, and the reasoning is kept below because each was
plausible and two of them were only killed by measurement. The fix that landed is a one-constant
recalibration justified by a gap between two *measured* values, not by a guess.

---

## The symptom

RBC p4 is the CEO letter. Its lower half has two independent regions that share baselines: body
prose on the left (band 0) and a 2×2 signature grid on the right (bands 1 and 2). The prose guard
refuses the page, so it is read row-major, which interleaves them:

```
y=419  (band 1) Dave McKay            (band 2) Phil Fontaine
y=416  (band 0) purpose-driven organization, we are deeply committed to…
y=404  (band 1) President and Chief Executive Officer,  (band 2) Special Advisor
y=399  (band 0) communities across Canada to enhance livelihoods…
```

A sentence of the CEO letter is broken by a name, then a title, then continues.

## The root cause

`columnsLookLikeProse` requires **every** band to satisfy both `MIN_BAND_FILL_RATIO = 0.65` and
`MIN_BAND_LINE_CHARS = 10`. On p4:

| band | fill | mean word-chars | verdict |
| --- | ---: | ---: | --- |
| 0 (body prose) | 0.846 | 66.78 | prose-like |
| 1 (signatures, left) | 0.699 | 17.38 | prose-like |
| 2 (signatures, right) | **0.637** | 14.00 | **rejects the page** |

The page is refused because **one band misses one threshold by 0.013**. Its character count passes
comfortably. This is a marginal false rejection, not table detection.

Why band 2's fill is low: `edges` is built from `gutterMid`, but gutter 2 is `lo=941.99,
hi=1067.04` — **125pt wide**. Half of that empty band (~62pt) is charged to band 2's width, so
content occupying 108pt of a 108pt column reads as filling only 0.637 of a 170pt span. Bank of
Canada's gutters are ~15pt, so the same error there is worth <0.01 and never mattered.

There is a genuine irony: `ColumnGutter`'s own documentation explains that a gutter must be modelled
as a band because a single boundary x is "systematically" wrong — and then the guard collapses it to
a midpoint.

## Fix 1 — exclude spanning lines from the width denominator. **Disconfirmed.**

The guard already excludes spanning lines when measuring band *content* (`if (split.spans)
continue;`) but not when computing the page-wide `min`/`max` that set the outer edges. A real
inconsistency, so it was the first hypothesis.

Measured: band 2 fill moves **0.637 → 0.639**. The page still rejects. Not the cause.

## Fix 2 — build band edges from the gutter's real edges, not its midpoint. **Rejected on evidence.**

Principled: a band should span `previousGutter.hi .. nextGutter.lo`, excluding gutter dead space.
It does fix p4 cleanly, and it sharpens every known-good page:

```
RBC p4   TABLE -> PROSE   band 2 fill 0.637 -> 0.995
BoC p13  PROSE -> PROSE   0.939 -> 0.965,  0.964 -> 0.992
BoC p15  PROSE -> PROSE   0.938 -> 0.965,  0.971 -> 1.000
HQ  p3   PROSE -> PROSE   0.954 -> 1.000,  0.953 -> 0.999
```

Then it was measured against the Textract reference across all five documents, and it is a disaster:

```
SHIPPED   (gutter midpoints)  501/505 placed, order disagreement 1.12%
CANDIDATE (gutter edges)      310/310 placed, order disagreement 0.67%
```

**191 fewer sentences correctly placed.** RBC's own order disagreement gets *worse*, 2.9% → 6.7%.
The reason is structural: with the gutter's width removed, an inner band's span is by construction
exactly its content extent, so fill ≡ 1.0 and the metric stops discriminating. The guard becomes far
more permissive, reorders pages it should not, and recall collapses.

This is the fix that "looked right". It was only caught because the reference harness existed.

## Fix 3 — partition bands by co-occurrence. **Falsified by evidence.**

A table links every band on every row, so its co-occurrence rate is ~1.0 regardless of how few rows
it has. Two independent regions that merely share a page should link on few or no lines. So: build a
graph over bands, link two bands when they appear on the same non-spanning line, and give each
connected component its own flow. Tables would be untouched by construction.

The rate must be normalised by `min(linesWithA, linesWithB)` and never be an absolute count — an
absolute threshold of 3 would split a genuine **2-row** commitment table, the exact disaster the
guard exists to prevent.

Four more documents were downloaded to test this (ATB 76pp, BC Legislative Assembly 12pp, Populous
Reflect RAP 12pp, FNFA brief 6pp), bringing the corpus to **11 documents**. Two results:

1. **Guard rejections are vanishingly rare** — still only RBC p4, across ~250 pages. Real commitment
   tables mostly produce *no gutters at all* (Agnico's ESTMA tables, the Reflect RAP tables), so the
   guard is never consulted for them and they are read row-major by default.
2. **The discriminator does not work.** Populous p12 is an office address block — three columns,
   each a city office with its own street address and phone — genuinely independent regions that
   must be read column-major. It scores:

```
Populous p12 (independent regions):  0-1: 1.00   0-2: 1.00   1-2: 1.00
RBC p4       (independent regions):  0-1: 0.25   0-2: 0.00   1-2: 1.00
a commitment table:                  ~1.00 on every pair
```

Populous p12 is indistinguishable from a table by this metric. Co-occurrence measures *row
alignment*, and independent regions are frequently row-aligned — an address block and a commitment
table have the same geometry. **Fix 3 abandoned.**

## Fix 4 — recalibrate MIN_BAND_FILL_RATIO against real geometry. **SHIPPED.**

The same evidence gave the answer. 0.65 was the midpoint of 0.500 (synthetic table) and 0.783
(synthetic two-column) — **both synthesised**. RBC p4 band 2 supplies a *real* prose band at 0.637,
so the prose side of the gap reaches lower than the synthetic fixtures implied, and 0.65 sat inside
it rather than between the two populations.

```
table side, measured:  0.500   (synthetic table, worst qualifying band)
prose side, measured:  0.637   (RBC p4 band 2 - REAL geometry)
midpoint:              0.5685  ->  0.57
```

Verified against the Textract cross-reference over five documents:

- **0.55-0.62 is a plateau** — identical corpus behaviour throughout, so 0.57 is not perched on an
  edge. This is the plateau property `COLUMN_GUTTER_RATIO` was originally chosen for and, unlike
  that constant, it survives contact with the corpus.
- **Exactly one page in 11 documents changes verdict**: p4 itself.
- On p4 the loader now recovers **13 intact sentences instead of 7** — row-major had been cutting
  them in half — and its order disagreement with Textract falls **28.6% -> 23.1%**.
- Corpus-wide: **507/511 sentences on the correct page, against 501/505** before. RBC alone improves
  125/125 -> 131/131 matched.
- `COLUMN_GUTTER_RATIO = 0.12` remains the argmax after the change (507 sentences).
- The synthetic table at 0.500 stays comfortably refused, asserted directly by the test suite.

**Do not read the pooled order-disagreement figure as a regression.** It rises 1.12% -> 1.64% purely
because p4 now contributes 78 orderable sentence pairs where it contributed 21; raw inversion counts
scale quadratically with set size. Per-page, p4 improved on both measures. This is the same set-size
confound documented in `tune-against-textract.ts`, reappearing one level up at the pooling step.

Regression coverage: `scripts/fixtures/textlayer-geometry-rbc-p4.json` (real glyph geometry, 62
runs, no binary blob) plus six assertions in `scripts/test-doc-loader-textlayer.ts` — the body
sentence stays whole, each of the four signatories keeps their own title, and no two adjacent
signatories are concatenated.

### Residual

p4 still disagrees with Textract at 23.1%. The body prose is now whole and the signatories are
correctly paired, but the two independent regions are still emitted in a different relative order
than Textract chooses. That is ordering *between* regions, not corruption *within* them, and no
commitment is affected. Left as measured.

## The underlying limitation is geometric, not a bug

RBC p4's signature grid is **row-aligned**: every band carries content on shared baselines, exactly
like a commitment table. The two are geometrically indistinguishable. What differs is semantic — in a
signature grid each *column* is one person, in a commitment table each *row* is one commitment — and
no purely geometric rule separates them.

Given that, the guard's conservatism is correct. Over-detection is the dangerous direction: reading
a commitment table column-major detaches an action from its owner and timeline, and produces a quote
that still passes `validate.ts`. A mis-ordered signature block does not.

The guard is also deliberately all-or-nothing, and must stay so. A tempting variant — extract only
the prose-like bands and leave the rest row-major — breaks commitment tables *specifically*, because
a table's ACTION column is itself prose-like (measured at 0.816 / 24.00, higher than either band of
the genuine two-column fixture). That is the reason the guard requires every band to qualify.

## What is NOT claimed

The guard remains geometric, and geometry cannot tell a signature grid from a commitment table — both
are row-aligned; the difference is semantic. This fix moves ONE threshold onto real evidence. It does
not give the guard a new capability, and the documented limitation stands: **a table whose columns
are all wide and wordy still passes the guard and would be read column-major, with no validation
flag.** No such page exists in the 11-document corpus, so that risk is still untested rather than
disproven.

Lowering the threshold moves marginally toward that risk, which is why 0.57 was placed at the
midpoint of a measured gap and verified to change exactly one page in ~250. The synthetic table's
worst qualifying band (0.500) still fails by a wider relative margin than p4's real prose band
(0.637) passes.

## How to re-run any of this

```
scripts/diagnose-prose-guard.ts   <pdf> <page>   per-band fill + mean word-chars, both readings
scripts/scan-guard-rejections.ts  <dir>...       every guard-rejected page, with co-occurrence rates
scripts/compare-loader-vs-textract.ts <pdf> <ref.json>   per-page order agreement
scripts/tune-against-textract.ts  <pdf>=<ref.json>...    sweep a constant against the reference
```

The last two need no AWS — they read the committed hashed fixtures in
`scripts/fixtures/textract-reference/`.
