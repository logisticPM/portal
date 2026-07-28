# Text-layer loader — measurement against a 7-document corpus

**Date:** 2026-07-27 · Corpus: `CS7980/Week 7/rap_samples` (local, not committed — the PDFs are up
to 17 MB and several are third-party publications).

The loader shipped in `feat/textract-free-extraction` was tuned against **one** document (Bank of
Canada). This note re-measures it against **seven documents / 166 pages** and records what held,
what did not, and what is still blocked.

Scripts (all offline, no AWS, no model calls):

| Script | Answers |
| --- | --- |
| `scripts/profile-corpus.ts` | per-document gate + column profile |
| `scripts/dump-page-columns.ts` | one page's geometry and emitted text, by eye |
| `scripts/measure-run-gaps.ts` | inter-run gaps in font-size multiples (the `WORD_SPACE_RATIO` quantity) |
| `scripts/check-ligatures.ts` | silent character loss the damage regex might miss |
| `scripts/sweep-column-constants.ts` | `COLUMN_GUTTER_RATIO` × `MIN_COLUMN_ROWS` grid |
| `scripts/sweep-gutter-criterion.ts` | page-relative vs font-relative gutter criterion |
| `scripts/compare-gutter-per-doc.ts` | per-document page sets under each criterion |

The sweep scripts never modify the loader. They write a patched **copy** beside it (so its relative
imports still resolve), import that, and delete it.

---

## The corpus

| Document | Pages | Chars | Scanned gate | Coverage | Fidelity | Raw-gutter pages |
| --- | ---: | ---: | --- | --- | --- | --- |
| Agnico Eagle ESTMA 2024 | 7 | 18,213 | pass | 7/7 | clean | 0 |
| Bank of Canada RAP | 17 | 22,614 | pass | 16/17 | clean | 4 |
| Deloitte Expanding Horizons | 41 | 88,094 | pass | 41/41 | clean | 11 |
| Hydro-Québec Strategy | 13 | 27,571 | pass | 13/13 | clean | 1 |
| OPG RAP 2021 | 33 | 45,446 | pass | 32/33 | clean | 8 |
| RBC Pathways (full) | 35 | 83,705 | pass | 35/35 | clean | 7 |
| RBC first-20pp (Ghostscript trim) | 20 | 45,117 | pass | 20/20 | **65 damaged** | 5 |

---

## What held

**The scanned gate has no false positives.** All seven documents pass. The nearest approach is
Bank of Canada at 16/17 covered pages and OPG at 32/33 — both comfortably above the 0.6 coverage
ratio, so the demotion of low coverage from a hard rejection to a validation issue was not
load-bearing here, but neither did it mask anything.

**The fidelity gate fires on a real document, correctly.** RBC-first-20pp is the only document
flagged, with 65 damaged glyphs. They are not random: every one sits where an `f`-ligature should
be, encoded as **U+001E / U+001F** control characters — inside `DAMAGE_RE`'s `\u000E-\u001F` range.

```
RBC first-20pp:  "Of<U+001F>cer"  →  4f 66 1f 63 65 72
RBC full:        "Officer"      →  4f 66 66 69 63 65 72
```

The **full** RBC PDF is clean, so the corruption was introduced by the Ghostscript page-trim that
produced the derived file, not by the publisher. Two things follow. The gate earns its place — this
is exactly the silent-corruption case it exists for. And a document that has been re-processed by a
third-party tool is a realistic source of damage, not a hypothetical one.

A separate check for *silent* loss (`scripts/check-ligatures.ts`, scanning for words that only
exist once a ligature is dropped — `nancial`, `rst`, `ows`, `eld`) found scars **only** in the same
RBC-trimmed file, always adjacent to a flagged control character. On this corpus there is no
character loss the damage regex misses.

**The prose-likeness guard discriminates, and its one rejection is correct.** Across 36 raw-gutter
pages the guard rejects exactly one: RBC p4. That page is a **signature grid** — Dave McKay / Phil
Fontaine, Jacynthe Côté / Chinyere Eni, each above its own title. Column-major reordering would
have detached every name from its title. Spot-checks of pages the guard *passed* (Deloitte p11,
RBC p22) confirm genuine 3-column prose, where reading row-major would interleave three unrelated
sentences. No false positive and no false negative was found by inspection.

**Real tables are handled correctly, by not being detected at all.** Agnico's ESTMA payment tables
produce zero gutters, so the page is read row-major and cell boundaries survive as spaces:

```
Canada -Nunavut Amaruq 27,250,000 140,000 27,390,000
```

`joinRuns` is doing its job — measured gaps on the header row are 29–204pt at 4–30× font size,
far above `WORD_SPACE_RATIO = 0.2`. What *is* lost on such a table is column **alignment**: empty
cells vanish, so a row with four figures cannot be mapped back to which of the seven payment
columns each belongs to. That is inherent to row-major flattening and does not affect RAP
commitment extraction, which is prose.

---

## What did not hold

**`COLUMN_GUTTER_RATIO = 0.12` has no plateau across the corpus.**

On Bank of Canada alone, 0.09–0.18 was a flat band, which is what justified calling 0.12
"measured, not chosen". Across seven documents that flatness is gone. Sweeping 0.08 → 0.20 and
counting **churn** (pages whose reading order changes between adjacent settings):

```
value   rawPages  reordered  churn-vs-prev
 0.08      27        27         -
 0.09      25        25        11
 0.10      31        29         8
 0.11      30        28         8
 0.12      36        34        12
 0.13      42        38        12
 0.14      47        43         7
 0.15      47        42        10
 0.16      47        42         5
 0.18      47        42        10
 0.20      50        45         9
total churn across the band: 92 page-changes
```

There is no zero-churn band anywhere. A 4×11 grid over `COLUMN_GUTTER_RATIO` × `MIN_COLUMN_ROWS`
produced **44 distinct behaviours from 44 settings** — no two settings agree.

The count is also **non-monotone**: 0.08 → 0.09 *drops* 27 → 25, then climbs to 31. Raising a
minimum-gap threshold should not increase detections. The reason is that `minGutter` is not only a
gap threshold — it is also the dedupe radius for rough boundaries (`textlayer.ts:384`) and,
indirectly, the noise floor feeding `refineGutter`. A small value admits many spurious inter-word
gaps, whose midpoints outscore the real gutter and then fail refinement. So the constant controls
three things at once, which is why its behaviour is not smooth.

**The obvious fix is more stable and demonstrably wrong.** Typographic gutters scale with type
size, not page width, and this corpus spans text-block widths from ~533pt (Deloitte) to ~1124pt
(RBC two-page spreads) — so one ratio means a 64pt minimum gutter on one document and 135pt on
another. Replacing `textWidth * ratio` with `medianFontSize * K` is scale-free and measurably
steadier: **41 page-changes vs 92**, and monotone throughout.

It also fails the only constraint that matters. Bank of Canada's columnar pages are 7, 8, 13, 15 —
those carry the gold-set commitments and the 22/22 acceptance depends on them:

```
A 0.12 (shipped)  7,8,13,15   <== the accepted set
B K=1.75 .. 3.0   7            MISSING 8,13,15
B K=3.5           7,8,13       MISSING 15
```

It additionally misses Deloitte p11, visually confirmed as 3-column prose. **Rejected** — a
steadier constant that loses the pages we can verify is not an improvement. `medianFontSize` is
likely the wrong statistic on design-heavy RAPs, where headings, pull-quotes and captions pull the
median away from body text.

The two criteria disagree almost completely on documents with no ground truth — on Deloitte,
A gives `{3,11,12,13,18,24,29,30,32,33,37}` and B gives `{10,26,27,28,34,40}`, nearly disjoint sets.
Both cannot be right, and nothing in the corpus decides between them.

---

## Where this leaves the loader

`COLUMN_GUTTER_RATIO = 0.12` **stays**. It is the best available value: it is the only setting
verified against ground truth, and every alternative tested is worse on that evidence.

But the honest characterisation has changed. The comment at `textlayer.ts:97` says the value is
"MEASURED, not chosen". That was true of the evidence available when it was written and is too
strong now: it is measured **on one document**, sits in no plateau across seven, and its behaviour
on the other six is **unvalidated in both directions** — we cannot say the pages it reorders should
be reordered, nor that the ones it skips should be skipped.

This is a bounded risk, not an open one. Column reordering only ever changes the order of text
already extracted; it cannot invent or drop content, and page attribution is unaffected. The
failure mode is a commitment and its measure being separated on a multi-column page — which
`validate.ts` catches as `quote_not_found` whenever the model quotes across the seam, routing to
human review. The residual no-signal case remains **a table whose columns are all wide and wordy**,
which passes the prose guard and would be read column-major with pairing silently lost. No such
page exists in this corpus — the guard's one rejection (RBC p4) was a signature grid, not a
commitment table — so that risk is still **untested rather than disproven**.

## What would actually unblock tuning

A **human-verified gold set for a second document**. The measurement rig is built and cheap to
re-run; what is missing is ground truth. Generating a gold set by running the extractor and
treating its output as truth would be circular — it would score well and measure nothing.

Recommended candidate: **Hydro-Québec** (13pp, 105 KB, text-native, one columnar page, clean
fidelity). It is the smallest document a person can verify end to end, and its single columnar page
makes it a direct test of the constant that is currently unvalidated.

Until then, the loader is validated on Bank of Canada and *characterised* — not validated — on
the rest.
