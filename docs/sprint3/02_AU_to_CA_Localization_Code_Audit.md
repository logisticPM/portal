# 02 · AU → CA Localization — Code-State Audit

**Sprint:** 3 · **Author:** En-Ping Su · **Type:** Localization gap analysis (code, not design)

This is **not** a re-derivation of the Australia→Canada framework decisions — those are
settled in [`../sprint1/09_Questionnaire_Adaptation_AU_to_CA.md`](../sprint1/09_Questionnaire_Adaptation_AU_to_CA.md)
(the canonical mapping), with supporting analysis in `../sprint1/08_RAP_Reference_Analysis.md`,
the pillar restructuring in `../sprint2/02_Questionnaire_Expansion_Design.md`, and the Canadian
verification landscape in `../sprint2/07_Verification_P2_Design.md`.

This doc audits the **current codebase** against those decisions: what is already Canadian,
what still carries Australian assumptions, and a file-level checklist of what to change. The
09 doc called items 1–3 "find-and-replace" — this is the find half, made concrete.

## Headline

The code has **two layers at different localization stages**:

- **Confirmable layer — `src/lib/repo/`** — already Canadian. No localization debt.
- **Self-report survey layer — `src/lib/survey/`** — a near-verbatim port of Reconciliation
  Australia's 2025 RAP Impact Survey. **Almost all residual Australian debt lives here.**

The header comment at `src/lib/survey/types.ts:5` is explicit: *"what Australia's RAP Impact
Survey collects."*

## A. Already Canadian (done — do not touch)

| Concern | Where | Status |
|---|---|---|
| Indigenous-business cert tiers | `repo/types.ts:10` — `IdentityTier = "nation" \| "ccab" \| "self_declared"` | CCAB/CCIB present |
| Verification sources | `repo/types.ts:12` — `"nation" \| "ccib" \| "isc_ibd" \| "regional"` | CCIB + ISC-IBD (Canadian) |
| Currency | `components/ui.tsx` — `money()` uses `en-CA` / CAD | Canadian |
| Ownership-tier confirmation engine, the moat | `repo/` + `report` flow | Canada-specific (09 §4) |
| Fixture copy | `survey/fixtures.ts:130` — "First Nations businesses" | Canadian wording |
| Economic pillars | `repo/types.ts` — `FlowType = procurement \| capital`, tags | Indigenomics taxonomy, not AU social pillars (09 §5, sprint2/02 §3) |

## B. Residual Australian — outstanding (the work)

Grouped by the five areas in `09_Questionnaire_Adaptation_AU_to_CA.md`.

### B1 · Terminology & peoples (09 §1) — **schema gap, not just copy**

- **`indigenousStaff` is a single bucket, not distinctions-based.** `survey/types.ts:127-138`
  models `total` + a `breakdown` by *employment type* (permanent / nonOngoing / casual / …).
  09 §1 and sprint2/02 §2 both require a **distinctions-based** split — *First Nations /
  Métis / Inuit are three constitutionally distinct groups; one bucket is wrong.* The schema
  does not capture this. **This is real schema work, not find-and-replace.**
- **`nonOngoing` employment category** (`survey/types.ts:132`) is Australian public-service
  terminology ("non-ongoing employee"). Canadian equivalent: term/contract. Rename or remap.
- **`indigenousStaffByLevel.councillors`** (`survey/types.ts:142`) is an AU local-government
  framing; review whether it belongs in the Canadian model.

### B2 · Certification & ownership (09 §2)

- **Supply Nation fields** — `survey/types.ts:149` `procurementSupplyNationCertified`,
  `:151` `supplyNationMember`. Rename to CCIB/CIB (`ccibCertified` / `ccibMember`) per 09 §2.
- **Supply Nation in UI + fixtures** — `ContextForm.tsx:161` placeholder
  `"Supply Nation, CareerTrackers, Jawun"`; `survey/fixtures.ts:53,101,130` partneredWith /
  outcome copy. Replace with CCIB / NACCA / Indspire (CareerTrackers also operates in Canada).
- **51% ownership threshold** (09 §2) — confirm wherever ownership is gated;
  `repo/types.ts:42` `ownershipPct` comment already says "≥51 to qualify" → repo side OK,
  but any survey-side procurement gating should match.

### B3 · Calendar, indices, events (09 §3) — **find-and-replace**

- **`asx200` field** — `survey/types.ts:88`. Already labelled "Listed (TSX 200)" in the UI
  (`ContextSections.tsx:85`, `ProfileForm.tsx:107`) but the **field name is still `asx200`**.
  Rename the field to match the label (`tsx200` / `publiclyListed`). *This schema-vs-label
  mismatch is the clearest localization canary in the code.*
- **Reporting period = Australian financial year** — `survey/defaults.ts:28`
  `reportingPeriod: \`${startYear}-07-01..${year}-06-30\`` (1 Jul–30 Jun). Change to the
  Canadian fiscal year (calendar, or Apr 1–Mar 31) per 09 §3.
- **NRW participation** — `survey/types.ts:45` `NrwParticipation`, Q17–18. National
  Reconciliation Week is Australian. Canadian analogue: National Day for Truth and
  Reconciliation (Sep 30) / National Indigenous Peoples Day (Jun 21).
- **"Australian-based" employees** — `survey/types.ts:89` (Q5 comment) → "Canadian-based."

### B4 · Framework body & maturity ladder (09 §1–2) — **decision needed, not mechanical**

- **`RapType = reflect \| innovate \| stretch \| elevate`** — `survey/types.ts:16`. This is
  Reconciliation Australia's RAP ladder. 09 §2 maps it to **CCIB PAIR** (Partnership
  Accreditation in Indigenous Relations). Decide: keep RAP-tier labels as a borrowed concept,
  remap to PAIR levels, or drop. Touches `survey/types.ts`, the `rapTypeLabels` map and
  `RAP_OPTIONS` in the report UI, and fixtures. **Product/policy decision first.**
- **Reconciliation Australia engagement questions** — `survey/types.ts:101` (Q8–13,
  `raSupportDevelop` … `raEventsAttended`). No single Canadian equivalent body (09 §1 anchors
  to TRC Call to Action #92 + UNDRIP/UNDA). These questions likely become context or are
  reframed; not a rename.

### B5 · Comments referencing Australia (cosmetic)

- `repo/actions.ts:60`, `dynamo/single-table.ts:15`, `survey/types.ts:5` reference "Australia"
  in explanatory comments. Harmless, but update when touching those files so the codebase
  reads Canada-first.

## C. Effort split

| Bucket | Items | Nature |
|---|---|---|
| **Find-and-replace** (cheap) | B2 field/label renames, B3 calendar/index/events, B5 comments, the `asx200`→`tsx200` rename | Mechanical; mostly `src/lib/survey/` |
| **Schema / product decisions** (real work) | B1 distinctions-based staff breakdown, B4 RAP-ladder→PAIR mapping + RA-engagement questions | Need a data-model + policy decision before coding |

## D. Notes / open questions

- The 09 doc says items 4–5 (OCAP/CARE + confirmation layer + procurement slice) are "already
  reflected in the data model" — confirmed true for the `repo` layer. The **survey layer was
  never localized past the design doc**, which is why B1–B4 remain.
- The AU→CA institution mappings here are taken from 09/08/07; whether each is the *correct*
  program equivalent (e.g., RAP-ladder ↔ PAIR levels) is a domain call best confirmed with the
  Indigenomics framework owners before schema names are locked.
- None of this blocks the current `feat/editable-context-sections` work (editable context is
  framework-agnostic); these are follow-ups for when the survey schema is Canadianized.
