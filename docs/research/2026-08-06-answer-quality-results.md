# Answer Quality — Results

**Date:** 2026-08-06 · harness: `AWS_PROFILE=bedrock cases:caseqa-eval:cloud` · seed 1 · corpus as of 2026-08-01
(spec `docs/superpowers/specs/2026-08-03-answer-quality-eval-design.md`)

This is the first measurement of whether **"Ask this judgment"** answers questions correctly —
client question 4. **This report recommends nothing**, matching the four forensics reports before
it. What to do about the findings is a product decision, not a measurement one.

## Headline: the count that must be zero is 5

```
writer   us.anthropic.claude-sonnet-4-6
answerer us.meta.llama3-3-70b-instruct-v1:0   (the product's own model)
judge    us.anthropic.claude-opus-4-5-20251101-v1:0

--- answerable (target paragraph known by construction) ---
  attempted 38 · answered 38 · refused 0 · errored 0
  responsiveness@para  50.0%  (19/38 answered cited the target)
  false-refusal rate   0.0%
  failKinds {}

--- unanswerable (cross-case; correct behaviour is refusal) ---
  attempted 16 · answered 15 · refused 1
  false-answer rate    93.8%  (15/16)
  failKinds {"unverifiable":1}

--- faithfulness (LLM-judged, against the cited paragraph) ---
  [answerable]   191 claims  {supported 90, overstated 72, contradicted 3, unrelated 26}   47.1% supported
  [unanswerable]  75 claims  {supported 22, overstated 24, contradicted 2, unrelated 27}   29.3% supported
  [combined]     266 claims  {supported 112, overstated 96, contradicted 5, unrelated 53}  42.1% supported
  CONTRADICTED 5
  unparsed verdicts 0 / 266

claims dropped by verifyClaims across all answers: 34
```

Every figure above was recomputed from the raw bucket counts before publishing.

## Finding 1 — five published claims reverse what the judgment says

`contradicted` is the one verdict that must be zero: it means the product told a lay reader the
opposite of the court's text. It is **5 of 266 (1.9%)**, 3 of them on answerable questions.

**All three answerable cases were read individually. All three are genuine reversals, not judge
errors.** They share one mechanism — *the judgment rejects a proposition and the claim asserts
it*:

| case | the paragraph says | the claim says |
|---|---|---|
| `1999-bcca-442` | "I am **not persuaded** … that all aboriginal rights issues are to be decided at trial" | "the court decided that the matter **should proceed to trial**" |
| `2018-bcca-276` | the HFN's approach "applies to the **substantive resolution** of claims", **not** to standing | "these criteria **are used to determine** if the group has standing" |
| `2025-fc-415` | the plaintiff "is **not** seeking relief against either Saskatchewan or Alberta and … they are **not** proper parties", and that is "determinative" | "it does **not** automatically mean the province does **not** have to be part of the case" |

The failure is **loss of the negation frame**: `"I am not persuaded that X"` becomes `"X"`. For a
legal-information product this is the most consequential error shape available, because it inverts
a holding while remaining fluent, anchored to a real paragraph, and passing every existing check.

The third also shows a second problem in its own right — a triple-negative sentence published to a
reader the feature exists to serve *because* they have no legal training.

## Finding 2 — the product does not refuse

`false-refusal rate 0.0%` looks like a clean result and is not one. Read it next to the other
bucket:

- On 38 answerable questions: **0 refusals of any kind**, `failKinds {}`.
- On 16 questions about judgments an independent screen confirmed do **not** address them: **15
  answered, 1 refused — 93.8% false-answer rate.**

And the single refusal was `unverifiable`, not `not_addressed`. That distinction is the whole
finding: `unverifiable` means **`verifyClaims` caught it** — the mechanical quote check — while
`not_addressed` would have meant the model recognised it could not answer. **The model returned
`{"claims":[]}` zero times in 54 questions.**

So refusal is not well-calibrated; refusal barely happens. The only brake on an answer to an
unanswerable question is the verbatim-quote check, and that brake is about whether a *quotation*
exists, not about whether the judgment addresses the *question*.

This is consistent with `unanswerable` faithfulness: 27 of 75 claims `unrelated` (36%), against 26
of 191 (14%) on answerable questions. When it answers a question the judgment does not address, it
produces claims that are anchored but about something else.

## Finding 3 — the `overstated` rubric hypothesis is refuted

Two earlier smoke runs left this open, and I flagged it twice as undecided: `overstated` was the
largest non-supported bucket, and the product's prompt demands "plain language a non-lawyer
understands" — which drops qualifiers by nature, close to the rubric's definition of overstated. So
the bucket might have been the judge penalising the product for following its instructions.

**It is not.** `overstated` is 96 of 266 (36.1%), and the three sampled rows are all genuine:

- `2002-bcsc-1199 para-4` — the paragraph reports **counsel's submission** ("Counsel says that…");
  the claim states it as law ("The law does not require…"). Asserting an argument as a holding.
- `2002-bcsc-1199 para-6` — the paragraph says the court *could* consider an application under
  R.15; the claim asserts a negative the paragraph never states ("the remedy does **not** lie in
  joining the action").
- `2013-bcca-326 para-102` — the claim appends "which is a generally recognized valuation
  methodology", absent from the paragraph.

Six samples were inspected in total across `contradicted` and `overstated`, and **all six verdicts
were correct**. The rubric is not the problem. Combined, **52.9% of answerable claims are not
`supported`.**

## Finding 4 — how an anchored claim can be unrelated to its own paragraph

`unrelated` is 53 of 266 (19.9%). The mechanism is worth naming because it is not obvious that it
is even possible: `verifyClaims` guarantees the **quote** is verbatim in the cited paragraph, but
`text` and `quote` are written independently by the model. So the model can compose a `text` about
one thing, pair it with a quotation that genuinely exists somewhere, and the anchor points at the
quotation's home paragraph — which need not support the `text` at all.

All three sampled `unrelated` rows come from `2017-bcsc-899`: claims about the injunction test and
the balance of convenience, anchored to paragraphs about piecemeal project-by-project decisions,
about pleading with clear and specific language, and to a quotation *from a different case*. This
is exactly the gap spec §2 named — "nothing checks that the published plain-language `text`
faithfully represents its source" — and this is its mechanism.

(Those three rows are the first three encountered, not a random draw from the 53.)

## Sample integrity — the denominators held

The instrument's own guards behaved, which is what makes the numbers above readable:

- **Stage 1 rejected 81 paragraphs** by the line-shape test across 40 cases examined, and killed
  **zero** whole cases. The front-matter filter is doing real work without costing sample size —
  the caption bug that motivated it does not recur.
- **Stage 2 rejected 1 case** as not substantive; the substance screen was unparseable 0 times.
- **1 answerable question dropped** because its ground-truth paragraph fell outside
  `assembleInput`'s budget — excluded rather than scored as a product failure.
- **4 unanswerable pairs discarded** because the screen found the target case *does* address the
  question. That is §5's validation working: counting them would have inflated the false-answer
  rate with correct answers. It also means that rate rests on **16**, not 20.
- **0 lexical gimmes, 0 malformed questions, 0 unparsed verdicts in 266 judgments.**

## What this cannot establish

- **Not practitioner-validated.** Faithfulness is LLM-judged.
- **The judge selected the sample it then graded.** Spec §8: stage 2 and faithfulness are the same
  model, so if it prefers passages whose propositions it finds easy to verify, `supported` is
  **optimistically biased** — and unfalsifiable from this output, because a stage-2-rejected target
  is never scored. The direction of that bias means the true `supported` share is more likely below
  47.1% than above it.
- **Questions are synthetic**, derived from paragraphs in our own corpus. They cannot reveal what
  real users ask and miss. The product has no users yet.
- **n = 38 answerable, 16 unanswerable.** `responsiveness@para` read 50.0% here and 50.0% on a
  6-case smoke, but 16.7% on another 6-case smoke — the answerer is deliberately uncached, so
  run-to-run variance at small n is large. 38 is better, not precise.
- **The false-answer rate rests on a judge's view** of whether a case addresses a question, on 16
  pairs.
- **Not a measure of retrieval.** This asks about one judgment at a time; finding the right case is
  `2026-08-03-retrieval-eval-production-searcher.md`.

## Open

- **`contradicted 5` is user-facing.** The feature is live. Nothing in this report decides what to
  do about that.
- **The negation-loss shape in Finding 1** is specific enough to be testable directly — a targeted
  probe on judgments containing "I am not persuaded", "does not follow", "cannot be said" would
  measure it far more cheaply than a 490-call eval.
- **`text` is never checked against its own `quote`.** Finding 4's mechanism is unguarded in
  production: the verifier validates the quotation, not the sentence built beside it.
- **Client question 4 now has a number**, and the number is not reassuring. It is also not the
  "accuracy %" a report to the client would want, for the reasons above.
