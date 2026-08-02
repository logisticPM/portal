# BDA Quote-Locate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the BDA (production/US) extraction path verbatim quotes + reliable pages by locating BDA's field values in the document's own text layer, so the review queue's evidence cards and jump-to-PDF links have something to cite.

**Architecture:** A new pure module `src/lib/rap/locate.ts` transforms an `ExtractedRap` by searching each locatable free-text field's value in the per-page text (`string[][]` from the existing `extractPagesFromPdf`) and filling in `quote` + `page` on exact-normalized hits. `pipeline.bda.ts` parses the full document's text once and calls this between building the merged extraction and validating it. Date-typed values are expanded into their exact human spellings so an ISO `publicationDate` still matches prose.

**Tech Stack:** TypeScript, Next.js/SST Lambda, `pdf-parse` (via `doc-loader/textlayer`), `npx tsx` test scripts with a `check()` harness.

## Global Constraints

- **Exact-normalized match only.** Match with the validator's own `normalizeForQuoteMatch` (from `src/lib/rap/validate.ts`); never fuzzy/edit-distance. Date variants are alternate *exact* spellings, not fuzziness.
- **Verbatim-source quote.** The stored `quote` is always a verbatim paragraph from the document text (capped), never a synthesized/echoed string — so it passes `quoteOccursIn` by construction.
- **Additive only.** `requireQuote` stays `false` on the BDA path. Locate only fills `quote`/`page`; it never introduces a new flag or changes which fields are flagged.
- **PDF-only, graceful.** BDA also accepts Office docs, which `textlayer` cannot parse; a parse failure must be caught and extraction must still succeed with BDA's original confidence-only grounding.
- **No new AWS calls, no infra change.** Reuse the `bytes` already fetched in `pipeline.bda.ts`.
- **Pure module.** `locate.ts` does no I/O, imports only types + `normalizeForQuoteMatch`.
- `MAX_QUOTE_CHARS = 240`.

Spec: `docs/superpowers/specs/2026-08-02-bda-quote-locate-design.md`.

---

## File Structure

- **Create** `src/lib/rap/locate.ts` — pure: `searchTermsFor`, `locateQuotes`, `MAX_QUOTE_CHARS`, internal month tables + `located` helper.
- **Create** `scripts/test-locate.ts` — `npx tsx` unit tests (`check()` harness).
- **Modify** `src/lib/rap/validate.ts` — add one additive `export` to `quoteOccursIn` so the test can assert the safety property directly.
- **Modify** `src/lib/rap/pipeline.bda.ts` — two imports + a `try/catch` locate call before `validateAndFlag`.

---

## Task 1: `searchTermsFor` — value → exact search terms

**Files:**
- Create: `src/lib/rap/locate.ts`
- Test: `scripts/test-locate.ts`

**Interfaces:**
- Consumes: `normalizeForQuoteMatch` from `./validate` (signature `(s: string) => string`).
- Produces:
  - `export const MAX_QUOTE_CHARS = 240`
  - `export function searchTermsFor(value: string): string[]` — returns the exact strings to search for a value. Non-date → `[value]`; `YYYY-MM-DD`/`YYYY-MM` → ISO value + de-duplicated human date spellings; bare `YYYY` → `[]`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-locate.ts`:

```ts
// Unit tests for the BDA quote-locate step. Run: npx tsx scripts/test-locate.ts
import { searchTermsFor } from "../src/lib/rap/locate";
import { normalizeForQuoteMatch } from "../src/lib/rap/validate";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const norm = (xs: string[]) => xs.map(normalizeForQuoteMatch);

// --- searchTermsFor ---
check("non-date value → [value]", JSON.stringify(searchTermsFor("TMX Group")) === JSON.stringify(["TMX Group"]));

check(
  "free-text timeline is not treated as a date",
  JSON.stringify(searchTermsFor("over a horizon of up to 10 years")) === JSON.stringify(["over a horizon of up to 10 years"]),
);

const ymd = norm(searchTermsFor("2025-09-25"));
check("YYYY-MM-DD includes ISO", ymd.includes(normalizeForQuoteMatch("2025-09-25")));
check("YYYY-MM-DD includes 'September 25, 2025'", ymd.includes(normalizeForQuoteMatch("September 25, 2025")));
check("YYYY-MM-DD includes '25 September 2025'", ymd.includes(normalizeForQuoteMatch("25 September 2025")));
check("YYYY-MM-DD includes 'Sep 25, 2025'", ymd.includes(normalizeForQuoteMatch("Sep 25, 2025")));
check("YYYY-MM-DD includes 'Sept 25, 2025'", ymd.includes(normalizeForQuoteMatch("Sept 25, 2025")));

const ym = norm(searchTermsFor("2025-09"));
check("YYYY-MM includes 'September 2025'", ym.includes(normalizeForQuoteMatch("September 2025")));
check("YYYY-MM includes 'Sep 2025'", ym.includes(normalizeForQuoteMatch("Sep 2025")));

check("bare YYYY → [] (too weak to cite)", searchTermsFor("2025").length === 0);

const single = norm(searchTermsFor("2025-09-05"));
check("single-digit day is un-padded → 'September 5, 2025'", single.includes(normalizeForQuoteMatch("September 5, 2025")));

const deduped = searchTermsFor("2025-05-01"); // May: full name === 3-letter abbrev
check("terms are de-duplicated by normalized form", new Set(norm(deduped)).size === deduped.length);

process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd portal && npx tsx scripts/test-locate.ts`
Expected: FAIL — `Cannot find module '../src/lib/rap/locate'` (module not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/rap/locate.ts`:

```ts
// ===========================================================================
// Quote-locate for the BDA extraction path. BDA returns clean field values +
// confidence + sparse bounding-box geometry, but NO verbatim text span, so the
// review queue's evidence cards / jump-to-PDF have nothing to cite (see
// docs/superpowers/specs/2026-08-02-bda-quote-locate-design.md). This module
// finds each value in the document's own per-page text layer and fills in a
// verbatim quote + reliable page. Pure: exact-normalized match only, and the
// stored quote is always verbatim source text, so it can never mis-cite.
// ===========================================================================
import { normalizeForQuoteMatch } from "./validate";
import type { ExtractedRap, Grounded } from "./types";

export const MAX_QUOTE_CHARS = 240;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// YYYY, YYYY-MM, or YYYY-MM-DD (the shape validate.ts calls "isoish").
const ISO_DATE_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/**
 * The exact strings to search the text for, given a field value.
 *
 *  • non-date            → [value]                 (unchanged for free text)
 *  • YYYY-MM-DD / YYYY-MM → ISO + human spellings   (so an ISO publicationDate
 *                                                    matches "September 25, 2025")
 *  • bare YYYY           → []                       (too weak to cite)
 *
 * Every term is still matched by exact-normalized substring downstream; these
 * are alternate exact spellings of ONE date, not fuzzy matching.
 */
export function searchTermsFor(value: string): string[] {
  const v = value.trim();
  const m = ISO_DATE_RE.exec(v);
  if (!m) return [v]; // not date-like → search the value as-is
  const [, year, mm, dd] = m;
  if (!mm) return []; // bare YYYY — too weak to cite
  const monthIdx = parseInt(mm, 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return [v];
  const full = MONTHS[monthIdx];
  const abbr = full.slice(0, 3); // Jan, Feb, … Sep, …
  const terms: string[] = [v];
  if (dd) {
    const day = String(parseInt(dd, 10)); // un-padded: "5", not "05"
    terms.push(`${full} ${day}, ${year}`, `${day} ${full} ${year}`, `${abbr} ${day}, ${year}`);
    if (full === "September") terms.push(`Sept ${day}, ${year}`);
  } else {
    terms.push(`${full} ${year}`, `${abbr} ${year}`);
    if (full === "September") terms.push(`Sept ${year}`);
  }
  // de-duplicate by normalized form (e.g. May's full name and 3-letter abbrev
  // collapse), keeping the first raw spelling of each.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const n = normalizeForQuoteMatch(t);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(t);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd portal && npx tsx scripts/test-locate.ts`
Expected: PASS — all `searchTermsFor` checks ✅, exit 0.

- [ ] **Step 5: Commit**

```bash
cd portal
git add src/lib/rap/locate.ts scripts/test-locate.ts
git commit -m "feat(rap): searchTermsFor — expand ISO dates into exact human spellings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `locateQuotes` — fill quote + page from the text layer

**Files:**
- Modify: `src/lib/rap/locate.ts`
- Modify: `src/lib/rap/validate.ts` (one additive `export`)
- Test: `scripts/test-locate.ts` (extend)

**Interfaces:**
- Consumes: `searchTermsFor`, `MAX_QUOTE_CHARS` (Task 1); `normalizeForQuoteMatch`, `quoteOccursIn` from `./validate`; `ExtractedRap`, `Grounded` from `./types`.
- Produces: `export function locateQuotes(extracted: ExtractedRap, pages: string[][]): ExtractedRap` — returns a new `ExtractedRap` with `quote`/`page` filled on locatable free-text fields that were found in `pages`; every other field (including canonical enums, `periodCovered`, `frameworkRefs`, `pillars`, `commitmentType`) returned unchanged.

- [ ] **Step 1: Make `quoteOccursIn` importable (additive export)**

In `src/lib/rap/validate.ts`, change the declaration `function quoteOccursIn(` to `export function quoteOccursIn(`. (Same additive-export pattern the file already uses for `normalizeForQuoteMatch`; no behavior change.)

- [ ] **Step 2: Write the failing test**

Append to `scripts/test-locate.ts` (before the final `process.exit`):

```ts
import { locateQuotes } from "../src/lib/rap/locate";
import { quoteOccursIn } from "../src/lib/rap/validate";
import { buildTextFromPages } from "../src/lib/rap/doc-loader/textlayer";
import type { ExtractedRap, Grounded } from "../src/lib/rap/types";

// Grounded<string> builder; page defaults to null (as BDA leaves most fields).
const g = (value: string | null, page: number | null = null): Grounded<string> => ({
  value,
  quote: null,
  page,
  confidence: 0.6,
  flagged: false,
});

// Minimal ExtractedRap. Only the fields under test carry real values; the rest
// are structurally valid placeholders. `as unknown as ExtractedRap` mirrors the
// pattern in scripts/test-rap-dataclass.ts.
function rap(over: Partial<ExtractedRap>): ExtractedRap {
  return {
    orgName: g(null), sector: g("other") as any, jurisdiction: g("CA") as any,
    rapTitle: g(null), publicationDate: g(null),
    periodCovered: { value: null, quote: null, page: null, confidence: 0.6, flagged: false },
    frameworkRefs: { value: null, quote: null, page: null, confidence: 0.6, flagged: false } as any,
    pillars: [], governanceBody: g(null), reviewCycle: g(null),
    rapType: g("reflect") as any, pairLevel: g("committed") as any, endorsementStatus: g(null),
    commitments: [], sectorFields: {}, extras: [],
    ...over,
  } as unknown as ExtractedRap;
}

// pages[i] is page i's paragraph list (0-indexed page, no [p.N] markers).
const pages: string[][] = [
  ["Cover — Reconciliation Action Plan"],                        // p.1
  ["Our organization, TMX Group, is committed to reconciliation."], // p.2
  ["This RAP was published September 25, 2025 following board approval."], // p.3
  ["Support increased capital flows to First Nations, Inuit, and Métis businesses and communities, and to advance economic reconciliation across every region in which we operate over the coming years as measured annually."], // p.4 (long)
];
const source = buildTextFromPages(pages);

// orgName located on p.2
{
  const out = locateQuotes(rap({ orgName: g("TMX Group") }), pages);
  check("orgName located: page", out.orgName.page === 2);
  check("orgName located: quote is the containing paragraph", out.orgName.quote === "Our organization, TMX Group, is committed to reconciliation.");
  check("orgName recovered quote passes quoteOccursIn", out.orgName.quote != null && quoteOccursIn(out.orgName.quote, source));
}

// ISO publicationDate matched via a date variant on p.3
{
  const out = locateQuotes(rap({ publicationDate: g("2025-09-25") }), pages);
  check("ISO date located via variant: page", out.publicationDate.page === 3);
  check("ISO date located: quote passes quoteOccursIn", out.publicationDate.quote != null && quoteOccursIn(out.publicationDate.quote, source));
}

// Value absent → untouched
{
  const out = locateQuotes(rap({ orgName: g("Nonexistent Corp") }), pages);
  check("absent value → quote stays null", out.orgName.quote === null);
  check("absent value → page unchanged", out.orgName.page === null);
}

// Canonical enum skipped even if the words appear
{
  const withSector = rap({ sector: { ...g("finance"), value: "finance" } as any });
  const out = locateQuotes(withSector, pages);
  check("canonical enum field is never located", out.sector.quote === null);
}

// Long paragraph → quote capped with … and still passes quoteOccursIn
{
  const out = locateQuotes(rap({
    commitments: [{
      pillarRaw: g("Opportunities"), pillarNormalized: null,
      action: g("Support increased capital flows to First Nations, Inuit, and Métis businesses and communities, and to advance economic reconciliation across every region in which we operate over the coming years as measured annually."),
      deliverable: g(null), timeline: g(null), owner: g(null), metric: g(null),
      commitmentType: g("other") as any,
    }] as any,
  }), pages);
  const q = out.commitments[0].action.quote;
  check("long action located on p.4", out.commitments[0].action.page === 4);
  check("long action quote capped at MAX_QUOTE_CHARS+ellipsis", q != null && q.length <= 241 && q.endsWith("…"));
  check("capped quote still passes quoteOccursIn", q != null && quoteOccursIn(q, source));
}

// Geometry page preferred when the value is on it (value appears on 2 pages)
{
  const multi: string[][] = [
    ["Foreword by TMX Group leadership."],   // p.1
    ["Details about TMX Group operations."],  // p.2
  ];
  const out = locateQuotes(rap({ orgName: g("TMX Group", 2) }), multi); // geometry says p.2
  check("geometry page preferred when term is on it", out.orgName.page === 2);
  const outNoGeom = locateQuotes(rap({ orgName: g("TMX Group") }), multi);
  check("no geometry → first occurrence", outNoGeom.orgName.page === 1);
}

// Already-quoted field is not overwritten
{
  const pre: Grounded<string> = { value: "TMX Group", quote: "pre-existing", page: 9, confidence: 0.6, flagged: false };
  const out = locateQuotes(rap({ orgName: pre }), pages);
  check("already-quoted field untouched", out.orgName.quote === "pre-existing" && out.orgName.page === 9);
}

// bare-year publicationDate is skipped (no citation) even though 2025 appears
{
  const out = locateQuotes(rap({ publicationDate: g("2025") }), pages);
  check("bare-year value → not located", out.publicationDate.quote === null && out.publicationDate.page === null);
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd portal && npx tsx scripts/test-locate.ts`
Expected: FAIL — `locateQuotes is not a function` / import error (not implemented yet).

- [ ] **Step 4: Write minimal implementation**

Append to `src/lib/rap/locate.ts`:

```ts
/**
 * Fill quote + page on one grounded free-text field by locating its value in
 * the per-page text. Returns the field unchanged if it has no value, already
 * has a quote, has no usable search terms (e.g. a bare year), or isn't found.
 *
 * Page precedence: if BDA supplied a geometry `page` and a term is found on it,
 * keep it; otherwise the first page (document order) where a term is found.
 */
function located(field: Grounded<string>, pages: string[][]): Grounded<string> {
  if (field.value == null || field.quote !== null) return field;
  const terms = searchTermsFor(String(field.value))
    .map((t) => normalizeForQuoteMatch(t))
    .filter((t) => t.length > 0);
  if (terms.length === 0) return field;

  const matchOnPage = (idx: number): string | null => {
    for (const para of pages[idx] ?? []) {
      const nPara = normalizeForQuoteMatch(para);
      if (terms.some((t) => nPara.includes(t))) return para;
    }
    return null;
  };

  // geometry page first (1-indexed → 0-indexed), then every other page in order.
  const geom = field.page != null && field.page >= 1 && field.page <= pages.length ? field.page - 1 : -1;
  const order: number[] = [];
  if (geom >= 0) order.push(geom);
  for (let i = 0; i < pages.length; i++) if (i !== geom) order.push(i);

  for (const idx of order) {
    const para = matchOnPage(idx);
    if (para) {
      const trimmed = para.trim();
      const quote =
        trimmed.length > MAX_QUOTE_CHARS ? `${trimmed.slice(0, MAX_QUOTE_CHARS).trimEnd()}…` : trimmed;
      return { ...field, quote, page: idx + 1 };
    }
  }
  return field;
}

/**
 * Recover verbatim quotes + reliable pages for a BDA extraction by locating its
 * free-text values in the document's own text layer. Canonical enums, derived,
 * and structured fields (sector, jurisdiction, commitmentType, rapType,
 * pairLevel, frameworkRefs, periodCovered, pillars) are left untouched — their
 * values are not literal document text.
 */
export function locateQuotes(extracted: ExtractedRap, pages: string[][]): ExtractedRap {
  const loc = (field: Grounded<string>) => located(field, pages);
  return {
    ...extracted,
    orgName: loc(extracted.orgName),
    rapTitle: loc(extracted.rapTitle),
    publicationDate: loc(extracted.publicationDate),
    governanceBody: loc(extracted.governanceBody),
    reviewCycle: loc(extracted.reviewCycle),
    endorsementStatus: loc(extracted.endorsementStatus),
    commitments: extracted.commitments.map((c) => ({
      ...c,
      pillarRaw: loc(c.pillarRaw),
      action: loc(c.action),
      deliverable: loc(c.deliverable),
      timeline: loc(c.timeline),
      owner: loc(c.owner),
      metric: loc(c.metric),
    })),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd portal && npx tsx scripts/test-locate.ts`
Expected: PASS — every check ✅, exit 0.

- [ ] **Step 6: Typecheck**

Run: `cd portal && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd portal
git add src/lib/rap/locate.ts src/lib/rap/validate.ts scripts/test-locate.ts
git commit -m "feat(rap): locateQuotes — recover verbatim quotes + pages from the text layer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire locate into the BDA pipeline

**Files:**
- Modify: `src/lib/rap/pipeline.bda.ts` (imports + a `try/catch` before `validateAndFlag`, currently ~lines 256–263)

**Interfaces:**
- Consumes: `locateQuotes` from `./locate` (Task 2); `extractPagesFromPdf` from `./doc-loader/textlayer` (`(buf: Uint8Array) => Promise<string[][]>`); `bytes: Uint8Array` already in scope in `runExtractionBda`.
- Produces: no new exports; `runExtractionBda` now returns quotes/pages on located fields.

- [ ] **Step 1: Add imports**

In `src/lib/rap/pipeline.bda.ts`, add near the existing `./` imports (e.g. after the `getDocumentBytes` import line):

```ts
import { extractPagesFromPdf } from "./doc-loader/textlayer";
import { locateQuotes } from "./locate";
```

- [ ] **Step 2: Insert the locate call before validation**

In `runExtractionBda`, find:

```ts
  const raw = parts.length === 1 ? parts[0] : mergeExtracted(parts);

  // BDA grounds by confidence (no quote) and on a lower scale → requireQuote=false, lower threshold
  const { extracted, issues } = validateAndFlag(raw, {
    requireQuote: false,
    threshold: BDA_CONFIDENCE_THRESHOLD,
  });
```

Replace with:

```ts
  const raw = parts.length === 1 ? parts[0] : mergeExtracted(parts);

  // Recover verbatim quotes + reliable pages for BDA's values (confidence +
  // sparse geometry, no text span) by locating them in the document's own text
  // layer. Best-effort: PDF-only, and any value not found stays quote:null.
  // `bytes` is already in hand from the fetch above.
  let located = raw;
  try {
    const pages = await extractPagesFromPdf(bytes); // full doc → global page numbers
    located = locateQuotes(raw, pages);
  } catch {
    // non-PDF (Office docs) or parse failure → keep BDA's confidence-only grounding
  }

  // BDA grounds by confidence (no quote) and on a lower scale → requireQuote=false, lower threshold.
  // Locate is additive: fields it couldn't find keep quote:null, so requireQuote stays false.
  const { extracted, issues } = validateAndFlag(located, {
    requireQuote: false,
    threshold: BDA_CONFIDENCE_THRESHOLD,
  });
```

- [ ] **Step 3: Typecheck**

Run: `cd portal && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full offline gate**

Run: `cd portal && npx tsx scripts/test-locate.ts && npx tsx scripts/test-validation-display.ts`
Expected: both PASS (locate green; the existing review-display test unaffected).

- [ ] **Step 5: Commit**

```bash
cd portal
git add src/lib/rap/pipeline.bda.ts
git commit -m "feat(rap): locate BDA field values in the text layer before validation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Live verification (after merge to main + deploy to production)

BDA is the only path that exercises this, so the real proof is on `production`:

1. Deploy `main` (with this merged) to `production`.
2. Re-upload `HydroQuebec_Reconciliation_Strategy.pdf` and `tmx-reconciliation-action-plan-2025.pdf` via `/extract`.
3. Expand each review card. Fields that previously read **"no source quote given"** now show a **"Cited: '…' · p.N"** line, and **"Open source PDF at p.N ↗"** appears on far more fields than the odd geometry-backed one.
4. Publication date, if flagged, now cites the prose sentence (e.g. "…published September 25, 2025…") thanks to date-variant matching.
5. Fields BDA genuinely rephrased still honestly show no quote — correct, not a regression.

Then proceed to merge #217 (`feat/review-field-edit-verify`) → deploy → confirm edit/verify (per the spec's Rollout).

---

## Self-Review

- **Spec coverage:** Component 1 `locateQuotes` → Task 2; `searchTermsFor` + date variants + bare-year skip → Task 1; locatable/skipped field registry → Task 2 (`locateQuotes` field list); page precedence + MAX_QUOTE_CHARS cap → Task 2 (`located`); Component 2 wiring + PDF-only try/catch + `requireQuote:false` → Task 3; every Testing bullet → Task 1/Task 2 checks; live verification → final section. No gaps.
- **Placeholder scan:** none — every step has runnable code or an exact edit.
- **Type consistency:** `searchTermsFor(value: string): string[]`, `locateQuotes(extracted: ExtractedRap, pages: string[][]): ExtractedRap`, `Grounded<string>`, and `extractPagesFromPdf(buf: Uint8Array): Promise<string[][]>` are used identically across tasks; `MAX_QUOTE_CHARS` defined in Task 1 and consumed in Task 2.
