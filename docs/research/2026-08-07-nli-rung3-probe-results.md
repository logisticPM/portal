# Rung-3 NLI Probe — Results

**Date:** 2026-08-07 · **Branch:** `feat/eval-persist-rows` · harness:
`AWS_PROFILE=bedrock npm run cases:nli-probe:cloud -- scripts/.cache/eval-rows/<runId>.jsonl`

**This is not ground truth. No human read any of these 264 claims.** The eval judge
(`claude-opus-4-5`) supplied the reference labels and the probe checker (`sonnet-4-6`) supplied
the NLI labels; both are models. What this measures is *agreement structure between two
independent model judgments*, which is enough to answer the engineering question and not enough
to establish that either is right.

The question: **the citation-verification ladder's third rung is a paraphrase/entailment judge.
`verifyClaims` is rungs 1–2. If we built rung 3, what would it buy?**

## Provenance

```
source run   2026-08-07T00-26-59-600Z   (persisted by cases-caseqa-eval, this branch)
answerer     us.meta.llama3-3-70b-instruct-v1:0   (under test)
judge        us.anthropic.claude-opus-4-5-20251101-v1:0   (reference labels)
checker      us.anthropic.claude-sonnet-4-6   (the probe — deliberately NOT the judge)
264 rows read · 264 usable · 264 labelled · 0 unparsed · 0 call failures
```

The checker is a different model from the judge on purpose. The same model on both sides would
agree with itself and the agreement would get written up as validation. The NLI prompt also
avoids the judge's four-way vocabulary (`supported` / `overstated` / `contradicted` /
`unrelated`) entirely, so the two are not one question asked twice.

**These are not the 266 claims published in #236.** The answerer is uncached by design — it is
the thing under test — so re-running produced a different draw. The headline reproduced almost
exactly (39.8% supported vs the published figure, `CONTRADICTED 5` in both), but no claim-level
comparison between the two runs is valid.

## Arm 3 first, because it licenses everything else

A negative control: the same claim checked against a paragraph **from the same case that it does
not cite**. Same-case rather than cross-case on purpose — a cross-case pairing is trivially
neutral on topic alone and would validate nothing.

| premise | → `entailment` |
| --- | --- |
| the paragraph the claim actually cites | **91.4%** (96/105 on `supported`) |
| a paragraph of the same case it does not cite | **5.0%** (2/40), 95% CI [1.4%, 16.5%] |

An 18× separation. **The checker is performing inference, not topic matching**, so arms 1–2 are
interpretable rather than an artefact of both texts being about Aboriginal title.

Precision caveat: n=40 is small. An earlier draw of 40 — taken during a run voided for unrelated
reasons (below), from a slightly different sampling frame — gave 8/40 = 20%. The two draws are
not independent enough to pool. The honest statement is *somewhere in the single digits to ~20%,
and far below 91.4%*; the ordering is what carries the argument, not the point estimate.

## Arm 1 — judge verdict × NLI label (n=264)

```
judge \ nli        entailment        neutral  contradiction         total
supported          96 (91.4%)      9 (8.6%)       0 (0.0%)           105
overstated         54 (56.8%)    38 (40.0%)       3 (3.2%)            95
contradicted         0 (0.0%)    3 (60.0%)       2 (40.0%)             5
unrelated           8 (13.6%)    51 (86.4%)       0 (0.0%)            59
```

## Arm 2 — manufactured negations (n=40)

`contradicted` is 1.9% of rows **by construction** — the answerer rarely reverses the court
outright — so arm 1's bottom row stays at n=5 no matter how often the eval is re-run. Arm 2
manufactures a known-contradiction set by minimally reversing claims the judge called
`supported`, then re-checking against the same paragraph.

```
drawn 40 · construction failed 0 · unparsed 0 · scored 40
caught (contradiction): 35/40 = 87.5%   95% CI [73.9%, 94.5%]
missed as neutral 2 · missed as entailment 3
```

**This is an upper bound, not an estimate.** A minimal lexical reversal (`necessary` →
`unnecessary`, inserting `not`) is exactly the SNLI/MNLI training distribution. The gap between
87.5% here and 2/5 on natural contradictions is the whole point: the checker is good at textbook
negation and the product does not fail by negation.

## The pre-registered decision

Declared in `nli-probe/tally.ts` **before any response was read**, and tested against hand-built
matrices so it could not be relaxed afterwards:

> ship iff false-alarm on `supported` ≤ 5% **and** synthetic recall ≥ 80%

```
false alarm 0.0% (0/105, 95% CI [0.0%, 3.5%])   ≤ 5%   PASS
synthetic recall 87.5% (35/40)                  ≥ 80%  PASS
VERDICT: SHIP
```

**The rule passes, and the rule asked the wrong question.** Recorded as-is; the threshold is not
being moved after the fact. What the rule did not look at is what matters.

## What rung 3 would actually buy

Gate A is the pre-registered one: flag a claim when the checker says `contradiction`.

| | gate A — flag `contradiction` | gate B — flag anything not `entailment` **(POST HOC)** |
| --- | --- | --- |
| claims flagged | 5/264 = **1.9%** [0.8, 4.4] | 106/264 = 40.2% [34.4, 46.2] |
| precision (flag is a real defect) | 5/5 = **100%** [56.6, 100] | 97/106 = 91.5% [84.6, 95.5] |
| recall over all 159 defects | 5/159 = **3.1%** [1.4, 7.1] | 97/159 = 61.0% [53.3, 68.2] |
| false alarm on `supported` | 0/105 = **0.0%** [0.0, 3.5] | 9/105 = 8.6% [4.6, 15.5] |
| catches `contradicted` | 2/5 | **5/5** |

Gate A is safe and nearly inert. Every flag it raises is a genuine defect — but it raises five,
against 159 defective claims. **It addresses 3% of the problem.**

Gate B was **not pre-registered** and must not be read as passing anything. On this data it would
exceed the 5% false-alarm bar set for gate A (8.6%, CI [4.6, 15.5]). It is recorded because it is
the most useful thing the probe found and because it is a hypothesis worth a *fresh*
pre-registration on *fresh* data: 61% recall at 91.5% precision, catching **all five**
contradictions, is a different product than gate A.

## Why the blind spot is structural, not a quality problem

**56.8% of `overstated` claims come back `entailment`** (54/95, CI [46.8, 66.3]), and `overstated`
is 36% of all claims — the product's single most common defect.

Given arm 3, this is not the checker being weak. An `overstated` claim's core proposition
genuinely *is* entailed by the paragraph; what is wrong with it is a dropped qualifier or a
widened scope. NLI has three labels and **none of them means "true but overclaimed."** Rung 3 is
therefore *structurally incapable* of catching overstatement — not merely bad at it. No amount of
prompt work or a stronger checker fixes a missing label.

That reframes the earlier n=3 finding. The attribution errors seen then (counsel's submission
stated as law, returning `entailment`) are the same phenomenon: the paragraph does contain the
proposition, uttered by someone whose saying it does not make it law. Entailment is agnostic to
who is speaking.

## Two instrument bugs found by running it, both fixed on this branch

1. **`maxTokens: 64` starved the checker.** "Output STRICTLY this JSON" does not stop a model
   reasoning in prose first, and a response truncated mid-reasoning still has a text part — so
   `ingest/llm.ts` does not throw, and the label merely fails to parse. The failures were **not
   random**: 11 of 16 were `overstated` (36% of corpus) and 0 of 16 were `unrelated` (22% of
   corpus). Truncation deleted the hardest rows and flattered every surviving rate. The first
   report of this probe would have read `overstated → entailment 60.7%` on 84 of 95 and
   `synthetic recall 91.4%` on 35 of 40. Budget raised to 1024; the runner now prints the
   unparsed rows' verdict distribution beside the corpus's, so the same skew cannot hide again.

2. **Raising the budget alone changed nothing.** `CallOpts` are not part of the cache key, so the
   truncated prose replayed forever. `cachedCall` refuses to store an *empty* response for
   exactly this reason but cannot see a non-empty one no parser will accept. Added
   `cacheKeyFor`/`hasCached`/`evictCached`, and in `nli-probe/repair.ts` the rule for when
   eviction can help: only on a **cache hit**. A fresh failure is not retried — temperature is 0,
   so the retry returns identical bytes.

A third failure shaped the instrument without changing a number: a re-run lost 21 calls to an
expired SSO token, printed a matrix identical to the previous run, and **exited 0 with
"VERDICT: SHIP"**. A failed call is not a data point the way an unparsed response is — the
request never reached the model. Any call failure now voids the run before a single rate prints.

## What this does not establish

- **No human labelled anything.** Both label sets are model output.
- **One answerer, one corpus, one seed.** Nothing here generalises to a different answerer.
- **n=5 on natural contradictions.** 2/5 has a 95% CI of [11.8%, 76.9%]. It is a count, not a rate.
- **Arm 2 is an upper bound** on sensitivity, by construction.
- **Gate B is post-hoc.** It has not passed any pre-registered test and is not a recommendation.

## Recommendation

**Do not build gate A.** It is safe, correct, and addresses 3% of the measured defects; the
engineering cost is not repaid by 5 flags in 264 claims.

**Do not build gate B on this evidence either** — but it is the first thing measured on this
project that would move the answer-quality number materially, and it deserves its own spec, its
own pre-registered thresholds, and a fresh eval run to be tested against. Note in advance that
its 8.6% false-alarm rate means roughly one in twelve correct sentences would be flagged, so any
design has to say what happens to a flagged claim — suppressed, softened, or shown with a
caveat — before the number can be judged acceptable.

**Neither gate addresses overstatement**, which is 36% of claims and the largest single defect
class. That needs a different instrument, because NLI has no label for it.
