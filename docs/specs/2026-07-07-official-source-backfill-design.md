# Official-Source Full-Text Backfill (corpus depth) — Design (rev. post-probe)

**Date:** 2026-07-07 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases/ingest` + `scripts`

## Motivation

The corpus is A2AJ-bounded: A2AJ `/fetch` returned no `unofficial_text_en` for
**2,821** cases, leaving them as metadata-only stubs. Full text is what the value
features consume (summaries, figures, briefings, dense retrieval). This backfills
full text from official open sources by the source URL A2AJ already stored in
`provenance.sourceUrl`, deepening the corpus.

## Phase 0 findings (credentialed probe, 2026-07-07)

Of the 2,821 no-full-text cases, essentially **all point to official open court
sites — ZERO CanLII**:

| host | count | format |
|---|---|---|
| `decisions.scc-csc.ca` (SCC, Lexum) | 1,114 | **PDF** (`…/<id>/1/document.do`) |
| `www.bccourts.ca` (BC SC/CA) | 806 | **HTML** (`.htm`; older = PDF) |
| `decisia.lexum.com` (fed. tribunals) | 294 | PDF (Lexum) |
| `coadecisions.ontariocourts.ca` (ONCA, Lexum) | 207 | PDF (Lexum) |
| `decisions.fct-cf.gc.ca` (FC) | 166 | PDF (Lexum) |
| `decisions.fca-caf.gc.ca` (FCA) | 113 | PDF (Lexum) |
| federal tribunals (Lexum) | ~120 | PDF |

Two consequences: (1) the **Lexum family serves PDF**, not HTML (the `index.do`
page is a JS viewer shell; the text lives in `application/pdf` at `…/<id>/1/document.do`);
(2) the no-text split is **core 2 / substrate ~1,687**, so backfill mostly deepens
**substrate**, which then becomes **promotable to core** — i.e. the real payoff is
core growth well beyond 452.

## Decisions (from brainstorm + probe)

- **v1 = bccourts.ca HTML only** (806 cases). It's the clean HTML path (no PDF
  dependency, no PDF-fidelity risk), it proves the whole backfill → promote → growth
  chain on a bounded set, and it fills the *provincial* coverage gap the corpus most
  lacks.
- **PDF (Lexum family, ~1,900) is deferred to v2** — its own spec (a PDF→text lib
  like `pdfjs`, the `index.do → <id>/1/document.do` URL transform, fidelity
  validation), built once v1 proves the chain.
- **Keep:** additive-safe (only `!fullTextAvailable` cases), official-open allowlist
  (no CanLII), **verbatim deterministic extraction (no LLM)**, provenance
  `source:"official_court"`.

## Architecture

### 1. Open-source fetcher — `src/lib/cases/ingest/official-source.ts` (new)

```ts
export const OPEN_HOSTS: string[] = ["www.bccourts.ca"]; // v1; v2 adds the Lexum PDF hosts
export function isOpenSource(url: string): boolean;       // host ∈ OPEN_HOSTS

// Deterministic HTML→text: drop <script>/<style>/<nav>/<header>/<footer>, take the
// judgment body, convert block elements to paragraph breaks (\n\n), decode entities,
// collapse intra-line whitespace. VERBATIM — no model. Output feeds chunkText, whose
// no-overlap chunks must still reproduce the source. The exact bccourts body
// container is pinned from a live sample during implementation (a small spike);
// if extraction yields empty/garbage for a page, return "" so that case is skipped.
export function htmlToText(html: string): string;

// Fetch (browser UA — some official sites 403 non-browser agents) + extract.
// `get` injectable for tests; "" on a non-open host, network failure, or empty extract.
export async function fetchOfficialText(url: string, get?: (u: string) => Promise<string>): Promise<string>;
```

### 2. Backfill runner — `scripts/cases-backfill-fulltext.ts` (new)

Mirrors `cases-fetch-fulltext.ts`:
- List `!fullTextAvailable` core+substrate cases; keep those with
  `isOpenSource(c.provenance.sourceUrl)` (v1 → bccourts).
- `fetchOfficialText(url)` → if non-empty: `applyFullText(c, text)`, set
  `provenance.source = "official_court"` (keep `sourceUrl`, `unofficial:true`), then
  `promoteOne` inline (same fused promotion as fetch-fulltext) → write PROFILE+CHUNK.
- Cases whose URL isn't open, or that yield no text, are skipped (unchanged).
- Flush every 100 (resumable — skips `fullTextAvailable`); cached; per-case idempotent.
- npm scripts `cases:backfill-fulltext` + `:cloud`.

New chunks carry no vectors → a case that gains text needs `cases:embed` +
`cases:index-build` afterward (ops, below).

## Governance

- **Verbatim, no LLM:** deterministic HTML→text → downstream summary/figure
  verbatim-verification stays valid; a page that doesn't extract cleanly is skipped
  (never store garbage text).
- **Additive:** only `!fullTextAvailable` cases are touched; existing full-text /
  vectors never rewritten.
- **Open sources only:** `isOpenSource` gate; CanLII and (in v1) the PDF hosts are
  not fetched. `provenance.source="official_court"`, `unofficial:true`, standing
  unofficial-reproduction disclaimer; reproduced under Crown-copyright reproduction terms.
- **Respectful:** rate-limit sleep + best-effort disk cache (Lambda-safe already);
  no bulk crawling.

## Testing (offline, TDD)

`scripts/test-cases-official-source.ts` (node:assert/strict):
- **`isOpenSource`:** `https://www.bccourts.ca/…` → true; `https://decisions.scc-csc.ca/…`
  (PDF host, v2) and `https://www.canlii.org/…` → false.
- **`htmlToText`:** a fixture HTML string with `<script>`/`<nav>`/`<header>` noise +
  two judgment paragraphs → returns exactly the two paragraphs, `\n\n`-separated,
  noise stripped, entities decoded; the output is a verbatim substring set of the
  source (no invented words).
- **`fetchOfficialText`** with an injected `get`: an open (bccourts) host → the
  extracted text; a `canlii.org` / `scc-csc.ca` URL → `""` (skipped without fetching);
  a `get` that throws → `""`.
- `npm run typecheck` clean; `npm run build` compiles. **`npm run verify` NOT run.**

## Operational run (post-merge, credentialed — measured, not code)

1. `cases:backfill-fulltext:cloud` — fetch + inline promote over the bccourts no-text cases (reports fetched / promoted / skipped).
2. `cases:embed:bedrock:cloud` — embed the new chunks (backfill changes chunks — this **does** require re-embed).
3. `cases:index-build:cloud` — rebuild + upload the search artifact.
4. Refresh derived layers over the new core: `cases:summarize:cloud` / `cases:extract-figures:cloud` / `cases:extract-nations:cloud`.
5. Record in a Result section: cases backfilled, promoted-to-core count, new core total, a verbatim spot-check (extracted text matches the bccourts page), confirmation no existing case was altered.

## Success criteria

- **Offline:** fetcher/extractor tests green; typecheck + build clean; `CaseRepo` untouched.
- **Ops:** the bccourts no-text cases gain verbatim, paragraph-structured full text
  with `provenance.source="official_court"`; a spot-check confirms fidelity; a
  meaningful number promote to core (corpus grows past 452); existing cases untouched.

## Deferred to v2 (separate spec)

PDF backfill for the Lexum family (~1,900: SCC / ONCA / FC / FCA / tribunals): a
PDF→text path (`pdfjs`/`pdf-parse`), the `index.do → <id>/1/document.do` URL
transform, per-host validation, and its own fidelity spot-check — built once v1
proves the backfill → promote → growth chain end-to-end.
