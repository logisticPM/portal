# Plan — Grounded RAP Index: building toward a credible corpus

**Owner:** Nate (En-Ping) · **Prepared:** 2026-07-06 · CS7980 capstone
**Status:** SUPERSEDED (2026-07-10) — full cutover de-scoped. No replacement plan: grounding is already enforced + displayed; the actionable work was verifying + hardening the extraction pipeline (see the note below).
**Context:** [PR #56](https://github.com/logisticPM/portal/pull/56) held — see its closing comment. Live `/commitments` is on the illustrative `@/lib/commitments` domain (106 rows, 0% supplier-confirmed). The grounded `@/lib/rap` domain is the intended backbone but has only ~25 hand-curated rows and a 3-PDF corpus. This plan gets us from there to a credible, honestly-grounded RAP Index without shipping a regression or faking grounding.

---

> ## ⚠️ Superseded — read this first (2026-07-10)
>
> The full plan below (grind a corpus to **≥80 grounded rows / ≥40 orgs**, then flip `RAP_INDEX_SOURCE=rap` to replace the live index) is **no longer being pursued as written.** Reasons:
>
> 1. **Two of the seven phases are already done.** Phase 0 (the `RAP_INDEX_SOURCE` flag + isolation) shipped — it's in `src/lib/rap-index/facts-source.ts`. Phase 4 (expand rap `Sector`, taxonomy reconciliation) is superseded by the canonical-taxonomy work in PR #145 (`rap/types.ts` now `Sector = CanonicalSector`; `extraction-schema.ts` uses `CANONICAL_SECTORS`).
> 2. **The value delta is marginal for the cost.** Per §8 of this doc, the grounded pipeline buys **grounding** (quote+page faithfulness), not **confirmation** (the actual product value, explicitly out of scope here). The live page already has **provenance** (every row a real, HTTP-checked source URL). 7–9 weeks would move the index from "sourced to a real page" → "quoted from that same page" — a change users and the client won't see.
> 3. **The live page is now genuinely good.** PRs #145–148 (canonical labels, working treemap drill, real dollar KPIs ~$23.8B, suppliers normalization, analytics fixes) closed most of the "reads thin/illustrative" gap that motivated the cutover.
> 4. **The ground is moving.** The repo split is live — this whole domain is migrating to `indigenomics-data-platform` (snapshot PRs; portal still the active repo). Betting 7–9 weeks against `logisticPM/portal` paths mid-split is risky.
>
> **What replaces it:** nothing large. We considered a "proof-of-grounding" capability demo but concluded it's unnecessary — **grounding is already a property the pipeline enforces, not an artifact to build.** `validateAndFlag(requireQuote:true)` (`pipeline.bedrock.ts`) rejects any commitment whose verbatim quote doesn't verify against the source, and the `/extract` review UI (`ReviewPanel.tsx`) already displays each row's source quote. Nothing downstream consumes grounded rows today (the illustrative page stays as the credible-looking live index, §7.4), so a bespoke showcase would have no consumer.
>
> **What we actually did:** verified the PDF extraction → publish path end-to-end (mock engine + the full dedup/persistence logic both real engines share) and **hardened the dedup key so re-uploads never duplicate canonical rows** — org-name normalization + a source-document content hash replacing the fragile model-extracted `title|period` key (**PR #151**, `scripts/test-rap-dedup.ts`). A live BDA/Bedrock cloud smoke test (`aws sso login --profile isb`, then `EXTRACTION_IMPL=bda`) remains an optional follow-up.
>
> The phase detail below is retained as reference — the corpus-acquisition, HTML-capture, and grounding-QA thinking (Phases 1–3) is the input if a grounded corpus is ever revived.

---

## 1. Goal & definition of "credible"

Replace the illustrative `/commitments` page with one sourced from the **grounded rap extraction pipeline** — every row traceable to a real `source {quote, page}` in a real document, with an honest `claimBasis` — **without** losing the analytics `main` already ships (risk, insights, confirmation integrity, export, search).

**Credible-target gate (all must hold before cutover):**

| Metric | Threshold |
|---|---|
| Grounded commitments (pipeline-extracted, human-reviewed) | **≥ 80** |
| Distinct organizations | **≥ 40** |
| Sectors represented (expanded rap taxonomy, §4) | **≥ 6** |
| Rows with a verified `source {quote, page}` | **100%** of shown rows |
| Rows with fabricated/empty grounding | **0** (hard rule) |
| Feature parity with current `main` page | risk + insights + integrity + export + search all working on rap types |

Rationale: 80/40 keeps us near the current 106/100 density so the page doesn't read as thin, while never showing an ungrounded row. Below the gate, `main` stays live.

**Isolation strategy (decided 2026-07-07):** the grounded work must not reach users until it clears the gate. Mechanism: the **code** lands on `main` incrementally behind the `RAP_INDEX_SOURCE` flag (default `commitments`, so it is dormant/invisible in prod), and the **grounded data accumulates in a dedicated non-prod SST stage** until it hits 80/40 — then flip the flag on prod. This is preferred over a long-lived git branch (which drifts hard against a very active `main`). A literal integration branch is an acceptable fallback if the team prefers, at the cost of regular rebasing.

**Non-negotiable:** we do **not** transcode `DATA_VERIFICATION.md`'s illustrative rows into the rap schema to pad the count — that fabricates grounding and defeats the purpose. Illustrative data may remain only behind the existing `@/lib/commitments` page until cutover.

---

## 2. Current state (baseline)

- **Live:** `main` → `/commitments` on `@/lib/commitments`, 106 illustrative commitments / 100 orgs, CSV export + risk + insights.
- **Grounded assets:** `src/lib/rap/real-fixtures.ts` ≈ 10 orgs / ~25 commitments, **hand-curated from §2 figures — not pipeline-grounded** (no real quote+page).
- **Corpus (`docs/rap-data-verification-and-sources.md §4`):** 3 downloaded PDFs — Bank of Canada RAP (17pp, clean baseline), RBC RAP (35pp, image-heavy), Agnico ESTMA (7pp, statutory). 3 more listed, not downloaded. Several target orgs are **web-only** (no single PDF).
- **Pipeline:** BDA + Bedrock extraction with a review queue exists (`src/lib/rap/pipeline.*`), auto-chunks PDFs >20pp (commit `dc1fd43`), async worker (`977811c`).

---

## 3. Phases

### Phase 0 — Lock the decision & instrument (0.5 wk)
- [ ] Confirm rap is the canonical domain; `main` page stays live until the gate is met. (This doc = the record.)
- [ ] Add a **corpus/extraction dashboard** (internal): counts of docs acquired, extracted, reviewed, promoted — so "how close to the gate?" is always answerable. Feed it from `extractionRepo`/`rapRepo`.
- [ ] Add a **feature flag** `RAP_INDEX_SOURCE = commitments | rap` (env-driven, default `commitments`) so `/commitments` can be flipped per-stage without a code merge.

**Exit:** flag exists; dashboard shows the 3-PDF / ~25-row starting point.

### Phase 1 — Corpus acquisition (2–3 wk, the long pole)
Turn `DATA_VERIFICATION.md`'s 100-org inventory into feedable source documents. **The illustrative rows are the worklist** — each already carries the public **source URL** it was drawn from, so acquisition = "for each illustrative row, fetch its source (PDF or web page) and grind it into a grounded row." Track every org in an acquisition sheet: `org · sector · source type (PDF | web | statutory) · URL · acquired? · pages`.

- [ ] **PDF-first orgs** — download the org's actual RAP/reconciliation PDF (start with the ~6 in §4). Target: 25–35 clean PDFs.
- [ ] **Web-only orgs** (Enbridge IRAP, TELUS, Agnico narrative, …) — build an **HTML→document capture path**: scrape the micro-site to clean text/PDF, preserving page/section anchors so grounding still points somewhere verifiable. This is the structural blocker §4 calls out; budget real time for it.
- [ ] **Statutory sources** — ESTMA filings, the ISC 5% procurement dataset (`open.canada.ca`), CER snapshots. These are tabular and high-trust; extract as structured records with `claimBasis: statutory`.
- [ ] De-dupe against existing real-fixtures; prefer primary org documents over aggregator summaries.

**Exit gate:** ≥ 50 acquired source documents spanning ≥ 6 sectors, logged with provenance.

### Phase 2 — Pipeline hardening (1.5 wk, parallel with Ph.1)
- [ ] **Image-heavy PDFs** (RBC-class): confirm OCR/vision extraction path works end-to-end; RBC is the canonical stress test.
- [ ] **Web-page ingestion (HTML-capture adapter — decided: build now)**: web RAPs aren't images, so they need **no OCR**. Fetch + clean the page to text and feed it **straight into the Bedrock tool-use core** (`pipeline.bedrock.ts`'s `CLAUDE_TOOL` / `EXTRACTION_SYSTEM` / `validateAndFlag`), **skipping Textract**. Reuse the verbatim-quote grounding; swap the PDF `page` anchor for a stable section/heading anchor. This is a small adapter over the existing engine, not a new pipeline. (BDA — `pipeline.bda.ts` — stays the PDF-native path; the `ca` stage already runs the Bedrock engine in-region.)
- [ ] **Grounding QA**: reject/flag any extracted commitment whose `source.quote` doesn't verify against the source text (reuse the quote-verifier pattern already in the cases pipeline). Zero ungrounded rows is a hard gate.
- [ ] **Statutory adapter**: map ISC 5% / ESTMA rows → rap `Commitment` with `claimBasis: statutory` and a source anchor to the dataset row.

**Exit:** all three input types (clean PDF, image PDF, web/statutory) produce verified grounded commitments.

### Phase 3 — Extraction, review & yield (2 wk, follows Ph.1/2)
- [ ] Run the corpus through the pipeline in batches; commitments land in the review queue (`/rap/review`).
- [ ] Human review (owner: data lead) — accept/correct grounding, set `claimBasis`, assign `pillar`/`commitmentType`. Apply the §1 fix-list from `docs/rap-data-verification-and-sources.md` (the RBC/Cedar-LNG/AIOC corrections) during review so known errors don't propagate.
- [ ] Track yield: docs → candidate commitments → promoted. Expect < 1 doc ≈ several commitments (BoC baseline gives the ratio).

**Exit gate:** ≥ 80 promoted, human-reviewed grounded commitments across ≥ 40 orgs.

### Phase 4 — Taxonomy reconciliation (1 wk, can start in Ph.0)
The illustrative set uses **15 sectors**; rap `Sector` has only **8** → 8 collapse to `"other"` today. Decide and implement:
- [ ] **Expand rap `Sector`** to cover the real distribution (add health, education, consulting, construction, forestry, aerospace, agriculture, media — or a sensible grouping). Update `extraction-schema.ts` `SECTORS`, `types.ts`, the BDA blueprint enum, and label maps. Prefer expansion over lossy collapse.
- [ ] Map the illustrative "type" values that are really **pillars** (`relationships`, `governance`) vs rap `CommitmentType` (`procurement`, `employment`, …). Document the crosswalk; the two are orthogonal dimensions in the rap model.
- [ ] Re-verify PR #105's `oneOf()` coercion fallbacks against the expanded enums (so nothing silently drops to `"other"`).

**Exit:** rap taxonomy covers the real corpus with < 5% of rows in `"other"`.

### Phase 5 — Feature parity on rap types (1.5 wk)
Port `main`'s page capabilities so the cutover loses nothing:
- [ ] `computeRisk` / deadline-risk tabs → operate on rap `dueDate` + `CommitmentRollup.latestStatus`.
- [ ] `buildInsights` takeaways → rap fields.
- [ ] `confirmationIntegrity` → map onto `claimBasis` (`independently_verified` = the "confirmed" analog).
- [ ] CSV export + search + pagination → rap repo query surface.
- [ ] Salvage PR #56's UI: grounded inline `<details>` rows, **source-quote display**, Record-progress form. (Cherry-pick from `feat/commitments-merge-rap` rather than re-authoring.)

**Exit:** a rap-backed `/commitments` behind the flag with parity + grounding, reviewed in staging.

### Phase 6 — Unification & cutover (1 wk)
- [ ] Seed the rap Dynamo tables (prod stage) from the reviewed corpus.
- [ ] Flip `RAP_INDEX_SOURCE = rap` in staging → verify against the §1 gate → flip in prod.
- [ ] Migrate `/organizations` and `/my-commitments` onto rap (they still import `@/lib/commitments`).
- [ ] Deprecate `@/lib/commitments` + `/api/commitments/export`'s old path once nothing imports them; keep the illustrative fixtures behind a `demo` flag if useful for screenshots.

**Exit / Done:** live `/commitments` served from rap, ≥ 80 grounded rows, 0 ungrounded, all `main` features intact, old domain retired.

---

## 4. Milestones & row-count gates

| Milestone | Grounded rows | Action |
|---|---|---|
| M0 — today | ~25 (hand-curated) | `main` live; plan approved |
| M1 — corpus acquired | — | ≥ 50 docs logged (Ph.1 gate) |
| M2 — first grounded batch | ~40 | staging preview behind flag; do **not** cut over |
| M3 — credible gate | **≥ 80 / ≥ 40 orgs** | eligible for cutover (Ph.6) |
| M4 — unified | ≥ 80, siblings migrated | `@/lib/commitments` retired |

**Hard rule:** never flip prod below M3, and never show an ungrounded row to reach a count.

---

## 5. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Web-only RAPs can't be fed as PDFs | Caps reachable org count | Phase 2 HTML-capture adapter; treat as first-class input, budget time |
| Extraction yield lower than hoped | Miss the 80-row gate | Supplement with statutory (ISC 5%, ESTMA) structured rows — high-trust, high-volume |
| Grounding verification too strict → few rows survive | Thin page | Tune verifier; allow `statutory` rows anchored to dataset cells, not just quotes |
| Taxonomy expansion churns the blueprint | Extraction regressions | Version the BDA blueprint; parity-test before/after (pattern already used in cases work) |
| Known figure errors propagate | Credibility hit | Apply `rap-data-verification-and-sources.md §1` fix-list during Phase 3 review |
| Scope creep from unifying siblings | Delays cutover | `/organizations` + `/my-commitments` migration is Phase 6, *after* the index cutover — don't block on it |

---

## 6. Effort estimate (rough)

~7–9 calendar weeks with Phases 1–2 and 4 overlapping; the long pole is corpus acquisition + the web-capture adapter (Phase 1/2). A "thin credible" cut (gate at 60/30 instead of 80/40, PDF-only, defer web-only orgs) could land in ~4–5 weeks if needed.

---

## 7. Decisions (resolved 2026-07-07, Nate)

1. **Gate numbers — 80/40 confirmed** as the starting bar. Build toward it in isolation and do **not** let a half-built grounded page reach `main`/prod before the gate (mechanism in §1 "Isolation strategy": flag-dormant code on `main` + grounded data in a non-prod stage; a side branch is the fallback).
2. **Web-only orgs — build the HTML-capture adapter now** (do not defer). Not all RAPs are PDFs; BDA is PDF-only, so we need a non-BDA path. Implementation: route cleaned HTML text through the existing Bedrock tool-use core, skipping Textract (Phase 2).
3. **Sector enum — expand to 15+.** Cover the real distribution rather than collapsing to `"other"`. Accept the mechanical cost (blueprint enum + coercion fallbacks + label maps).
4. **Illustrative data — keep (do not retire).** It is genuinely sourced (web pages, just not PDFs) and stays behind the existing commitments page as demo/fallback **and** as the acquisition worklist (each row's source URL is the target the HTML adapter grounds). Retire only after cutover, if at all.

## 8. Provenance ≠ grounding ≠ confirmation (team alignment)

A recurring confusion to head off: **a source URL is not supplier confirmation.** Three independent axes:

| Axis | Question | Satisfied by | Where it lives |
|---|---|---|---|
| **Provenance** | Does the claim trace to a real source? | `DATA_VERIFICATION.md` source URLs → "self-reported **with citation**" | `source {label,url}` / `source {quote,page}` |
| **Grounding** | Is the extracted figure faithful to that source? | pipeline quote+page anchoring + `validateAndFlag` | rap extraction |
| **Confirmation** | Is the claim actually **true** — did the counterparty attest? | a **confirmation record** (supplier/Nation confirms/disputes) or a supplier-side dataset (CCIB/PAIR, ISC 5%, Nation records) | `claimBasis: independently_verified` → `confirmed` status |

Marking sources satisfies **provenance only**. The `DATA_VERIFICATION.md §1` fix-list (Suncor "63 sites", Enbridge cumulative-vs-annual, etc.) shows well-sourced figures that are still wrong/misleading — **source ≠ truth**. "Supplier-confirmed" requires the *other side of the transaction* to attest, which is exactly the layer the portal exists to add and why the fixtures deliberately cap at `reported` / 0% confirmed. **Confirmation is a product to build, not a field a citation grants** — a separate track from this corpus effort, and not part of the 80/40 grounding gate.
