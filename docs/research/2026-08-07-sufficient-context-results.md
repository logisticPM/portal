# Sufficient-Context Gate — Results

**Date:** 2026-08-07 · harness:
`AWS_PROFILE=bedrock SUFFICIENCY_RATER=us.amazon.nova-pro-v1:0 npm run cases:sufficiency-eval:cloud`
(spec `docs/superpowers/specs/2026-08-07-sufficient-context-gate-design.md`)

**This is not ground truth. No human read any of these 92 ratings.** The labels are constructed
(arms S and L) or produced by an LLM screen (arm X); the ratings come from a fourth model.
**This report recommends nothing** — what to do about the findings is a product decision.

## Provenance

```
writer    us.anthropic.claude-sonnet-4-6                 (wrote arm S's questions)
judge     us.anthropic.claude-opus-4-5-20251101-v1:0     (built arm X's labels; ran arm L's residual check)
answerer  us.meta.llama3-3-70b-instruct-v1:0             (the product's model — not used here)
RATER     us.amazon.nova-pro-v1:0                        (the thing under test)

construction: 39 answerable · 16 unanswerable (seed 1) · 1 skipped, target dropped by the assembly budget
target attrition:   substance screen 1 · unparseable 0
question attrition: writer empty 0 · malformed 0 · lexical gimme 0
pairing attrition:  discarded 4 · screen unparsed 0 · exhausted 0
92 ratings · 0 unparsed · 0 call failures · 0 cache evictions
```

Four roles, four different models, enforced by a guard that refuses to start otherwise. `rater ==
judge` is rejected unconditionally — that pairing would have scored the rater against labels the
judge itself produced. The probe (`cases:probe-models:cloud`) found 8 invocable ids; `nova-pro`
was chosen because it shares a vendor with neither the Anthropic writer/judge nor the Meta
answerer, so the separation is by family and not merely by id string.

Construction was cross-checked against the persisted rows of the 2026-08-07 eval run: **54 qids
matched, zero drift**. Note what that does and does not establish — construction is reproducible;
it is *not* a check against the 93.8% baseline, because that run (2026-08-06) persisted no rows.

## Result: the pre-registered rule fails on the arm it was built to protect

```
arm S  false refusal            10/38 = 26.3%   95% CI [15.0%, 42.0%]   max 5.0%    FAIL
arm X  projected false answer    0/16 =  0.0%   95% CI [ 0.0%, 19.4%]   max 20.0%   PASS
VERDICT: TUNE-DO-NOT-SHIP
```

Both halves matter and they point in opposite directions.

**The gate works.** Zero of sixteen cross-case questions leaked through, against a measured
product baseline of **93.8%** (15 of 16 answered). On the thing the whole exercise exists to fix,
this rater did not make a single mistake.

**And it is unusable as configured.** It refuses **26.3%** of questions that are answerable *by
construction*. The product's current false-refusal rate is **0.0%**, so every one of those is a
new failure on a question the product answers correctly today. The lower bound of the interval is
15% — three times the bar — so this does not turn on sample size.

That combination is exactly what `tune-do-not-ship` was pre-registered to mean: the signal is
real, the operating point is wrong, and it is not a dead end. It is also the reason the decision
function has four outcomes instead of two.

## Arm L did not work, and that is the most useful thing here

Arm L deletes the target paragraph, so insufficiency is supposed to be created by construction
rather than certified by a screen. It measures its own contamination rather than assuming it away,
and the contamination is fatal:

```
rater says sufficient        23/38 = 60.5%   95% CI [44.7%, 74.4%]
judge says STILL ADDRESSED   33/38 = 86.8%   95% CI [72.7%, 94.2%]
```

**Removing the target paragraph left the question answerable 87% of the time.** Arm L's "ground
truth" is wrong for roughly six of every seven items, so its number cannot be read as the rater
missing 23 negatives — most of those 23 were not negatives.

This is a design failure, not a rater failure, and it was predicted as a risk in the spec: *"a
judgment can state the same proposition in more than one paragraph."* The measurement says the
risk dominates. Two mechanisms, both pushing the same way: judgments restate holdings across
paragraphs, and the lay questions are general enough that other paragraphs bear on them.

**Leave-one-out is not a usable negative construction for this corpus.** Anything built on it —
here or later — needs a different design. Recording that saves the next attempt.

Note also that the rater was *more* conservative than the judge on the same texts (60.5% called
sufficient vs 86.8% called addressed). The two are answering different questions, so this is not a
disagreement rate, but it is consistent with arm S: this rater errs strict.

## A hypothesis I tested and had to drop

Reading the ten false refusals, they looked like compound questions — several ask two things
("what does deep consultation involve? **And** does the government have to change the project?")
where the target paragraph answers one. That would have made the ground truth, not the rater,
wrong.

It does not hold:

```
false refusal, multi-question  (>1 "?")   2/7  = 28.6%   95% CI [ 8.2%, 64.1%]
false refusal, single question           8/31 = 25.8%   95% CI [13.7%, 43.2%]
```

Nearly identical, intervals almost entirely overlapping. **The refusals are not explained by
compound questions.** The impression from ten samples was wrong, and the split is reported here so
it is not re-proposed later.

## What the rater's own reasons show — an observation, not a measurement

Every one of the ten refusals uses the same construction: *"does not provide a **definitive**
answer."* That is the prompt's own word — it instructs `sufficient: true` only if the text
"contains the information needed to give a definitive answer." The rater appears to be applying it
literally.

**This is a hypothesis about the prompt, not a measured cause**, and it names the obvious next
experiment: relax "definitive", or raise the rater to a stronger model, and see where the
operating point moves. Neither has been tested. **Any such change requires its own
pre-registration on fresh thresholds** — re-running with a softened prompt and reporting the
better number against *these* thresholds would be exactly the discipline failure this project's
method exists to prevent.

## What this does not establish

- **No human labelled anything.** Arm S's labels are constructed, arm X's come from an LLM screen,
  and every rating is model output.
- **One rater, one corpus, one seed.** `nova-pro`'s operating point is not "the" operating point.
  Seven other invocable models were not tried.
- **Arm X is n=16.** 0/16 has a 95% upper bound of **19.4%** — just inside the 20% threshold it
  passed. The catch rate is excellent and the interval is wide; it is not evidence of zero leakage.
- **Arm X retains a circularity** the spec named: its labels came from the judge. The rater is a
  different model, which is the control, but the labels are still one model's opinion.
- **Arm L is void**, for the reason above.
- **The 93.8% baseline is a different run** (2026-08-06) from the one construction was
  cross-checked against (2026-08-07). Same seed and same construction code, so the question set
  should be identical — but that identity is inferred, not verified, because the baseline run
  persisted no rows.

## Where this leaves client question 4

The product answers 93.8% of questions it cannot answer. This measurement shows a rater exists
that would have caught **all sixteen** of those, and that the version tested would also refuse
about a quarter of the questions it currently gets right.

So the gate is worth pursuing and is **not** ready to wire in. The next step is a tuning
experiment with its own pre-registered thresholds — not a re-run of this one.
