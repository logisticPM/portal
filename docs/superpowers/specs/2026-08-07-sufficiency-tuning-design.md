# Sufficiency Rater Tuning — Design

**Date:** 2026-08-07 · **Branch:** `feat/sufficiency-tuning`
**Follows** [`2026-08-07-sufficient-context-results.md`](../../research/2026-08-07-sufficient-context-results.md) (merged, #239).

## 1. What we know and what is left

The gate catches everything and refuses too much:

```
arm S  false refusal          10/38 = 26.3%   CI [15.0, 42.0]   bar  5%   FAIL
arm X  projected false answer  0/16 =  0.0%   CI [ 0.0, 19.4]   bar 20%   PASS
verdict: TUNE-DO-NOT-SHIP
```

The task is to find a configuration that keeps arm X's catch rate and brings arm S's false
refusal under 5% — and to report that on data **never used to choose it**.

## 2. The methodological problem this spec exists to solve

We now have data. Tuning a prompt against the same 38+16 questions and reporting the improved
number is fitting to the test set: the number stops meaning anything, and this project's entire
method rests on reported numbers meaning something.

**Therefore: a seeded, disjoint dev/test split, made once, before any rating.** All tuning looks
only at dev. The single chosen configuration runs on test **once**, and that is the reported
result.

**The rule that makes it work, pre-registered here:** if the test result fails, we do **not** go
back and pick a different configuration. Doing so converts test into a second dev set and the next
number would be worthless. A failure means the tuning direction was wrong and the next attempt
needs a fresh test set.

## 3. Sizing, driven by what a 5% bar can actually be measured against

Wilson 95% upper bounds on arm S:

| observed refusals | n=38 | n=50 | n=80 | n=100 |
| --- | --- | --- | --- | --- |
| 0 | 9.2% | 7.1% | **4.6%** | 3.7% |
| 1 | 13.5% | 10.5% | 6.7% | 5.4% |
| 2 | 17.3% | 13.5% | 8.7% | 7.0% |

**n=73 is the smallest arm-S size at which a perfect result clears a 5% upper bound.** At n=80,
zero refusals gives an upper bound of 4.6% and clears it.

**One refusal at n=80 is `inconclusive`, not a failure**, and the distinction is load-bearing.
1/80 is a point estimate of 1.25% with a CI of **[0.22%, 6.75%]** — the upper bound sits above the
bar but the lower bound is far below it, so the data cannot distinguish a rate under 5% from one
over it. That is *"we cannot tell at this n"*, not *"we proved it is too high"*.

An earlier draft of this spec wrote that one refusal "does not clear" the bar, and the plan's test
then asserted `classify(1, 80, 0.05) === "fails"` — conflating *the upper bound exceeds the bar*
with *the rate exceeds the bar*. That conflation is precisely what `classify` exists to prevent,
so a test asserting it was self-defeating. Caught by the Task 4 implementer.

The bar is demanding and that is a property of the bar, not a flaw in the plan — stating it now
prevents a post-hoc argument that "1 of 80 is basically 5%". It equally prevents the opposite
error: treating an inconclusive result as a proven failure.

Arm X is cheap by comparison: 0/40 gives an upper bound of 8.8%, comfortably inside 20%.

**Sizes:**

| | dev | test | total |
| --- | --- | --- | --- |
| answerable (arm S) | 40 | **80** | 120 |
| cross-case (arm X) | 20 | 40 | 60 |

`pickTargets` draws at most one target per case, so 120 answerable questions needs **120 eligible
core cases**. That ceiling is **unverified** — the pool probe could not run because the SSO token
expired. The implementation must measure it first and abort with the actual count if short, rather
than silently drawing fewer and reporting rates over a smaller n.

## 4. Arm L is dropped

Leave-one-out was measured and does not work on this corpus: after deleting the target paragraph,
an independent model still judged the question answerable **33/38 = 86.8%** of the time. Its ground
truth is wrong for six of every seven items.

`src/lib/cases/sufficiency/arms.ts` and its tests are **deleted**, not left dead. The knowledge
lives in the merged findings doc; unreachable code with load-bearing-looking tests is worse than
no code. Negative-side power comes from arm X growing 16 → 60 instead.

## 5. The configuration grid, pre-registered

Open-ended fiddling until something passes is the failure mode. The grid is fixed here, and it is
**staged** to keep the call budget sane:

**Stage 1 — model, prompt held at P0 (the current one).** Four raters, none of which may be the
writer, judge, or answerer:

| id | note |
| --- | --- |
| `us.amazon.nova-pro-v1:0` | the #239 baseline |
| `us.meta.llama4-maverick-17b-instruct-v1:0` | shares a vendor with the answerer — allowed, recorded as weaker separation |
| `cohere.command-r-plus-v1:0` | |
| `us.amazon.nova-lite-v1:0` | |

`us.deepseek.r1-v1:0` is excluded by design: it is a reasoning model and this prompt already asks
for reasoning before the label, which is exactly the budget-starvation shape that cost #237 an
entire arm.

**Stage 2 — prompt, model held at stage 1's winner.** Two variants beyond P0:

- **P0** — current. Requires the text to support a *"definitive answer"*.
- **P1** — drops "definitive": sufficient if the text answers the substance of the question, even
  if it does not resolve every sub-part or state a general rule. This targets the observation that
  all ten #239 refusals used the prompt's own word.
- **P2** — P1 plus an explicit reminder that the judgment need not phrase the answer the way the
  question does.

Each variant gets a distinct id string baked into the prompt so cache keys differ and no variant
can silently replay another's responses.

**Six configurations total.** Not "until something works".

## 6. Selection and reporting rules, pre-registered

**On dev:** choose the configuration with the lowest arm-S false refusal *among those with arm-X
projected false answer ≤ 20%*. Tie-break on lower arm X. If no configuration qualifies, report
that and stop — do not relax either bar.

**On test:** run the one chosen configuration once. Thresholds are unchanged from #239 — false
refusal ≤ 5%, projected false answer ≤ 20% — so this is comparable to the published result.

**Primary rule uses the point estimate**, exactly as #239 did. Changing to an interval-based rule
now would be moving the goalposts mid-experiment, even though it moves them in the harder
direction.

**Secondary rule, added now and reported alongside:** if the 95% CI on arm S straddles 5%, the
outcome is labelled **`inconclusive-at-this-n`** whichever side the point estimate falls, and
shipping requires a larger test set. This adds honesty without moving the bar.

## 7. Guards

- **Four roles, four models.** Unchanged, including the unconditional refusal of `rater == judge`.
- **The split is computed from a seed and printed** before any rating, so a reader can verify dev
  and test are disjoint and that nothing migrated between them.
- **Test runs are logged.** Every test-mode run appends to a manifest recording the configuration
  and timestamp, and the runner prints all prior test runs at startup. A second test run cannot
  quietly become "the" result.
- **Call failures void the run** before any rate prints. Unchanged from #239.
- **Attrition is counted and persisted**, not just printed.

## 8. What this will not do

- It will not address **overstatement** (36% of claims) or **negation-frame loss**. Different
  instruments; still open.
- It will not wire anything into the product. Phase 2 remains conditional on a passing test result.
- It cannot establish that the rater is *right*, only that it agrees with constructed labels. No
  human reads any judgment in this experiment.

## 9. Cost

Roughly 360 dev ratings (6 configs × 60) + 120 test ratings, plus construction for 180 questions.
Prompts carry the whole judgment, so these are large calls. Construction is cached and shared with
the existing eval; ratings are not shared across configurations by design.
