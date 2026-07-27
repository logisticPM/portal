# Textract-free in-country extraction — design

**Date:** 2026-07-27
**Status:** design, approved for planning
**Context:** `docs/ca-extraction-textract-scp.md` (why Textract is unavailable),
`docs/rap-extraction-findings.md` (engine history and measurements)

---

## Problem

An AWS Organizations SCP (`p-9n6l6a99`, management account `123896930307`) denies **all tested
Textract actions** to this account's *service roles*. Both `StartDocumentAnalysis` and
`StartDocumentTextDetection` were confirmed denied from the `ca` Lambda role on 2026-07-27;
a developer SSO session is allowed, so the deny is principal-conditional. We cannot lift it —
it belongs to an external administrator.

Consequence: the `bedrock` engine (Textract LAYOUT OCR → Claude) — the **only** in-country-at-rest
extraction path — cannot run on `ca`. The stage therefore sits on `EXTRACTION_IMPL=mock`, returning
canned output regardless of the uploaded document. The data-residency story has no working
implementation.

## Goal

A **production-quality** replacement for the OCR stage that needs no Textract, with page-grounding
parity — not a demo-grade stopgap. Verbatim quotes must remain checkable against the source, because
that is this pipeline's differentiator.

## Feasibility — already measured, not assumed

Probed live on `ca` (2026-07-27) by routing real RAP text through the existing Claude chain with
Textract entirely out of the path:

| Fact | Result |
| --- | --- |
| Bedrock `InvokeModelWithResponseStream` from the Lambda role in `ca-central-1` | **works** — not SCP-denied |
| Bank of Canada RAP (17pp) via `pdf-parse` text → Claude | **25 commitments**, 0 validation issues, 13.7s |
| Reference: same document via Textract→Claude / BDA | 26 / 22 commitments |
| Are the RAPs digital-born? | **yes** — BoC 21,994 chars, TMX 3,805 chars extracted |

So the commitments survive. **What does not survive is page grounding.** The probe returned the gold
action text verbatim —

```
"Invest in the CBNII to share work and learn best practices in economic Reconciliation"
```

— but attributed it to **page 12**, where `scripts/fixtures/gold-commitments-bankofcanada.json`
says **page 13**. `pdf-parse`'s default output is one flat blob with no page boundaries, so the model
*guesses* pages (measured at 1/10 correct, `rap-extraction-findings.md` §4a). Closing that gap is the
substance of this design.

A second defect: the TMX PDF yields a NUL byte wherever an `fi` ligature belongs
(`"its \u0000rst Reconciliation Action Plan"`), and Claude **silently repaired it** to `"first"` —
producing a quote that reads verbatim but does not match the source bytes. BoC had zero NULs, so this
is font-dependent, not universal. Silent repair of provenance is the one failure this pipeline must
not have.

---

## Approach

Three options were considered:

- **A. Hard-swap** the Textract call inside `pipeline.bedrock.ts`. Smallest diff, but deletes the
  Textract path — no A/B once the SCP lifts.
- **B. New engine** `pipeline.pdftext.ts`. Clean separation, but duplicates ~400 lines of chunking,
  forced-tool-call, retry/split and merge logic — the most hard-won code in the repo. Two copies will
  drift.
- **C. Pluggable document loader** inside the bedrock engine. **Chosen.**

### Why C

Document loading is the only place the strategies differ; the Claude orchestration is identical. A
seam there means no duplication, both paths stay live and comparable, and — critically — both real
risks (page markers, text fidelity) land inside a pure, unit-testable unit rather than requiring a
deploy to exercise.

When the SCP is lifted, restoring Textract is an env flip, not a code change.

### Explicit selection, never silent fallback

`DOC_LOADER` selects the loader. An unrecognised value **throws at startup**. There is deliberately no
"try Textract, fall back to text-layer on AccessDenied" behaviour: a pipeline that quietly downgrades
its own provenance guarantee is worse than one that fails. This repo has already been bitten twice by
quiet defaults — empty `DIGEST_*` silently degrading email to `skipped`
(`docs/notifications-delivery-status.md`), and `pipeline.ts:18`'s bare `runExtractionMock` fallthrough
silently serving fake extractions. We are not adding a third.

---

## Architecture

```
src/lib/rap/doc-loader/
  types.ts        DocLoader interface + typed errors
  index.ts        selectLoader(env) — the seam; throws on unknown DOC_LOADER
  textract.ts     existing LAYOUT path, moved verbatim (incl. buildTextFromLayoutBlocks)
  textlayer.ts    new pdf-parse path
```

```ts
export interface DocLoader {
  readonly name: "textract" | "textlayer";
  load(input: { sourceS3Key: string; fileName: string }): Promise<LoadResult>;
}

export interface LoadResult {
  text: string;                 // "[p.N]\n<paragraph>", blank-line separated
  fidelityDamaged: boolean;     // control chars / U+FFFD seen in the decoded text
  damagedOffsets: number[];     // positions, for reviewer context
}
```

`text` uses the **existing contract** — the same `[p.N]`-marked paragraph format
`buildTextFromLayoutBlocks` already produces and `chunkDocument` already consumes. Nothing downstream
changes.

### Changes outside the new module

- `pipeline.bedrock.ts` — `loadDocumentText` shrinks to loader selection + delegation. The Textract
  implementation and `buildTextFromLayoutBlocks` **move** into `doc-loader/textract.ts` unchanged.
  The `.txt` / `ALLOW_UNGROUNDED_TXT` branch moves to the loader layer (it is a loading concern).
  Re-export `buildTextFromLayoutBlocks` from its new home so `scripts/test-layout-text.ts` keeps working.
- `sst.config.ts` — add `DOC_LOADER` to `extractionEnv`, defaulting to `textlayer` off-prod and
  `textract` on prod (unused there today; prod runs `bda`).
- `src/lib/cases/ingest/pdf-parse.d.ts` — add an options overload for `pagerender`. Additive only;
  the cases pipeline shares this file.
- `EXTRACTION_IMPL=bedrock` is **not** renamed. The engine is Claude-on-Bedrock; how it obtains text
  is now a sub-strategy. Renaming would churn config across every stage for no gain.

---

## The text-layer loader

### Reconstructing paragraphs, not just pages

Per-page text alone is insufficient. `pdf-parse`'s default is a flat line join with no paragraph
boundaries, so `chunkDocument`'s paragraph split never fires and chunks are cut on the size budget —
potentially mid-commitment. This is exactly what the LAYOUT path was adopted to fix
(`pipeline.bedrock.ts:196-201`).

The loader therefore rebuilds structure from text-item geometry:

1. `pdf-parse`'s `pagerender` callback fires per page — capture each page's `getTextContent()` items.
2. Group items into **lines** by shared y-position (from each item's transform matrix).
3. Group lines into **paragraphs** where the vertical gap exceeds ~1.5× that page's median line gap.
4. Emit `[p.N]\n<paragraph>`, blank-line separated, page order preserved.
5. Reuse `splitOversizedBlockText` so every emitted piece carries its own `[p.N]` marker — identical
   to the LAYOUT path, and for the same reason (a marker-less piece gets attributed to whatever page
   precedes it: in-range, non-null, and wrong).

Pure function: bytes in, string out, no AWS. That is what makes the risks testable.

### Gate 1 — fidelity (flag, do not reject)

**The existing validator already carries most of this.** `ValidationRule` includes `quote_not_found`
("quote given, but it does not appear in the source document"), and `isClean()` returns false whenever
`validationIssues` is non-empty. So when Claude silently repairs the damaged word to `"first"`, the
repaired quote fails the source-substring check on its own — **no new detection mechanism is
required**. The TMX probe confirms the machinery fires: it returned `validationIssues: 2` and
`flagged: true` on the org field.

What is missing is **legibility, not detection**. A reviewer today sees N unexplained
`quote_not_found` errors with no signal that the *source text* is damaged rather than the model
hallucinating. So the loader adds exactly two things:

- replace unmappable bytes with `U+FFFD`, so damage is **visible** rather than an invisible NUL;
- emit **one document-level `ValidationIssue`** — new rule `"source_text_damaged"`, path `"$document"`,
  message naming the count and offsets.

That single issue makes `isClean()` false (such a document can never auto-publish) *and* explains to
the reviewer why the quote errors are there.

Rejecting outright was considered and declined: TMX's damage was 5 characters in 3,805, and killing a
whole RAP over one bad ligature blocks legitimate documents. The rule becomes *corrupt text may enter
the system, but never unreviewed.*

**Type change:** add `"source_text_damaged"` to the `ValidationRule` union in `src/lib/rap/types.ts`.
Additive; no existing consumer breaks. `LoadResult.fidelityDamaged` / `damagedOffsets` exist only to
carry this from loader to validator — they are not persisted, and `ExtractionResult` needs no change.

### Gate 2 — scanned documents

If extracted text totals under 200 characters, or averages under 50 per page, throw a typed
`ScannedDocumentError`:

> "This document has no extractable text layer and appears to be scanned. In-region extraction
> requires a text-based PDF."

`stageExtraction` already catches and records failures as `status: FAILED` with the message, so this
surfaces in the existing review UI with no new plumbing.

**Decision recorded:** we fail in-region rather than falling back to BDA in `us-east-1`. A silent
cross-border fallback is precisely the failure mode the residency architecture exists to prevent, and
an honest "we cannot process this in-region" is defensible where quiet exfiltration is not. Revisit
only as an explicit, user-visible choice.

Thresholds are named constants with a comment marking them as heuristics.

### Errors

Three typed failures, each carrying a message a non-engineer can act on (these land in the review
queue): `ScannedDocumentError`, `UnsupportedDocumentError` (neither PDF nor `.txt`), and loader
selection failure at startup for an unrecognised `DOC_LOADER`.

---

## Testing

### Committed, offline — `scripts/test-doc-loader-textlayer.ts`

Follows the existing `scripts/test-*.ts` convention (run individually with `npx tsx`). Fixtures are
**synthesised at test time with `pdf-lib`** (already a dependency), so no binary blobs are committed
and no test depends on an untracked dump:

- page markers attach to the right content across a 3-page synthetic PDF;
- paragraph grouping — large y-gaps split, tight line spacing does not;
- oversized paragraphs split with each piece carrying its own `[p.N]`;
- fidelity gate — an injected NUL sets `fidelityDamaged` and blocks auto-publish;
- scanned gate — a text-free PDF raises `ScannedDocumentError`;
- `selectLoader` throws on an unknown `DOC_LOADER`.

### Manual parity — `scripts/measure-textlayer-parity.ts`

Not in CI, because the source PDF is not in the repo (same rationale as
`scripts/test-layout-real-ocr.ts`). Runs the textlayer loader over the BoC PDF and diffs its p13/p15
output against `scripts/fixtures/textract-layout-p13-p15.json` rendered through
`buildTextFromLayoutBlocks`.

### Acceptance — needs `ca` + Bedrock

Score end-to-end output against `scripts/fixtures/gold-commitments-bankofcanada.json` (22 entries,
each with a page):

| Metric | Baseline measured 2026-07-27 | Target |
| --- | --- | --- |
| Actions matching gold | ~25 found, text matches | ≥22 of 22 |
| **Pages matching gold** | **fails — 12 vs 13** | 12 on p13, 10 on p15 |
| Fidelity flags | not implemented | 0 on BoC, >0 on TMX |

The page row is the bar. If it does not land, the approach has not met the stated goal and we record
that rather than shipping it.

---

## Rollout

1. **Land the seam, `DOC_LOADER` defaulting to `textract`.** Pure refactor: behaviour-neutral on every
   stage, offline tests green.
2. **Measure on `ca`** — flip to `textlayer` + `EXTRACTION_IMPL=bedrock`, run the acceptance script,
   record the numbers.
3. **Decide from the measurement.** Pages land → `ca` keeps it and it becomes the documented
   in-country path. Pages do not land → revert `ca` to `mock` and the finding joins the SCP
   escalation in `docs/ca-extraction-textract-scp.md`.

Step 1 being behaviour-neutral is deliberate: the risky part becomes a config flip, reversible in a
single deploy.

**Deploy note:** every `sst deploy --stage ca` must re-export `DIGEST_SENDER` / `DIGEST_RECIPIENT`, or
the notification email silently reverts to `skipped` (`docs/notifications-delivery-status.md`).

## Out of scope

- Lifting the SCP — external, tracked in `docs/ca-extraction-textract-scp.md`.
- Replacing BDA on prod. Prod works; this is about restoring an in-country path on `ca`.
- OCR for genuinely scanned documents. Explicitly rejected above.
