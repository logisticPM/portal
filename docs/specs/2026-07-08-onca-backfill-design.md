# ONCA Full-Text Backfill (backfill v3) — Design

**Date:** 2026-07-08 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases/ingest/official-source.ts`

## Motivation

BC provincial (bccourts) is now 100% full text (backfill v2 + the `fetch-polyfill` fix).
The next provincial-court gap *already in the corpus* is the **Ontario Court of Appeal**
(`coadecisions.ontariocourts.ca`, ~207 no-text cases). It is Lexum/Decisia infrastructure —
the **same platform and PDF path as SCC** — so this is a near-trivial extension of the
proven SCC PDF backfill, not a new adapter.

(The genuinely-missing provinces — AB/SK/MB/QC/ONSC — are a separate *harvest + data-source*
sub-project, not this backfill: those cases are not in the corpus. Deferred.)

## Phase 0 findings (live read-only probe, 2026-07-08)

- **Same infra as SCC.** `coadecisions.ontariocourts.ca` is Lexum/Decisia; its `robots.txt`
  is byte-identical to SCC's (`User-agent: *` disallows only the two `/icm/…120620/111322`
  publication-ban docs; all `/coa/` decisions allowed).
- **No captcha right now.** `…/coa/coa/en/nav_date.do` returns HTTP 200 with no
  robocop/DataDome markers. (SCC's captcha gate was tripped by *our* 1,114-request burst;
  ONCA has not been hit.) The live per-document captcha/format check is the ops gate below.
- **URL form.** Lexum standard `/coa/coa/en/...`; stored `sourceUrl`s are the viewer form
  `…/coa/coa/en/item/<id>/index.do` (same shape as SCC's `/scc-csc/scc-csc/en/item/<id>/index.do`).
- **The existing `toDocumentUrl` regex already produces the correct ONCA PDF URL** —
  `^(.*)/item/(\d+)/index\.do/?$` → `$1/$2/1/document.do` maps
  `…/coa/coa/en/item/<id>/index.do` → `…/coa/coa/en/<id>/1/document.do`. Only its
  SCC-only host guard blocks it today.
- **Not usable:** `www.ontariocourts.ca` (robots.txt disallows `/decisions/`); CanLII
  (DataDome captcha — official API only, out of scope here).

## Decisions

- **v3 = ONCA only** (`coadecisions.ontariocourts.ca`, ~207 in-corpus no-text cases),
  reusing the SCC PDF path (`pdfToText`/`cleanupPdfText`) unchanged.
- **Change is tiny and lives in `official-source.ts`:** add the ONCA host to the allowlist,
  and **generalize `toDocumentUrl`** (drop the `host === "decisions.scc-csc.ca"` guard) so
  the Lexum `/item/<id>/index.do → /<id>/1/document.do` transform applies to any host whose
  path matches that pattern. Non-Lexum URLs (e.g. bccourts `.htm`) don't match the pattern
  → passthrough unchanged (safe). The runner is unchanged (`BACKFILL_HOST` already exists).
- **Keep everything else:** additive-safe (only `!fullTextAvailable`), official-open
  allowlist (no CanLII), verbatim deterministic extraction (no LLM),
  `provenance.source="official_court"`, robots deny-list (already covers the `/icm/` docs).

## Architecture

### `src/lib/cases/ingest/official-source.ts` (the only code change)

```ts
export const OPEN_HOSTS = ["www.bccourts.ca", "decisions.scc-csc.ca", "coadecisions.ontariocourts.ca"];

// toDocumentUrl: generalize — apply the Lexum viewer→PDF transform to ANY host whose path
// is the …/item/<id>/index.do shape (SCC, ONCA, and future Lexum courts). Non-matching
// URLs pass through unchanged, so bccourts/other hosts are unaffected.
export function toDocumentUrl(url: string): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^(.*)\/item\/(\d+)\/index\.do\/?$/);
    if (!m) return url;                       // not a Lexum viewer URL → unchanged
    u.pathname = `${m[1]}/${m[2]}/1/document.do`;
    return u.toString();
  } catch { return url; }
}
```

`pdfToText` / `cleanupPdfText` / `fetchOfficialText` routing / `ROBOTS_DENY` — **unchanged**.
ONCA judgments are **English-only** (Ontario courts are not officially bilingual), so
extraction is cleaner than SCC's bilingual PDFs. ONCA running headers
("COURT OF APPEAL FOR ONTARIO") are not matched by `RUNNING_HEADER_RE` → left as minor
verbatim noise (safe-fail; assessed in the fidelity gate, refined only if material).

## Captcha-risk mitigation (SCC lesson)

ONCA shares SCC's Decisia infra, so a burst could trip the same per-document captcha gate.

- **Phase-0 probe is a hard gate:** fetch 2–3 real ONCA `document.do` (by stored `sourceUrl`)
  and confirm each returns `application/pdf` (not a 403 captcha) and clean verbatim text.
  **Bulk runs only if the probe passes.**
- **Slow pacing:** run with `BACKFILL_SLEEP_MS≈2500` (~207 cases ≈ 8–10 min) to stay under
  the rate that tripped SCC. **Stop immediately if a captcha 403 appears mid-run.**

## Testing (offline, TDD)

Extend `scripts/test-cases-official-source.ts`:
- `isOpenSource("https://coadecisions.ontariocourts.ca/…")` → true.
- `toDocumentUrl("…/coa/coa/en/item/1234/index.do")` → `…/coa/coa/en/1234/1/document.do`.
- Regression: `toDocumentUrl("…/scc-csc/scc-csc/en/item/2189/index.do")` still →
  `…/scc-csc/scc-csc/en/2189/1/document.do` (generalization didn't break SCC).
- Regression: `toDocumentUrl` on a bccourts `.htm` and on a malformed string → unchanged.
- All existing tests stay green. `typecheck` clean; `build` compiles; `verify` NOT run.

## Operational run (post-merge, credentialed)

1. **Phase-0 captcha/fidelity gate (go/no-go):** fetch 2–3 real ONCA `document.do` by
   stored `sourceUrl`; confirm `application/pdf` + clean text (not captcha). Proceed only if clean.
2. `BACKFILL_HOST=coadecisions.ontariocourts.ca BACKFILL_SLEEP_MS=2500 cases:backfill-fulltext:cloud`.
3. Promote (`cases-promote` with `LABEL_MODELS`) → relevance-gated core growth.
4. Refresh derived layers over new core: `summarize` / `extract-figures` / `extract-nations`;
   rebuild + upload the search artifact (`INDEX_BUCKET` explicit). Dense embed of new chunks
   remains throttle-gated (a quiet window with low `EMBED_CONCURRENCY`), as with the bccourts run.
5. Record a Result section: cases backfilled, promoted-to-core count, new core total, a
   verbatim spot-check, confirmation no existing case was altered.

## Success criteria

- **Offline:** allowlist + generalized `toDocumentUrl` tests green (incl. SCC/bccourts
  regressions); typecheck + build clean; `CaseRepo` untouched.
- **Ops:** the Phase-0 gate passes (ONCA serves PDFs, no captcha); ONCA no-text cases gain
  verbatim full text with `provenance.source="official_court"`; a meaningful number promote
  to core; existing cases untouched.

## Deferred

- **Missing provinces (AB/SK/MB/QC/ONSC):** separate harvest + data-source sub-project
  (official CanLII API with a key, or per-province official sites) — those cases are not in
  the corpus.
- **The rest of the Lexum family** (FC / FCA / federal tribunals / `decisia.lexum.com`):
  same one-line generalization now covers their URL form; add each host to `OPEN_HOSTS` and
  run per host once ONCA confirms the Decisia captcha permits paced access.

## Result — ops run (2026-07-08, credentialed)

Merged as PR #139 (`0aaa140`). Offline gate green; Phase-0 probe passed; bulk run was
**partially captcha-limited**, exactly as the SCC lesson predicted.

**Phase-0 captcha/fidelity gate — PASS.** Of the 207 no-text ONCA cases, all are stored as
the viewer form `…/coa/coa/en/item/<id>/index.do` (so `toDocumentUrl` is required). Three
real `document.do` fetches returned clean English PDFs, no captcha: *Comfort Capital v.
Yeretsian* (15,038 chars), *R. v. Schoer* (59,265), 2019 ONCA 39 (56,791).

**Backfill (inline promote — `LABEL_MODELS` set + `BACKFILL_SLEEP_MS=2500`, so only the 207
new cases were labeled, not the whole substrate):** `processed 207 · got text 109 ·
promoted to core 6`. The first ~100 fetches were clean; then ONCA's **Decisia captcha gate
tripped** (~100 requests in, despite 2.5 s pacing — the same external bot gate that SCC hit,
and `fetchOfficialText` swallows the 403 into `""`, so the only visible signal was the text
count plateauing 100 → 109). ~98 cases remain captcha-blocked.

**Derived refresh + index (over 541 core):** summarize +6, figures +5 (persistent ~42
failures = the known ~8% "LLM emits unparseable JSON" rate, **not** throttling), nations
filled +3. Search artifact rebuilt and uploaded (`buildId 1783575163347-lgxbu6eh`, units
243,948 = +3,751 chunks, cases 5,049, bm25 155.6 MB + vectors 301.4 MB) — the 109 new ONCA
full texts are now **BM25-searchable** and the 6 new core are activated.

**Outcome:** core 535 → **541**; ONCA 109/207 full text. Dense vectors for the new chunks
remain throttle-deferred (BM25 only), as with the bccourts run.

**Strategic ceiling (confirmed across SCC + ONCA):** the Lexum/Decisia family
(SCC 1,114 + ONCA ~98 remaining + FC/FCA/tribunals) is **captcha-limited for bulk from this
environment** — paced access still trips the gate after ~100 requests. Getting the rest
needs either a very slow multi-session trickle or the **official CanLII API** (key + ToS;
note CanLII's site is DataDome-gated and its API may return metadata rather than full text —
verify before committing). The genuinely-missing provinces (AB/SK/MB/QC/ONSC) are a separate
harvest + data-source sub-project (those cases are not in the corpus).
