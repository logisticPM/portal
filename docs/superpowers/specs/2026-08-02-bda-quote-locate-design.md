# Design: Recover verbatim quotes + reliable pages for the BDA extraction path

**Date:** 2026-08-02
**Branch:** `feat/bda-quote-locate` (off `main` @ abb6a79, i.e. after #215)
**Ships before:** #217 (review field edit/verify) — see Rollout.

## Problem

On the US/`production` deployment (`EXTRACTION_IMPL=bda`), the review queue's evidence
cards and "Open source PDF at p.N" jump links have almost nothing to cite. Testing
Hydro-Québec + TMX on production showed nearly every flagged field reading
*"no source quote given"*, and a page number on only the odd field.

The cause is structural, not a bug. Amazon Bedrock Data Automation (BDA) is a
custom-*blueprint* extraction service: it returns `inference_result` (clean field
values) plus `explainability_info` (`{confidence, geometry, value}` per field).
`geometry` is a **bounding box with a page number**, never a verbatim text span. So
`src/lib/rap/pipeline.bda.ts` hardcodes `quote: null` and takes `page` from
`ex.geometry?.[0]?.page` — present for only some fields. Validation runs
`requireQuote: false` accordingly (`validate.ts:17-21` — "BDA grounds by confidence,
not a text quote").

By contrast the `ca` path (`pipeline.bedrock.ts` + `doc-loader/textlayer.ts`) shows
Claude the document as `[p.N]`-marked text and the model returns a verbatim quote per
field, which `quoteOccursIn` verifies. That is why `ca` has rich citations and BDA
does not.

The #215 review UI (evidence cards, "Cited: '…' · p.N", jump-to-PDF) is calibrated for
an engine that returns quotes+pages. Under BDA it degrades. This design gives the BDA
path something to cite by **locating BDA's field values in the document's own text
layer** — which we already extract for the `ca` path — and recovering a verbatim quote
plus a reliable page.

## Non-goals

- No change to the `ca`/bedrock path (already produces quotes).
- No new AWS calls, no infra/permissions change, no second LLM pass.
- No change to what gets *flagged*. Locate is additive: it only fills in
  `quote`/`page`; it never turns a found/not-found result into a validation failure.
- Not fuzzy. Only exact-normalized matches are trusted, so a recovered quote can never
  point at the wrong span. Date-variant matching (below) is **not** an exception: each
  variant is a different *exact* spelling of the same date, still matched by
  exact-normalized substring, and the stored quote is always verbatim source text.
  Fields BDA rephrased into something absent from the text stay honestly uncited.

## Approach (chosen)

**Locate BDA values in the existing per-page text layer.** Reuse
`extractPagesFromPdf()` (the `ca` workhorse) to get `string[][]` — per-page paragraph
arrays for the full document — and search each BDA field value in it. Pure, testable,
no new dependency or AWS call, one local PDF parse.

Alternatives considered and rejected:

- **Map BDA's bounding-box geometry to underlying text.** Still needs the text layer to
  read the box, geometry is sparse, and it is much fiddlier — strictly worse coverage
  than locating by value.
- **Second LLM grounding pass.** Adds cost + latency and reintroduces the hallucination
  risk the codebase is built to avoid.

## Component 1 — `src/lib/rap/locate.ts` (new, pure)

```ts
export function locateQuotes(extracted: ExtractedRap, pages: string[][]): ExtractedRap
```

For each **locatable free-text grounded field** with a non-null `value` and
`quote === null`:

1. Build the field's **search terms** via `searchTermsFor(value)`:
   - Non-date value → `[value]` (the value itself).
   - ISO date `YYYY-MM-DD` or `YYYY-MM` → the ISO value **plus** human-format variants
     of the same date (see `searchTermsFor` below). This is what lets an ISO
     `publicationDate` (`2025-09-25`) match prose that reads "September 25, 2025".
   - Bare `YYYY` → `[]` (empty). A 4-digit year is too weak to be a meaningful
     citation (it would match any paragraph mentioning the year), so the field is
     **skipped** rather than cited on a bare year.
   - Empty terms → field untouched, move on.
2. Normalize each term and the page text with the validator's own
   `normalizeForQuoteMatch` (imported from `./validate`) — lowercase, non-alphanumeric →
   space, collapsed spaces. Using the same function is what guarantees a recovered quote
   passes `quoteOccursIn` by construction.
3. Scan `pages` for a **hit**: a paragraph whose normalized text *includes* the
   normalized form of **any** search term (alternate spellings of one value; first
   found wins). See Page precedence for scan order.
4. On a hit, set:
   - `quote` = the verbatim containing paragraph, trimmed, capped at `MAX_QUOTE_CHARS`
     (240) with a trailing `…` when truncated. A capped prefix is still a substring of
     the source, and `quoteOccursIn` splits on `…`, so the recovered quote still
     validates.
   - `page` = the hit page's 1-indexed number.
5. **Page precedence:** if BDA already supplied a `geometry` page (`g.page != null`) and
   any search term is found on *that* page, keep it; otherwise use the first page where a
   term is found.
6. **No hit → field untouched** (`quote` stays `null`, any geometry `page` preserved).
7. **Already-quoted field → untouched** (defensive; BDA never sets a quote today).

**Locatable fields** (values expected to be literal document text):

- Top-level: `orgName`, `rapTitle`, `governanceBody`, `reviewCycle`,
  `endorsementStatus`, `publicationDate`.
- Per commitment: `pillarRaw`, `action`, `deliverable`, `timeline`, `owner`, `metric`.

**Skipped** (canonical / derived / structured — not literal doc text): `sector`,
`jurisdiction`, `commitmentType`, `rapType`, `pairLevel`, `frameworkRefs`,
`periodCovered`, `pillars`.

### `searchTermsFor(value: string): string[]`

A small pure helper in the same module. Returns the exact strings to search for a
given value:

- **Not an ISO date** (fails `^\d{4}(-\d{2}(-\d{2})?)?$`) → `[value]`. Unchanged
  behavior for every free-text field (`orgName`, `action`, the free-text `timeline`
  like "over a horizon of up to 10 years", etc.).
- **`YYYY-MM-DD`** → the ISO value plus human forms of that exact date:
  `"September 25, 2025"`, `"25 September 2025"`, `"Sep 25, 2025"`, `"Sept 25, 2025"`
  (day un-padded; both `Sep` and `Sept` abbreviations). `normalizeForQuoteMatch`
  strips the commas, so comma/no-comma spellings collapse to the same normalized form
  and are de-duplicated.
- **`YYYY-MM`** → the ISO value plus `"September 2025"`, `"Sep 2025"`, `"Sept 2025"`.
- **`YYYY` only** → `[]`. A bare year is too weak to cite meaningfully, so the field
  is skipped (no citation) rather than matched on the year alone.

Every returned term is still matched by exact-normalized substring, and the stored
quote is always the verbatim source paragraph — so date variants add coverage without
ever enabling a wrong citation. Only `publicationDate` is an ISO-typed locatable field
today (`periodCovered` is skipped; `timeline` is free text), but the helper is written
against the value shape, not the field name, so any future ISO field benefits.

The function is a pure transform over `(ExtractedRap, pages)` → `ExtractedRap`,
immutable (returns a new object; does not mutate its input), and imports only
`normalizeForQuoteMatch` and types — no I/O, no AWS, no React.

## Component 2 — wire into `src/lib/rap/pipeline.bda.ts`

One insertion point, after `raw` is built (currently line 257) and before
`validateAndFlag` (line 260). Reuses `bytes` already fetched at line 253:

```ts
// Recover verbatim quotes + reliable pages for BDA's values (confidence + sparse
// geometry, no text span) by locating them in the document's own text layer.
// Best-effort: PDF-only, and any value not found stays quote:null.
let located = raw;
try {
  const pages = await extractPagesFromPdf(bytes); // full doc → global page numbers
  located = locateQuotes(raw, pages);
} catch {
  // non-PDF (Office docs) or parse failure → keep BDA's confidence-only grounding
}
const { extracted, issues } = validateAndFlag(located, {
  requireQuote: false, // unchanged — locate is additive, never a gate
  threshold: BDA_CONFIDENCE_THRESHOLD,
});
```

- Import `extractPagesFromPdf` from `./doc-loader/textlayer` and `locateQuotes` from
  `./locate`.
- **Full-document parse**, not the ≤20-page BDA chunks, so recovered pages are already
  in the document's global numbering — no interaction with `offsetChunk`.
- `requireQuote` stays `false`: fields locate can't find are never turned into
  `no_quote` flags, so the flag set the reviewer sees does not grow.
- The `try/catch` keeps non-PDF inputs (BDA also accepts Office docs, which
  `textlayer` does not parse) and any parse failure graceful — extraction still
  succeeds with BDA's original confidence-only grounding.

## Data flow

```
BDA jobs → mapBdaToExtracted / mergeExtracted → raw:ExtractedRap
  (values + confidence + sparse geometry pages, quote=null)
        │
        ├─ extractPagesFromPdf(bytes)  → pages: string[][]   (full doc, [p.N] contract)
        ▼
  locateQuotes(raw, pages) → located:ExtractedRap
  (locatable free-text fields now carry verbatim quote + reliable page)
        ▼
  validateAndFlag(located, {requireQuote:false, threshold:0.5})
        ▼
  ExtractionResult → review queue → #215 evidence cards + jump-to-PDF now cite
```

## Error handling

- **Non-PDF / parse failure:** caught; extraction proceeds with BDA grounding unchanged.
- **Value not found:** field left as-is (honest null quote). Never a failure.
- **Empty text layer / scanned PDF:** `extractPagesFromPdf` returns sparse/empty pages;
  no matches → no quotes recovered, no error. (BDA still handles scans; locate simply
  adds nothing there.)
- **Page-number drift:** avoided by parsing the full document (global numbering) rather
  than per-chunk.

## Testing

**Unit — `scripts/test-locate.ts`** (`npx tsx`, `check()` style, synthesized pages):

- Value present in a page paragraph → `quote` = containing paragraph, `page` correct.
- **Recovered quote passes `quoteOccursIn`** against `buildTextFromPages(pages)` — the
  safety property, asserted directly.
- Value absent → field unchanged (`quote` null, original geometry page preserved).
- Canonical enum field (e.g. `sector: "Finance banking"`) → skipped even if the words
  appear in the text.
- Multi-page value → **geometry page preferred** when the value is on it; **first
  occurrence** otherwise.
- Per-commitment fields (`action`, `pillarRaw`, `timeline`) located; global page numbers.
- Already-quoted field → not overwritten.
- Paragraph longer than `MAX_QUOTE_CHARS` → quote capped with `…` and still passes
  `quoteOccursIn`.
- **Date variants:** ISO `publicationDate` `2025-09-25` with the doc prose reading
  "Published September 25, 2025" → located; quote = the prose paragraph; passes
  `quoteOccursIn`. Abbreviated-month prose ("Sept. 25, 2025") also located. `YYYY-MM`
  value with "September 2025" in the text → located.
- **Bare year guard:** `publicationDate` `2025` → skipped (no quote/page) even though
  "2025" appears in the text.
- `searchTermsFor` unit cases: non-date → `[value]`; `YYYY-MM-DD` → ISO + de-duplicated
  human forms; `YYYY` → `[]`.

**Offline gate:** `npx tsc --noEmit`; `npx tsx scripts/test-locate.ts`; existing
`scripts/test-validation-display.ts` still passes.

**Live on `production` (BDA — the only path that exercises this):**

1. Re-upload Hydro-Québec + TMX; expand the review cards.
2. Flagged fields that previously said *"no source quote given"* now show
   **"Cited: '…' · p.N"**, and **"Open source PDF at p.N ↗"** appears on many more
   fields than the odd geometry-backed one.
3. Fields BDA genuinely rephrased still show no quote — correct, not a regression.

## Files

- `src/lib/rap/locate.ts` — new pure module: `locateQuotes`, `searchTermsFor`, field
  registry, `MAX_QUOTE_CHARS`.
- `src/lib/rap/pipeline.bda.ts` — parse full-doc text + call `locateQuotes` before
  `validateAndFlag`; two imports.
- `scripts/test-locate.ts` — new unit test.

## Rollout

1. Implement + test on `feat/bda-quote-locate`.
2. PR → squash-merge to `main` → deploy to `production`.
3. Confirm citations appear on BDA (re-upload the two docs).
4. **Then** merge #217 (`feat/review-field-edit-verify`) → deploy → confirm edit/verify.

Locate ships first so #217's evidence cards have something to cite the moment they go
live on production.
