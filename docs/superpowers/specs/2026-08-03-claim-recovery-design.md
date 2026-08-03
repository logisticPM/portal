# Claim Recovery — Anchoring a Near-Exact Quote

**Date:** 2026-08-03 · **Status:** proposed (design), pre-implementation
**Domain:** `src/lib/cases/ingest/summarizer.ts`, `src/lib/cases/types.ts`,
`src/app/cases/methodology/page.tsx`
**Backlog:** RM-4, and the live half of #32

## The problem is no longer "we could recover some claims"

`verifyClaims` keeps a claim only when its quote appears **verbatim** in a paragraph.
25% of all claims — 707 of 2,784 — fail that test.

The 2026-07-31 forensics measured what those failures are
(`docs/research/2026-07-31-claim-drop-forensics.md`). They are not fabrications:

```
transcription overlap (n=631): p10 0.60 · p25 0.77 · p50 0.98 · p75 0.99 · p90 1.00
  0.95–1.00   352  █████████████████████████████████
```

**352 claims share at least 95% of the quote as one contiguous run with real judgment text.**
The median is 0.98. One sampled case scores 0.99 with the divergence at **character 0** — a
single leading character.

On 2026-08-03 this stopped being an optimisation. Two core cases have **no summary at all**:

| case | English full text | why it has no summary |
|---|---:|---|
| `2008-scc-41` | 134,142 chars | every claim dropped; best near-miss **0.97** |
| `2025-scc-4` | 49,858 chars | every claim dropped; best near-miss **1.00** |

`summarizeCase` fails a case when fewer than two claims survive. Both of these have full
English text well inside the assembly budget. **They produce nothing because quotes that
differ from the judgment by a rounding error are thrown away.**

This also corrects the record: the SCC full-text spec claimed backlog #32 shared the
bilingual over-length cause. It does not — these two are monolingual, in budget, and still
fail. The cause is here.

## What "recovery" means, precisely

`CitationAnchor` is `{ text, sourceParagraph, sourceUrl }`. **There is no quote field.** The
model's quote is a *locator*: it is used to find a paragraph number and then discarded. A
reader sees the claim's assertion and `[para-62]`.

So recovering a claim does not put garbled text in front of anyone. It attaches an assertion
to a paragraph number. **The only risk is attaching it to the wrong paragraph**, and the
guard below is built for exactly that risk.

## The rule

In `locate()`, after the three exact windows fail, one more attempt:

> Score every chunk by `longestCommonSubstringLen(quote, chunkText) / quote.length`.
> Recover **iff exactly one chunk — counting a chunk and its immediate neighbours as one —
> scores ≥ 0.95.**

Two constants, both chosen against measurement rather than invented:

**0.95.** A single substituted word splits the quote and leaves the longer surviving fragment
at roughly half its length, so 0.5 is the one-garbled-word floor and 0.95 sits far above it.
It is also where the mass is: 352 of 631, and both blocked cases (0.97 and 1.00). The
0.90–0.95 band — a further 51 claims — is **deliberately excluded**; see Not doing.

**"Exactly one" instead of a margin threshold.** A margin needs a number nobody has measured.
"Exactly one paragraph matches near-exactly" needs none, and it says the right thing: if two
paragraphs both match at 0.95, the attribution is a coin flip and we decline. Boilerplate
repeated across a judgment is the case this catches.

**Neighbours count as one.** A quote straddling a chunk boundary scores well against both
halves, which would look like ambiguity and block a recovery that `locate()`'s own
adjacent-pair window already considers legitimate. The winner's immediate neighbours are
therefore not counted as competitors.

## Where the code already is

`longestCommonSubstringLen` is already in `summarizer.ts` (line 92), and the drop-diagnostic
path at line 141 already scans every chunk with it to compute `bestOverlap` / `bestPara`.
**The code that finds the best-matching paragraph exists; today it only records, never acts.**

Two changes follow from that:

- The scan must move into `locate()`'s fallback so it runs always, not only when
  `opts.measureOverlap` is set. Diagnostics are opt-in; recovery cannot be.
- It runs **only after the exact windows fail** — 707 of 2,784 claims, the same volume the
  forensics already processed. The existing note measures this at ~65 ms per drop on a large
  case.

`drop-cause.ts` is documented "MEASUREMENT ONLY — nothing here runs in the summarize path."
That stays true: this spec touches neither it nor `lcsSpan`.

## Disclosure

A recovered anchor is slightly weaker evidence than an exact one, and the corpus should say
so rather than quietly blend them.

- `CitationAnchor` gains `matched?: "exact" | "near"`. Absent means exact, so every stored
  anchor stays valid without a migration.
- `SummaryMeta` gains `claimsRecovered`, alongside the existing `claimsDropped`.
- The methodology page states the corpus-wide recovered rate.

**No per-claim UI change.** What the reader needs is the right paragraph; whether our matcher
found it by exact or near match is a corpus-quality fact, not a per-line caveat. That is a
product decision and this spec does not pre-empt it — it makes the data available.

## Explicitly NOT doing

- **The 0.90–0.95 band (51 claims).** At 0.90 a quote differs by a tenth of its length, which
  is more than a typo. `docs/superpowers/specs/2026-07-31-anchor-signals-design.md` exists to
  measure whether the best-matching paragraph is the *right* paragraph in that region; that
  measurement has not run. Recovering it now would be guessing.
- **The 0.50–0.80 band (175 claims).** Same reason, more so.
- **`unseen` (51 claims).** These share nothing substantial with the judgment. The fabrication
  ceiling is 7.1–7.2% and this spec must not move it.
- **No change to what is published.** The model's quote is still discarded, `MIN_TEXT` still
  applies, and a claim with no text still drops.
- **No re-summarization.** Recovery changes future runs; re-running the corpus is a separate
  credentialed decision.

## Testing

`scripts/test-cases-summarizer.ts` (extend), offline:

- A quote verbatim in one chunk → anchored, `matched` absent (the exact path is unchanged).
- A quote differing by one leading character, 0.99 against exactly one chunk → **recovered**,
  `matched: "near"`. This is the sampled real case.
- A quote at 0.94 → **still dropped**. The threshold has to bite.
- A quote at 0.97 against **two** non-adjacent chunks → **dropped**, because the attribution
  is ambiguous. Asserted explicitly: this is the guard the whole design rests on.
- A quote at 0.97 against a chunk **and its immediate neighbour** → **recovered**, because
  neighbours are one competitor, not two. Without this the straddling case would regress.
- A quote sharing nothing (overlap < 0.5) → dropped, and `unseen` behaviour is unchanged.
- `claimsRecovered` counts recoveries and `claimsDropped` no longer counts them.
- **Regression:** a case whose claims all match exactly produces byte-identical anchors to
  today. Recovery must be additive.

## Success criteria

- `2008-scc-41` and `2025-scc-4` produce summaries.
- Around 352 previously-dropped claims anchor, and the drop rate falls from 25% toward 12%.
- No claim anchors to a paragraph that two paragraphs could equally have supplied.
- The recovered share is recorded per case and disclosed corpus-wide.
- The fabrication ceiling does not move: `unseen` claims are still dropped.
