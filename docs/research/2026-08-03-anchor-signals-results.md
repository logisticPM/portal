# Anchor Signals — Results

**Date:** 2026-08-03 · **Branch:** `feat/anchor-signals` · harness: `AWS_PROFILE=bedrock cases:anchor-signals:cloud`
(spec `docs/superpowers/specs/2026-07-31-anchor-signals-design.md`)

Read-only. Zero LLM calls — model responses replay from `scripts/.cache/llm`. Writes nothing.

**This report recommends nothing.** It exists to make one decision decidable: whether the
model's own cited paragraph can break the ties the uniqueness guard declines.

## The question

Claim recovery (#227) anchors a claim when exactly one paragraph scores ≥0.95. What blocks
progress now is strong matches that are *ambiguous* — `2008-scc-41` has no summary at all
despite a 0.97 best match, because a second paragraph also cleared 0.95. Lowering the
threshold cannot help; the match is already above it.

`citedPara` is the candidate tie-breaker: the model's bookkeeping and our text matching are
independent, so agreement would be real corroboration. But `summarizer.ts` records that models
misattribute paragraph ids about half the time. Whether they do so *among the claims where two
paragraphs match strongly* is what nobody had measured.

## Result

398 `no_span` drops across 577 cases · 1 curated-summary case outside the population.

| band | drops | declined | cited=best | cited=rival | best±1 | rival±1 | elsewhere | no-digits | *(unresolvable)* |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **≥0.95** | 15 | 15 | **6** | **3** | 2 | 1 | 3 | 0 | *1* |
| 0.90–0.95 | 54 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | *0* |
| 0.80–0.90 | 66 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | *0* |
| 0.50–0.80 | 208 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | *0* |
| <0.50 | 55 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | *0* |

*(unresolvable)* overlaps the columns to its left — it counts declines whose cited value
production's `findCited` cannot resolve — and is **not additive** with them. The runner asserts
both reconciliations before printing: `398 banded = 398 counted`, and each band's buckets sum
to its `declined`.

### Two cells of that table are identities, not measurements

- **`declined = 0` in every band below 0.95** is the definition of `declinedByGuard`, which is
  only true when the threshold *was* cleared. It is not evidence that ambiguity is confined to
  the top band.
- **`declined = drops` at ≥0.95** follows from recovery: a ≥0.95 match whose rival is under the
  threshold is anchored by `locate()`'s fourth attempt, so it never becomes a drop. Every drop
  in the top band is necessarily a decline.

Both are flagged because the earlier forensics report printed `locate_bug = 0` and
`assembly_boundary = 0` as if they were findings when both were structural. The conclusions
there held, but the evidence cited for them was tautological.

## What the guard costs

**15 claims, 3.8% of the 398 drops.** That is the entire prize available to any tie-breaker
built on this signal.

## The signal, at three levels of permissiveness

How many claims a tie-breaker could reach depends entirely on how generously it reads the
model's cited paragraph. Reporting one number would either understate the prize or overstate
the signal, so all three are here:

| reading | names a candidate | best:rival | two-sided *p* | |
|---|---:|---:|---:|---|
| strict (production's `findCited`) | 8/15 (53%) | 6:2 | 0.29 | exact id; brackets unreadable |
| digit-normalised | 9/15 (60%) | 6:3 | 0.51 | exact paragraph number |
| offset-tolerant | 12/15 (80%) | 8:4 | 0.39 | exact number, or ±1 |

*p* is a two-sided binomial test against a coin flip, exact by doubling because Binomial(*n*,
0.5) is symmetric.

**No reading reaches significance.** The most favourable split available anywhere in these data
is 8:4, and it sits at *p* = 0.39. The measurement cannot distinguish `citedPara` from chance
among the claims where two paragraphs match strongly — which is the one population the question
was about.

Two further limits on how far the 80% can be read:

- **It bounds coverage, not accuracy.** An offset-tolerant rule would anchor 8 of 15 to the best
  match and 4 of 15 to the rival. Nothing here establishes which of the two is the true source,
  so the 4 are not known to be errors — and the 8 are not known to be correct.
- **There is no ground truth in this measurement at all.** Both paragraphs cleared 0.95 by text
  matching. No human has read these fifteen judgments to say which paragraph the quotation came
  from.

## 11 of 15 are overlap ties at printed precision

At two decimal places the best and rival scores are equal in eleven rows (2× 0.97/0.97,
7× 0.99/0.99, 2× 1.00/1.00). A "prefer the higher overlap" tie-breaker has nothing to work with
in those. The underlying floats may differ; this is a statement about the printed values only.

A printed **1.00 is rounding, not exactness** — an overlap of exactly 1.0 means a paragraph
contains the quote contiguously, which `locate()`'s second attempt anchors, so it can never
become a drop. No row here is a quotation appearing verbatim in two paragraphs, and none should
be read that way.

## All 15 declines

```
2026-fc-425    best=para-51@0.97  rival=para-96@0.97  cited="[para-96]" (production: unresolvable)
2024-onca-148  best=para-15@1.00  rival=para-35@1.00  cited="para-15"
2024-scc-39    best=para-11@0.99  rival=para-98@0.99  cited="para-10"
2024-scc-10    best=para-81@0.99  rival=para-7@0.98   cited="para-80"
2021-fca-184   best=para-20@0.99  rival=para-58@0.99  cited="para-58"
2021-onca-779  best=para-5@0.99   rival=para-38@0.99  cited="para-5"
2020-fca-122   best=para-5@1.00   rival=para-12@1.00  cited="para-12"
2018-scc-40    best=para-37@0.99  rival=para-78@0.99  cited="para-5"
2015-bcca-89   best=para-49@0.99  rival=para-58@0.99  cited="para-49"
2012-bcca-472  best=para-33@0.97  rival=para-45@0.97  cited="para-33"
2008-scc-41    best=para-51@0.97  rival=para-7@0.96   cited="para-51"
2003-nsca-105  best=para-128@1.00 rival=para-19@0.99  cited="para-20"
2003-scc-55    best=para-3@0.99   rival=para-13@0.99  cited="para-3"
2002-bcca-59   best=para-75@0.99  rival=para-107@0.99 cited="para-130"
1999-bcca-750  best=para-287@0.99 rival=para-155@0.98 cited="para-160"
```

Fifteen rows is small enough to publish in full, which is the point: every aggregate above is
checkable against them, and both instrument bugs described below were found only because the
raw cited values were printed.

## The case that motivated the measurement

**`2008-scc-41` is the most favourable row in the table.** `cited="para-51"` names the best
match, and the best match also carries the higher overlap (0.97 vs 0.96). It is the only one of
the fifteen where both signals point the same way — four rows have a strictly higher 2dp best,
and this is the only one of those four whose cited paragraph names it. A cited-para tie-breaker
would recover this case.

That is n=1, and the population it sits in tops out at *p* = 0.39. Both facts are true and they
point opposite ways. Recording both without resolving them is the intended output of this
report.

## Off-by-one is systematic; three rows are not

`2024-scc-39` cited para-10 for a best match at para-11, `2024-scc-10` cited para-80 for
para-81, and `2003-nsca-105` cited para-20 against a rival at para-19. Given their own columns
rather than lumped with the three rows where the cited paragraph names nothing nearby:
`2018-scc-40` (cited para-5 against best 37 / rival 78), `2002-bcca-59` (cited para-130 against
75 / 107), and `1999-bcca-750` (cited para-160 against 287 / 155).

`1999-bcca-750` shows that ±1 is a choice, not a natural boundary: 160 is five from the rival's
155. A wider window would move it, which is why the offset-tolerant row above is labelled as
one reading among three rather than as the result.

## What the bracket-wrapped citation does and does not affect

`2026-fc-425` cited `"[para-96]"`, which *is* the rival paragraph. `findCited`
(`summarizer.ts:128`) accepts `N` and `para-N` and neither matches, so production cannot resolve
it.

**This did not change the outcome for any of the fifteen, and it cannot change the drop rate.**
`findCited` feeds only `locate()`'s *first* attempt. The second attempt tests the same
`includes(quote)` predicate across every paragraph, and the cited paragraph is one of them — so
attempt 1 succeeding implies attempt 2 would have succeeded. A more permissive `findCited` can
therefore only **redirect** an anchor to a different paragraph, never create or destroy one. And
all fifteen rows here are `no_span`, meaning attempts 1–3 all failed and no paragraph contains
the quote contiguously; attempt 1 could not have fired for any of them.

What bracket-wrapping did affect is this report's classifier, and the `strict` row above — the
ceiling production could reach today is 8/15, not 9/15.

`summarizer.ts` is untouched on this branch. Normalizing `findCited` would change **which
paragraph** some anchors point at, in cases where two paragraphs contain a quote verbatim; a
follow-up would validate it by diffing anchored paragraph ids, not by re-measuring the drop
rate. An earlier draft of this report claimed the drop rate would move. That was wrong.

## The instrument was wrong on the first two runs

Both were caught before any number here was recorded.

**Run 1** filed `"[para-96]"` under a `cited=absent` column and counted both best±1 rows as
`cited=neither`, putting the headline at 8/15 with a 6:2 split. Fixed in `9dd7010`: comparison
moved to the paragraph number, `best±1` and *(unresolvable)* separated out, all declines printed
instead of six, and a binomial *p* added.

**Run 2** tested off-by-one against the best match only, so `2003-nsca-105` — an offset against
the *rival* — was counted as random misattribution, contradicting the very claim the column
existed to support. It also reported 9/15 as "the ceiling" while arguing two sections later that
offsets carry signal, and it silently dropped any drop that fell outside every band or had no
parseable claims. Fixed together with the reconciliation gates.

Recorded because the denominator is 15. One misclassified row moves the headline, which is
exactly the failure this line of work keeps hitting — reading a biased subset as a distribution.
Run 1's 8/15 was not purely an artifact, incidentally: it is production's own strict reading,
and it survives as the first row of the ceiling table.

## Scope

- **No ground truth.** Not a measurement of whether `best` or `rival` is correct.
- **The 0.90–0.95 band (54 claims) is untouched by the guard**, so this report says nothing
  about it. `2026-08-03-claim-recovery-results.md:104` cites 51 for "the 0.90–0.95 band", which
  is **not the same quantity**: it comes from `2026-07-31-claim-drop-forensics.md:112`, a
  pre-recovery run over 707 drops restricted to the `transcription` bucket (n=631). The 54 here
  is post-recovery over all 398 `no_span` drops. The two are not comparable and their closeness
  is coincidence.
- **`declinedByGuard`, `rival` and `rivalPara` are measurement-only.** Nothing in production
  behaviour changed on this branch; a differential over randomized corpora against `origin/main`
  found no change to anchors, drop counts, or recoveries.
- **`rival: 0` is ambiguous and documented as such.** It means either "no eligible non-adjacent
  competitor" or "one exists sharing no substring". `rivalPara === null` marks both, so a future
  margin calculation must check it rather than treat the margin as `bestOverlap`.
- **The replay population excludes 1 curated case.** A hand-written `enrichment.ts` summary was
  never produced by a model, so there is no cached response to replay. `2014-scc-44` became
  reachable when the SCC backfill gave it 62 chunks and aborted every replay run until the
  population was corrected (`b66e88e`) — by fixing the population, not by relaxing the
  cache-miss guard.

## Open

- **`2008-scc-41`, `1999-3-scr-533`, `1997-2-scr-657`** still have no summary.
- **Whether a cited-para tie-breaker is worth building** is not answered here, and a larger
  replay cannot answer it: the ceiling is 15 claims and no reading of the split separates from
  chance. Distinguishing the two hypotheses needs ground truth, which is the RM-3 gold set.
- **The bracket-wrapping rate across all 398 drops** is unmeasured. It cannot affect the drop
  rate, per the reasoning above, but it bounds how much of `locate()`'s first attempt is
  reachable at all.
