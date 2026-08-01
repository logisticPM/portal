# Claim-Drop Forensics — Where the 707 Discarded Claims Go

**Date:** 2026-07-31 · **Branch:** `feat/drop-forensics`, revised on `feat/elision-bucket` ·
harness: `cases:drop-forensics:cloud`
(specs `…/2026-07-31-claim-drop-forensics-design.md`, `…/2026-07-31-elision-bucket-design.md`)

This document reports a measurement. It **recommends nothing** — deliberately. Choosing a remedy is
a separate decision that should be made with this distribution in hand, not bundled into the
measurement that produces it.

---

# REVISION — 2026-07-31, second run (7 buckets)

**Three things below this line were wrong. Read this section first.**

## 1. The "ellipsis contamination" this revision was built to size is negligible

The original run flagged `unseen = 7.2%` as an **upper bound**, on the theory that ellipsis elisions
— legitimate legal quoting the LCS test cannot span — were being misfiled as fabrications. A second
spec argued the contamination was worse than stated, because `transcription` is tested before
`unseen`, so an elided quote whose longest fragment exceeds half the quote would be absorbed there
too.

The argument was sound. The measurement killed it:

```
  elision                3     of 707   (0.4%)
```

Only **18** of the 707 dropped quotes contain an ellipsis at all. Three earn the bucket.

```
  fabrication rate: 7.1% (floor) … 7.2% (ceiling)
```

**The original 7.2% was right.** The caveat attached to it overstated the doubt.

## 2. The one example cited as a confirmed elision is partly fabricated

The original document presented `2025-bcsc-1167 para-62` as the proof that the bucket was
contaminated, and stated: *"the model joined two genuine passages … both fragments are genuine …
That is a taxonomy gap, not a fabrication."*

That was asserted from the shape of the string. It was never checked. Checked now, the quote has
**three** fragments, not two:

| fragment | chars | in the judgment? |
|---|---:|---|
| `"For all these reasons, the Plaintiffs' proprietary estoppel claims are dismissed"` | 80 | yes — para-52 |
| `"The Plaintiffs' unjust enrichment claims fail on that basis alone"` | 65 | **no — appears in no chunk** |
| `"For all these reasons, these Plaintiffs' negligent misrepresentation claims are dismissed."` | 90 | yes — para-62 |

The middle fragment is invented, and the two genuine fragments come from *different* paragraphs. The
verifier was right to drop it, the `unseen` bucket is the right bucket, and the claim that it was
legitimate quoting was wrong.

## 3. Two of the original headline zeros were structural, not measured

- **`locate_bug = 0`** was guaranteed. The runner converts a `locate_bug` verdict into an anchor and
  `continue`s *before* the tally, so that counter can never increment. The conclusion it was cited
  for — that the classifier and the shipped verifier agree on what is findable — is nonetheless
  true, but the evidence is the per-case reconciliation: **0 disagreements across 559 cases**. That
  line is now printed unconditionally.
- **`assembly_boundary = 0`** was also guaranteed, and it was cited as refuting the prompt-seam
  hypothesis. It cannot refute anything: every seam in the assembled text carries a `[para N]`
  marker, so a quote spanning one necessarily contains the marker and is caught by `marker_bleed`
  a step earlier. The hypothesis **is** dead — but it is `marker_bleed = 0` that kills it, since a
  seam-spanning quote must carry the marker and none does.

## The corrected distribution

```
707 span-dropped claims across 559 cases · 0 cases had no parseable claims
0 further claims rejected before classification (over_cap / no_text / quote_too_short)
replication vs verifyClaims: 0 disagreement(s) across 559 cases

  locate_bug             0   structurally 0 — see the reconciliation line above
  marker_bleed           0   the seam hypothesis dies here
  assembly_boundary      0   structurally 0 — subsumed by marker_bleed
  normalization         22   recoverable — widen normWs
  elision                3   legitimate quoting, misfiled by the 6-bucket taxonomy
  transcription        631   (was 634)
  unseen                51   (unchanged)

  elision diagnostics (ellipsis-bearing quotes that missed the bucket):
    cross_chunk_only     transcription    0 · unseen    0
    fragment_too_short   transcription    4 · unseen    1
    fragment_not_found   transcription    8 · unseen    2
    out_of_order         transcription    0 · unseen    0
```

`cross_chunk_only` and `out_of_order` are **both zero**. The strict-bucket / loose-counter design —
built specifically so the reader could choose where in the interval to stand — has no cases on
either side of the choice. The interval it was meant to open is 0.1 percentage points wide.

## What this run did establish: the `transcription` overlap distribution

This was bundled in at zero marginal cost and is the only result here that changes a decision.

```
  transcription overlap (n=631): p10 0.60 · p25 0.77 · p50 0.98 · p75 0.99 · p90 1.00

    0.50–0.55    37  ████
    0.55–0.60    31  ███
    0.60–0.65    36  ███
    0.65–0.70    23  ██
    0.70–0.75    19  ██
    0.75–0.80    29  ███
    0.80–0.85    23  ██
    0.85–0.90    30  ███
    0.90–0.95    51  █████
    0.95–1.00   352  █████████████████████████████████
```

**352 of 631 — 56% — share at least 95% of the quote as one contiguous run with real judgment text.**
The median is 0.98. The original document sampled three points, saw two at 0.99, and said explicitly
that three points could not support a claim about 634. They can now: the mass is at the top.

(`p90 1.00` is display rounding. An overlap of exactly 1.00 is impossible in this bucket — a fully
contiguous quote returns `locate_bug` and is never a drop.)

The sampled divergence offsets suggest where the difference sits: `"The Nuchatlaht have established
a claim to title to the whole of the area they have claimed."` is 92 characters, scores 0.99, and
reports `divergeAt=92` — the matched run ends at the quote's end, so the single differing character
is at position 0.

This is the number RM-4 needs. It is stated here and **acted on nowhere** — per both specs, this
document recommends nothing.

---

# ORIGINAL — first run (6 buckets), retained as the record of what that taxonomy measured

Everything below predates the revision above. Where the two disagree, the revision is correct.

## Setup (methodology, stated up front)

- **What is being measured:** every claim that `verifyClaims` discarded during the 2026-07-31 forced
  summarize run — 707 drops, all of them `no_span` (`quote_too_short 0 · no_text 0 · over_cap 0`).
  These are the paragraph-anchored citations the product tells readers to check each point against,
  so a discarded claim is content that reached the summary stage and then failed verification.
- **Population:** all core cases. 707 drops across **559 cases**; 0 cases had no parseable claims.
  Not a sample.
- **Read-only, zero Bedrock calls.** Model responses were replayed from `scripts/.cache/llm`; chunk
  text was read from DynamoDB (`LegalCases`, us-east-1). Nothing was written. A cache miss aborts
  the run with the case id rather than silently calling the model, so the distribution cannot be
  computed over an unrepresentative subset.
- **Classifier:** `src/lib/cases/ingest/drop-cause.ts`. Six **ordered** buckets, each drop assigned
  exactly one. Ordering is load-bearing and regression-tested — `marker_bleed` is tested before
  `assembly_boundary` because a quote containing `[para ` is definitionally present in the assembled
  text, so the reverse order would absorb every marker case and report `marker_bleed` as zero
  regardless of how often it happened.
- **Overlap** is longest-common-substring against the best-matching chunk, normalized by quote
  length, and is therefore **position-independent**. `divergeAt` is the offset into the quote where
  the matched contiguous run ends.
- **Threshold:** the `transcription`/`unseen` split is LCS ≥ 0.5. Half is the natural floor, not an
  arbitrary cut: a single substitution mid-quote splits the string, so LCS returns the longer
  surviving fragment ≈ half the quote. One garbled word therefore lands near 0.5, and anything below
  it shares no substantial run with any chunk.

## The distribution

```
707 dropped claims across 559 cases · 0 cases had no parseable claims

  locate_bug             0   BUG in locate() — investigate before reading anything else
  marker_bleed           0   recoverable — our prompt marker
  assembly_boundary      0   recoverable — our assembly seam
  normalization         22   recoverable — widen normWs
  transcription        634   recoverable only by span alignment
  unseen                51   NOT recoverable — the model was never shown this text

  recoverable without span alignment: 22   (3.1%)
  fabrication rate (unseen / total):  7.2% — see caveat below, this is an UPPER BOUND
```

Buckets sum to 707.

| Bucket | n | % | What it implies |
|---|---:|---:|---|
| `locate_bug` | 0 | 0% | The classifier and the shipped verifier agree on what is findable. Nothing below this line is contaminated by a `locate()` defect. |
| `marker_bleed` | 0 | 0% | The model never swept a `[para N]` marker into a quote. |
| `assembly_boundary` | 0 | 0% | **The leading hypothesis, refuted.** No drop is explained by the prompt-only seam. |
| `normalization` | 22 | 3.1% | A character-class fold `normWs` does not perform. Cheap to recover, and small. |
| `transcription` | 634 | 89.7% | A real passage, garbled. Shares ≥ half its length contiguously with actual judgment text. |
| `unseen` | 51 | 7.2% | Absent from the input the model was given — but see the contamination caveat. |

## Two results that change what was believed going in

### 1. `assembly_boundary` is zero. The hypothesis is dead.

The spec named this the leading hypothesis and argued it from code: `assembleInput` budgets at
240 KB, and over budget it selects a **non-contiguous** subset of chunks and joins them with `\n`,
so the model can see para-5 immediately followed by para-40 while `locate()`'s widest window is
*document*-adjacent pairs. The reasoning was sound and the measurement killed it: **not one of the
707 drops spans a prompt-only seam.**

The spec also predicted this hypothesis would explain the 17 summarize failures and their SCC skew
(`2018-scc-40`, `2020-scc-4`, `2013-scc-14`, `2008-scc-41`, `2005-scc-43`, `2025-scc-4`), on the
theory that the longest judgments are exactly the ones that get subsetted — and stated that if it
held, those failures were the same bug's tail and needed no separate work. It does not hold.
**The 17 failures are now unexplained** and are not accounted for by anything in this table.

### 2. The 7.2% `unseen` rate is an upper bound, not a fabrication rate

`unseen` was the number this run existed to produce: the rate at which the generator emits
quotations absent from its own input. 7.2% is what the classifier reports, and it is **too high**,
because at least one confirmed case in the bucket is legitimate quoting rather than invention.

`2025-bcsc-1167 para-62` reads:

> `"For all these reasons, the Plaintiffs' proprietary estoppel claims are dismissed. ... The Plaintiffs' unjust enrichment claims fail on that basis alon"`

The `...` mid-quote is the model's own **ellipsis elision** joining two real passages — standard
legal quoting practice, and both fragments are genuine. The classifier's LCS test cannot span an
elision, so the quote scores 0.37 and files as `unseen`. That is a taxonomy gap, not a fabrication.

**The size of this contamination is unmeasured.** A follow-up pass to count how many of the 51
`unseen` quotes contain an ellipsis marker and resolve fragment-by-fragment in order within one
chunk was attempted and timed out with no output. What can be stated: the true fabrication rate is
**below 7.2%**, by an amount nobody has measured yet.

## Worked examples

Three per non-empty bucket. These are the **first three encountered in iteration order**, not a
random sample — read them as illustrations of the failure mode, not as representative of the
bucket's centre. Quotes are truncated for display at 150 characters, so an abrupt ending is the
display cut, not the divergence; the divergence is at `divergeAt`.

### `normalization` (22)

| Case | Para | Overlap | divergeAt | Quote |
|---|---|---:|---:|---|
| `2025-bcsc-242` | para-24 | 0.99 | 107 | "I find that a protective order and sealing order should be granted over the Identified Cultural Information." |
| `2018-bcsc-822` | para-236 | 0.92 | 141 | "The content of the Crown's underlying title is what is left when Aboriginal title is subtracted from it: s. 109 of the Constitution Act, 1867; Delgamu" |
| `2018-scc-4` | para-27 | 0.65 | 106 | "The Tribunal awards monetary compensation against the Crown according to the terms set out in ss. 20 to 23, the provisions of which are reproduced in " |

These match once the widened fold is applied (soft hyphen, ellipsis glyph, ligatures, space before
punctuation, space after an opener) — i.e. the text is verbatim and the divergence is a character
class, not a word.

### `transcription` (634)

| Case | Para | Overlap | divergeAt | Quote |
|---|---|---:|---:|---|
| `2026-bcca-137` | para-79 | 0.51 | 96 | "The Forest Act and the Park Act do not apply to areas where Aboriginal title has been recognized." |
| `2026-bcca-137` | para-79 | 0.99 | 92 | "The Nuchatlaht have established a claim to title to the whole of the area they have claimed." |
| `2026-bcca-150` | para-2 | 0.99 | 189 | "The appellants appeal from orders relating to their interests in the manufactured homes. They say the judge erred in ordering the appellants to remove" |

Note the spread inside a single bucket: 0.51 is the one-garbled-word floor, while 0.99 means the
quote diverges from real judgment text by roughly one character near its end. Two of these three
read 0.99. **Whether that is typical of the bucket is unmeasured** — the overlap percentile
distribution within `transcription` was part of the same follow-up pass that timed out. A sample of
three cannot support a claim about 634.

### `unseen` (51)

| Case | Para | Overlap | divergeAt | Quote |
|---|---|---:|---:|---|
| `2026-nssc-166` | para-39 | 0.43 | 89 | "I find that Sipkne'katik breached its obligation to provide MFCS with reasonable notice. I am satisfied MFCS suffered loss as a result of this breach." |
| `2025-bcca-437` | para-13 | 0.26 | 131 | "The Property is within Electoral Area 'G' of the Regional District, which is subject to local zoning and land use bylaws, including the Zoning Bylaw, " |
| `2025-bcsc-1167` | para-62 | 0.37 | 247 | "For all these reasons, the Plaintiffs' proprietary estoppel claims are dismissed. ... The Plaintiffs' unjust enrichment claims fail on that basis alon" |

The third is the confirmed elision case described above and is **not** a fabrication. The first two
sit at 0.43 and 0.26 with no ellipsis marker; neither has been individually verified against the
judgment text.

## What this run establishes, against the spec's success criteria

| Criterion | Result |
|---|---|
| Every drop assigned exactly one bucket, summing to 707 | ✅ 0+0+0+22+634+51 = 707 |
| The `unseen` rate is known for the first time | ⚠️ Measured at 7.2%, but it is an **upper bound** — contaminated by at least one confirmed ellipsis elision, contamination size unmeasured |
| The `assembly_boundary` hypothesis confirmed or killed with a number | ✅ **Killed.** 0 |
| Whether the 17 summarize failures are this bug's tail is answered | ✅ Answered: **no.** They are now unexplained |
| Nothing in the corpus, summaries, or verifier changed | ✅ Read-only, zero Bedrock calls, zero writes |

## Open, and explicitly out of scope for this document

- The ellipsis contamination inside the 51 `unseen` — how much of 7.2% is legitimate elision.
- The overlap distribution inside the 634 `transcription`, beyond the three sampled points.
- Why the 17 summarize failures (6 of them SCC) fail, now that the predicted cause reads zero.
- What, if anything, to do about any of the above. This document takes no position.
