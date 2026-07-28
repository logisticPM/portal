# RBC p4 interleaving — root cause, and why three fixes were not shipped

**Date:** 2026-07-27 · Found by the Textract cross-reference
(`docs/rap-textlayer-corpus-measurement.md`), which flagged p4 at **28.6% within-page order
disagreement** — the worst page in the corpus.

**Status: root cause understood, NOT fixed.** Two candidate fixes were implemented and measured;
both are worse. The third needs a constant fitted to a single page. The recommendation is to accept
this as a documented limitation. Nothing in `src/` was changed.

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

## Fix 3 — partition bands by co-occurrence. **Not shipped: needs a constant fitted to n=1.**

A table links every band on every row; two independent regions never share a line. So: build a graph
over bands, link two bands when they appear on the same non-spanning line, and give each connected
component its own flow. Tables are untouched by construction — every row links all bands.

The measured co-occurrence on p4 is:

```
bands 0-1: 2 lines      bands 1-2: 5 lines
```

Bands 0 and 1 *do* share two lines (a display heading fragment, "Letter from", sitting at the same
baseline as a line of body text). Separating them therefore requires a threshold of **3** — placed
between 2 and 5, on the evidence of exactly one page. That is the same n=1 fitting error this
project documented earlier the same day when rejecting a font-relative gutter criterion, and it
should not be repeated because the page in question is the one we happen to be looking at.

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

## Impact of leaving it

Bounded and cosmetic:

- **No commitments are on this page.** It is a CEO letter with a signature block.
- **Page attribution is unaffected** — p4's sentences are all on p4 (RBC scores 125/125).
- **A quote spanning the interleave fails `validate.ts`'s substring check** and routes to human
  review. Wrong-looking, never wrong-and-confident.
- Blast radius is **one page in a 166-page corpus** (it appears twice only because the trimmed RBC
  file contains the same page).

## If this needs fixing later

Fix 3 is the right shape and is safe by construction; it only needs evidence. Collect two or three
more pages where the guard rejects but the page has independent regions, and the threshold can be
placed on a measured gap instead of a guess. The rig to find them already exists — run
`scripts/compare-loader-vs-textract.ts` over new documents and look for pages with high within-page
order disagreement. `scripts/diagnose-prose-guard.ts` then prints the per-band numbers for any page.
