# Briefing Dependency Fix + Claim-Drop Diagnostics — Design

**Date:** 2026-07-30 · **Status:** approved (design), pre-implementation · **Domain:** `src/lib/cases/briefs/generator.ts`, `src/lib/cases/ingest/summarizer.ts`, `scripts/cases-summarize.ts`

## Motivation

Two findings from the 2026-07-30 frontier-research scan, narrowed to what the evidence actually
supports:

**A. A live correctness bug in `verifyBriefing`.** Principles are filtered against the *retrieved*
case ids, not against the precedents that actually **survived** verification. A precedent can be
dropped for an empty `establishes`/`relevance`, for being a duplicate, or by the 6-entry cap — and a
principle citing that case still renders. The result a reader sees is a cross-case principle citing a
case that has no precedent entry on the page. The research framing is that claims with dependencies
cannot be filtered as a flat list; **we already have the dependency graph — it is the `caseIds`
edges.**

**B. We cannot currently answer whether dropped claims are recoverable, so we should measure rather
than build.** The literature reports that LLMs "reliably identify the right document but struggle to
identify the precise supporting span" (FullCite), and that 38–60% of automatically-flagged
"ungrounded" claims are benign (CanLegalRAGBench) — which suggests span alignment could recover some
of our 548 discarded claims. **But our own spot-check of those 548 concluded they were genuine
paraphrases, correctly discarded.** If the model paraphrased, there is no verbatim span to align to
and alignment recovers nothing. The two readings cannot be distinguished from what we store: only
`summaryMeta.claimsDropped`, a count, is persisted — the raw claims are not.

So this ships **the certain fix (A)** plus **an instrument (B)** that makes the next summarize run
answer the question with data, and defers any recovery mechanism until it does.

## Context that shapes the design

`verifyClaims` returns `CitationAnchor { text, sourceParagraph, sourceUrl }` — **the quote is not
stored**. It is a verification token, discarded after use; the page shows `claim.text` plus a
paragraph link. Two consequences:

- Span alignment would *not* risk displaying a fuzzy-matched quote as verbatim — that hazard does
  not exist here.
- But verbatim matching is currently the proxy for *"the model actually read this paragraph"*.
  Loosening it loosens that proxy, with nothing user-visible to compensate. That is precisely why B
  is a measurement and not yet a mechanism.

## A. Fix the briefing dependency filter

`verifyBriefing` today:

```ts
const valid = new Set(retrievedIds);
const precedents = body.precedents.filter(/* … */).slice(0, 6);
const principles = body.principles
  .map((pr) => ({ text: pr.text.trim(), caseIds: pr.caseIds.map((id) => id.trim()).filter((id) => valid.has(id)) }))
  .filter((pr) => pr.text && pr.caseIds.length > 0)
  .slice(0, 4);
```

`valid` is the *retrieved* set. Change principles to filter against the ids that survived into
`precedents`, computed **after** the cap:

```ts
// A principle may only cite precedents the reader can actually see. `valid` (the retrieved set) is
// the wrong gate: a precedent can be dropped for an empty establishes/relevance, as a duplicate, or
// by the 6-entry cap, and a principle citing it would render as a dangling reference.
const survivingIds = new Set(precedents.map((p) => p.caseId));
const principles = body.principles
  .map((pr) => ({ text: pr.text.trim(), caseIds: pr.caseIds.map((id) => id.trim()).filter((id) => survivingIds.has(id)) }))
  .filter((pr) => pr.text && pr.caseIds.length > 0)
  .slice(0, 4);
```

This can only ever **tighten** output — every id it now rejects was already unreachable on the page.
The `dropped` count keeps its existing meaning (cap-trims and duplicates count), and the
`precedents.length < 2 ⇒ refuse` rule is untouched.

## B. Claim-drop diagnostics (measurement only, zero behaviour change)

`verifyClaims` gains a third return field. **Nothing about which claims are accepted or rejected
changes** — the same claims survive, with the same anchors.

```ts
export type ClaimDropReason = "no_text" | "quote_too_short" | "no_span";

export interface ClaimDrop {
  reason: ClaimDropReason;
  quoteLen: number;      // normalized quote length
  citedPara: string;     // what the model claimed, verbatim from its output
  citedParaFound: boolean; // did that paragraph id resolve to a real chunk?
  bestOverlap: number;   // no_span only: longest common substring with the CITED paragraph,
                         // as a fraction of the quote length. 0 when the paragraph didn't resolve.
}

export function verifyClaims(
  claims: RawClaim[], chunks: CaseChunk[], sourceUrl: string,
): { anchors: CitationAnchor[]; dropped: number; drops: ClaimDrop[] };
```

**`bestOverlap` is the whole point.** It distinguishes the two competing explanations:

| Pattern | Reading |
|---|---|
| `citedParaFound` true and **bestOverlap high** (≳0.5) | Right paragraph, garbled transcription — **span alignment would recover these** |
| `citedParaFound` true and **bestOverlap low** (≲0.25) | Genuine paraphrase — there is no span to align to; the claim was correctly discarded |
| `citedParaFound` false | The model invented a paragraph id — a separate failure worth counting |

**Where those thresholds come from** (corrected 2026-07-31, after measuring): this draft originally
said ≳0.8 / ≲0.4, chosen as round numbers rather than derived. That was wrong. A single substitution
in the *middle* of a quote leaves no contiguous match spanning the edit, so LCS returns the longer
surviving fragment — about **half** the quote. A one-word garble therefore cannot reach 0.8 unless the
edit sits near an end, and an 0.8 threshold would have reported the recoverable population as
near-zero no matter what the truth was — defeating the only purpose this instrument has. Measured on
a realistic fixture: one-word substitution **0.57**, genuine paraphrase **0.13**. The separation is
~4×, which is the signal; the boundary belongs at 0.5, with ~0.25 marking the two-edit case.

It is computed **only against the cited paragraph**, not every chunk. That is deliberate on two
grounds: it is the exact hypothesis under test ("right document, wrong span"), and scanning all
chunks per dropped claim would be O(chunks × quote × para) per claim, which is too slow for a
559-case batch.

Implementation: a pure `longestCommonSubstringLen(a, b)` using the standard two-row DP (O(n·m) time,
O(min(n,m)) space). It runs only on the drop path, on a quote of at most a few hundred characters
against a ~2 KB chunk, so the cost is negligible.

Adding a field is backwards-compatible: the two existing callers (`summarizeCase`,
`answerCaseQuestion`) destructure `{ anchors, dropped }` and are unaffected.

## Reporting — `scripts/cases-summarize.ts`

Aggregate `drops` across the batch and print, after the existing summary lines:

```
   drop diagnostics: no_span 402 · quote_too_short 88 · no_text 12 · cited-para-not-found 31
   no_span overlap: ≥0.5 → 24 · 0.25–0.5 → 61 · <0.25 → 317
   near-miss samples (overlap ≥0.5): 2010-scc-17 para-14 (0.78) · 2004-scc-73 para-8 (0.61) · …
```

The `≥0.5` bucket **is the recoverable population**. If it is a few percent, span alignment is not
worth building and we will have said so with a number. If it is large, the follow-up has both a
justification and a threshold that came from our own data rather than from a paper about a different
pipeline.

## Files

| File | Change |
|---|---|
| `src/lib/cases/briefs/generator.ts` | `verifyBriefing`: filter principle `caseIds` against surviving precedents. |
| `src/lib/cases/ingest/summarizer.ts` | `ClaimDropReason`/`ClaimDrop` types; `longestCommonSubstringLen`; `verifyClaims` returns `drops`. |
| `scripts/cases-summarize.ts` | Aggregate + print the drop histogram and near-miss samples. |
| `scripts/test-cases-briefs.ts` | Test for the dependency fix. |
| `scripts/test-cases-summarizer.ts` | Tests for the diagnostics + the LCS helper. |

Unchanged: which claims survive, which briefings publish, every anchor, `CitationAnchor`'s shape,
storage, retrieval, the `<2 precedents ⇒ refuse` rule, and the `≥15-char` / `max 6` claim rules.

## Testing (offline, TDD)

`scripts/test-cases-briefs.ts`:
- A principle citing a case whose precedent was dropped for an **empty `establishes`** → that id is
  removed; if it was the principle's only id, the principle is dropped.
- A principle citing a case dropped by the **6-entry cap** → same.
- A principle citing a surviving precedent → kept unchanged.
- Regression: the `<2 surviving precedents ⇒ null` rule still fires.

`scripts/test-cases-summarizer.ts`:
- `longestCommonSubstringLen`: identical strings → full length; no overlap → 0; a shared middle
  substring → its length; empty input → 0.
- `verifyClaims` diagnostics: a claim with no text → `no_text`; a 10-char quote →
  `quote_too_short`; a quote that is a near-miss of the cited paragraph (one word changed) →
  `no_span` with **high** `bestOverlap` and `citedParaFound` true; a fully paraphrased quote →
  `no_span` with **low** `bestOverlap`; a quote citing `para-999` that does not exist →
  `citedParaFound` false.
- **Regression, the important one:** for a fixture where claims currently pass, `anchors` and
  `dropped` are byte-identical to today's behaviour — the diagnostics change nothing.

Gate: `npx tsx scripts/test-cases-summarizer.ts` and `scripts/test-cases-briefs.ts` pass;
`npm run typecheck` clean; `npm run build` compiles; `npm run verify` unaffected.

## Operational

- **No credentialed run required to land this.** The diagnostics are emitted by the *next*
  `cases:summarize:cloud`, which is already a normal part of the derived-layer refresh ritual after
  the corpus grows — no extra job.
- Note that summaries already generated are skipped by default (`skipped_already_generated`), so a
  meaningful histogram needs either a corpus with new core cases or a `SUMMARIZE_FORCE=1` run. Say
  so at run time rather than being surprised by an empty histogram.

## Explicitly NOT doing

- **No span alignment / claim recovery.** That is the decision this measurement exists to inform.
- No change to the `<2 precedents` refusal rule, the `≥15-char` quote rule, or the 6-claim cap —
  those are separate questions (the refusal rule's calibration is its own future item).
- No NLI/entailment checking, no LePhantomCite-style agentic audit (that one is an offline
  audit tool at 47.6% precision — never an auto-drop gate).
- No storage of dropped claims — the histogram is a run-time log, not a new persisted layer.

## Success criteria

- A principle can no longer cite a case with no visible precedent entry, proven by a test.
- The next summarize run prints a drop histogram whose `no_span` overlap buckets tell us, from our
  own corpus, whether span alignment is worth building.
- Accepted claims, published briefings, and all anchors are unchanged — proven by a regression test.
