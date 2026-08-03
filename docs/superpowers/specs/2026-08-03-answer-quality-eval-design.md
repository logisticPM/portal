# Answer-Quality Evaluation — Design

**Date:** 2026-08-03 · **Branch:** `feat/answer-quality-eval` · RM-3, sub-project B

**Goal:** measure whether "Ask this judgment" answers questions correctly, so client question 4
has an answer backed by a number instead of an assurance.

**Prior art on this branch:** `docs/research/2026-08-03-canlegalragbench-assessment.md` closed
the external-benchmark route on evidence. No expert-labelled dataset covers our domain, and this
project has no licensed practitioner, so an LLM-judge limitation cannot be removed by buying
data. The design below responds by **shrinking the judge's role to the smallest defensible
share** rather than by disclaiming it.

---

## 1. What is already guaranteed, and therefore not measured here

`answerCaseQuestion` (`src/lib/cases/caseqa/generator.ts`) assembles the judgment by paragraph,
asks for 1–6 claims of `{text, quote, paragraph}`, then runs `verifyClaims`, which **discards any
claim whose quote is not verbatim (or near-exact and uniquely located) in a real paragraph**.
Zero surviving claims ⇒ refusal, in one of four kinds: `no_full_text`, `unparseable`,
`not_addressed`, `unverifiable`.

So *"the quotation is real"* is a structural property. This spec does not re-measure it.

## 2. The three gaps

| gap | why it is invisible today |
|---|---|
| **Faithfulness** | The verifier checks the `quote`. Nothing checks that the published plain-language `text` faithfully represents its source. A model may locate a genuine paragraph and then overstate, reverse, or embellish — every existing check passes. |
| **Responsiveness** | Claims can be true, verbatim-anchored, and about something other than what was asked. |
| **Refusal correctness** | `not_addressed` fires whenever the model returns `{"claims":[]}`. A **false refusal** — the judgment does address the question, the model said otherwise — is invisible and silently costs the reader an answer. |

Faithfulness is the analogue of CanLegalRAGBench's reported **8–29% of claims not supported by
retrieved documents**, and is the one gap with an external number to sit beside.

## 3. Known-answer construction

**Pick the paragraph first, then write the question for it.** For a case with full text, select a
target paragraph, and have a model write a realistic first-person lay question that this
paragraph answers. The target paragraph is then ground truth **by construction** — no human
labelling, no judge.

### Sampling, stated exactly so a re-run reproduces the set

- **Population:** `listCases({ tier: "core" })` filtered to cases with ≥1 chunk. Core tier
  because that is what the product exposes a Q&A affordance on.
- **Cases:** **40**, drawn by seeded shuffle (`EVAL_SEED`, default `1`) so the set is
  reproducible and re-running after a prompt change measures the same questions.
- **One target paragraph per case**, drawn by the same seeded shuffle from that case's
  paragraphs of **≥300 characters**. The floor excludes procedural one-liners ("Appeal
  dismissed.", "Costs to the respondent."), which no lay question can be built from and which
  would score as construction failures rather than product failures.
- **Unanswerable set:** **20**, formed by pairing the first 20 constructed questions with a
  case drawn — same seed — from the 40 excluding its own source case, then validated per §5.
- Every count above is printed in the provenance line, so a set that shrank through discards is
  visible rather than silently smaller.

This is what makes three of the four metrics objective. It is the central design decision, and
its cost is stated in §8: questions are synthetic, so they measure the system against questions
*derived from the corpus* rather than against questions real users would ask.

### Question register

First-person, non-doctrinal, the way a member of the public writes. Borrowed from
CanLegalRAGBench's query style, which draws on users of public-facing legal assistants.

Not this (the register of `src/lib/cases/validate/eval-queries.ts`, which is a *retrieval* set):
> "Does the Crown owe a trust-like obligation when managing reserve land or resources?"

This:
> "Our band council found out the government leased our reserve land for way under market rate
> back in the 70s. Is that something they can be held responsible for now?"

## 4. Metrics

Let `A` = answerable questions (built per §3), `U` = unanswerable questions (§5).

| metric | definition | objective? |
|---|---|---|
| **responsiveness@para** | of `A` answered, the share whose claims cite the known target paragraph | **yes** |
| **false-refusal rate** | of `A`, the share refused — broken down by `failKind` | **yes** |
| **false-answer rate** | of `U`, the share *answered* rather than refused | **yes** |
| **faithfulness** | of all published claims, the share whose `text` is entailed by its cited paragraph | judge |

Reported alongside, not as quality metrics but because they condition every number above:
`droppedClaims` per answer, `bestOverlap` on `unverifiable` failures, and the `failKind`
distribution.

**Responsiveness is scored on citing the target paragraph, not on citing *only* it.** An answer
that cites the target plus two neighbouring paragraphs is responsive. Requiring exclusivity
would penalise a fuller answer, which is not the failure mode being measured.

## 5. Unanswerable questions

Take a question constructed for case A and ask it of case B. Correct behaviour is refusal, so
any answer is a false answer.

**Validation is mandatory, not optional.** A question about consultation duties transplanted
between two consultation cases may be genuinely answerable by the target. Before a pair enters
`U`, a judge pass must confirm the target case does not address the question; pairs it cannot
clear are **discarded, not counted as either**, and the discard count is reported. Skipping this
would inflate false-answer rate with correct answers.

## 6. Judging faithfulness

**Against the cited paragraph, not the quote.** Two reasons:

1. The quote is gone. `CitationAnchor = { text, sourceParagraph, sourceUrl, matched? }` — no
   quote field, by design, because the model's quotation is a locator that is discarded once it
   has found a paragraph. Judging against it would require the harness to intercept generation.
2. The paragraph is what the product shows. The reader's link points at `sourceParagraph`, so
   "is this sentence supported by that paragraph" is exactly the check a reader can perform.

**Cost, stated:** a paragraph carries more than its quote, so this is more permissive than
judging against the quote. A `text` supported by a *different sentence* of the same paragraph
passes. That is acceptable because the reader can verify it; it is recorded as a limitation.

**Verdicts:** `supported` · `overstated` · `contradicted` · `unrelated`. Four rather than a
boolean, because "not supported" bundles a hedge-stripped overstatement with a reversal of the
holding, and those are different product defects. `contradicted` is the one that must be zero.

**Model separation is a hard requirement.** The judge must not be the answering model.
`SUMMARY_MODEL` defaults to `us.meta.llama3-3-70b-instruct-v1:0`; the judge is a Claude model on
Bedrock. A model grading its own output measures self-consistency.

## 7. Guards against the harness fooling itself

Each is a test, not a comment.

1. **Generator ≠ answerer ≠ judge** for question construction, answering, and faithfulness. The
   runner asserts the three model ids are distinct and aborts if not.
2. **Lexical-gimme rejection.** A constructed question sharing a verbatim run of ≥40 characters
   with its target paragraph is discarded. Otherwise the retriever wins on string overlap and
   responsiveness measures nothing.
3. **Empty-population abort.** Zero constructed questions, or zero cases with full text, exits
   non-zero. `cases-eval.ts` shipped a full scorecard of zeros with exit 0 on 2026-08-02; that
   must not recur.
4. **Reconciliation.** `answered + refused + errored === attempted`, per bucket, asserted before
   any metric prints. The anchor-signals runner gained the same gate after a column mis-sum.
5. **Provenance line.** Every run prints the three model ids, the corpus `asOf`, question counts
   per bucket, and the discard counts from §5 and guard 2 — before the metrics.

## 8. What this cannot establish

- **Not practitioner validation.** Faithfulness is LLM-judged. CanLegalRAGBench's own conclusion
  warns about "the limitations of automatic evaluation of relevance and accuracy", and that
  caution applies here rather than being discovered later.
- **Questions are synthetic.** Derived from paragraphs in our own corpus, so they cannot reveal
  what real users ask and miss. The product has no users yet, so no alternative exists.
- **Single-case only.** `answerCaseQuestion` answers from one judgment. Cross-case synthesis is
  not in this instrument because it is not in the product.
- **Faithfulness is judged permissively**, per §6.
- **Responsiveness is not correctness.** Citing the target paragraph shows the answer came from
  the right place, not that a lawyer would call it right.

## 9. Units

| file | responsibility | pure? |
|---|---|---|
| `src/lib/cases/caseqa-eval/construct.ts` | target-paragraph selection, question-construction prompt, lexical-gimme rejection | pure except the prompt string |
| `src/lib/cases/caseqa-eval/judge.ts` | faithfulness + unanswerability prompts, verdict parsing | pure parsing; caller makes the call |
| `src/lib/cases/caseqa-eval/metrics.ts` | the four metrics, reconciliation assertions | pure |
| `scripts/cases-caseqa-eval.ts` | runner: construct → answer → judge → report, with §7 guards | I/O |
| `scripts/test-cases-caseqa-eval.ts` | unit tests over the three pure modules | — |

`caseqa/` is untouched. This instrument observes it and does not modify the product path.

## 10. Scale and cost

40 answerable + 20 unanswerable, per §3. Worst case: 40 construction calls, 60 answer calls at up
to 2 each (120), 20 unanswerability checks, and 240 faithfulness judgments (60 answers × the
6-claim cap) — under 450 calls. Cheap enough to re-run as a regression gate, which is the point:
the number must be reproducible after a prompt or model change.

**Caching.** Construction and judging go through the same `cachedCall` the summarizer uses
(`sha256(modelId + "\n" + prompt)`), so a re-run after changing only the *answering* model
replays the question set and the judgments instead of regenerating them. Answer calls are
deliberately **not** replayed from cache when the answering model or prompt changes — that is
the thing under measurement.

## 11. Success criteria

- Four metrics printed with their denominators, from a run whose provenance line names three
  distinct models.
- `contradicted` count published, whatever it is.
- Every guard in §7 covered by a test that fails when the guard is removed.
- A findings doc stating what the numbers are and, per the pattern of the three preceding
  forensics reports, **recommending nothing**.
