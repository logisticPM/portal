# SCC PDF Full-Text Backfill (backfill v2) — Design

**Date:** 2026-07-07 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases/ingest/official-source.ts` (+ tiny `scripts` tweak)

## Motivation

Backfill v1 (bccourts HTML) proved the additive → promote → grow chain in code, but
its **ops run is blocked**: `www.bccourts.ca` sits behind BC-government WAF that lets a
single fetch through but blocks sustained automated access from our run environment
(two bulk runs: 806 processed / 0 text / 0 promoted). The code is correct; the *source*
is hostile.

The remaining no-full-text corpus (~2,821 cases) lives overwhelmingly on the **Lexum
family**, a completely different platform. The largest, highest-value bucket is the
**Supreme Court of Canada** (`decisions.scc-csc.ca`, ~1,114 cases) — the landmark
Indigenous economic-justice precedents (Tsilhqot'in, Haida, Delgamuukw, Marshall) are
all SCC. This spec pivots the backfill to SCC PDFs.

## Phase 0 findings (live probe from the run environment, 2026-07-07)

Both make-or-break unknowns were verified from **this machine** (same environment the
credentialed script runs in):

- **Reachability — GREEN.** `decisions.scc-csc.ca` returns HTTP 200, clean, no WAF
  challenge (unlike bccourts).
- **robots.txt — permits access.** `User-agent: *` has **no blanket `Disallow`**; only
  two specific `/icm/…` documents are disallowed (`120620`, `111322` — publication-ban
  cases). All `/scc-csc/` decisions are allowed for automated access.
- **Format — direct PDF.** Two real judgment endpoints returned genuine PDFs
  (`application/pdf`, `%PDF-1.6` / `%PDF-1.5`, ~341 KB / ~958 KB). `…/<id>/1/document.do`
  is a **direct download** — no JS-viewer shell to defeat. (A stale id returns a normal
  302, not a block.)

The remaining unknown is **PDF→text fidelity**, which is gated in ops (below), not
assumed.

## Decisions

- **v2 = SCC PDF only** (`decisions.scc-csc.ca`, ~1,114 cases). Biggest bucket, highest
  precedential value, and a clean direct-PDF path. The rest of the Lexum family (ONCA /
  FC / FCA / tribunals / `decisia.lexum.com`, ~900) is deferred to a later pass on the
  **same code path** (allowlist addition + per-host URL check).
- **Almost all change lives in `official-source.ts`.** The existing runner already lists
  `!fullTextAvailable && isOpenSource(sourceUrl)`, applies text, promotes inline, and
  flushes — so adding SCC to the allowlist and a PDF branch makes the runner pick SCC up
  automatically. The runner gets **one** small change: an optional host-scope filter so
  the ops run targets SCC and doesn't re-hammer the WAF-blocked bccourts host.
- **PDF library — `pdf-parse` (primary), evidence-gated.** SCC PDFs are digitally
  generated (text-based, not scanned), so a thin plain-text extractor suffices. The
  Phase-0 fidelity gate (ops step 1) is the go/no-go: if `pdf-parse` output is clean on
  the samples, ship it; if it shows reading-order or header/footer damage that
  deterministic cleanup can't fix, escalate to `pdfjs-dist` (position-aware assembly)
  before any bulk run. Do not pre-build the heavier path. (`pdf-lib`, already a dep, is
  for *authoring* PDFs and is not used here.)
- **Keep everything else from v1:** additive-safe (only `!fullTextAvailable` cases),
  official-open allowlist (**no CanLII**), **verbatim deterministic extraction (no LLM)**,
  `provenance.source="official_court"`, `unofficial:true`, polite pacing (`SLEEP_MS`).

## Architecture

### 1. `src/lib/cases/ingest/official-source.ts` (extend — the bulk of the work)

```ts
// Allowlist gains the SCC host.
export const OPEN_HOSTS = ["www.bccourts.ca", "decisions.scc-csc.ca"];

// robots.txt compliance: never fetch a disallowed document, even if it were in-corpus.
const ROBOTS_DENY = ["/icm/icm/en/item/120620/", "/icm/icm/en/120620/1/document.do",
                     "/icm/icm/en/item/111322/", "/icm/icm/en/111322/1/document.do"];

// SCC stored URLs may be the viewer form (…/item/<id>/index.do) or the PDF form
// (…/<id>/1/document.do). Normalize to the PDF form; pass document.do through unchanged.
// Non-SCC hosts returned unchanged.
export function toDocumentUrl(url: string): string;

// Deterministic, VERBATIM PDF → text (no LLM). pdf-parse → cleanup pass:
//  - de-hyphenate line-break splits ("compensa-\ntion" → "compensation")
//  - drop page-number-only lines and known running-header/footer lines
//  - normalize ligatures (ﬁ→fi, ﬂ→fl, …)
//  - collapse intra-line whitespace, paragraph-join on blank lines
// Only markup/artifacts removed — word characters never altered. Empty/garbage → "".
export async function pdfToText(buf: Buffer): Promise<string>;
```

`fetchOfficialText(url, get?)` changes:
- Deny-list check first: any `ROBOTS_DENY` substring → return `""`.
- `url = toDocumentUrl(url)` before fetching.
- After a successful fetch, branch on content-type: `application/pdf` (or a
  `document.do` URL) → `pdfToText(buf)`; otherwise the existing `htmlToText`.
- Everything else unchanged: browser UA, retry-once on non-OK, `MIN_TEXT` floor,
  charset handling for HTML, `""` on non-open host / short / error.

### 2. `scripts/cases-backfill-fulltext.ts` (one small change)

Add an optional host-scope filter so the ops run targets SCC cleanly:

```ts
const HOST = process.env.BACKFILL_HOST; // e.g. "decisions.scc-csc.ca"
const todo = all.filter((c) =>
  !c.fullTextAvailable &&
  isOpenSource(c.provenance.sourceUrl) &&
  (!HOST || new URL(c.provenance.sourceUrl).host === HOST));
```

Everything else (fetch → `applyFullText` → `provenance.source="official_court"` →
`promoteOne` inline → BatchWrite flush-every-100, resumable, paced) is unchanged.

New chunks carry no vectors → a case that gains text needs `cases:embed` +
`cases:index-build` afterward (ops, below).

## Governance

- **Verbatim, no LLM.** Deterministic PDF→text keeps downstream summary / figure /
  nations verbatim re-anchoring valid. A PDF that extracts empty/garbage (`< MIN_TEXT`)
  is **skipped**, never stored — safe-fail toward 宁缺毋滥. The failure mode of imperfect
  PDF extraction is *lost recall* (a real quote fails `normWs` re-anchor and is dropped),
  never fabrication — the integrity-preserving direction.
- **Fidelity gate (the key safeguard).** Bulk runs only after ops step 1 confirms the 2–3
  sample PDFs extract to clean, single-column-correct, verbatim text (a known quote
  survives `normWs`).
- **robots.txt honored** via `ROBOTS_DENY`; SCC decisions are explicitly allowed.
- **Additive-safe.** Only `!fullTextAvailable` cases touched; existing full text / vectors
  never rewritten. Per-case idempotent, resumable.
- **Official-open only** (`isOpenSource` gate, no CanLII). `provenance.source="official_court"`,
  `unofficial:true`, standing unofficial-reproduction disclaimer; reproduced under
  Crown-copyright reproduction terms.
- **Respectful.** `SLEEP_MS` pacing (400 ms); no raw-PDF disk caching (resumability comes
  from the `!fullTextAvailable` skip — avoids ~1 GB of cached PDFs).

## Testing (offline, TDD)

Extend `scripts/test-cases-official-source.ts` (node:assert/strict):

- **`isOpenSource`:** `https://decisions.scc-csc.ca/…` → true; `https://www.bccourts.ca/…`
  → true; `https://www.canlii.org/…` → false.
- **`toDocumentUrl`:** `…/scc-csc/en/item/2189/index.do` → `…/scc-csc/en/2189/1/document.do`;
  a `…/document.do` URL → unchanged; a non-SCC URL → unchanged.
- **`ROBOTS_DENY`:** `fetchOfficialText` with an injected `get` returns `""` for a
  `/icm/…/120620/1/document.do` URL **without calling `get`**.
- **`pdfToText`:** on a tiny fixture PDF buffer (authored in-test with `pdf-lib`, or a
  committed minimal fixture) containing a hyphenated line break, a page-number line, and
  a ligature → returns the paragraphs verbatim, de-hyphenated, page number dropped,
  ligature normalized; output is a whitespace-normalized substring set of the source
  (no invented words).
- **`fetchOfficialText`** with injected `get`: a `document.do` URL whose `get` returns a
  PDF buffer → `pdfToText` output; a `canlii.org` URL → `""` (no fetch); a `get` that
  throws → `""`.
- `npm run typecheck` clean; `npm run build` compiles. **`npm run verify` NOT run.**

## Operational run (post-merge, credentialed — measured, not code)

1. **Fidelity gate (go/no-go).** Fetch 2–3 real SCC PDFs by stored `sourceUrl`, run
   `pdfToText`, and confirm: clean readable text, correct reading order, a known quote
   survives `normWs` re-anchor. **Proceed only if clean;** otherwise stop and escalate the
   lib to `pdfjs-dist` (re-open this spec).
2. `BACKFILL_HOST=decisions.scc-csc.ca cases:backfill-fulltext:cloud` — fetch + inline
   promote over the SCC no-text cases (reports fetched / promoted / skipped).
3. `cases:embed:bedrock:cloud` — embed the new chunks (backfill changes chunks → this
   **does** require re-embed).
4. `cases:index-build:cloud` — rebuild + upload the search artifact
   (`INDEX_BUCKET` passed explicitly).
5. Refresh derived layers over the new core: `cases:summarize:cloud` /
   `cases:extract-figures:cloud` / `cases:extract-nations:cloud`.
6. Record a Result section: cases backfilled, promoted-to-core count, new core total, a
   verbatim spot-check (extracted text matches the SCC PDF), confirmation no existing
   case was altered.

## Success criteria

- **Offline:** extractor/URL/deny-list/fetch tests green; typecheck + build clean;
  `CaseRepo` untouched.
- **Ops:** the fidelity gate passes; SCC no-text cases gain verbatim, paragraph-structured
  full text with `provenance.source="official_court"`; a spot-check confirms fidelity; a
  meaningful number promote to core (corpus grows past 452); existing cases untouched.

## Deferred (later pass, same code path)

The rest of the Lexum family (ONCA / FC / FCA / federal tribunals / `decisia.lexum.com`,
~900): add each host to `OPEN_HOSTS`, confirm its `document.do` URL form and robots.txt,
and re-run with `BACKFILL_HOST` per host. Built once SCC proves the PDF path end-to-end.
