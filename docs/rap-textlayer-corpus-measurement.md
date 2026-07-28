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

---

## UPDATE — the deadlock broke: Textract LAYOUT as an independent reference

**This section supersedes the "what would unblock tuning" conclusion below.** That conclusion was
that tuning needed a second human-verified gold set. It did not. A cross-engine reference works,
and the corpus now has one.

### Why this is not circular

Scoring the loader against its own output measures nothing. Scoring it against **Textract LAYOUT**
is a different proposition: Textract resolves columns with a vision model over the rendered page,
where we use glyph geometry from the PDF's text layer. The two share no code, no input
representation and no failure modes. Textract is *not* ground truth — it has its own errors — but
its errors are **uncorrelated** with ours, which is all a reference needs to carry signal.

### It runs in country, under an SSO session

The org SCP denies Textract to the account's Lambda roles but **not to SSO principals**
(`docs/ca-extraction-textract-scp.md`). So the reference is produced by a human-run script against
`ca-central-1` — no cross-border transfer, no BDA, no deploy. Confirmed working 2026-07-27 on five
documents. This also re-confirms the SCP is principal-conditional, live, at 139 pages of real use.

BDA was considered and rejected as the reference engine: its page numbers are inferred rather than
read, and page attribution is precisely the property under test.

### Metrics, and the trap in the obvious one

Sentences (≥8 words, normalised as `validate.ts` normalises quotes) are matched between the two
readings, then:

- **agreeing sentences (absolute)** — matched *and* attributed to the same page. Recall-bearing.
- **within-page order disagreement** — adjacent transpositions pooled over pages, as a share of
  orderable pairs. Restricted to same-page pairs because page order is never in doubt; column
  order within a page is exactly what `COLUMN_GUTTER_RATIO` controls.

The trap is the **ratio** agreeing/matched, which *improves as the loader recovers less text* — a
smaller matched set is easier to agree on. Ratio 0.20 scores 99.8% on 435 sentences while 0.12
scores 99.2% on 505, and 0.12 places **67 more sentences correctly**. Never optimise the
percentage; that mistake was made and caught during this measurement.

### Result: 0.12 is the argmax, on five documents

```
ratio  BankOfCanad    HydroQuebec    Deloitte_Ex    OPG_Reconci    RBC_Pathway      TOTAL
 0.08  109/109 0.5%   103/103 0.0%   116/121 1.0%   45/45 0.0%     97/97 6.0%       470/475  1.60%
 0.09  118/118 0.4%   103/103 0.0%   90/93  0.0%    37/37 0.0%     111/111 5.7%     459/462  1.73%
 0.10  118/118 0.4%   103/103 0.0%   97/100 1.6%    45/45 0.0%     106/106 4.0%     469/472  1.39%
 0.11  118/118 0.4%   102/102 0.0%   96/100 1.8%    40/40 0.0%     105/105 4.1%     461/465  1.42%
 0.12  118/118 0.4%   102/102 0.0%   123/127 0.9%   33/33 0.0%     125/125 2.9%     501/505  1.12%   <-- max
 0.13  118/118 0.4%   102/102 0.0%   120/125 1.2%   30/30 0.0%     108/108 1.7%     478/483  0.71%
 0.14  118/118 0.4%   81/81  0.0%    119/124 1.3%   33/33 0.0%     127/127 1.2%     478/483  0.74%
 0.15  118/118 0.4%   81/81  0.0%    124/128 1.2%   33/33 0.0%     105/105 1.5%     461/465  0.75%
 0.16  105/105 0.0%   81/81  0.0%    124/128 1.2%   28/28 0.0%     105/105 1.5%     443/447  0.67%
 0.18   98/98  0.0%   81/81  0.0%    123/124 1.2%   28/28 0.0%     104/104 1.5%     434/435  0.68%
 0.20   89/89  0.0%   81/81  0.0%    130/131 1.2%   28/28 0.0%     106/106 1.5%     434/435  0.74%
```

**0.12 places the most sentences correctly (501), a clear peak** against 461 at 0.11 and 478 at
0.13. The lowest order disagreement is 0.16 at 0.67%, but it costs 58 correctly-placed sentences to
buy 0.45pp — a bad trade.

This is a genuine independent vindication: 0.12 was chosen against Bank of Canada alone, *before*
any of the other four documents entered the corpus, and it is the argmax across all five. The
per-document optima do differ (OPG prefers ~0.08–0.10, Deloitte ~0.20), so 0.12 is a pooled
optimum, not universally best — but it is now **measured on five documents rather than one**.

The earlier finding stands unchanged and is not in tension with this: the *page classification*
still churns under the constant (92 page-changes across the band). What this shows is that the
churn is largely on pages where reordering does not change the recovered text much, and that 0.12
is where the recall-bearing quantity peaks.

### Whole-document agreement at the shipped setting

| Document | Page agreement | Whole-doc order disagreement | Pages flagged |
| --- | --- | --- | --- |
| Bank of Canada | 118/118 (100%) | 0.03% | — |
| Hydro-Québec | 102/102 (100%) | 0.00% | — |
| OPG | 33/33 (100%) | 0.00% | — |
| RBC Pathways | 125/125 (100%) | 0.23% | p4 (28.6%), p10 (8.8%) |
| Deloitte | 123/127 (96.9%) | 2.19% | p12 (26.7%) |

**Bank of Canada's four columnar pages (7, 8, 13, 15) agree with Textract's independent column
resolution.** Previously we knew only that our reordering produced the right *gold answers*, which
could have been luck; now we know it produces the right *reading order*. Hydro-Québec's single
columnar page (p3, 22 sentences) is likewise a perfect match — so column reordering is corroborated
on a second document without a gold set ever being built.

### What the reference found that we could not

**RBC p4 is read wrongly by both branches.** The prose guard correctly refuses it (it is a
signature grid — see above), but the row-major fallback then **interleaves** the left-column body
prose with the right-column signature block, because the two regions share baselines. Textract
separates them. Page attribution is unaffected, so grounding still holds, and a quote spanning the
interleave fails `validate.ts`'s substring check and routes to human review — the safe direction.
But "the guard rejected it" was being read as "the page is handled", and it is not. **No page in
the corpus is handled correctly by the fallback when two independent text regions share baselines.**

Deloitte's four page disagreements (`ours p24/ref p14`, `ours p3/ref p34`, `ours p18/ref p14`) are
large jumps, consistent with a repeated boilerplate sentence matching the wrong instance rather than
real misattribution. Unconfirmed — on the worklist.

### The harness is committed and needs no AWS

`scripts/fixtures/textract-reference/*.json` holds the reference for all five documents as
**SHA-256 hashes** of normalised sentences plus page and position — 92 KB total. The comparison only
ever asks "does this sentence appear, and where", which works on an opaque key, so no third-party
prose is reproduced in the repo. Re-running the sweep costs nothing; regenerating a fixture needs an
SSO session and a Textract run.

| Script | Purpose |
| --- | --- |
| `scripts/fetch-textract-blocks.ts` | pull a completed job's blocks (SSO, ca-central-1) |
| `scripts/build-textract-reference.ts` | distil blocks into a committable hashed fixture |
| `scripts/compare-loader-vs-textract.ts` | one document: page + per-page order agreement |
| `scripts/tune-against-textract.ts` | sweep a constant against every fixture |
| `scripts/lib/reference-units.ts` | the shared splitter — both sides MUST split identically |

### What is still open

- **RBC p4's interleaving** — a real defect with a known cause and no fix yet.
- **The all-wide-columns table** risk is still untested; no such page exists in the corpus.
- A human-verified gold set is still the only way to measure **recall of commitments** (did we find
  every commitment?). The reference measures *fidelity of reading* — a different question, and the
  one that was blocking constant tuning.

---

## Superseded — what was thought to be needed before the reference existed

A **human-verified gold set for a second document**. The measurement rig is built and cheap to
re-run; what is missing is ground truth. Generating a gold set by running the extractor and
treating its output as truth would be circular — it would score well and measure nothing.

Recommended candidate: **Hydro-Québec** (13pp, 105 KB, text-native, one columnar page, clean
fidelity). It is the smallest document a person can verify end to end, and its single columnar page
makes it a direct test of the constant that is currently unvalidated.

Until then, the loader is validated on Bank of Canada and *characterised* — not validated — on
the rest.
