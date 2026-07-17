# RAP extraction — live-test findings & engine decision

**Date:** 2026-07-01, updated 2026-07-16 · Tested on a real RAP (Bank of Canada, "Our journey towards Reconciliation") in an AWS sandbox account, `ca-central-1` + `us-east-1`.

> The document is **17 pages**, not the 13 stated throughout the 2026-07-01 sections — measured
> from Textract (17 `PAGE` blocks). Its commitment content is on p13 and p15.

This documents what we learned deploying and testing the RAP extraction pipeline on real AWS, the decision we made, and the open path for later. Written for the team + client.

---

## Decision (TL;DR)

**Ship Option A — Amazon Bedrock Data Automation (BDA), in `us-east-1`.** It works end-to-end today: it extracted all 22 commitments plus every header field from the real Bank of Canada RAP in **64 seconds**.

**Option B — Claude on Bedrock (in-country, `ca-central-1`) — UPDATE 2026-07-16: the blocker is fixed.**
It was deferred because a single grounded call **aborted** on the real RAP. It now runs end to end
in `ca-central-1` in **116.5s**, returning **26 commitments — all 22 forward-looking ones on their
correct pages** (12 on p13, 10 on p15), every one carrying a verbatim quote and a real page number,
plus 4 defensible extras. The over-extraction that the first run showed (46, ~17 of them past
achievements) was a prompt gap and is fixed. §4 records what the original diagnosis got wrong;
§4a how we cut the document; §4b the live runs.

**This still does not by itself overturn "ship A" — that is a team call.** But the two things that
argued against B have both moved: it is now ~1.8× slower than BDA (116.5s vs 64s), not 6×, and it
extracts the same 22 commitments BDA does while carrying **verbatim quotes and read (not guessed)
page numbers**, in-country at rest. The open question is cost — `AnalyzeDocument`+LAYOUT is a
pricier Textract tier and that is still unmeasured.

---

## 1. The two options we built

Both sit behind one switch (`EXTRACTION_IMPL=mock|bda|bedrock`) so we can change engines with a config flag, no code change.

| | **A — BDA** | **B — Claude on Bedrock** |
|---|---|---|
| Region that works | **`us-east-1` only** (see §2) | `ca-central-1` (in-country) |
| Grounding | value + confidence + page (bounding box) | **verbatim quote** + page + confidence |
| Multi-page | native | async Textract OCR |
| Data residency | documents processed in the US | **stays in Canada** (at rest); see §3 |
| Status | **works today** | quality proven; truncates on large RAPs |

---

## 2. Region finding — BDA runtime is not in `ca-central-1`

BDA's **control plane** (create blueprint / project) works in `ca-central-1`, which is misleading. Its **runtime** (`InvokeDataAutomationAsync`) does **not** — it fails there with "invalid ARN" for the required `data-automation-profile`. BDA invoke only succeeded in **`us-east-1`** (`…/us.data-automation-v1` profile).

**Implication:** choosing BDA means the app/extraction runs in `us-east-1`. A "Canada app + BDA" hybrid isn't clean because BDA reads its input from a same-region S3 bucket, so the upload bucket would also have to be in `us-east-1`.

Other verified facts:
- `BDA_PROFILE_ARN` is **required** (not optional).
- BDA confidence runs on a **lower scale** than Claude's (~0.5–0.8 for solid extractions), so our flag threshold for BDA is 0.5, not 0.85.
- BDA output shape confirmed: `job_metadata.json → output_metadata[0].segment_metadata[0].custom_output_path → { inference_result, explainability_info }`.

---

## 3. Residency nuance — neither engine keeps *inference* strictly in Canada

Worth telling the client plainly: even Option B doesn't achieve strict in-country **inference**. In this account, `ca-central-1` reaches Claude only via **cross-region inference profiles** (`us.` / `global.` prefixes) — there is no in-region-only Claude profile. So:

- **Data at rest** (S3 uploads, DynamoDB) *can* stay in `ca-central-1` for Option B.
- **The model inference call** routes through the North-America (`us.`) or global geo either way.

So the residency spectrum is: **A** = data + inference in US · **B** = data at rest in Canada, inference via NA/global geo. Strict in-country inference isn't currently available here for either.

---

## 4. Why Option B aborted (the real blocker), and the fix — CORRECTED 2026-07-16

**FIXED — Option B now extracts the real RAP end to end.** This section originally recorded a
diagnosis that later measurement contradicted on almost every specific. It is rewritten here
against what was actually measured; §4a covers how we cut the document, §4b the live run.

**What was wrong with the original diagnosis** (kept explicitly, because the wrong version was
cited for weeks):
- *"`output_tokens: 8192` for only ~2,200 characters of JSON — a ~15× mismatch."* The **character
  figure was wrong**: at ~2.8 chars/token, 8192 tokens ≈ **23k characters**, so there was no 15×
  anomaly to explain. The cap is also no longer 8192 — it is **16000** (`MAX_OUTPUT_TOKENS`).
- *"Root cause: the `Grounded<T>` per-sub-field schema is too much output."* Measured false. The
  burn is **invisible**: at 32 commitments the model spends ~89% of its budget on tokens that
  appear in **no stream channel** (`{tool_use: 1}` only — no text block, no thinking block),
  always dying ~1,380 chars in, exactly where the commitments array begins. It reproduces on
  sonnet-4-5 and sonnet-4-6, in us-east-1 and ca-central-1.
- *"Fix 1: lighten commitment grounding."* **Measured NOT to address it.** Because the burn is not
  JSON, shrinking the schema cannot recover it. Do not lighten the grounding contract for this
  reason — it costs provenance and buys nothing.
- *"Raising the cap"* makes it **worse**, not better: 32 commitments @16000 aborts, where 32 @4000
  at least returns.

**The actual regime** (measured live, 2026-07-16 — design to these, do not re-derive; they cost
real money):

| Commitments | max_tokens | Result |
|---|---|---|
| 8 | 16000 | ✅ `stop_reason: tool_use` |
| 22 | 16000 | ✅ 22/22 — **3/3 runs**, both regions, ~8.9k–10.2k output tokens |
| 32 | 16000 | ❌ connection `aborted` at ~69s — 3/3, both regions, also on sonnet-4-5 |
| 32 | 4000 | ❌ `stop_reason: max_tokens` |
| 45 | 16000 | ❌ aborted |

~**410 output tokens per commitment**; ~15% run-to-run variance on identical input.

**Why the Bank of Canada RAP died in one call.** Not because it has 22 commitments (22 is inside
the proven-good regime). Because the model actually extracts **46** commitment-like items from it
(see §4b) ≈ **19k output tokens** — over the 16000 cap. Confirmed live: the pre-fix pipeline
(commit `cc45d4c`, single forced call) run against the real PDF **fails with `Error: aborted` after
106s**. This document did not "already work".

**The fix is chunking** — one header call over the document plus one commitments call per ~6000-char
chunk, each staying well inside the measured-good regime, merged in document order. The mechanism
is still unexplained and chunking **sidesteps** it deliberately rather than fixing it (worth an AWS
support case with the repro).

The connection-level fixes remain correct regardless: **streaming**
(`InvokeModelWithResponseStream`), an **http/1.1 handler with a long timeout** (the default http2
handler dropped long generations), and **async multi-page Textract**.

---

## 4a. Chunk-boundary spike — how we cut a real RAP (2026-07-16)

Everything in §4 was measured on **synthetic `.txt`**, which short-circuits `loadDocumentText` and **bypasses Textract entirely**. Nothing had ever seen real OCR output. This spike ran three boundary strategies against the real `test/BankOfCanada_RAP.pdf` and measured them. Plan: `docs/superpowers/plans/2026-07-16-chunk-boundary-spike.md`.

**The document (measured, not assumed):** it is **17 pages, not 13** (§4/§5 say 13 — wrong). Real OCR output is 21,388 chars. Its commitments are the 22 "Some key actions:" bullets — 12 on p13, 10 on p15 — which **independently matches BDA's 22 in §5**. That is the gold set the arms were scored against.

**Result — arm (a) Textract LAYOUT wins, decisively and not on the expected grounds:**

| Arm | Boundary source | Gold found | **Pages correct** | **Quotes verbatim** |
|---|---|---|---|---|
| **(a)** | Textract `LAYOUT` blocks | 22/22 | **22/22** | **32/32** |
| (b) | single newline | 22/22 | 8/22 | 11/32 |
| (c) | sentence (status quo) | 10/22 | 1/10 | 9/19 |

**The real finding — the OCR text was scrambled before chunking ever ran.** Pages 13 and 15 lay their bullets out in **two columns**, and `StartDocumentTextDetection` returns `LINE` blocks in page-wide top-to-bottom order, so the columns interleave:

```
Invest in the CBNII to share          ← left column
Continue to integrate Indigenous      ← right column, a DIFFERENT commitment
work and learn best practices in      ← left again
```

Only **3 of 22** commitments existed as contiguous text in what we were sending Claude. This is upstream of the chunker: no boundary rule can reassemble text that isn't contiguous. It invalidates the premise of §4's "one big call truncates" framing — the input was already corrupt on the two pages that hold every commitment.

**Why (b) is the dangerous one.** Claude *reconstructs* the interleaved columns, so arm (b) scores a perfect 22/22 on count — but **21 of its 32 quotes are fabricated**: it welds fragments from two columns into a verbatim-looking span that appears nowhere in the document. A real example it returned:

> "Reshape our relationship with Indigenous Peoples **that values Indigenous histories, teachings and identities**"

— two unrelated p5 bullets stitched together. Its page numbers are systematically **off by one** (p12 for p13, p14 for p15), because the model infers page from the nearest preceding page-number line. Those pages are in-range, varied and non-null, so they **pass a "plausible" check while being wrong**. On a compliance product, a confident fabricated citation is worse than a miss.

**Arm (a) fixes this at the source:** LAYOUT resolves multi-column reading order natively, and each block carries its own `Page`, so pages are *read* rather than guessed. Two consequences worth knowing:
- LAYOUT_LIST blocks **overlap** their sibling LAYOUT_TEXT blocks (33% of words are owned twice). Emitting every block naively duplicates every commitment — `buildTextFromLayoutBlocks` dedupes deliberately.
- The emitted text is **no longer byte-for-byte the source**: `[p.N]` markers are injected and running header/footer/page-number boilerplate is dropped. That is the price of correct page grounding.

**Costs:** `AnalyzeDocument`+LAYOUT is a pricier Textract tier than plain text detection (unmeasured). One `aborted` stream was observed live on a 5,794-char chunk — the transient failure is real and small chunks do not prevent it, so orchestration must retry.

**F3 was not latent — and is now FIXED (2026-07-16).** `validate.ts`'s `requireQuote` only checked `quote !== null` and never substring-matched the document, so **all 21 of arm (b)'s fabricated quotes passed validation** — on the gate whose entire purpose is catching fabrication.

`validateAndFlag` now takes the document text the model was actually shown and raises `quote_not_found` when a quote doesn't occur in it. Three decisions make it real without making it noisy:
- **Match on words**, not bytes. The chunker is whitespace-lossy and Textract's punctuation drifts against the model's (curly vs straight apostrophes); a fabrication differs in *words*, so tolerance costs nothing and avoids false positives that would train reviewers to ignore the flag.
- **Honest elision passes.** A multi-valued field (`pillars`, `frameworkRefs`) has no single verbatim span, so the model marks the join with `…` — that is provenance, not fabrication, and each fragment is checked instead. A **silent weld** carries no ellipsis, is matched whole, and is still caught. Found live: without this, `pillars` flagged on every run.
- **Check against the LAYOUT-built text, never the raw PDF** — it carries injected `[p.N]` markers and drops boilerplate, so comparing to the original would false-negative everywhere. Chunks are non-overlapping slices of exactly that text, so no per-chunk plumbing is needed.

Verified live: **0 false positives across ~180 quote instances**, 26/26 commitments still grounded. Opt-in via `sourceText`, so the BDA path (grounds by confidence, not quotes) is unaffected.

---

## 4b. Live end-to-end run — Option B against the real PDF (2026-07-16)

`scripts/smoke-extract-bedrock.ts`, real `test/BankOfCanada_RAP.pdf`, `ca-central-1`, mock repo
(read-only, nothing written to any table).

| | pre-fix (`cc45d4c`, one call) | post-fix (chunked) |
|---|---|---|
| Result | ❌ `Error: aborted` @106s | ✅ completed in **392s** |
| Commitments | — | **46**, all with a non-null quote AND page |
| Pages | — | 4, 5, 7, 8, 9, 13, 15, 16 — none outside 1–17, none null |

**The 22 forward-looking commitments are extracted perfectly:** the page distribution shows
**12 on p13 and 10 on p15** — exactly the gold counts, each appearing once, on the correct page.
No drops, no duplicates. Textract OCR on the real multi-page PDF works, and page numbers are read
rather than guessed.

> **UPDATE — over-extraction fixed (2026-07-16, verified live).** `EXTRACTION_SYSTEM` gained a
> forward-looking rule (rule 7). Re-run against the same PDF: **46 → 26 commitments**, and all
> **17** past-achievement bullets are gone — pages 7 and 8 no longer appear in the output at all.
> The 22 real commitments are untouched (still 12 on p13 + 10 on p15). The `"Starting in 1975"` /
> `"Over the past several years"` validation flags are gone; the 3 that remain (`"Annual"`,
> `"Every three years"`) are legitimate cadences that just aren't ISO dates.
> The 4 remaining non-gold items are defensible: p6 "Commit to understanding limitations of Western
> ways of thinking…" and two p16 governance commitments ("Every three years… review and refresh",
> "Share annual updates on progress"). Only p9 "Develop a Reconciliation Action Plan" is arguable —
> the Bank already did, this document *is* it.
> **Side effect: it got 3.4× faster — 392s → 116.5s** — because output tokens scale with commitment
> count (~410 each), and it no longer emits ~20 things it shouldn't. That materially narrows the
> latency gap with BDA (64s) for the engine decision.
>
> The original 46-result analysis is kept below, because it is what diagnosed the cause.

**The original run returned 46, not 22 — it over-extracted.** The breakdown:
- **22** — the real forward-looking "Some key actions:" commitments (p13/p15). Correct.
- **17** — the p7/p8 **past-achievement** bullets from "Where we have been" (p7 has 7, p8 has 10 —
  the numbers match exactly). These are history, not commitments: "Representing Indigenous voices
  on Canadian banknotes — *Starting in 1975*…". `validateAndFlag` catches the smell without
  understanding it, flagging `timeline: "Starting in 1975"` and `"Over the past several years"` as
  unparseable dates.
- **7** — vision statements (p4/p5), a p9 item, and the p16 governance commitment ("Every three
  years we will review and refresh our goals"). These are arguably legitimate commitments that the
  22-item gold set simply doesn't cover.

So ~17 of the 46 are genuinely wrong. **This is not a chunking artifact** — nothing is duplicated
or split; the model is asked "extract the commitments from this chunk" and a list of past
achievements looks exactly like a list of commitments. Neither the old single-call prompt nor the
new per-chunk prompt ever says *forward-looking only*, so the same over-extraction was latent
before; the old call simply died before it could show us (46 × ~410 ≈ 19k tokens > the 16000 cap —
which is precisely why it aborted).

**Fixed** (see the update box above): `EXTRACTION_SYSTEM` rule 7 now states that commitments are
forward-looking and that a past-achievement list must be skipped even when it looks exactly like a
list of commitments. BDA (§5) returning 22 on the same document was the clue that this was a prompt
gap in Option B, not an inherent limit.

---

## 5. What "works today" looks like (Option A)

Real BDA output from the Bank of Canada RAP:
- **Header:** org = Bank of Canada; sector = finance_banking (inferred); jurisdiction = CA (inferred); period 2024–2027; framework = TRC CTA #92; pillars = economy/employment/respect/governance; governance body + review cycle captured.
- **22 commitments**, each with action / deliverable / classified type (partnership, governance, education_training, procurement, employment, community_investment, cultural_awareness).
- **Extras bucket** surfaced Vision, Guiding Principles, and the reporting commitment — content not in our schema, exactly the "promote recurring extras to real fields later" loop.
- Gaps (document-driven, not engine bugs): per-deliverable `timeline`/`owner`/`metric` were empty (the plan is narrative and doesn't state them), and it conflated review cadence.

---

## 6. Recommendation for next steps

1. **Now:** run on Option A (BDA, `us-east-1`). It's deployed and working.
2. **Tell the client** the residency tradeoff honestly (§3): with BDA, RAP documents are processed in the US. If strict Canadian residency becomes a hard requirement, that's the trigger to invest in Option B.
3. **Revisit B** with fix #1 (lighter commitment grounding) — it keeps the in-country data-at-rest posture *and* the superior verbatim-quote provenance, and is the smaller of the two engineering efforts.
4. **Explore alternatives** if neither fits: a Canada-hosted or self-hosted model for true in-country inference; or Textract-Queries-only extraction (no LLM) for the structured subset.

---

## 7. BDA's ~20-page limit — and the chunking workaround (2026-07-01)

**Finding.** BDA **custom-blueprint** extraction caps at **~20 pages per document**. The 35-page RBC RAP failed with `ClientError — The input document size is too large to process` **even after compressing 18 MB → 2.9 MB** — proving it's a *page-count* limit, not file size. The 17-page Bank of Canada RAP works; RBC needed trimming.

**Why it matters for the client.** Many real RAPs and sustainability reports exceed 20 pages (RBC RAP = 35 pp; corporate ESG reports routinely 50–150 pp). Without a workaround, only short RAPs extract.

**Workaround (implemented — `pipeline.bda.ts`).** Long PDFs are auto-handled:
1. The worker reads the PDF and counts pages (`pdf-lib`).
2. If > 20 pages, it **splits into ≤20-page chunks**, uploads them to S3 (`bda-chunks/…`), and runs a BDA job on **each chunk in parallel** (wall time ≈ one job, not the sum).
3. Results are **merged** into one extraction: header fields (org/title/period/…) from the first chunk that found a value; commitments + extras are the **union**, de-duplicated across chunk boundaries; page numbers are **offset** back to the original document's numbering.
4. The extraction worker's timeout was raised to 900 s and memory to 1536 MB (pdf-lib loads the PDF to split it).

**Residual caveats.**
- A commitment split across a chunk boundary could be captured twice (mitigated by action-text dedup) or truncated at the seam — rare, but possible.
- Chunk PDFs + BDA outputs accumulate in S3 (`bda-chunks/`, `bda-output/`); add an S3 lifecycle rule to expire them.
- Very long docs (100+ pp → 5+ chunks) may hit BDA **concurrency limits** and serialize; the 900 s timeout covers this, but a job queue would be more robust at scale.
- Alternative for extreme lengths: BDA **standard output** (supports thousands of pages) for a first pass, then targeted custom extraction — larger effort, deferred.
