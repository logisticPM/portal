# Elision Bucket — Sizing the Contamination in the Drop Taxonomy

**Date:** 2026-07-31 · **Status:** proposed (design), pre-implementation
**Domain:** `src/lib/cases/ingest/drop-cause.ts`, `scripts/cases-drop-forensics.ts`,
`scripts/test-cases-drop-cause.ts`, `docs/research/2026-07-31-claim-drop-forensics.md`
**Predecessor:** `docs/superpowers/specs/2026-07-31-claim-drop-forensics-design.md` (shipped, #213)

## Motivation

The forensics run (#213) classified all 707 dropped claims and reported:

```
  normalization         22   (3.1%)
  transcription        634   (89.7%)
  unseen                51   (7.2%)
```

The findings document already records that 7.2% is an **upper bound**, because
`2025-bcsc-1167 para-62` is an *ellipsis elision* — the model joined two genuine passages with
`...`, which is standard legal quoting, and the LCS test cannot span an elision so it scored 0.37
and filed as `unseen`.

That caveat understated the problem.

## The correction: the contamination is in both buckets, not just `unseen`

`classifyDrop` tests `transcription` (LCS ≥ 0.5) *before* `unseen`. An elided quote is split into
fragments; if the **longest single fragment** is more than half the quote, LCS clears 0.5 and the
claim is filed as `transcription` — "a real passage, garbled" — when in fact it is a faithful,
legitimately elided quotation with nothing garbled about it.

`2025-bcsc-1167` landed in `unseen` only because its two fragments happened to be of similar length.
Move the elision later in the sentence and the identical quoting practice lands in `transcription`.

So the population to measure is not the 51. It is **685 = `transcription` 634 + `unseen` 51**, and
the result revises both the 7.2% fabrication ceiling and the 89.7% figure that RM-4's span-alignment
decision rests on.

## Design

### A seventh bucket, positioned before `transcription`

`elision` is inserted between `normalization` and `transcription`. **The position is the whole
point** — placed after `transcription`, the contamination inside 634 stays permanently invisible,
which is the same class of ordering error the predecessor spec caught between `marker_bleed` and
`assembly_boundary`.

Positioning against the earlier buckets is safe by construction and is asserted, not assumed:

- `locate_bug` and `assembly_boundary` both test for the quote appearing **contiguously**. An elided
  quote contains an ellipsis that appears in neither the chunk nor the assembled prompt, so neither
  can fire on it.
- `marker_bleed` must stay ahead of `elision`: a quote that swept up a `[para N]` marker *and*
  contains an ellipsis is a marker problem first, and that is the bucket that tells us so.
- `normalization` cannot fire on an elided quote either — `widenFold` still leaves the `...` in
  place, so no contiguous match exists.

### Strict bucket, loose counter — both reported

The bucket uses the **strict** test, which is the one nobody can argue with: all fragments resolve
**inside a single chunk**, in order, at non-overlapping positions. That is unambiguously one
paragraph quoted with its middle omitted.

Fragments resolving across *several* chunks in document order is also legitimate in real legal
writing, but it is much harder to distinguish from stitching unrelated passages together. Rather
than pick, the run reports it as a **separate counter, not a bucket** (`cross_chunk_only`). The true
fabrication rate then sits between the two numbers, and the choice of where in that interval to
stand is left to whoever reads the report.

### The test, precisely

1. `w = widenFold(rawQuote)`. Folding first collapses every elision spelling — `…`, `. . .`,
   `[ ... ]` — into ASCII `...`, so the split needs one pattern instead of five. It also means a
   quote that is *both* elided and punctuation-divergent still resolves, which is the combination
   that would otherwise fall through every bucket.
2. Split on `/\s*[\[(]?\.{3,4}[\])]?\s*/`, trim, drop empties. Fewer than 2 fragments → not an
   elision; return `null` and let classification continue.
3. Any fragment shorter than `MIN_FRAGMENT = 20` characters → fail as `fragment_too_short`. A short
   fragment matches incidentally almost anywhere in a paragraph, and admitting those would inflate
   the bucket in exactly the direction that flatters us.
4. For each chunk, folded with `widenFold`: resolve fragments left to right, each search starting
   after the end of the previous match. First chunk that resolves all of them → **`elision`**.
5. Otherwise scan chunks in document order, carrying the cursor forward across chunk boundaries
   (each fragment must sit entirely within one chunk, so a join cannot manufacture a match). If this
   resolves → `cross_chunk_only` counter, and the claim still falls through to `transcription` or
   `unseen` as before.
6. Otherwise diagnose why, for the report: some fragment found nowhere → `fragment_not_found`;
   all found but not in order → `out_of_order`.

`DropVerdict` gains one optional field to carry steps 3, 5 and 6 out to the runner:

```ts
export type ElisionDiag = "cross_chunk_only" | "fragment_too_short" | "fragment_not_found" | "out_of_order";
// set ONLY when the quote contained an ellipsis but did not earn the elision bucket
elisionDiag?: ElisionDiag;
```

The runner tallies `elisionDiag` **cross-tabulated against the final bucket**, not as a flat count.
A `cross_chunk_only` claim can end up in either `transcription` or `unseen`, and the fabrication
interval needs the `unseen` half of it specifically (see Output).

**Known conservatism, stated rather than discovered later:** step 4 takes the leftmost match for
each fragment and does not backtrack. If a fragment occurs twice and only the later occurrence
leaves room for the next one, the test fails. With a 20-character floor, repeated occurrences within
one paragraph are rare. This makes `elision` a **lower bound**, which is the correct direction for a
number being used to bound a fabrication rate.

### Why the failure reasons are reported and not just the bucket

`elision = N` on its own is uninterpretable. It cannot distinguish "the remaining quotes are
fabrications" from "the remaining quotes are elisions that fell under the 20-character floor". The
counts for `fragment_too_short`, `fragment_not_found`, `out_of_order`, and `cross_chunk_only` are
what make the bucket mean something, so they are part of the required output, not a nice-to-have.

### Bundled at zero marginal cost: the `transcription` overlap distribution

The runner already computes `bestOverlap` for every drop. Accumulating a histogram costs nothing and
closes the other open question from the findings doc, where three sampled points (two at 0.99) were
explicitly flagged as unable to support any claim about 634.

Report for the post-elision `transcription` bucket: a histogram in 0.05 bins from 0.50 to 1.00, plus
p10/p25/p50/p75/p90. This is the number RM-4 needs — if the mass sits at 0.99, span alignment is the
wrong tool for most of the bucket.

## Execution

**Change `classifyDrop` and re-run the existing runner.** The previous attempt at this measurement
was a throwaway script that opened its own pass over the corpus and timed out after 10 minutes with
no output at all, because it only printed on completion. `cases-drop-forensics.ts` demonstrably
completes over the same data; hanging the elision test inside its existing loop makes the marginal
cost approximately zero and reuses a code path already known to terminate.

## Scope

- **All 561 core cases**, same population as #213, so the two distributions are comparable.
- **Read-only.** Zero writes. Zero Bedrock calls — model responses replay from `scripts/.cache/llm`
  (2792 entries, warm). A cache miss still aborts with the case id.
- Needs DynamoDB read access for chunk text.

## Output

The distribution replaces the one in `docs/research/2026-07-31-claim-drop-forensics.md`. That
document is already merged and states 7.2% as a headline; leaving it uncorrected is worse than
amending it. So: a **Revision section at the top** carrying the corrected numbers, with the original
6-bucket distribution left visible below it as the honest record of what the earlier taxonomy
measured. The document continues to **recommend nothing**.

```
707 dropped claims across 559 cases

  locate_bug             0
  marker_bleed           0
  assembly_boundary      0
  normalization         22
  elision              ...   legitimate quoting, misfiled by the 6-bucket taxonomy
  transcription        ...   (was 634)
  unseen               ...   (was 51)

  elision diagnostics, by final bucket:
                       cross_chunk_only    transcription ...  unseen ...
                       fragment_too_short  transcription ...  unseen ...
                       fragment_not_found  transcription ...  unseen ...
                       out_of_order        transcription ...  unseen ...

  fabrication rate: between (unseen − unseen∩cross_chunk_only)/total   [floor]
                        and unseen/total                               [ceiling]

  transcription overlap: p10 ... p25 ... p50 ... p75 ... p90 ...
```

The interval's floor subtracts only the `cross_chunk_only` claims **that landed in `unseen`**.
Subtracting the whole `cross_chunk_only` count would be wrong — most of those claims are expected in
`transcription`, and the arithmetic could drive the floor below zero.

## Testing

`scripts/test-cases-drop-cause.ts`, offline, synthetic chunks:

- A quote with `...` between two ≥20-char fragments, both present in one chunk in order → `elision`.
- The same fragments present but in **reverse** order in the chunk → not `elision`.
- Fragments in two different chunks in document order → not `elision`; the `cross_chunk_only`
  diagnostic fires.
- A quote whose second fragment appears in **no** chunk → not `elision`; `fragment_not_found`.
- A quote with a 5-character fragment → not `elision`; `fragment_too_short`.
- `…`, `. . .`, and `[...]` spellings all reach the same verdict as plain `...`.
- **Ordering regression:** a quote that is elided **and** whose longest fragment exceeds 0.5 overlap
  lands in `elision`, not `transcription`. This is the assertion that the whole change exists for —
  without it the bucket can be silently starved by the test that follows it.
- **Ordering regression:** a quote that is elided **and** contains `[para ` lands in `marker_bleed`.

## Explicitly NOT doing

- **No fix, again.** Not recovering elided claims, not teaching `locate()` to span elisions, not
  widening `normWs`, not building span alignment.
- **No change to `verifyClaims`.** Every claim that was dropped stays dropped. This changes how we
  *describe* the drops, not which ones happen.
- **No re-summarization**, no writes, no new LLM calls.
- **No recommendation** in the findings document, including on RM-4, even though the histogram is
  collected specifically to inform it.

## Success criteria

- All 707 drops still sum, now across 7 buckets.
- The elision contamination inside `transcription` is known — the number that did not exist before
  this spec and that the previous run's framing missed entirely.
- The fabrication rate is reported as an **interval** with both endpoints measured, not a single
  number with a prose caveat.
- The `transcription` overlap distribution is known for all 634, not three sampled points.
- The findings document no longer leads with a figure known to be wrong.
- Nothing in the corpus, the summaries, or the verifier has changed.
