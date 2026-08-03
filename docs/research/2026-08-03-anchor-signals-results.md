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

| band | drops | declined | cited=best | cited=rival | best±1 | elsewhere | no-digits | *(unresolvable)* |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **≥0.95** | 15 | 15 | **6** | **3** | 2 | 4 | 0 | *1* |
| 0.90–0.95 | 54 | 0 | 0 | 0 | 0 | 0 | 0 | *0* |
| 0.80–0.90 | 66 | 0 | 0 | 0 | 0 | 0 | 0 | *0* |
| 0.50–0.80 | 208 | 0 | 0 | 0 | 0 | 0 | 0 | *0* |
| <0.50 | 55 | 0 | 0 | 0 | 0 | 0 | 0 | *0* |

*(unresolvable)* overlaps the columns to its left — it counts declines whose cited value
production's `findCited` cannot resolve at all — and is **not additive** with them.

### Two cells of that table are identities, not measurements

- **`declined = 0` in every band below 0.95** is the definition of `declinedByGuard`, which is
  only true when the threshold *was* cleared. It is not evidence that ambiguity is confined to
  the top band.
- **`declined = drops` at ≥0.95** follows from recovery: a ≥0.95 match with no rival is
  anchored, so it is not a drop. Every drop in the top band is necessarily a decline.

Both are flagged because the earlier forensics report printed `locate_bug = 0` and
`assembly_boundary = 0` as if they were findings when both were structural. The conclusions
there held, but the evidence cited for them was tautological.

## What the guard costs

**15 claims, 3.8% of the 398 drops.** That is the entire prize available to any tie-breaker
built on this signal.

## The signal: 6 best, 3 rival, on n=9

`citedPara` names one of the two candidates in **9 of 15 (60%)** — the *ceiling* for a
tie-breaker, computed on a paragraph-number comparison deliberately looser than production's.
Of those nine it agrees with the best match in 6 and with the rival in 3.

**On n=9, a 6:3 split differs from a coin flip with two-sided p=0.51.** The measurement cannot
distinguish this signal from chance.

Two further limits on how far that 60% can be read:

- **It bounds coverage, not accuracy.** A rule that trusted `citedPara` whenever it named a
  candidate would anchor 6 of 15 to the best match and 3 of 15 to the rival. Nothing here
  establishes which of the two is the true source, so the 3 are not known to be errors — and
  the 6 are not known to be correct.
- **There is no ground truth in this measurement at all.** Both paragraphs cleared 0.95 by
  text matching. No human has read these fifteen judgments to say which paragraph the
  quotation came from.

## 11 of 15 are overlap ties at printed precision

At two decimal places the best and rival scores are equal in eleven rows (0.97/0.97,
0.99/0.99, 1.00/1.00). A "prefer the higher overlap" tie-breaker has nothing to work with in
those. The underlying floats may differ; this is a statement about the printed values only.

A printed **1.00 is rounding, not exactness** — a truly contiguous quote matches on
`locate()`'s verbatim path and never becomes a drop. So no row here is a quotation appearing
verbatim in two paragraphs, and none should be read that way.

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

Fifteen rows is small enough to publish in full, which is the point: the aggregate columns
above are checkable against them, and the instrument bug described below was only visible
because a raw cited value was printed.

## The case that motivated the measurement

**`2008-scc-41` is the most favourable row in the table.** `cited="para-51"` agrees with the
best match, and the best match also carries the higher overlap (0.97 vs 0.96). It is the only
one of the fifteen where both signals point the same way — four rows have a strictly higher
2dp best, and this is the only one of those four whose cited paragraph names it. A cited-para
tie-breaker would recover this case.

That is n=1, and the population it sits in reads p=0.51. Both facts are true and they point
opposite ways. Recording both without resolving them is the intended output of this report.

## Two things the measurement surfaced

**Production discards bracket-wrapped cited paragraphs.** `2026-fc-425` cited `"[para-96]"`,
which *is* the rival paragraph. `findCited` (`summarizer.ts:128`) accepts `N` and `para-N` and
neither matches, so `locate()`'s first attempt — trusting the model's own citation — is thrown
away whenever the model wraps it. This affects 1 of the 15 declines. **The rate across the
other 383 drops is not measured here**, and bracket-wrapping would break that first attempt
for non-declined claims too. `summarizer.ts` is untouched on this branch: normalizing
`findCited` changes production anchoring and the drop rate, so it belongs to its own spec.

**An off-by-one cited paragraph is systematic, not random.** `2024-scc-39` cited para-10 for a
best match at para-11; `2024-scc-10` cited para-80 for para-81. Filed under `best±1` rather
than lumped with genuine misattribution (`2018-scc-40` cited para-5 against best para-37;
`2002-bcca-59` cited para-130 against best para-75).

## The instrument was wrong on the first run

The first measurement filed `"[para-96]"` under `cited=absent` and counted both `best±1` rows
as `cited=neither`. That put the headline at 8/15 with a 6:2 split. Corrected in `9dd7010`
before any number in this report was recorded: comparison moved to the paragraph number,
`best±1` and *(unresolvable)* separated out, all declines printed instead of six, and the
binomial p added so a small-n split cannot be read as a hit rate.

Recorded because the denominator is 15. One misclassified row moves the headline, which is
exactly the failure this line of work keeps hitting — reading a biased subset as a
distribution.

## Scope

- **No ground truth.** Not a measurement of whether `best` or `rival` is correct.
- **The 0.90–0.95 band (54 claims) is untouched by the guard**, so this report says nothing
  about it. `2026-08-03-claim-recovery-results.md` cited 51 for that band; this run reads 54,
  and the difference is not investigated here.
- **`declinedByGuard` is measurement-only**, as is the whole `ClaimDrop` diagnostic surface.
  Nothing in production behaviour changed on this branch.
- **The replay population excludes 1 curated case.** A hand-written `enrichment.ts` summary was
  never produced by a model, so there is no cached response to replay. `2014-scc-44` became
  reachable when the SCC backfill gave it 62 chunks and aborted every replay run until the
  population was corrected (`b66e88e`) — by fixing the population, not by relaxing the
  cache-miss guard.

## Open

- **`2008-scc-41`, `1999-3-scr-533`, `1997-2-scr-657`** still have no summary.
- **Whether a cited-para tie-breaker is worth building** is not answered here and cannot be
  answered by a larger replay: the ceiling is 15 claims and the split is chance-level at this
  n. Distinguishing the two hypotheses needs ground truth, which is the RM-3 gold set.
- **The bracket-wrapping rate across all 398 drops** is unmeasured and cheap to measure.
