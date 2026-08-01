# Anchor Signals — Can the Bottom 175 Be Attributed to a Paragraph?

**Date:** 2026-07-31 · **Status:** proposed (design), pre-implementation
**Domain:** `src/lib/cases/ingest/drop-cause.ts`, `scripts/cases-drop-forensics.ts`
**Predecessors:** `2026-07-31-claim-drop-forensics-design.md` (#213), `2026-07-31-elision-bucket-design.md` (#214)

## The reframe this rests on

`CitationAnchor` is `{ text, sourceParagraph, sourceUrl }`. **There is no quote field.** The model's
quote is a *locator* — it is used to find a paragraph number and then discarded. What a reader sees
is the claim's assertion followed by `[para-62]`, under a line that says *"verify each claim against
its anchored paragraph."*

So recovering a dropped claim does not mean publishing garbled text; garbled text is never
published. It means **attaching an assertion to a paragraph number**. The failure mode is
mis-attribution: a reader who is explicitly told to check para-62 goes there and finds nothing
supporting the claim. That is worse than dropping the claim, because it spends trust the anchor
exists to build.

This changes what "safe recovery" means, and it is why the question below is about attribution
confidence rather than quote fidelity.

## The question

#214 measured the `transcription` bucket's overlap distribution: 352 of 631 sit at ≥0.95, and
**175 sit in 0.50–0.80** — the band where a fifth to a half of the quote diverges, and which abuts
the 0.50 line below which we call a claim "the model was never shown this".

Is the best-matching paragraph in that band the *right* paragraph? This spec measures the two
signals that a recovery gate would use. **It builds no gate and recovers nothing.**

## The two signals

### Signal 1 — margin

`margin = bestOverlap − runnerUpOverlap`, where the runner-up is the best-scoring chunk that is
**not the winner and not document-adjacent to the winner** — adjacency meaning index `i±1` in the
chunks array, which `verifyClaims` documents as contiguous document order.

Excluding neighbours is the load-bearing part. A quote that straddles a chunk boundary scores well
against both halves, so a naive second-best would report a near-zero margin for an attribution that
is not actually ambiguous — `locate()` already treats document-adjacent pairs as one search window
and anchors to the first of the pair. Without the exclusion the signal would report "ambiguous" for
exactly the case the existing verifier considers unambiguous.

A wide margin (0.72 vs 0.31) means one paragraph clearly owns the quote. A narrow one (0.72 vs 0.70)
means the attribution is a coin flip regardless of how high the absolute overlap is.

### Signal 2 — cited-paragraph corroboration

`bestPara === citedPara`, where `citedPara` is the paragraph the model itself reported for the claim
(`RawClaim.paragraph`).

**This is corroboration, not a requirement.** `summarizer.ts` carries a measured note: models
frequently misattribute paragraph ids, and strict cited-paragraph matching dropped half of all
honest claims (measured 2026-07-05). So a disagreement proves little. But an *agreement* is two
independent signals — the model's own bookkeeping and our text matching — landing on the same
paragraph, and that is the strongest evidence available without a human.

## Scope

- All 561 core cases, same population and same runner as #213/#214, so the numbers are comparable.
- **Read-only.** Zero writes, zero Bedrock calls; responses replay from the warm 2792-entry cache.
  A cache miss still aborts with the case id.
- Needs DynamoDB read access for chunk text.
- Reported for **every** `transcription` drop, banded by overlap, not only for the 175 — the bands
  above 0.80 are the control. If margin and corroboration look the same at 0.95 as at 0.52, then
  neither signal separates anything and the gate design has to change.

## Output

Appended to the existing forensics report, and written up in
`docs/research/2026-07-31-anchor-signals.md`:

```
transcription anchor signals (n=631), by overlap band

  band        n    citedPara agrees    margin p25 / p50 / p75    no runner-up
  0.50–0.60  68           ...%              ... / ... / ...           ...
  0.60–0.70  59           ...%              ... / ... / ...           ...
  0.70–0.80  48           ...%              ... / ... / ...           ...
  0.80–0.90  53           ...%              ... / ... / ...           ...
  0.90–1.00 403           ...%              ... / ... / ...           ...

  bottom 175 (0.50–0.80): both signals agree ...  ·  margin only ...  ·  cited only ...  ·  neither ...
```

`no runner-up` counts single-chunk cases and cases where every non-adjacent chunk scores zero;
margin is undefined there and must not be silently treated as 1.0.

The 2×2 on the bottom 175 is the number that decides the gate. The report **recommends nothing** —
same rule as its two predecessors.

## Implementation shape

`classifyDrop`'s existing loop already computes an LCS for every chunk. It currently keeps only the
best. Keep the per-chunk overlaps in a `number[]` (chunk counts are in the hundreds; the LCS itself
already dominates), then derive the runner-up with the adjacency exclusion after the loop. No second
LCS pass.

`DropVerdict` gains:

```ts
runnerUpOverlap: number | null;  // null = no eligible non-adjacent chunk
bestIndex: number | null;        // so the runner has the winner's document position
```

The runner reads `citedPara` from `RawClaim.paragraph`, which it already has in hand.

## Testing

`scripts/test-cases-drop-cause.ts`, offline:

- Three chunks where the winner is chunk 0 and chunk 2 is a weak partial match → `runnerUpOverlap`
  equals chunk 2's score, not chunk 1's.
- A quote straddling chunks 0 and 1 → chunk 1 is excluded as adjacent, so the runner-up comes from
  chunk 2 or is `null`. **This is the assertion the adjacency rule exists for**; without it the
  margin collapses on a case the shipped verifier already handles.
- A single-chunk case → `runnerUpOverlap` is `null`, not `0`.
- All chunks scoring zero except the winner → `runnerUpOverlap` is `null`, not `0`.
- `bestIndex` points at the winning chunk's position in the input array.

## Explicitly NOT doing

- **No recovery gate, no span alignment, no claim recovery.** Nothing that changes which claims
  survive, which paragraphs they anchor to, or what any summary says.
- No change to `verifyClaims`, `locate()`, `normWs`, `assembleInput`, or the bucket taxonomy.
- No re-summarization, no writes, no LLM calls.
- No threshold. Picking one is the next decision and it needs this table first.

## Success criteria

- The 2×2 for the bottom 175 — both signals / margin only / cited only / neither — is known.
- The bands above 0.80 are measured too, so we can tell whether the signals discriminate at all or
  look identical everywhere.
- `no runner-up` is reported separately and never folded into a margin of 1.0.
- Nothing in the corpus, the summaries, or the verifier has changed.
