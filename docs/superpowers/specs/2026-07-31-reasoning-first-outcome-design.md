# Reasoning-First Outcome Classification + Labelled Eval Set — Design

**Date:** 2026-07-31 · **Status:** proposed (design), pre-implementation
**Supersedes the model-swap hypothesis.** Combines roadmap items RM-5 (reasoning-first schema) and
RM-3 (eval set), because neither is worth doing without the other: the prompt change cannot be
validated without labels, and labels are worthless without something to validate.

**Prior work:** `2026-07-30-outcome-backfill-design.md` shipped the classifier (PR #209). It produced
296 classified cases out of 559, with 204 winType disagreements between the two models.

## What the evidence says

A measured bake-off on 2026-07-31 (7 candidate models, real corpus prompts) produced two results.

**1. Swapping the second model does not help.** Against the shipped prompt, no candidate was clearly
better than the incumbent `us.meta.llama3-3-70b-instruct-v1:0`:

| Model | Behaviour on the polarity set |
|---|---|
| `kimi-k2-thinking`, `zai.glm-5` | Zero inversions — achieved by abstaining on nearly everything. No coverage gain. |
| `us.deepseek.r1-v1:0`, `openai.gpt-oss-120b-1:0` | One polarity inversion each. |
| `mistral.magistral-small-2509` | Two inversions. |
| `mistral.mistral-large-3-675b-instruct` | Answered `party_win` for **every** case — a constant function, not a classifier. |

`us.amazon.nova-premier-v1:0` is listed but returns `ResourceNotFoundException` — no access.

**2. Decomposing the task does help, on the same models.** Forcing the model to emit *who brought the
proceeding* and *whether what they sought was granted* before naming an outcome:

| Model | Shipped prompt | Reasoning-first |
|---|---|---|
| `llama3-3-70b` (the incumbent that was failing) | inverted | **3/4 correct, 0 abstentions** |
| `gpt-oss-120b` | 1 inversion | **3/4 correct, 0 abstentions** |

**So the change is to the prompt, not the model roster.** The pair stays
`us.anthropic.claude-sonnet-4-6` + `us.meta.llama3-3-70b-instruct-v1:0`.

## Why the eval set is the harder half

The bake-off used five cases I labelled by hand. **At least one label was wrong.** For `2021-yksc-43`
I recorded "the nation was the applicant, its application was dismissed, therefore a loss" — but all
four models, once required to name the moving party, independently identified **the Yukon government**
as the applicant. If Yukon moved and was refused, the nation prevailed, and the label was inverted.

I made the identical error I had attributed to the model: **reading party roles off the style of
cause instead of locating the moving party in the text.** `fnnnd v yukon` puts the nation first, so I
assumed the nation moved.

Two consequences that shape this design:

- **The eval set cannot rest on unaided human labelling**, mine or anyone's. The error is systematic
  and invisible to the labeller.
- **The intermediate fields are objectively checkable in a way the final label is not.** "Who brought
  this proceeding" is stated in the judgment. "Is this `doctrine_win` or `party_win`" is
  interpretation. So the eval is built primarily on the checkable fields.

## A. Reasoning-first schema

The model emits the derivation, then the label. Every new field is **closed-valued** — no free text —
so the no-new-hallucination-surface rule from the previous spec is preserved intact.

```ts
export interface OutcomeDerivation {
  movingPartyIsIndigenous: boolean;              // did the Indigenous party bring this proceeding?
  granted: "granted" | "refused" | "partly";     // was what the moving party sought given?
}
export interface RawOutcome {
  winType: WinType;
  outcomeType: OutcomeType;
  derivation: OutcomeDerivation;                 // NEW
}
```

The prompt requires, in order: identify the moving party → whether an Indigenous party is involved →
what was sought → granted or refused → who prevailed → `winType` **relative to the Indigenous party,
not the moving party**, plus an explicit warning that a dismissed application brought *by* the
Indigenous party is not a favourable result.

`movingParty` is deliberately reduced to a **boolean** rather than stored as a name. The name is free
text; the boolean is the only part the outcome depends on, and it is verifiable.

### The derivation is a consistency gate, not decoration

Two closed fields reconstruct the polarity, so the merge can check the label **against its own
stated reasoning**:

| `movingPartyIsIndigenous` | `granted` | Implied direction |
|---|---|---|
| true | granted | Indigenous party prevailed |
| true | refused | Indigenous party did not prevail |
| false | granted | Indigenous party did not prevail |
| false | refused | Indigenous party prevailed |

A model that answers `movingPartyIsIndigenous: true`, `granted: "refused"`, and `winType: "party_win"`
has **contradicted itself**. That is exactly the inversion we cannot currently detect, and it becomes
detectable per-model, before any cross-model comparison. Such a response is treated as a failed
classification for that model — the same as an unparseable one.

This is the substantive gain over a prompt tweak: it converts an invisible failure into a checkable
one.

### Storage

`CaseOutcome` gains `derivation?: OutcomeDerivation`. Both fields are closed-valued, both are written
only by the automated pass, and neither is rendered to end users — they exist so a reviewer can
verify a classification in one line instead of reading a judgment.

This also replaces the weakest part of the shipped work. `dispositionSentence` is unreliable — it
returned `"I granted Mr."` for one case (the splitter breaking on the `Mr.` abbreviation) and a
quoted legal maxim for another. The review line becomes derivation-based and needs no sentence
extraction at all.

## B. The eval set

`docs/research/gold/cases-outcome-gold.jsonl`, one record per case:

```jsonl
{"caseId":"2013-ykca-7","movingPartyIsIndigenous":true,"granted":"granted","winType":"party_win","movingPartyQuote":"…verbatim sentence naming the moving party…","citedPara":"para-3","labeller":"consensus-4","confidence":"high"}
```

**`movingPartyQuote` is mandatory and must appear verbatim in the case's chunks**, verified
programmatically at load time. A label whose quote does not match is rejected by the loader. This is
the discipline whose absence produced my error — it makes the unaided inference I made impossible to
record.

### How labels are produced

1. **Four-model consensus on the checkable fields.** Run the reasoning-first prompt across the four
   models already shown to be invokable. Where all four agree on `movingPartyIsIndigenous` **and**
   `granted`, accept as gold with `labeller: "consensus-4"`. This is defensible precisely because
   these fields are stated in the text rather than interpreted — and it is the mechanism that caught
   my error.
2. **I adjudicate the disagreements**, and may only record a label accompanied by a verbatim quote
   that the loader can verify.
3. **The user adjudicates the residue** — cases where the quote does not settle it. Expected to be
   small; these are escalated with the quote and the competing readings, not as raw judgments to read.

Target ~120 cases, stratified across `winType`, court level, and decade. Cases already used in the
bake-off are included and **their existing labels are discarded and relabelled**, since one is known
wrong and the rest were produced by the same flawed method.

### What the eval measures

- **Polarity accuracy** — the elimination metric. Direction, from the checkable fields. A
  contradiction between derivation and label counts as a failure even when `winType` happens to match.
- **Coverage** — the fraction receiving a label rather than abstaining.
- **Self-consistency rate** — how often a model's `winType` contradicts its own derivation. New, and
  the number this design exists to drive down.

Reported as a table per model so a future model swap is decided by measurement rather than reputation.

## Operational

- **The prompt change invalidates the entire response cache** (keyed on `(model id, prompt)`), so all
  1118 entries go stale and the corpus is fully reclassified. ~30 minutes, and the pass is idempotent.
- `OUTCOME_FORCE=1` is required, since every core case now carries a `dual_llm` outcome that would
  otherwise be skipped.
- `OUTCOME_RUBRIC_VERSION` bumps to `2026-07-31.1`. Rows carrying the old version are distinguishable
  from new ones for the whole of the transition.
- Curated outcomes (Haida `2004 SCC 73`, Tsilhqot'in `2014 SCC 44`) remain immune, as before.
- No re-embedding, no index rebuild. `GSI2PK` still moves atomically with `winType`.

## Two fixes carried in

Both are prerequisites, not opportunistic additions.

**1. `maxTokens` must be raised, and truncation must stop being silent.** `configuredModels()` calls
`modelFromId(id)` with no options, so `maxTokens` is 256. Measured: `kimi-k2-thinking` and
`deepseek-r1` return **empty text with `stopReason: "max_tokens"`**, which `parseOutcome` turns into
`unclassified` with nothing logged. A starved model therefore looks exactly like a scrupulous one.

Since this design makes the response longer for every model, the budget rises (2048) **and** an empty
response with `stopReason === "max_tokens"` throws instead of returning `""`. The runner already
counts thrown errors as `failed`, so truncation becomes visible.

Without this fix, the whole method is unsound: it rests on abstention being meaningful, and today
abstention and truncation are indistinguishable.

**2. Do NOT change `parseOutcome`'s brace scan.** An earlier concern that reasoning text would
pollute it was **measured and disproved** — all four thinking models return reasoning in a structured
`reasoningContent` block, and `llm.ts` already filters to text parts only. Recorded so nobody
"fixes" a non-problem.

## Explicitly NOT doing

- **No model swap.** Measured, and the roster stays. The bake-off harness is kept so the question can
  be reopened with data.
- **No thinking model in production.** They abstained more, not less. `maxTokens` is fixed regardless
  because it is a latent trap either way.
- **No free-text fields.** `movingParty` stays a boolean; `whoWon` and `holding` stay empty.
- **No external benchmark.** RM-3 originally proposed adopting CanLegalRAGBench; it measures
  retrieval grounding, not outcome polarity, so it does not serve this and is left as its own item.
- **No `industry` field.** Still RM-8, still the missing half of the client's question.
- **No retrieval changes.** Haida at rank 35 remains its own item.

## Success criteria

- A model contradicting its own derivation is detected and counted, where today it is invisible.
- A gold set of ~120 cases exists in which **every** label carries a quote the loader verifies against
  the judgment text.
- Polarity accuracy and self-consistency are reported per model, so the shipped configuration is
  chosen by measurement.
- Truncation is never again reported as abstention.
- The published win count is revised — up or down — with the direction explained by the eval rather
  than asserted. **The current figure of 47 is a floor produced partly by the defect this fixes.**
