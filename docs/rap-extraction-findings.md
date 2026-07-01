# RAP extraction — live-test findings & engine decision

**Date:** 2026-07-01 · Tested on a real 13-page RAP (Bank of Canada, "Our journey towards Reconciliation") in an AWS sandbox account, `ca-central-1` + `us-east-1`.

This documents what we learned deploying and testing the RAP extraction pipeline on real AWS, the decision we made, and the open path for later. Written for the team + client.

---

## Decision (TL;DR)

**Ship Option A — Amazon Bedrock Data Automation (BDA), in `us-east-1`.** It works end-to-end today: it extracted all 22 commitments plus every header field from the real Bank of Canada RAP in **64 seconds**.

**Option B — Claude on Bedrock (in-country, `ca-central-1`) is deferred.** Its extraction *quality* is excellent (arguably better-grounded than BDA), but a single grounded call currently **truncates** on RAPs with many commitments. It's a known, fixable limitation, not a dead end — see §4.

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

## 4. Why Option B truncates (the real blocker), and the fix

On the 13-page RAP, Claude extracted **all 13 header fields perfectly** — each with a verbatim quote, page number, and calibrated confidence (it even read `reviewCycle: "Every three years"` correctly, where BDA wrongly returned "annual"). But it **truncated before the commitments array** with `stop_reason: max_tokens`.

The diagnostic: the model reported **`output_tokens: 8192` (the full cap) for only ~2,200 characters of JSON** — a ~15× mismatch. The output budget is being consumed far faster than visible JSON is produced, so it runs out before the ~22 commitments. Raising the cap to 32k made the generation long enough that the **connection aborted**. The two constraints collide.

**Root cause:** the `Grounded<T>` schema wraps *every* field — including all 8 sub-fields of every commitment — in `{value, quote, page, confidence}`. For a 22-commitment RAP that's ~190 grounded objects with verbatim quotes: too much output for one call.

**Fixes (for when we revisit B):**
1. **Lighten commitment grounding** — one representative quote + page per *commitment* instead of per sub-field. Cuts output ~4–5× while keeping meaningful provenance. (Schema change across `extraction-schema.ts`, `types.ts`, `validate.ts`, `publish.ts`.)
2. **Two-pass extraction** — call 1: header fields + commitment actions/deliverables; call 2 (or a batch): grounding. More API calls, but each stays small.
3. **Model/param tuning** — try a different Claude model/profile, or investigate the token-vs-char anomaly (possible interleaved reasoning consuming the budget).

We fixed the connection-level issues along the way (these are committed and correct regardless): **streaming** (`InvokeModelWithResponseStream`), an **http/1.1 handler with a long timeout** (the default http2 handler dropped long generations), and **async multi-page Textract**. The pipeline now also **detects the truncation** and throws a clear error rather than a confusing JSON-parse failure.

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
