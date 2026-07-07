# Plan — Grounded RAP Index: building toward a credible corpus

**Owner:** Nate (En-Ping) · **Prepared:** 2026-07-06 · CS7980 capstone
**Status:** proposed
**Context:** [PR #56](https://github.com/logisticPM/portal/pull/56) held — see its closing comment. Live `/commitments` is on the illustrative `@/lib/commitments` domain (106 rows, 0% supplier-confirmed). The grounded `@/lib/rap` domain is the intended backbone but has only ~25 hand-curated rows and a 3-PDF corpus. This plan gets us from there to a credible, honestly-grounded RAP Index without shipping a regression or faking grounding.

---

## 1. Goal & definition of "credible"

Replace the illustrative `/commitments` page with one sourced from the **grounded rap extraction pipeline** — every row traceable to a real `source {quote, page}` in a real document, with an honest `claimBasis` — **without** losing the analytics `main` already ships (risk, insights, confirmation integrity, export, search).

**Credible-target gate (all must hold before cutover):**

| Metric | Threshold |
|---|---|
| Grounded commitments (pipeline-extracted, human-reviewed) | **≥ 80** |
| Distinct organizations | **≥ 40** |
| Sectors represented (rap taxonomy) | **≥ 6 of 8** |
| Rows with a verified `source {quote, page}` | **100%** of shown rows |
| Rows with fabricated/empty grounding | **0** (hard rule) |
| Feature parity with current `main` page | risk + insights + integrity + export + search all working on rap types |

Rationale: 80/40 keeps us near the current 106/100 density so the page doesn't read as thin, while never showing an ungrounded row. Below the gate, `main` stays live.

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
Turn `DATA_VERIFICATION.md`'s 100-org inventory into feedable source documents. Track every org in an acquisition sheet: `org · sector · source type (PDF | web | statutory) · URL · acquired? · pages`.

- [ ] **PDF-first orgs** — download the org's actual RAP/reconciliation PDF (start with the ~6 in §4). Target: 25–35 clean PDFs.
- [ ] **Web-only orgs** (Enbridge IRAP, TELUS, Agnico narrative, …) — build an **HTML→document capture path**: scrape the micro-site to clean text/PDF, preserving page/section anchors so grounding still points somewhere verifiable. This is the structural blocker §4 calls out; budget real time for it.
- [ ] **Statutory sources** — ESTMA filings, the ISC 5% procurement dataset (`open.canada.ca`), CER snapshots. These are tabular and high-trust; extract as structured records with `claimBasis: statutory`.
- [ ] De-dupe against existing real-fixtures; prefer primary org documents over aggregator summaries.

**Exit gate:** ≥ 50 acquired source documents spanning ≥ 6 sectors, logged with provenance.

### Phase 2 — Pipeline hardening (1.5 wk, parallel with Ph.1)
- [ ] **Image-heavy PDFs** (RBC-class): confirm OCR/vision extraction path works end-to-end; RBC is the canonical stress test.
- [ ] **Web-page ingestion**: a normalized "document" adapter so HTML captures flow through the same extract→ground→review path as PDFs, with a synthetic but stable `page`/anchor.
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

## 7. Open decisions for the team

1. **Gate numbers** — is 80/40 the right "credible" bar, or ship at a thinner 60/30 first?
2. **Web-only orgs** — build the HTML-capture adapter now, or defer those orgs and lean on statutory sources for volume?
3. **Sector enum** — expand rap `Sector` to ~15, or adopt a coarser grouping and accept some `"other"`?
4. **Illustrative data** — retire entirely, or keep behind a `demo` flag for screenshots/marketing?
