# Spike: how should we find chunk boundaries in a real RAP?

**Status:** ready to execute in a fresh session. **Decides F1 in `.superpowers/sdd/progress.md`, which blocks Task 3 of `2026-07-16-option-b-chunked-extraction.md`.**

**Branch:** `fix/bedrock-model-id` (held local — carries the model-id fix + the chunking plan + the chunker).

## Why this spike exists

The chunking plan justified no-overlap chunking with: *"we split only at blank-line paragraph boundaries, which is where RAP commitments actually separate."* **That argument is false on real input, and the plan was wrong to assert it.**

```
pipeline.bedrock.ts:83   return lines.join("\n")     ← Textract LINE blocks, SINGLE newlines
chunk.ts:66              .split(/\n\s*\n/)           ← paragraph split needs a BLANK line
```

Real OCR'd text contains no blank lines, so the paragraph split never fires, the whole document becomes one paragraph, and everything falls through `splitLargeParagraph` — sentence splitting, which is (i) untested and (ii) able to cut a commitment mid-record.

Rather than argue about which boundary source is best, **run all three against the same real document and measure.**

## The three arms

All three answer one question — *where do we cut?* — from a different source. They differ in **where** they change things, which matters for isolation:

| Arm | Boundary source | Changes | Cost |
|---|---|---|---|
| **(a) LAYOUT** | Textract `StartDocumentAnalysis` with `FeatureTypes: ["LAYOUT"]` → reading-order blocks (`LAYOUT_TEXT`, `LAYOUT_LIST`, `LAYOUT_SECTION_HEADER`…). Emit a real blank line between blocks. | `loadDocumentText` in `pipeline.bedrock.ts` | A different Textract call (costs more per page); LAYOUT **is verified available in ca-central-1** at the feature level |
| **(b) single-newline** | Existing `LINE` blocks; treat each `\n` as a boundary. | `chunk.ts` split regex | Trivial |
| **(c) sentence (status quo)** | Existing `LINE` blocks; sentence split via `splitLargeParagraph`. | nothing — already implemented | Free |

**Do not assume (a) wins.** Textract LAYOUT on a dense RAP may produce blocks that are too coarse (a whole section) or too fine (every bullet). That is what the measurement is for.

## Ground truth

**`s3://indigenomics-portal-ca-rapuploadsbucket-bbhvotne/test/BankOfCanada_RAP.pdf`** (534 KB) — the team's real test RAP, almost certainly the 13-page document in `docs/rap-extraction-findings.md`. That doc reports **BDA extracted ~22 commitments** from it. Treat ~22 as the reference count, **not gospel** — BDA may itself have missed some. A wildly different number in any arm is a signal to investigate, not automatically a failure.

**Everything measured so far used synthetic `.txt`, which bypasses Textract entirely** (`loadDocumentText` short-circuits on `.txt`). No arm has ever seen real OCR output. That is the whole point of this spike.

## Method

1. **Dump the OCR once, per arm's source.** Before extracting anything, write the raw Textract output for the real PDF to a local file for both `DetectDocumentText` (LINE) and `AnalyzeDocument` (LAYOUT). Inspect them. **This alone may settle the question** — if LAYOUT blocks map cleanly onto commitments, (a) wins on inspection and you have saved three extraction runs. Cache these dumps; Textract on a 13-page PDF is slow and costs money per run.
2. For each arm, produce the chunk list for the real document and record: **chunk count, char sizes, and — by eye on a sample — whether any chunk boundary cuts through a commitment.** A boundary that splits "Action: … / Deliverable: …" is the failure this spike exists to detect.
3. Only then run the actual extraction per arm (Claude, ca-central-1, `us.` profile) and record per arm:
   - total commitments returned vs the ~22 reference
   - how many have a **non-null quote AND page** (the grounding contract)
   - any `stop_reason: max_tokens` or `aborted`
   - elapsed + total output tokens
4. **Compare the commitment SETS, not just the counts.** Two arms returning 22 each could be returning different 22s. Diff the `action` texts across arms — a commitment found by (a) but not (c) is the interesting result.

## Isolation

Run the three arms in **separate git worktrees** (`isolation: "worktree"`) — (a) and (b) touch overlapping files and would conflict. Each arm branches from `fix/bedrock-model-id`.

## Rules

- **Read-only against AWS.** Mock repo, no table writes. Prod RapData is empty (verified 0 items) and must stay that way. Do not upload, delete, or modify any S3 object.
- **Do not re-derive the measured facts** in the chunking plan (~410 output tokens/commitment; 22 works 3/3; 32 fails 3/3; ~15% variance; raising `max_tokens` makes it worse). They cost real money. The diagnostic is preserved at `scratchpad/diag-truncation-final.ts`.
- **Do not try to explain the underlying failure mechanism** (89% of the output budget billed to tokens in no stream channel, on two models, in two regions). Chunking sidesteps it deliberately.
- Fix **F2** (`splitLargeParagraph` is completely untested and is the production path) as part of whichever arm wins — or before, since (c) depends on it entirely.
- Carry **F4** into Task 3: `splitInHalf` returns both halves with the PARENT's `index`. Never key/Map/dedupe chunks by `index` after a split — renumber first. Append-order iteration is safe.

## Decision criteria

Pick the arm that maximises **commitments correctly extracted with intact grounding**, tie-broken by simplicity. Explicitly acceptable outcomes:

- **(c) is good enough** → the cheapest result. Say so plainly; do not gold-plate to (a) for elegance.
- **(a) wins** → also fixes the `Page`/`Confidence` waste (`pipeline.bedrock.ts:74-77` discards both today) and sets up the agreed Textract QUERIES follow-up for header grounding.
- **None is good enough** → that is a real finding. Report it rather than shipping the least-bad option.

Whatever wins: **record the measurement in `docs/rap-extraction-findings.md`.** §4 is currently stale and actively misleading (see the chunking plan's Task 5 Step 5).

## Also carry forward

**F3 — chunking is whitespace-lossy** (`chunk.ts:136-139` trims paragraphs; `splitLargeParagraph` rejoins sentences with a literal `" "`). Currently **latent, not a live bug**: `validate.ts:28`'s `requireQuote` only checks `quote === null` and never substring-matches the document. But any future grounding check that compares a quote against the ORIGINAL text will get false negatives. Either compare quotes against the **chunk the model actually saw**, or make the chunker preserve exact substrings (index-slicing rather than trim+split+rejoin). Arm (a) should consider preserving exact source offsets while it is in there.
