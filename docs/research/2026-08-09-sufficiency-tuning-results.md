# Sufficiency Rater Tuning — Results

**Date:** 2026-08-09 · dev run `2026-08-08T01-33-55-183Z` · **held-out test run `2026-08-09T04-35-37-863Z`, attempt 1**
(spec `docs/superpowers/specs/2026-08-07-sufficiency-tuning-design.md`)

**This is not ground truth. No human read any judgment.** Arm S's labels are constructed, arm X's
come from an LLM screen, every rating is model output. **This report recommends nothing.**

## Headline: the held-out number is worse than the tuned number, and that is the point

```
CHOSEN ON DEV      P1/us.amazon.nova-pro-v1:0   false refusal 10.3% (4/39)
HELD-OUT TEST      P1/us.amazon.nova-pro-v1:0   false refusal 16.7% (13/78)   CI [10.0%, 26.5%]   bar 5%   FAILS
                                                leakage        0.0% (0/27)   CI [ 0.0%, 12.5%]   bar 20%  clears
VERDICT (point estimate, same rule as #239): TUNE-DO-NOT-SHIP
```

The dev figure was the **minimum over five configurations**. Selecting a minimum biases it
downward — the winner's curse — which is the entire reason the test split exists. Reporting 10.3%
would have understated the honest rate by **6.4 points**.

The two intervals overlap ([4.1, 23.6] on dev against [10.0, 26.5] on test), so sampling noise
alone could produce this gap; the direction is nevertheless exactly what selection bias predicts,
and the held-out number is the one without the bias. **16.7% is the number.**

This is the clearest justification the apparatus has produced for itself. Without the split we
would have published 10.3% in good faith.

## The dev grid

Stage 1 (prompt held at P0), then stage 2 (prompt varied at stage 1's winner):

| configuration | false refusal (n=39) | 95% CI | leakage (n=20) |
| --- | --- | --- | --- |
| P0/`nova-pro` — the #239 baseline | 28.2% | [16.5, 43.8] | 0.0% |
| P0/`llama4-maverick` | **7.7%** | [2.7, 20.3] | **25.0%** — disqualified |
| P0/`nova-lite` | 71.8% | [56.2, 83.5] | 0.0% |
| **P1/`nova-pro`** — chosen | **10.3%** | [4.1, 23.6] | 0.0% |
| P2/`nova-pro` | 10.3% | [4.1, 23.6] | 0.0% |

**The "definitive" hypothesis holds.** #239 observed that all ten of its refusals gave the same
reason — *"does not provide a **definitive** answer"* — using the prompt's own word, and recorded
that as *an observation about the prompt, not a measured cause*. Removing the word (P0 → P1, same
model, same questions) moved false refusal **28.2% → 10.3%** with leakage unchanged at 0.0%. It is
now measured.

**P2 bought nothing.** Identical to P1 at 4/39. Its extra instruction — that the judgment need not
phrase the answer the way the question does — changed no decision.

**The selection ordering earned its keep.** `llama4-maverick` had the lowest false refusal in the
whole grid at 7.7%, and leaks 25% of unanswerable questions. Filtering on leakage *before*
minimising refusal disqualified it before the two were ever compared. Had the order been reversed
it would have won, and the gate would let one unanswerable question in four through.

## What the gate is actually worth now

Against the product's measured baseline of **93.8%** false answers on unanswerable questions:

| | current product | this gate |
| --- | --- | --- |
| answers a question the judgment cannot answer | 93.8% | **0.0%** (0/27, CI upper 12.5%) |
| refuses a question it could answer | 0.0% | **16.7%** (CI [10.0, 26.5]) |

The catch side is now measured on held-out data across three separate runs (0/16, 0/20, 0/27) and
has never leaked once. The cost side is the blocker: roughly **one correct answer in six** would be
refused. That is not shippable, and it is not close.

## Pre-registration deviation, disclosed

`cohere.command-r-plus-v1:0` was in the registered grid and was **removed mid-experiment**. Bedrock
began refusing it:

> Access denied. This Model is marked by provider as Legacy and you have not been actively using
> the model in the last 30 days.

All **59** of its calls were denied, so it produced **zero ratings**. Removing a configuration that
contributed no data cannot move the selection toward or away from any result — that is the only
thing that makes this defensible. **A model dropped because its numbers were unwelcome would
invalidate the experiment.** Stage 1 was therefore three raters, not four.

It also falsified an assumption behind `cases-probe-models.ts`: that script exists because
`list-inference-profiles` reporting ACTIVE does not mean invocable, and this shows that **invocable
at probe time does not mean invocable later**. The probe reported this exact id as INVOCABLE hours
before the 59 denials. The chosen rater was re-probed immediately before the test run.

## An instrument bug that made the central guarantee unverified

The dev/test split is the experiment's whole claim to rigour, and the guard protecting it —
introduced as the fix for a *blocking* review finding — **verified nothing**.

`persist()` writes `kind: "dev"`; the guard read `h.mode`. `undefined !== "dev"` is true for every
row ever written, so it skipped every file, printed

```
held-out split: no prior dev run on disk — SPLIT NOT VERIFIED against dev
```

and **spent the test set anyway**. A check that cannot match is bad; one that then lets the run
proceed is worse.

**The split was verified by hand afterwards and is correct:**

```
testS identical: true (78 / 78)      testX identical: true (27 / 27)
dev-tuned questions appearing in the test arm: 0
seed 1 both runs · nAnswerable 120 both · nUnanswerable 60 both
```

So this run's numbers stand. But they stood on luck rather than evidence at the moment they were
produced, and that is worth recording plainly.

Fixed: the predicate is now `isDevHeader()` in `sufficiency/split.ts`, tested against a header
built the way `persist()` builds one, so a field rename on either side breaks the test. A failure
to verify is now **fatal** rather than a warning — a run that cannot confirm its held-out claim
must not spend the held-out set.

## What this does not establish

- **No human labelled anything.** Every label and every rating is model output.
- **One rater family, one corpus, one seed.** `nova-pro` at P1 is not "the" operating point.
- **Arm X is n=27 on test.** 0/27 has a 95% upper bound of 12.5%. Excellent, and not zero.
- **The P0 → P1 comparison is controlled on dev but not on test.** No held-out P0 number exists;
  #239's 26.3% came from a different, smaller question set (n=38). The improvement is real on dev
  and indicative on test, not measured on test.
- **Arm X retains the circularity** the spec named: its labels came from the judge. The rater is a
  different model, which is the control, but the labels remain one model's opinion.
- **The grid was three raters and three prompts**, not the registered four and three.

## Where this leaves client question 4

The product answers 93.8% of the questions it cannot answer. A gate now exists that has never let
one through in 63 held-out unanswerable questions across three runs — and it would refuse about one
correct answer in six.

**Neither number is shippable on its own, and together they define the remaining work precisely:**
the catch side is solved; the cost side needs another factor of three. Under the pre-registered
rule this test set is spent — a failing result does not license choosing another configuration and
testing again, because that turns the held-out set into a second dev set. **A further attempt needs
a fresh test set**, which is available by changing the seed or expanding the corpus.
