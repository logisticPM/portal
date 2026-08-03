# Claim Recovery — Results

**Date:** 2026-08-03 · **Branch:** `feat/claim-recovery` · harness: `SUMMARIZE_FORCE=1 cases:summarize:cloud`
(spec `docs/superpowers/specs/2026-08-03-claim-recovery-design.md`)

## Result

| | before | after |
|---|---:|---:|
| claims kept | 2,077 | **2,481** |
| claims dropped | 707 | **398** |
| drop rate | 25.4% | **13.8%** |
| core cases with a summary | 573 / 578 | **575 / 578** |

**346 claims recovered across 251 cases.** Of the 2,503 anchors now published, **346 (13.8%)
were matched near-exactly** rather than verbatim.

**This is not a clean A/B.** 19 core cases gained or changed full text in the SCC backfill
earlier the same day, so their prompts and therefore their claims differ: the total claim
count moved from 2,784 to 2,879. The drop *rate* is the comparable figure; the raw counts
are not.

## The case that recovery was for

`2025-scc-4` had **no summary at all** — every claim was discarded, the best at 1.00 overlap.
It now publishes **3 claims, 2 of them recovered.** The case exists in the product only
because of this change.

## The case recovery did not fix, and why that is the design working

`2008-scc-41` **still has no summary.** Its best near-miss scores 0.97, comfortably over the
0.95 threshold — and the uniqueness guard declined it anyway, because a second non-adjacent
paragraph also matched at ≥0.95.

That is the guard doing exactly what it was built for. The quote is a locator, never
published, so the only harm this design can do is point a reader at the wrong paragraph.
When two paragraphs match a quotation equally well, the attribution is a coin flip and we
decline it. **An ambiguous citation is worse than a missing one** — that is the trade, and
here it costs a whole case.

The guard is not theoretical. Near-misses at ≥0.95 that were still declined appear
throughout the run:

```
2020-fca-122  para-5   (model cited para-12)  1.00
2003-nsca-105 para-128 (model cited para-20)  1.00
2024-onca-148 para-15                         1.00
```

(1.00 is `toFixed(2)`; an exactly-contiguous quote would have matched on the verbatim path.)

**The binding constraint is now ambiguity, not the threshold.** Anything further requires
distinguishing *which* of two near-identical paragraphs a quotation came from, which is what
`docs/superpowers/specs/2026-07-31-anchor-signals-design.md` was written to measure and that
measurement has not run.

## Setup, and two things that went wrong on the way

- **`SUMMARIZE_FORCE=1`, not `FORCE=1`.** The first attempt used the wrong variable name and
  regenerated nothing: `already-generated 572 · generated 2`. It looked like a successful run.
  Recorded because the output of a no-op force is indistinguishable from a real one unless
  you read the `already-generated` count.
- **The forensics dry-run aborted, correctly.** The plan called for re-running
  `cases:drop-forensics` first as a cheap cache-replayed check. It stopped at `2014-scc-44`
  with `cache miss … Do NOT interpret a partial run.` Tsilhqot'in gained full text that
  morning, so its prompt changed and the cached response no longer matches. The guard
  refused to measure a partial population — which is what it exists for. The partial signal
  before the abort (210 recoveries across 150 cases) is **not** reported as a corpus figure.

## Failures

10 of 578 failed regeneration, up from 5 attempted-and-failed in the un-forced run — but
forcing re-runs all 567, so cases that previously succeeded can now fail. Six of the ten
kept their previous summary:

```
⚠ 2021-ykca-5 · 2020-scc-4 · 2017-bcca-154 · 2013-scc-14 · 2012-bcsc-543 · 2009-bcsc-841
   forced regeneration failed — previous summary retained in table
```

That retention is deliberate in `cases-summarize.ts` and it worked: a failed forced
regeneration does not destroy a good summary. **Three core cases have no summary**:
`2008-scc-41`, `1999-3-scr-533`, `1997-2-scr-657`.

## Also measured

`cited-para-not-found 12` — in twelve drops the model cited a paragraph id that does not
exist in the judgment. The near-miss samples show the same thing from the other side
(`para-5 (model cited para-12)`). This corroborates the standing note in `summarizer.ts` that
models misattribute paragraph ids about half the time, and is why `locate()` searches every
paragraph rather than trusting the cited one.

## What did not change

- The fabrication ceiling. Claims sharing nothing substantial with the judgment are still
  dropped; the 0.90–0.95 and 0.50–0.80 bands are untouched.
- What is published. `CitationAnchor` still has no quote field; the model's quotation is used
  to find a paragraph and discarded.
- `drop-cause.ts`, which remains measurement-only.

## Open

- **`2008-scc-41`** needs the ambiguity resolved, not the threshold lowered.
- **The 0.90–0.95 band (51 claims)** waits on the anchor-signals measurement.
- **13.8% of published anchors are near matches.** The methodology page now states the rule;
  whether the per-claim UI should distinguish them is a product decision, deliberately not
  taken here.
- **The forensics cache is stale** for every case whose text changed in the SCC backfill.
  Re-running `cases:drop-forensics` needs a cache refresh first, or it will keep aborting.
