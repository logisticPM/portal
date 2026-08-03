# SCC Full-Text Backfill — Results

**Date:** 2026-08-03 · **Branch:** `feat/scc-fulltext` · harness: `cases:backfill-scc:cloud`
(spec `docs/superpowers/specs/2026-08-03-scc-fulltext-design.md`, **read its amendment**)

## What we set out to fix

`Tsilhqot'in Nation v British Columbia` 2014 SCC 44 and `Haida Nation v British Columbia`
2004 SCC 73 — the first declaration of Aboriginal title and the foundational duty-to-consult
case — were listed in the corpus with **no full text**. So was `R v Marshall` [1999] 3 SCR
456, and it was not even in core. Without text a case has no chunks: Ask this judgment
cannot answer from it, semantic search cannot reach its paragraphs, and it carries no
citation-anchored summary. They were present and unusable.

## Result

```
processed 1,095 · got text 238 · promoted to core 16
outcomes: {"ok": 1095}
```

Plus a 25-case staging run: **SCC full text 166 → 429**.

All three target cases now hold English text, and Marshall was promoted out of substrate:

| case | chunks | chars | French markers | tier |
|---|---:|---:|---:|---|
| Tsilhqot'in, 2014 SCC 44 | 62 | 119,809 | 0 | core |
| Haida, 2004 SCC 73 | 37 | 71,561 | 2 | core |
| R v Marshall, [1999] 3 SCR 456 | 81 | 152,930 | 1 | core *(was substrate)* |

The 2 and 1 residual French markers are citation apparatus, not prose. Not zero; stated
rather than rounded away.

## The gate that was supposed to block this had already lifted

The predecessor spec was deferred because a burst of 1,114 requests tripped a Decisia bot
gate. One polite request on 2026-08-03 with a truthful user-agent returned 200 and a 957 KB
PDF. The block was rate-based and had expired.

**Every one of the 1,095 requests in this run returned `ok`.** Zero blocked, zero errors,
zero 404s, at 3 s spacing. Contrast the 2026-07-07 run, which was blocked on all 1,114 and
reported nothing — it returned 1,114 empty strings and ran to completion.

## The 857 that produced no text are scanned images, not blocks

238 of 1,095 yielded text. That cliff needed explaining before it could be reported: the
counter went 100/100, then 200/200, then essentially flat.

By decade:

```
with text     2020s 69 · 2010s 120 · 2000s 145 · 1990s 72 · 1980s 4 · 1970s 19
WITHOUT text                                     1990s 237 · 1980s 329 · 1970s 291
```

Age-correlated, which suggested an archival boundary. **It is not one.** Fetching
`1997-1-scr-12` directly returns `200 application/pdf, 1,339,455 bytes` — the document is
there. Running our extraction on it:

```
pdfToText chars   : 0
pdfToPages pages  : 20
total page chars  : 0
pdfToPageItems    : 20 pages, 0 items
```

**20 pages, zero text items.** The PDF has no text layer — it is a scanned image. The
1970s–1990s SCC archive is scans, and the remedy is OCR, which is a different piece of work
with a different cost.

This contradicts a load-bearing sentence in the 2026-07-07 spec: *"SCC PDFs are digitally
generated (text, not scanned), so pdf-parse yields clean text."* True after roughly 2000,
false before it.

**The pipeline handled this correctly.** It reported `ok` (the site did answer), stored
nothing (there was nothing to store), and invented nothing. The `MIN_TEXT` gate did its job.

## The bilingual split, and how the first attempt failed

SCC judgments are the bilingual *Supreme Court Reports* edition. Tsilhqot'in extracts to
265,148 characters — over `assembleInput`'s 240,000 budget on its own, so it would have been
summarized from a non-contiguous subset of two interleaved languages. Backlog #32 (17
summarize failures, 6 SCC) and the predecessor's *"8 failed — over-long bilingual"* share
this cause.

The first implementation assumed **facing pages** and split page by page. It shipped with
**eight passing unit tests, all green on the first run.** They proved nothing: the fixtures
were `[FR, EN, FR, EN]` page arrays written from the same wrong model as the code.

The real layout is **two columns on every page** — French and English side by side, parallel
translations. Running the real PDF is what caught it:

| | page-level (wrong) | column-level |
|---|---:|---:|
| pages kept | 7 / 66 | 64 / 66 |
| English characters | 25,968 | 119,809 |
| output opens in | French | English |

Three splitters were compared across all 66 pages: midpoint of the page's x range gave 64/66
clean splits and 127,123 characters, identical to a fixed `x = 290` and better than two-means
(122,966). A "widest gap between distinct x values" heuristic was tried and discarded — it
put the cut at the page edge on 5 sampled pages.

**`scripts/cases-verify-bilingual.ts` now exists because of this.** It runs the real
judgment and asserts that `renderItems` reproduces `pdfToPages` page for page, that the page
rejoin is byte-identical to `pdfToText`, that English lands between 100k and 200k characters
with zero French markers, and that the text opens in English. A change that passes the unit
tests and fails this gate is wrong, and the unit tests are what need correcting.

## Crawler identity

Three separate definitions of a Chrome user-agent were in the codebase —
`official-source.ts`, `robots.ts`, and `cases-harvest-court.ts` (the third found by a
reviewer, missed by the spec). `robots.ts` documented the rationale: *"some official hosts
403 a non-browser UA."*

Probed against all six allow-listed hosts with
`IndigenomicsLegalHub/1.0 (…; +<repo url>)`:

```
✓ www.bccourts.ca · decisions.scc-csc.ca · coadecisions.ontariocourts.ca
✓ www.yukoncourts.ca · www.courtsnb-coursnb.ca · www.manitobacourts.mb.ca
✅ all 6 hosts accept the truthful UA
```

The rationale is false for every host this project actually uses. `cases:probe-hosts` keeps
it checkable.

## Open

- **857 scanned SCC judgments (1970s–1990s) need OCR** to become usable. Sizeable, separate,
  and now precisely scoped.
- **English-only does not guarantee the budget.** `2026-scc-26` (Pharmascience) came in at
  232,208 characters — 96.8% of 240,000. The longest judgments will still exceed it.
- **Whether this closes backlog #32** — the 17 summarize failures, 6 of them SCC — is
  untested. Re-summarizing the newly-texted cases is the experiment, and it has not run.
- **A 200 response carrying the wrong body** is still recorded as `ok`. It did not happen
  here, but the outcome codes distinguish HTTP status, not content plausibility.
