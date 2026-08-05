# Decline Adjudication — Results

**Date:** 2026-08-05 · **Branch:** `feat/decline-adjudication` · harness: `AWS_PROFILE=bedrock cases:adjudicate:cloud`
(spec `docs/superpowers/specs/2026-08-04-decline-adjudication-design.md`)

**This is not ground truth. No human read any of these fifteen judgments.** The adjudication is
LLM-only, by decision. Whatever the judge picked, we have not learned which paragraph any
quotation came from. **This report recommends nothing**, matching the three forensics reports
before it.

## Result: both pre-registered gates tripped

```
judge      us.anthropic.claude-opus-4-5-20251101-v1:0
summarizer us.meta.llama3-3-70b-instruct-v1:0 (under test — cannot be the judge)
seed 1 · replayed 577 cases · 1 curated outside the population
declines re-derived from the corpus: 15 (not hardcoded — #228 published 15)

flip rate        40.0%  (6/15 readable)         gate 33%  ** TRIPPED **
unparseable      0/15
abstention rate  55.6%  (5/9 order-consistent)  gate 50%  ** TRIPPED **
decided          4  · of those, citedPara names neither candidate in 2
agreement        WITHHELD — the flip gate tripped
```

The data landed in **§3's outcome 1**, and would independently have landed in **outcome 2**.

## What that means, and it is a product conclusion

**The judge disagrees with itself on 6 of 15 pairs when the only thing that changes is which
paragraph is shown first.** Not a marginal effect — 40% against a pre-registered gate of 33%. On
the nine pairs where it was order-consistent, it declined to call 5.

Four pairs got a stable, decided answer. Of those, `citedPara` names neither candidate in two,
leaving **two** rows on which an agreement rate could have been computed. No rate on a denominator
of two is interpretable, so the flip gate withheld nothing of value — it withheld a number that
would have been noise wearing a percentage sign.

**So the fifteen declined claims are not adjudicable by this method, and the guard should keep
declining them.** That conclusion needs no ground truth: whatever the right answer is, an
independent capable reader given the quotation and both paragraphs cannot produce a stable one.
An ambiguous citation is worse than a missing one, and this is what the ambiguity looks like when
someone tries to resolve it.

**The tie-breaker line closes.** #228 found `citedPara` indistinguishable from chance; this finds
the pairs themselves resistant to adjudication. Those are different results with the same
consequence.

## The position-bias control was the decisive instrument

Spec §4 added it, and without it this report would have said something false. With `best` always
presented first, the run would have produced a stable-looking set of picks, an agreement rate on
whatever denominator survived, and no indication that 40% of the answers were an artefact of
ordering. **The flip rate is not a caveat on the result — it is the result.**

This is worth recording as a methodology finding beyond this instrument: on fine-grained textual
comparison of near-identical passages, this judge is order-sensitive at 40%. Any future measurement
that asks a model to choose between two similar texts and does not swap the order is not measuring
what it thinks it is.

## The case that motivated the line cannot be resolved by it

`2008-scc-41` is the case `2026-08-03-claim-recovery-results.md` named as needing "the ambiguity
resolved, not the threshold lowered", and `2026-08-03-anchor-signals-results.md` identified as the
single most favourable row in the whole table — the only one of fifteen where `citedPara` and the
overlap margin pointed the same way.

**It flipped.** `rival` in one ordering, `best` in the other. The one case we most wanted an answer
for is one the judge cannot answer stably.

## All 15 rows

Published whole, as the two preceding reports were, because every aggregate above must be
checkable against them and because both instrument bugs #228 found were caught exactly this way.
`first` and `second` are the two presentation orderings; `agreed=n/a` means either the row flipped,
or the judge abstained, or `citedPara` names neither candidate.

```
2026-fc-425    best=para-51   rival=para-96   cited=[para-96]   unsure/unsure  flip=no   agreed=n/a
2024-onca-148  best=para-15   rival=para-35   cited=para-15     best/best      flip=no   agreed=true
2024-scc-39    best=para-11   rival=para-98   cited=para-10     rival/unsure   FLIP      agreed=n/a
2024-scc-10    best=para-81   rival=para-7    cited=para-80     best/best      flip=no   agreed=n/a
2021-fca-184   best=para-20   rival=para-58   cited=para-58     best/best      flip=no   agreed=false
2021-onca-779  best=para-5    rival=para-38   cited=para-5      best/rival     FLIP      agreed=n/a
2020-fca-122   best=para-5    rival=para-12   cited=para-12     rival/best     FLIP      agreed=n/a
2018-scc-40    best=para-37   rival=para-78   cited=para-5      best/best      flip=no   agreed=n/a
2015-bcca-89   best=para-49   rival=para-58   cited=para-49     unsure/unsure  flip=no   agreed=n/a
2012-bcca-472  best=para-33   rival=para-45   cited=para-33     unsure/unsure  flip=no   agreed=n/a
2008-scc-41    best=para-51   rival=para-7    cited=para-51     rival/best     FLIP      agreed=n/a
2003-nsca-105  best=para-128  rival=para-19   cited=para-20     unsure/rival   FLIP      agreed=n/a
2003-scc-55    best=para-3    rival=para-13   cited=para-3      rival/best     FLIP      agreed=n/a
2002-bcca-59   best=para-75   rival=para-107  cited=para-130    unsure/unsure  flip=no   agreed=n/a
1999-bcca-750  best=para-287  rival=para-155  cited=para-160    unsure/unsure  flip=no   agreed=n/a
```

## Two observations, explicitly not conclusions

**All four decided rows picked `best`.** `best` is *our* overlap scoring's preference, not the
model's citation. Four of four is *p* = 0.125 two-sided — not significant, and on n = 4 it would be
irresponsible to read further. It is recorded because it is the only hint in the data that the
judge's stable answers track anything at all, and because it points at a different question than
the one this instrument asked: whether the judge agrees with the *scoring*, not with `citedPara`.
Note it is not simply "picked the higher overlap" — in two of the four the overlaps are equal to
three decimal places.

**The length-bias confound spec §10 flagged does not show up here.** Of the four decided rows the
judge picked the shorter paragraph twice (`2024-onca-148` 1893 vs 2014, `2024-scc-10` 1942 vs 2014)
and the longer twice (`2021-fca-184` 2017 vs 1984, `2018-scc-40` 1981 vs 1976). No preference is
visible. That is why §9.5 required the lengths in the output — the check costs nothing once the
data is printed, and it would have been unanswerable otherwise. On n = 4 this rules the confound
out weakly, not firmly.

## What this cannot establish

- **Not ground truth**, per the opening. Nothing here says which paragraph any quotation came from.
- **Not a claim that the guard is correct.** The guard declines ambiguous citations by design. This
  measures that the ambiguity resists resolution, not that declining was the right rule.
- **Not a general statement about this judge.** It was asked one narrow, unusually hard question:
  distinguish two paragraphs that both contain ≥95% of a garbled quotation as a contiguous run. The
  40% order-sensitivity is a fact about *this task*, and the sample is fifteen deliberately hard
  pairs.
- **A shared blind spot remains invisible.** If judge and summarizer misread the same near-miss the
  same way, they agree for the wrong reason and nothing here detects it.
- **n = 15.** The gates were chosen precisely because they license conclusions that do not need
  power. Both tripped by margins (40 vs 33, 55.6 vs 50) that one or two rows could have moved.

## Open

- **`2008-scc-41`, `1999-3-scr-533`, `1997-2-scr-657`** still have no summary. `2008-scc-41`'s
  ambiguity is now measured as unresolvable by an independent reader, not merely unresolved.
- **Whether the judge tracks the overlap scoring** rather than `citedPara` is a different question,
  suggested by the four-of-four above and not answered by anything here.
- **The 40% order-sensitivity applies to any future two-text comparison** in this codebase. The
  answer-quality instrument's faithfulness scoring shows one paragraph at a time and is not exposed
  to it; nothing else currently is either.
