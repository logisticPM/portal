# 10 · Direction Decision Memo + Scorecard (RAP-11)

**Sprint:** 1 (Week 4) · **Author:** En-Ping Su (Sprint Lead) + team · **Card:** RAP-11
**Definition of Done:** scorecard filled for each direction + a one-paragraph recommendation.
**Status:** Recommendation made; **client greenlight still pending** (client response time is slow — not a blocker for a discovery sprint).

---

## 1. Directions evaluated

Per the exploration ledger (see `07_Team_Handin_2page`), three strands plus the deck comparators:

| # | Direction | Origin | Client stance |
|---|---|---|---|
| D1 | **Educational platform** (citation-first tool over open data) | Our first idea | **Declined** ("not keen") |
| D2 | **Consent Layers** (consent/confirmation app) | Built at the client's Tech Jam | Exploratory; engine reused |
| D3 | **RAP platform** (consent-based, verified Indigenous-economic data; supplier-confirmed RAP questionnaire → RAP Index) | Current idea | **No greenlight yet** |
| — | Deck comparators (hero sim, conversational entry, reference layer, B2B directory) | Client deck | Parked |

## 2. Scorecard (1–5; higher = better)

| Criterion (weight) | D1 Educational | D2 Consent Layers | **D3 RAP platform** |
|---|:---:|:---:|:---:|
| Data feasibility — open/ingestable (×1) | 4 | 3 | **4** |
| Build effort realistic for 4 students / 10 wks (×1) | 3 | 4 | **3** |
| Fit with client positioning (Deck 4 / Indigenomics theory) (×1.5) | 2 | 3 | **5** |
| Capstone-scope realism (Aug showcase) (×1) | 4 | 4 | **4** |
| "Felt understanding" / public value (×1) | 3 | 3 | **5** |
| Existing-codebase head start (×1.5) | 1 | 5 | **5** |
| **Weighted total (max 35)** | **18.5** | **26.5** | **30.0** |

**Notes on the scoring:**
- **D1** lost on *client fit* (declined) and *head start* (nothing reusable) — set aside.
- **D2** scores well on *head start* (it IS the confirmation engine) but is a *foundation*, not a standalone product — its value is realized **inside D3**.
- **D3** wins on *client fit* (operationalizes Indigenomics' RAP framework + the $100B thesis; aligns with the emerging UBCIC–RRII verification standard), *public value*, and *head start* (reuses the Consent Layers engine). Its only soft spots are build effort/data realism, both de-risked this sprint (see §4).

## 3. Recommendation (one paragraph)

> **We recommend the RAP platform (D3) as the capstone direction**, with the Consent Layers confirmation engine as its reusable core. It scores highest because it operationalizes the client's own RAP framework and $100B economic thesis, adds the verification layer Australia's proven questionnaire never had, and starts from a real head-start (the Tech Jam engine) rather than a blank page. **This is a recommendation, not committed scope: it is contingent on the client's greenlight.** Because the client has not yet responded, Sprint 1 deliberately produced *validated knowledge + thin prototypes* (an MVP demo on synthetic data, the AU→CA questionnaire adaptation, a data-feasibility memo, and de-risking spikes) rather than committing engineering to an unvalidated direction.

## 4. What this sprint did to de-risk D3 (evidence behind the score)

- **Thin vertical prototype built** — company-side report + coverage pages on the mock `PortalRepo`, completing the report→confirm→coverage demo loop (portal PR #1, cards RAP-23/RAP-9).
- **Questionnaire adaptation** — Australia's RAP Impact Survey mapped to the Canadian context (CCIB, OCAP/CARE, federal 5% target) — `08`, `09`.
- **Data feasibility** — federal 5% open data + the Indigenous Business Directory rated ingestable for a Horizon-2 pilot; synthetic data sufficient for the MVP — `ML_RAP4_Data_Feasibility_Memo`.
- **Architecture + backend spikes** — AWS hosting (SST/OpenNext) and a DynamoDB single-table design documented — `SH_RAP8_AWS_Architecture`, `Backend_DynamoDB_DataModel_and_repo-dynamo`.

## 5. Decision on next steps (sprint-planning outcome)

- **Implementation deferred to Sprint 2, gated on client validation.** Building the DynamoDB layer (RAP-27), AWS hosting (RAP-28), and finalizing the frontend (RAP-29) would commit engineering to an unvalidated direction — premature for a discovery sprint. These moved to **Sprint 2** (RAP-7 repo/CI/dev-env moved too; it is direction-agnostic and low-risk).
- **Sprint 1 outputs stand on their own:** the spikes/memos/prototype *prepare* the build so Sprint 2 can move fast once the client confirms.
- **Open gating items carried to Sprint 2:** (1) client greenlight on the RAP-platform direction; (2) advisor confirmation; (3) consent-app LICENSE / spec review.

## 6. To finalize

Add the **client's answer to questionnaire Q2** (does the RAP platform fit their direction?) when received — that answer is the tie-breaker that converts this *recommendation* into *committed scope*.
