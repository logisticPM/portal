# Claim-Drop Forensics — Design

**Date:** 2026-07-31 · **Status:** proposed (design), pre-implementation
**Domain:** `scripts/cases-drop-forensics.ts` (new), `src/lib/cases/ingest/drop-cause.ts` (new)

## Motivation

The 2026-07-31 forced summarize run produced the first real measurement of what we discard:

```
claims kept 2077 · dropped 707
drop diagnostics: no_span 707 · quote_too_short 0 · no_text 0 · over_cap 0
no_span overlap: >=0.5 → 655 · 0.25–0.5 → 49 · <0.25 → 3
```

Two facts follow, and both are larger than the question the histogram was built to answer.

**We discard 25% of all citation-anchored content.** 707 of 2784 claims. Those anchors are what make
a briefing verifiable — they are the paragraph links the product tells readers to check each point
against.

**The reason we deferred fixing it was wrong.** A prior spot-check concluded the discarded claims
were "genuine paraphrases, correctly discarded". 92.6% of them share a contiguous run of at least
half the quote with real judgment text. A genuine paraphrase does not contain a 200-character
verbatim run.

So the question is no longer "is span alignment worth building". It is **"why is a quarter of our
evidence failing verification, and how much of it is recoverable versus fabricated?"** This spec
measures that. It fixes nothing.

## Why a spec rather than another ad-hoc script

Three diagnostics were improvised during the investigation and one of them produced a wrong
conclusion: a prefix-anchored search reported "83% are real paraphrases" when `bestOverlap` is
longest-common-**substring** and therefore position-independent. The two measure different things,
and the label asserted a conclusion the method could not support.

The distinction matters for this work specifically — the whole question is *where* inside the quote
the divergence sits — so the search has to be LCS-anchored and it has to be committed, tested code
rather than something typed into a shell.

## The taxonomy

Every dropped claim lands in exactly one bucket. The ordering is deliberate: each test is cheaper
and more specific than the next, and the last one is the one nobody has measured.

| # | Bucket | Test | Meaning |
|---|---|---|---|
| 1 | `locate_bug` | the quote **is** contiguously present in some chunk | Should be impossible — `locate()` searches every chunk with `includes()`. A non-zero count is a bug in `locate`, not a model problem. |
| 2 | `marker_bleed` | the quote contains `[para ` | The model swept a paragraph marker into its quote. **Recoverable, and our fault.** |
| 3 | `assembly_boundary` | present in `assembleInput(chunks, holding)` but not in any chunk or document-adjacent pair | The model quoted across a seam that exists only in the prompt. **Recoverable, and our fault.** |

**`marker_bleed` must be tested before `assembly_boundary`** — corrected 2026-07-31 while planning. A
quote containing `[para ` is *definitionally* present in the assembled text, since that is where the
markers live, so testing `assembly_boundary` first would silently absorb every marker case and the
`marker_bleed` bucket would read zero no matter how often it happened. This is exactly the overlap
the ordering regression test exists to catch, and the spec's own first draft had it backwards.
| 4 | `normalization` | matches after a widened fold (spaces around punctuation, ellipsis forms, non-breaking space, soft hyphen, ligatures) | A character class `normWs` misses. **Recoverable, cheap.** |
| 5 | `transcription` | not in the assembled input, but LCS ≥ 0.5 against some chunk | The model garbled a real passage. Recoverable only by span alignment. |
| 6 | `unseen` | **not present in the assembled input at all**, and LCS < 0.5 | The model produced a quote it was never shown. |

### Bucket 6 is the reason this is worth doing

Buckets 2–5 are recovery questions. **Bucket 6 is a governance question, and its size is unknown.**

A quote absent from the input the model was given is not a transcription error — the model had
nothing to transcribe. For a product that presents paragraph-anchored citations to a legal audience,
the rate at which the generator invents quotations is a number we should already have and do not.

The verifier currently catches these — that is the system working — but it catches them in the same
bin as everything else, so we have never separated "our pipeline mangled a real quote" from "the
model made one up". Those have opposite remedies: the first is a bug to fix, the second is a reason
to keep the verifier exactly as strict as it is.

If bucket 6 is large, some of the recovery ideas in this backlog become actively dangerous — a
looser matcher would start admitting invented quotations.

## Why `assembly_boundary` is the leading hypothesis

`assembleInput` (`summarizer.ts:173`) budgets at 240 KB. Over budget, it selects a **non-contiguous
subset** of chunks and joins them with `\n`:

```ts
const lines = chunks.map((ch) => `[para ${ch.paragraph}] ${ch.text}`);
// … over budget: pick a subset, then
return chosen.map((i) => lines[i]).join("\n");
```

So the model can see para-5 immediately followed by para-40. `locate()`'s widest window is
`norm[i] + " " + norm[i+1]` — **document**-adjacent pairs. A quote spanning a seam that exists only
in the assembled prompt cannot match, however faithfully it was transcribed.

This also predicts the SCC skew in the 17 summarize failures (`2018-scc-40`, `2020-scc-4`,
`2013-scc-14`, `2008-scc-41`, `2005-scc-43`, `2025-scc-4`): the longest judgments are exactly the
ones that get subsetted. A "failure" is only `anchors.length < 2`, so a case with few claims and a
high drop rate fails outright. **If this hypothesis holds, the 17 failures are the same bug's tail
and need no separate work** — which is why they are not a separate item.

It is a hypothesis. The measurement is what settles it.

## Scope

- **All 561 core cases**, not a sample. The model responses are already on disk
  (`scripts/.cache/llm`), so re-deriving every quote costs no LLM calls.
- **Read-only.** Nothing is written to DynamoDB.
- **Correction to an earlier claim:** this is *not* credential-free. Chunk text lives in DynamoDB, so
  the run needs read access. What it avoids is the expensive half — zero Bedrock calls.
- A cache miss must **abort with the case id**, not silently call the model. A partial cache would
  otherwise produce a cause distribution over an unrepresentative subset, and a silently incomplete
  measurement is the failure mode this whole investigation has been dogged by.

## Output

`docs/research/2026-07-31-claim-drop-forensics.md`, committed, containing the distribution and — for
each bucket — three worked examples with the case id, paragraph, and the divergence in context.

```
707 dropped claims across 542 cases

  locate_bug           0     (any non-zero is a bug in locate(), investigate first)
  assembly_boundary  ...     recoverable — our seam
  marker_bleed       ...     recoverable — our marker
  normalization      ...     recoverable — widen normWs
  transcription      ...     recoverable only by span alignment
  unseen             ...     NOT recoverable — the model was never shown this text
```

The report states what each bucket implies and **recommends nothing**. Choosing a remedy is a
separate decision that should be made with the distribution in hand, not bundled into the
measurement that produces it.

## Testing

`scripts/test-cases-drop-cause.ts`, offline, against synthetic chunks:

- A quote present verbatim in a chunk → `locate_bug` (the bucket that must never fire in production).
- A quote spanning two chunks that are adjacent **in the assembled input but not in the document** →
  `assembly_boundary`; the same quote spanning document-adjacent chunks → not a drop at all.
- A quote containing `[para ` → `marker_bleed`, and it is checked **before** `normalization`, since a
  marker-bearing quote could also differ by punctuation and must not be misfiled.
- A quote differing only by a space before a period → `normalization`.
- A quote with one word substituted mid-passage → `transcription`, with the divergence offset
  reported from the LCS anchor, **not** from the quote start.
- A quote sharing nothing with any chunk → `unseen`.
- **Ordering regression:** a claim matching two buckets lands in the earlier one, asserted
  explicitly, because a taxonomy whose buckets overlap silently reports whichever test ran first.

## Explicitly NOT doing

- **No fix.** Not widening `normWs`, not changing `assembleInput`, not touching `locate`'s windows,
  not building span alignment. Every one of those is a live candidate and all of them should wait for
  the distribution.
- **No re-summarization.** Read-only against what is already stored and cached.
- **No change to `verifyClaims`.** It is doing its job; we are measuring what it rejects.
- **No claim recovery**, even where a bucket makes the fix obvious. Recovering claims changes
  published summaries and belongs behind its own review.

## Success criteria

- Every one of the 707 drops is assigned exactly one bucket, and the buckets sum to 707.
- The `unseen` rate — the rate at which the generator produces quotations absent from its own input —
  is known for the first time.
- The `assembly_boundary` hypothesis is confirmed or killed with a number.
- Whether the 17 summarize failures are this bug's tail is answered, rather than assumed.
- Nothing in the corpus, the summaries, or the verifier has changed.
