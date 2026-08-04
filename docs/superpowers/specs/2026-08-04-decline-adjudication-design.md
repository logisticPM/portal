# Decline Adjudication — Design

**Date:** 2026-08-04 · RM-3 sub-project C

**Goal:** close the question `2026-08-03-anchor-signals-results.md` left open — whether the
uniqueness guard's declined claims can be adjudicated at all — without claiming ground truth we
do not have.

---

## 1. What #228 left open

Claim verification anchors a claim when exactly one paragraph matches its quotation near-exactly.
When two match, the guard declines: an ambiguous citation is worse than a missing one. That guard
costs **15 claims**, and `2026-08-03-anchor-signals-results.md` measured whether the model's own
`citedPara` could break those ties. It could not distinguish itself from chance at any of three
levels of permissiveness (*p* = 0.29 / 0.51 / 0.39).

That report deliberately recommended nothing. The open item it named was ground truth — someone
reading the fifteen judgments and saying which paragraph each quotation came from.

**No human will read them.** That was decided: the adjudication is LLM-only. So this instrument
cannot produce ground truth, and **the findings doc must say so in its first paragraph.**

## 2. The question, reshaped so it is answerable without ground truth

Not *"which paragraph is correct"* — that needs ground truth. Instead:

1. **Does a blind, independent reader agree with `citedPara` more often than chance?** The judge
   sees the quotation and the two candidate paragraphs and nothing else. It does not know which
   candidate our text matching preferred, and it does not know what the model cited. That
   blinding is real independence even though it is not ground truth.
2. **How often does it abstain?** If a capable reader, given both paragraphs and the quotation,
   mostly cannot tell — then the pairs are undecidable from the text, and the guard should keep
   declining them. That is a publishable product conclusion requiring no ground truth at all.
3. **Does its answer survive swapping the order the candidates are presented in?** See §4.

## 3. This measurement's realistic value is a negative or a methodological result

**Stated up front so a weak positive cannot be dressed up later.** n = 15, and usable rows will be
fewer after abstentions. At n = 12, a 9:3 split gives two-sided *p* = 0.15; even 10:2 gives 0.04
on a denominator small enough that one row moves it. **An agreement result cannot establish that a
tie-breaker is safe**, and this spec does not permit claiming it does.

What *can* be established at this n, because it needs no statistical power:

| outcome | conclusion licensed |
|---|---|
| flip rate **≥ 1/3** (§4) | the judge provides no usable signal; the question cannot be answered this way. Report and stop — the agreement metric is **not computed**. |
| flip < 1/3, abstention **≥ 1/2** of consistent pairs | the pairs are undecidable from the text. **The guard should keep declining them permanently.** The tie-breaker line closes. |
| flip < 1/3, abstention < 1/2, agreement at chance | corroborates #228 from an independent direction. Line closes. |
| flip < 1/3, abstention < 1/2, agreement above chance | a tie-breaker gains *support*, not proof. The next step would be ground truth, not a build. |

Three of the four outcomes close the line. That asymmetry is the reason this is worth ~30 calls.

**Both thresholds are declared here, before the data is seen.** 1/3 for flips because a judge
disagreeing with itself on a third of rows cannot support an inference on a denominator this small;
1/2 for abstentions because past that point the median pair is one the judge declined to call, and
a rate computed on the minority it did call would describe the easy half of a set selected for
being hard. A threshold chosen after seeing the number is not a threshold — the same discipline
`2026-08-03-canlegalragbench-assessment.md` used to make its negative result clean.

An **order-consistent** pair, used throughout below, is one where both presentation orderings
returned the same verdict — including both returning `unsure`.

## 4. Position-bias control, and why it is not a second judge

LLM judges have a documented preference for the first option presented. If the best match were
always shown first, the judge could score well by preferring position 1 and we would read it as
signal.

So **every pair is judged twice, with the presentation order swapped**, and the disagreement rate
between the two orderings — the **flip rate** — is a headline result. A judge that changes its
answer when the order changes is not reading the text.

This is one judge checked against itself, not two judges. It stays inside the LLM-only decision:
no second model is introduced, and no model's opinion is being treated as ground truth. It is the
standard control for the specific failure mode that would otherwise fake a positive.

Presentation order is assigned by **seeded shuffle** (`ADJ_SEED`, default `1`) rather than always
best-first-then-rival, so the two calls per pair differ only in order and the assignment is
reproducible.

## 5. Blinding, stated exactly

The judge prompt contains:
- the quotation, as the model wrote it (garbled — these are near-misses, not verbatim);
- two paragraphs, labelled **A** and **B**, in the order §4 assigns.

It does **not** contain: which candidate our overlap scoring preferred, the overlap numbers, what
the model cited, the case name, or the paragraph ids. Leaking any of those turns an independent
read into a confirmation.

Verdict: `{"pick":"A"|"B"|"unsure"}`. `unsure` is a first-class answer, not a failure — §2's
second question depends on the judge being able to give it, so the prompt must invite it
explicitly rather than grudgingly.

**Unparseable is not `unsure`.** A response we cannot read is our failure and is counted
separately, exactly as the substance screen and the unanswerability screen already do.

## 6. Population

**Re-derived, never hardcoded.** The runner replays the warm LLM cache the same way
`cases-anchor-signals.ts` does and takes the claims the guard *currently* declines. Hardcoding
the fifteen would silently go stale the next time the corpus changes — and the corpus changed
twice in the week this line of work ran. The count is printed, so a population that has moved is
visible rather than assumed.

Same abort discipline as the existing replay runners: a cache miss stops the run rather than
measuring an unrepresentative subset, and an empty population is an error.

## 7. The judge model

Must not be `SUMMARY_MODEL` (`us.meta.llama3-3-70b-instruct-v1:0`) — that is the model whose
`citedPara` is under test, and asking it to adjudicate its own bookkeeping measures
self-consistency.

Default `us.anthropic.claude-opus-4-5-20251101-v1:0`, **verified invocable on this account by a
real Converse call**, not chosen from memory. Two ids written from memory into an earlier spec
were dead, and a third was listed `ACTIVE` by `list-inference-profiles` yet rejected as "not
available for this account". The runner asserts the judge differs from the summarizer and aborts
before any network call if it does not.

Judged through `cachedModel`, so re-running replays verdicts instead of re-buying them.

## 8. Metrics

| metric | definition |
|---|---|
| **flip rate** | of pairs judged twice, the share where the two orderings disagree |
| **abstention rate** | of order-consistent pairs, the share answered `unsure` |
| **agreement with `citedPara`** | of order-consistent, non-abstained pairs, the share where the judge's pick is the paragraph the model cited — with a two-sided binomial *p* against 0.5 |
| **unparseable** | reported separately, never folded into `unsure` |

Denominators narrow at each step and every one is printed with its numerator, because the last
metric's denominator may be very small and a bare percentage would hide that.

**A pair that flipped is excluded from the last two metrics**, since it has no stable answer to
compare. Excluded, not resolved by taking one ordering: picking one would be picking the answer.

## 9. Guards

Each is a test that fails if the guard is removed.

1. **Judge ≠ summarizer**, asserted before any network call.
2. **Blinding**, tested on the prompt builder: the prompt must contain the quotation and both
   paragraphs, and must NOT contain the strings `best`, `rival`, an overlap number, or the cited
   paragraph id.
3. **`unsure` and unparseable are distinct**, tested on the parser: `{"pick":"unsure"}` returns an
   abstention, garbage returns null, and null is never coerced to an abstention.
4. **Cache-miss abort** and **empty-population abort**, matching the existing replay runners.
5. **Every row is printed** — quotation head, both paragraph ids, both orderings' picks, whether
   it flipped, and whether it agreed. Fifteen rows is small enough to publish whole, and every
   aggregate above must be checkable against them. The anchor-signals report published all 15
   declines for the same reason, and the two instrument bugs it found were both caught that way.
   Note this is **our report, not the judge prompt**: §5 excludes the paragraph ids from what the
   judge sees, and printing them afterwards is what makes the run auditable. The two audiences
   must not be confused — leaking an id into the prompt would break the blinding this whole
   design rests on, which is why guard 2 tests the prompt's contents directly.
6. **Reconciliation**: `consistent + flipped + unparseable === pairs`, asserted before printing.

## 10. What this cannot establish

- **Not ground truth.** No human read anything. Whatever the judge picks, we do not learn which
  paragraph a quotation came from.
- **Not significance.** Per §3, n is too small. A positive result is a reason to seek ground
  truth, never a reason to build.
- **Not a claim about the guard's correctness.** The guard declines ambiguous citations by design;
  this measures whether the ambiguity is resolvable by an independent reader, not whether
  declining was right.
- **A shared blind spot is invisible.** If the judge and the summarizer misread the same
  near-miss the same way, they agree for the wrong reason and nothing here detects it.

## 11. Units

| file | responsibility | pure? |
|---|---|---|
| `src/lib/cases/adjudicate/prompt.ts` | blinded prompt builder, verdict parser | pure |
| `src/lib/cases/adjudicate/tally.ts` | the four metrics, binomial *p*, reconciliation | pure |
| `scripts/cases-adjudicate-declines.ts` | replay, order assignment, judge calls, report | I/O |
| `scripts/test-cases-adjudicate.ts` | unit tests over the two pure modules | — |

`summarizer.ts` is not modified. This instrument observes the guard; it does not change it.

## 12. Scale and cost

15 declines × 2 orderings = **30 judge calls**, plus a read-only DynamoDB replay of the core tier
(~578 `getCase` calls, no LLM). Cheap enough that the position-bias control is free.

## 13. Success criteria

- The four metrics printed with their numerators and denominators, from a run whose provenance
  names the judge model and the replay population size.
- All rows published.
- Every guard in §9 covered by a test that fails when the guard is removed.
- A findings doc that **states in its first paragraph that this is not ground truth**, records
  which of §3's four outcomes the data landed in, and — per the three preceding forensics
  reports — **recommends nothing**.
