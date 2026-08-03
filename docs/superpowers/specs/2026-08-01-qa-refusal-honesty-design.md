# "This judgment does not address that question" — When It Is Not True

**Date:** 2026-08-01 · **Status:** proposed (design), pre-implementation
**Domain:** `src/lib/cases/caseqa/generator.ts`, `src/lib/cases/caseqa/run.ts`,
`src/lib/cases/caseqa/types.ts`, `src/app/cases/[id]/page.tsx`

## The defect

`answerCaseQuestion` ends:

```ts
if (anchors.length === 0)
  return { status: "failed", failReason: "this judgment does not appear to address that question" };
```

`anchors.length === 0` has two causes and the message only describes one of them.

1. **The model found nothing.** It returned `{"claims":[]}`, exactly as the prompt instructs
   when the judgment is silent. The message is correct.
2. **The model answered, and every claim failed verification.** `verifyClaims` keeps a claim
   only if its quote appears verbatim in a paragraph. Claims whose quotes are garbled are
   dropped. If all of them are, the reader is told the judgment does not address their
   question — **about a judgment that may answer it in full**.

In case 2 the product asserts something false about a court decision, to a legal audience,
on a page whose entire premise is that every point is checkable.

## Why this is not hypothetical

The 2026-07-31 forensics measured the shipped verifier's drop behaviour across all 561 core
cases (`docs/research/2026-07-31-claim-drop-forensics.md`):

- **707 of 2784 claims — 25% — are discarded**, all for a quote that does not match.
- **352 of the 631 `transcription` drops (56%) sit at ≥0.95 overlap.** They share at least
  95% of the quote as one contiguous run with real judgment text. One sampled case scored
  0.99 with the divergence at **character 0**.
- The fabrication ceiling is 7.1–7.2%. The overwhelming majority of drops are real passages,
  lightly garbled — not invention.

A Q&A answer is 1–6 claims. At a 25% per-claim drop rate, losing every claim is an ordinary
outcome, not a rare one.

**The 17 summarize failures are this bug's sibling.** `summarizeCase` fails a case when
`anchors.length < 2` — the same verifier, the same cause, a threshold of 2 instead of 1.
That backlog item (#32) and this one share a root.

## What this spec changes

**It does not loosen verification.** Every claim that is dropped today stays dropped, and no
unverified quote is ever shown. What changes is what we *say* when nothing survives, and
whether we can *see* how often it happens.

### 1. Separate the two failures

```ts
if (claims.length === 0)  → "this judgment does not appear to address that question"
if (anchors.length === 0) → a different failure: we could not verify the answer
```

The second message must not blame the judgment. It should say the answer could not be
anchored to the text and invite a retry, because a retry genuinely may succeed — the retry
prompt has a different cache key and the model re-quotes.

### 2. Measure it

`verifyClaims` already takes `{ measureOverlap: true }` and returns `drops[]` with
`bestOverlap` and `bestPara`. The Q&A path does not pass it, so **no diagnostics exist for
this feature at all** and the failure rate is unobservable. Turn it on, and persist the
best overlap on the failed record.

The cost is bounded: overlap is measured only for claims that are already being dropped.

### 3. Retry once when the evidence says the answer was real

If every claim was dropped but the best overlap across them is **≥ 0.8**, the model was
quoting real text and mistyped it. Re-issue the prompt once with `RETRY_SUFFIX` (a different
cache key) before failing.

0.8 is chosen against the measured distribution, not invented: a single substituted word
splits the quote and leaves ≈0.5, so 0.8 sits well above one-word garbling and comfortably
below the 0.95 mass. Claims below it are not confidently "a real passage".

**One retry, not a loop.** A second failure at high overlap means the mismatch is systematic
(a normalization gap, an elision), and hammering the model will not fix it.

### 4. Tell the reader what was discarded

`dropped` is already stored on a successful answer and never displayed. When claims were
dropped but some survived, the answer is partial and the reader should know — they are being
asked to rely on it.

## Explicitly NOT doing

- **No change to `verifyClaims`, `locate()`, `normWs`, or `assembleInput`.** The verifier is
  correct; this is about the message and the diagnostics around it.
- **No span alignment, no claim recovery.** Recovering garbled quotes is RM-4 and needs its
  own decision.
- **No change to the briefings path or `summarizeCase`.** The 17 summarize failures share
  this root cause but sit behind a different threshold and a different user surface; fixing
  them here would widen this change into two features at once.
- **No loosening of the anchor requirement.** Zero verified claims still means no answer.

## Testing

`scripts/test-cases-caseqa.ts`, offline, with a stub model:

- Model returns `{"claims":[]}` → the "does not address" message, and **no retry is issued**
  (a retry here would be a wasted call on a correct refusal).
- Model returns one claim whose quote is verbatim → `done`, one anchor, `dropped: 0`.
- Model returns claims whose quotes are garbled beyond recognition (overlap < 0.8) → failure
  with the *verification* message, not the "does not address" message, and **no retry**.
- Model returns a claim at ≥0.8 overlap, and the retry returns a verbatim quote → `done`.
  This is the case the retry exists for.
- Model returns a claim at ≥0.8 overlap and the retry fails too → failure with the
  verification message, and **exactly two model calls** — asserted, so a loop cannot creep in.
- A partially-dropped answer reports the surviving anchors and a non-zero `dropped`.

## Success criteria

- No failure path tells the reader a judgment is silent when the model in fact answered.
- The rate at which answers fail verification is recorded and can be queried.
- A high-overlap near-miss gets exactly one second chance.
- Nothing unverified reaches the page.
