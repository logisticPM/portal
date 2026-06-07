# Sprint 1 — Plan, Goal, Roles & Definition of Done

**Project:** Indigenomics capstone — public-facing companion to Indigenomics AI
**Sprint:** 1 (Week 4) · **Type:** Discovery / Direction-Selection sprint
**Sprint Lead (Scrum Master + acting Product Owner):** *[you]*
**Team size:** 4 · **Timebox:** 1 week

---

## Sprint Goal

> **Choose the capstone product direction with evidence, and validate it with the client — leaving Sprint 2 ready to build a vertical slice.**

This sprint deliberately produces *validated knowledge + thin prototypes*, not shipped features. The product is not yet scope-locked, so the sprint's job is to **collapse that ambiguity**, not wait on it.

Directions under evaluation this sprint (see `01_Product_Backlog.md`):
- **Reconciliation Hub** (citation-first RAG over open data) — *teammate idea*
- **Build on the consent-layer app** (extend the Tech Jam product) — *teammate idea*
- The strongest deck directions as comparators (hero simulation, conversational entry, reference layer)

---

## Why a discovery sprint (note for the hand-in)

A Sprint 1 has **no velocity baseline** and uncertain output, so reporting story-point velocity would be a vanity metric. We track **discovery + reliability metrics** this sprint and *baseline* velocity for Sprint 2. Naming this tradeoff is deliberate — quantifying progress in an exploratory sprint is the point, not a number that doesn't yet mean anything.

---

## Roles & responsibilities (4 members)

| Member | Sprint role | Primary deliverable |
|---|---|---|
| **[you]** | **Sprint Lead** (Scrum Master + acting PO) | Backlog, this Goal/DoD, board + burndown, client questionnaire + meeting, risk log, **Direction Decision memo** |
| **[member 2]** | Data / Feasibility lead | **Data-feasibility memo**: verify each direction's data foundation is ingestable (pull a real sample); go/no-go table |
| **[member 3]** | Engineering / Architecture lead | **Consent-layer reusability audit** + repo/CI/dev-env setup + one architecture spike for the leading direction |
| **[member 4]** | Design / UX + Client-facing lead | **1–2 clickable prototypes/mockups** of the top candidate directions + capture requirements into the backlog |

Each member also submits (Part 1B, individual): hours mapped to their backlog items (Toggl/Clockify) and an AI-usage log — see `05_TimeTracking_and_AI_Log_template.md`.

### Role rotation schedule (rotate the lead each sprint)

| Sprint | Week | Lead |
|---|---|---|
| 1 | 4 | **[you]** |
| 2 | 5 | [member 2] |
| 3 | 6 | [member 3] |
| 4 | 7 | [member 4] |
| 5 | 8 | [you] / showcase |

---

## Definition of Done (per work type)

| Work type | Done means… |
|---|---|
| **Spike / research** | Written findings + an explicit go/no-go recommendation, posted to the repo |
| **Data task** | Source verified as live + licence checked + an ingestable sample actually pulled |
| **Prototype** | Clickable + screen-recorded (≤2 min) + linked in the board |
| **Codebase audit** | Reusable-vs-throwaway inventory with real file paths + effort estimate |
| **Decision** | Scorecard filled for each direction + a one-paragraph recommendation |
| **Any card** | Owner assigned · estimate recorded · moved to Done on the board · time logged |

---

## Metrics tracked this sprint

**Use now (discovery-appropriate):**
- **Commitment reliability** — tasks completed ÷ committed (target 70–90%)
- **Cycle time** per card (In Progress → Done)
- **Discovery metrics** — # assumptions validated/invalidated · # client questions resolved · # directions scored
- **Risk burndown** — open risks trending to zero (top risk: scope unlocked)
- **Sprint burndown** — tasks remaining vs. day (no end-of-sprint cliff)

**Baseline now, report from Sprint 2:** velocity (estimate items in points), cumulative flow (log card states), epic/release burndown (set up vs. August showcase once direction locks).

---

## Risk / blocker log

| # | Risk / blocker | Owner | Mitigation | Status |
|---|---|---|---|---|
| 1 | Client (Indigenomics) hasn't locked product scope | [you] | Prototypes + questionnaire to client by mid-week; let their answer break the tie | Open |
| 2 | Hero-sim over-scoped (4 sectors, 4 students) | [member 2] | Narrow to housing + energy where open data is strong (per feasibility note) | Open |
| 3 | Consent-layer extension may drift from agreed positioning | [member 3/4] | Reframe only as a sovereignty *layer* of the larger platform, not a standalone pivot | Open |
| 4 | Advisor dependency (cultural + economic) not yet confirmed | [you] | Item 2 of the client questionnaire | Open |
