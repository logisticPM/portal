# SCC Full Text — An Honest Fetcher and a Monolingual Judgment

**Date:** 2026-08-03 · **Status:** proposed (design), **amended 2026-08-03 after the layout
model failed against a real PDF — read the amendment first**

---

# AMENDMENT — the judgment is two columns on one page, not facing pages

## What this spec got wrong

The section below asserts that the SCR edition puts French and English on **facing pages**,
and designs a page-level splitter around that. Measured against the actual Tsilhqot'in PDF:

**Each page carries both languages, side by side in two columns.** Page 30 of 66, lines
0–40 French, lines 41–80 English — parallel translations of the same passage. pdf.js reads
the full left column, then the full right column, so a page's extracted text is French then
English, not one language.

The original claim came from classifying fixed 2,000-character windows. A window spans
several columns and pages, so the alternation it showed was an artifact of the window size,
not the layout.

## How it was caught, and how it was not

`bilingual.ts` shipped with eight passing assertions. Every one passed on the first run.

They proved nothing, because the fixtures were `[FR, EN, FR, EN]` page arrays — **I wrote
the fixtures from the same wrong model as the code.** A test suite built on a mistaken
assumption goes green and confirms only that the code matches the assumption.

What caught it was running the real PDF: 66 pages in, 7 pages out, 25,968 characters, output
beginning in French. **This spec therefore requires a real-document check as an acceptance
gate, not just unit tests** — see the revised Testing section.

## The revised design: split by column, classify each side

Per page: split the text items at the **midpoint of that page's x range**, classify each
half's language, keep the English half.

Three splitters were compared across all 66 pages:

| splitter | clean bilingual splits | English characters |
|---|---:|---:|
| **midpoint of the page's x range** | **64 / 66** | **127,123** |
| fixed `x = 290` | 64 / 66 | 127,123 |
| two-means clustering on x | 64 / 66 | 122,966 |

Midpoint and a fixed threshold perform identically here; midpoint is chosen because it
adapts to a different page geometry, which a fixed constant tuned on one document would not.
Two-means is more machinery for a slightly worse result.

A "widest gap in the distinct x values" heuristic was tried first and **discarded**: it put
the cut at the far right edge on 5 of the pages sampled (p2: left 5,165 chars, right 3), and
its gutter estimate ranged 121–484 across pages. That is not a gutter, it is a detector
failing loudly enough to notice — recorded here so nobody re-derives it.

**Classify, never assume a side.** English was the left column on every page that split
cleanly in this document, but a corpus-wide rule cannot rest on one judgment. The classifier
decides per page; the side is an observation, not an input.

**The 2 pages that do not split cleanly** are single-language (cover, index). Fallback:
classify the whole page and apply the original keep/drop policy — keep if English, drop if
French, and keep an undetermined page only when both neighbours are English.

**Yield: 127,123 English characters**, against 265,148 bilingual and a 240,000 budget. The
budget problem the spec set out to solve is solved.

## What survives from the original design

- **`pdfToPages` is correct and stays.** Verified against the real PDF: rejoining its pages
  and cleaning reproduces `pdfToText`'s output **byte for byte** (265,148 = 265,148). Its
  `pagerender` mirrors pdf-parse's own `render_page` exactly — same no-separator
  concatenation within a line, same `\n` on a Y change — because a first draft that joined
  items with `" "` would have split words apart ("Recon" + "ciliation" → "Recon ciliation"),
  and one that dropped the newline would have disabled `cleanupPdfText`'s hyphen rejoin.
- **The language classifier works** on monolingual text: the left column scored en=44/fr=0,
  the right fr=24/en=0. It was fed the wrong unit, not built wrong.
- **The keep/drop policy** for undetermined pages carries over unchanged.
- **Split before `cleanupPdfText`** — unchanged and still load-bearing.

## What must change

`bilingual.ts`'s interface moves from pages to columns: it needs each page's **items with x
positions**, not a joined page string. `pdfToPages` gains a sibling that preserves geometry.
`keepEnglishPages` becomes `keepEnglishColumns`. Its current tests are deleted, not adapted —
they encode the wrong model.

---

**Date:** 2026-08-03 · **Status:** proposed (design), pre-implementation
**Domain:** `src/lib/cases/ingest/official-source.ts`, `src/lib/cases/ingest/robots.ts`,
`scripts/cases-backfill-fulltext.ts`
**Predecessor:** `docs/specs/2026-07-07-scc-pdf-backfill-design.md` (deferred after the gate)

## What we are missing

1,286 SCC-sourced cases; **166 have full text, 1,120 do not.** Two of the missing are core:
**Tsilhqot'in Nation v British Columbia, 2014 SCC 44** and **Haida Nation v British
Columbia, 2004 SCC 73** — the first declaration of Aboriginal title and the foundational
duty-to-consult case. **R v Marshall**, [1999] 3 SCR 456, is missing and still in substrate.

Without full text a case has no chunks. No chunks means Ask this judgment cannot answer from
it, semantic search cannot reach its paragraphs, and it carries no citation-anchored summary.
These three are listed in the corpus and effectively unusable.

## The gate is open — probed, not assumed

The 2026-07-07 spec was deferred because `decisions.scc-csc.ca` began serving a Decisia bot
gate (403) after a 1,114-request burst. One polite request today, with a truthful
user-agent:

```
http=200  type=application/pdf  bytes=957644  time=3.5s   %PDF-1.6
```

`robots.txt` still allows `/scc-csc/` in full — it disallows only two `/icm/` documents and
BUbiNG. The 403 was **rate-based and has expired.** The cooldown-and-retry path the
predecessor recommended is available; no CanLII adapter is needed, which keeps the
official-open-only rule intact.

## Three defects to fix before fetching anything

### 1. The fetcher impersonates a browser

```ts
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/126.0 Safari/537.36";
```

`official-source.ts:90` and `robots.ts:9` both send this. Presenting an automated crawler as
Chrome to a court website that has deployed bot detection is not something this project
should do, and it is **counterproductive**: an identified research crawler can be
allowlisted and can appeal a block; browser-lookalike traffic can only be rate-limited as
anonymous load.

It is also unnecessary. Today's probe used
`IndigenomicsLegalHub/1.0 (research corpus for Indigenomics Institute; +<repo url>)` and got
a clean 200 for both `robots.txt` and the PDF.

**Change:** one exported `CRAWLER_UA` with a contact URL, used by both modules.

### 2. Every failure looks like an empty document

```ts
async function defaultFetch(u) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(u, { headers: { "User-Agent": BROWSER_UA } });
    if (res.ok) return { … };
    if (attempt === 0) await sleep(1500);
  }
  return { buf: Buffer.alloc(0), contentType: "" };   // 403, 404, 500, timeout — all this
}
```

with `catch { return ""; }` around it. A gate response, a missing document and a network
timeout are indistinguishable in the data, and all three are indistinguishable from a
judgment that genuinely has no text.

**This is what made the 1,114-request burst so costly.** It did not fail — it returned 1,114
empty strings and ran to completion. Nobody could tell from the output that every single one
had been blocked.

**Change:** `Fetched` carries an outcome — `ok` / `blocked` (401/403/429) / `missing` (404) /
`error`. `fetchOfficialText` returns that outcome alongside the text. **The batch runner
aborts on the first `blocked`**, because a gate response means every subsequent request is
both futile and rude.

### 3. Timings that caused the block are still the defaults

Retry after 1.5s, no inter-request delay in the runner beyond what the caller imposes.

**Change:** a per-host minimum interval, default **3 s** for `decisions.scc-csc.ca`
(the observed response time is ~3.5 s, so this roughly halves our concurrency against a
sequential crawl), and exponential backoff on 429/503 rather than a fixed 1.5 s.

## The real work: the judgment is bilingual

The SCC PDF is the *Supreme Court Reports* bilingual edition — French and English on facing
pages. `pdf-parse` reads pages in physical order, so the extracted text alternates.

Measured on Tsilhqot'in (`2014 SCC 44`): **265,148 characters.** Classifying 2,000-char
windows by French/English function words gives:

```
FRx1 ENx1 FRx1 ENx1 FRx1 ENx1 FRx1 ENx1 …     65 FR · 55 EN · 12 undetermined
```

Near-perfect alternation — the facing-page layout, visible in the data.

Two consequences, and the first is not obvious:

**`assembleInput`'s budget is 240,000 characters.** At 265,148, Tsilhqot'in exceeds it on its
own, so it would take the over-budget path that selects a **non-contiguous subset** of
chunks. Every SCC judgment we add would be summarized from a stitched-together excerpt of two
languages.

**This is already happening.** The predecessor spec recorded `summarize +78 (8 failed —
over-long bilingual …)`, and backlog item #32 — 17 summarize failures, **6 of them SCC** —
has been open since. Fetching 1,120 more bilingual PDFs without addressing this multiplies a
known failure, it does not introduce a new one.

Keeping only the English windows gives **110,000 characters**: one language, comfortably
inside the budget.

### Segment by page, not by character window

The 2,000-char window was a probe, not a design. Fixed windows cut mid-sentence, and this
codebase verifies every published claim by locating its quote **verbatim** in a chunk — a
boundary through the middle of a sentence manufactures quotes that can never verify. Given
the drop forensics (25% of claims already discarded, `docs/research/2026-07-31-claim-drop-forensics.md`),
adding an avoidable source of unverifiable text is the wrong trade.

`pdf-parse` accepts a `pagerender` hook, so pages are addressable. **Classify each page,
keep the English pages, concatenate in order.** Boundaries then fall exactly where the
physical layout already puts them, and no sentence is split.

### The undetermined pages

12 of 132 windows (9%) scored neither language — short pages: headnote fragments, citation
tables, the style of cause. A policy is required and must be explicit:

**Keep an undetermined page only when both its neighbours are English.** Dropping content is
the conservative error for a corpus that publishes quotations; keeping French text in an
English chunk pollutes retrieval and produces claims a reader cannot check. Undetermined
pages that are actually French will nearly always sit between French pages.

The count of undetermined pages kept and dropped is reported per case, so the policy's cost
is visible rather than assumed.

## Scope

- **`decisions.scc-csc.ca` only.** The other 1,160 no-text cases (`decisia.lexum.com` 342,
  `decisions.fct-cf.gc.ca` 171, `www.courts.gov.bc.ca` 140, `decisions.fca-caf.gc.ca` 120,
  …) stay deferred. They are a different host family with different layouts.
- **No change to `verifyClaims`, `assembleInput`, chunking, or the summarizer.** This spec
  produces better *input*; whether the derived layers then need re-running is a separate
  decision with its own cost.
- **No re-summarization** in this spec. Fetching changes `chunks`; refreshing summaries over
  1,120 newly-texted cases is an ops decision to take once the text is in and inspected.

## Staged rollout — the burst is the thing to avoid

1. **The three landmarks** (Tsilhqot'in, Haida, Marshall). Human reads the extracted English
   against the published judgment before anything else runs.
2. **25 cases.** Confirms pacing, the outcome codes, and the language split at small scale.
3. **The remaining ~1,092**, only if stage 2 is clean, at 3 s/request ≈ 1 hour.

Any `blocked` outcome stops the stage. Resume is a separate decision, not an automatic retry.

## Testing

**Unit tests alone are not an acceptance gate for the splitter.** The first attempt passed
eight synthetic assertions and was still wrong, because the fixtures encoded the same
mistaken layout model as the code. Two gates are required and the second is not optional:

**Gate 1 — offline unit tests** (below).

**Gate 2 — a real document.** Run the splitter against the stored Tsilhqot'in PDF and assert
on the output: English characters between 100,000 and 200,000; zero French function-word
markers surviving; the text opens with English; and `pdfToPages` still rejoins byte-identically
to `pdfToText`. A change that passes gate 1 and fails gate 2 is wrong, and gate 1 is the one
that must be corrected.

Offline, `scripts/test-cases-official-source.ts` (extend) and a new
`scripts/test-cases-bilingual.ts`, with recorded page fixtures:

- Injected `get` returning 403 → outcome `blocked`, text `""`, and the runner **stops**;
  asserted by counting calls, so a future refactor cannot turn it back into a silent skip.
- 404 → `missing`, distinct from `blocked`; the runner continues.
- 200 with a two-byte body → `ok` but below `MIN_TEXT`, so no text stored — the pre-existing
  behaviour, kept.
- Alternating FR/EN page fixtures → only English pages survive, **in document order**.
- An all-English document → every page kept, output identical to the input (the regression
  that stops the splitter from eating monolingual judgments).
- An undetermined page between two English pages → kept; between two French pages → dropped;
  at the document edge → dropped.
- A page split must never fall inside a sentence: assert the joined output contains each
  input page's full first and last sentence.
- `CRAWLER_UA` is asserted to contain no `Mozilla`, so nobody reinstates the disguise.

## Success criteria

- Tsilhqot'in, Haida and Marshall have full text, in English, verified by eye against the
  published judgments.
- A blocked request is visible as blocked, and stops the batch.
- No request identifies itself as a browser.
- Extracted English text for a typical SCC judgment is inside the 240,000-char budget.
- Nothing in the summarizer, verifier or chunker changed.

## Open, deliberately not in scope

- Whether to re-summarize the newly-texted cases, and whether that closes backlog #32.
- The 1,160 non-SCC no-text cases.
- Whether the French text should be stored separately rather than discarded. It is discarded
  here; a bilingual corpus is a product decision, not a fetcher decision.
