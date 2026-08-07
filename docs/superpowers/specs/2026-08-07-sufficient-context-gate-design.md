# Sufficient-Context Gate — Design

**Date:** 2026-08-07 · **Branch:** `feat/sufficient-context-gate`
**Answers client question 4** ("can Legal info answer questions correctly") — specifically the
half of it that is currently unanswerable in the negative: *does it know when it cannot?*

## 1. The problem, in the measured numbers

From [`2026-08-06-answer-quality-results.md`](../../research/2026-08-06-answer-quality-results.md)
and [`2026-08-07-nli-rung3-probe-results.md`](../../research/2026-08-07-nli-rung3-probe-results.md),
both merged:

| | |
| --- | --- |
| questions where the model returned `{"claims":[]}` | **0 of 54** |
| false-answer rate on questions the judgment does not address | **93.8%** (15/16) |
| the one refusal that did happen | `unverifiable` — the *mechanical quote check* caught it, not the model |
| responsiveness@para on answerable questions | 50.0% (19/38) |
| claims that exist only because an unanswerable question got answered | 75/266 = **28%** |
| `supported` rate within those 75 | 29.3%, against 47.1% on answerable |

**The architectural fact underneath:** `verifyClaims` asks *"is this quote in this paragraph"*;
the rung-3 NLI probe asks *"does this paragraph entail this claim"*. **Neither has ever seen the
question.** The system therefore cannot distinguish "I answered correctly" from "I said true
things about a document that cannot answer you."

This is not a prompting problem. [`generator.ts:27`](../../../src/lib/cases/caseqa/generator.ts)
already instructs: *"If the judgment does not address the question, output exactly
`{"claims":[]}`."* That instruction is in every one of the 54 prompts and fired zero times.
Prompting has been tried, at scale, and measurably failed.

## 2. Prior art, and exactly what we take from each

**[Sufficient Context (Joren et al., ICLR 2025)](https://arxiv.org/abs/2411.06037)** — the load-bearing one.

- It separates **sufficient** (the material itself contains enough to answer) from **grounded**
  (the answer has a citation). The **22** `unanswerable`-bucket claims that the judge called
  `supported` are exactly that gap: correctly quoted, correctly anchored, and answering nothing.
  (All figures in this spec are from the 2026-08-06 published run. The 2026-08-07 re-run that the
  rung-3 probe used gives 23 — a different draw of the same quantity, not a correction. Mixing
  the two runs at claim level is invalid; one run per document.)
- Their autorater is a *prompted* LLM (Gemini 1.5 Pro, chain-of-thought, one-shot), ≥93%
  agreement with human labels, and it **beat both an entailment baseline (TRUE-NLI) and a
  finetuned rater (FLAMe)**. We take: prompted, not finetuned; and *not NLI* — which independently
  corroborates our own rung-3 finding.
- Their control result: Gemma answers wrongly on 10.2% of questions with **no** context and
  **66.1%** with insufficient context. Retrieval *suppresses* abstention. Our 93.8% is the same
  phenomenon, further along.

**[Self-RAG (Asai et al.)](https://github.com/akariasai/self-rag)** — architectural shape only.
Its `ISREL` (is this passage relevant) and `ISSUP` (is the answer supported) are **two separate
judgments**. We have `ISSUP` twice over and no `ISREL`. We are not adopting reflection tokens or
any training; we are adopting the separation.

**[Magesh et al., JELS 2025 (Stanford RegLab)](https://arxiv.org/abs/2405.20362)** — the reporting
frame. They define accurate as **correct AND grounded**, and score refusals-or-ungrounded
separately as *incomplete*. Reported figures for shipped commercial legal RAG: Lexis+ AI ~65%
accurate, Westlaw AI-AR ~41–42%, Ask Practical Law AI ~19% with >60% incomplete; hallucination
17–33%.
**Verification limit:** the journal text is paywalled and the arXiv PDF and conference copy both
failed to fetch (402/404/403). These figures come from the RegLab summary page and search
snippets, and two snippets disagree slightly on Westlaw (41 vs 42%). **They must not go into any
client-facing material until the paper itself is read.**

Not adopted, and why: [RAGTruth](https://arxiv.org/abs/2401.00396) /
[LettuceDetect](https://arxiv.org/abs/2502.17125) / [Claimify](https://arxiv.org/abs/2502.10855)
all target the *overstatement* defect (36% of claims), which is a separate track. This spec does
not touch it. See §8.

## 3. What is being built

A **sufficiency rater**: given the question and the assembled judgment body, return a binary
`sufficient` label with a short reason. It runs **before generation** and, when it says
insufficient, short-circuits to the failure channel that already exists.

Unit of judgment is the **assembled body**, not a retrieved top-k, because
[`answerCaseQuestion`](../../../src/lib/cases/caseqa/generator.ts) assembles the whole judgment via
`assembleInput(chunks, holding)`. This is single-document Q&A; there is no retrieval step to fix.

**No new product state.** `failKind: "not_addressed"` and its message — *"this judgment does not
appear to address that question"* — already exist and already ship. The gate only makes a
currently-dead branch reachable.

## 4. Ground truth without new annotation, and without circularity

The eval already constructs its questions, so labels come free — but only if the circularity is
handled, and one half of it is not free.

**Arm S (sufficient).** The 38+ answerable questions. Ground truth **by construction**: a target
paragraph is picked first, then the lay question is written from it. Clean. Nothing to control for.

**Arm X (cross-case insufficient).** The existing unanswerable pairs. **Contaminated**: those pairs
were validated by `buildAddressedPrompt` run on the *judge* model
([`cases-caseqa-eval.ts:181`](../../../scripts/cases-caseqa-eval.ts)). Scoring a rater against a
label an LLM produced by answering nearly the same question is measuring self-agreement.
Control: the rater **must not be the judge model**. See §5.

**Arm L (leave-one-out insufficient).** New, and the reason this spec is worth writing. Take an
answerable question and remove **the target paragraph** from the assembled body. Insufficiency is
now created by construction rather than certified by a screen, and the remaining text is
maximally topically similar — the hardest possible negative.

Arm L has its own weakness and it is stated rather than hidden: **removing the target does not
strictly guarantee insufficiency**, because a judgment can state the same proposition twice. This
is not assumed away. Arm L reports its own residual-answerability rate, measured by asking a
*fourth* model whether the stripped body still addresses the question, and that rate is published
as a contamination bound, not subtracted out.

Arms X and L bracket the truth from opposite sides — X is the easy negative with a circularity
bias, L is the adversarial negative with an answerability bias. Neither alone is trustworthy;
reported together they bound the answer. This is the same three-arm discipline as the rung-3 probe.

## 5. Model separation

Four roles, and no model may hold two:

| role | model | why it cannot be the rater |
| --- | --- | --- |
| answerer (under test) | `us.meta.llama3-3-70b-instruct-v1:0` | it is the subject |
| eval judge / built arm X's labels | `us.anthropic.claude-opus-4-5-20251101-v1:0` | self-agreement on arm X |
| question writer | `us.anthropic.claude-sonnet-4-6` | wrote arm S's questions *from* the target paragraphs |
| **sufficiency rater** | **to be determined — see below** | |

The three ids above are the only ones verified invocable for this account by a real one-token
Converse call (`list-inference-profiles` reporting ACTIVE is not the same thing). **Task 1 of the
plan is to probe for a fourth.** If no fourth model is invocable, the rater falls back to
`sonnet-4-6` and the arm-S numbers carry an explicit writer-contamination caveat — the rater would
be grading questions its own family wrote. Arms X and L stay clean under that fallback, which is
why the fallback is acceptable rather than fatal.

## 6. Pre-registered thresholds

Declared here, before any rater response is read, as constants in the module with a test that
pins them — same discipline as `nli-probe/tally.ts`.

The product currently has **false-refusal 0.0%**. Every refusal the gate introduces is a new cost
that did not exist. So:

> **Ship the gate iff** false-refusal on arm S ≤ **5%** **and** projected false-answer on arm X
> ≤ **20%**, against a 93.8% baseline.

Both are defined here so they cannot be computed two ways:

- **false-refusal (arm S)** = of the answerable questions, the fraction the rater labels
  `insufficient`. These are questions the product answers correctly today, so each one is a
  regression the gate causes.
- **projected false-answer (arm X)** = of the cross-case unanswerable questions, the fraction the
  rater labels `sufficient` — because the gate only blocks what it calls insufficient, and
  everything it lets through is answered today at 93.8%. This is an **upper bound** on the new
  false-answer rate (a question the gate passes might still be refused downstream by
  `verifyClaims`, as one was), and the bound is what the threshold is set against. Hitting ≤20%
  therefore requires the rater to label ≥80% of arm X insufficient.

- Arm L: **reported, no threshold.** Its contamination is unquantified until it is run, so binding
  a ship decision to it would be binding it to an unknown.
- Rater parse failures are counted separately from rater *call* failures; any call failure voids
  the run before a rate prints (the guard added in #237).
- If false-refusal exceeds 5% but arm X passes, the outcome is **"tune, do not ship"** — the gate
  works and the operating point is wrong. If arm S passes but arm X does not, the gate is
  **inert** and is not worth wiring, exactly as gate A was not in #237.

## 7. Phase 2 — wiring, conditional on §6

Only if both thresholds pass. Nothing in phase 2 is built before phase 1 reports.

- `answerCaseQuestion` gains one early branch: rate sufficiency; if insufficient, return
  `{ status: "failed", failKind: "not_addressed" }`. No new type, no new message, no UI change.
- Behind an env flag, defaulting **off**, so the eval can measure both arms of the product in one
  run and the change is revertible without a deploy.
- One extra model call per question, before the answer call. On an insufficient question it
  *saves* the answer call, so cost falls on exactly the questions we currently waste it on.

## 8. What this will not fix, stated plainly

- **Overstatement (36% of claims).** Untouched. Needs claim decomposition, not a sufficiency gate.
- **Negation-frame loss (5 contradicted).** Untouched. Those questions *are* answerable; the model
  inverts the holding while answering. A sufficiency gate passes them by design.
- **responsiveness@para 50%.** The gate decides *whether* to answer, not *which paragraph* to cite.
  It may improve the number by removing bad cases from the denominator, which is not the same as
  improving retrieval, and the report must not claim otherwise.

## 9. Risks

- **The gate could be a general refuser.** A rater that says "insufficient" often enough scores
  well on arm X for the wrong reason. Arm S is the control that catches this, which is why its
  threshold is the binding one.
- **Arm L may be too hard to be informative** if residual answerability is high. That is a result,
  not a failure — it would mean the corpus repeats propositions, which is itself worth knowing.
- **No human labelled anything**, here or in the reports this builds on. Every number is
  model-vs-model agreement. This spec does not change that and must not be read as changing it.

## 10. Deliverables

1. `src/lib/cases/sufficiency/` — prompt + parser + tally, pure and tested, thresholds as pinned
   constants.
2. `scripts/cases-sufficiency-eval.ts` — three-arm runner, JSONL rows persisted (as #237
   established), call-failure guard.
3. A model probe establishing the fourth invocable id, or a recorded finding that there is none.
4. `docs/research/2026-08-XX-sufficient-context-results.md` — findings, recommending nothing.
5. Phase 2 wiring **only if §6 passes**.
