<!--
  TEAM HAND-IN — Part 1 (team portion), 2 PAGES MAX.
  Scaffold: prose is pre-filled; fill the [brackets] AFTER the sprint runs
  (numbers, names, dates, retro). Trim to fit 2 pages — Section 2 (the
  exploration ledger) is the spine per the professor's "show all past and
  previous work, including ideas the client declined" instruction.
  The separate 1-pager (hours + AI value-add) is per-person: see 05_TimeTracking_and_AI_Log_template.md.
-->

# Sprint 1 — Team Report
**Project:** Indigenomics capstone — exploring a public-facing companion to Indigenomics AI
**Sprint:** 1 (Week 4) · **Type:** Discovery / Direction-Selection · **Timebox:** 1 week
**Team:** En-Ping Su, Tong Wu, Shiting Huang, Mengshan Li · **Sprint Lead (Scrum Master + acting PO):** En-Ping Su
**Dates:** Jun 1 – Jun 8, 2026 (Mon–Mon)

---

## 1. Sprint goal & why a discovery sprint
The product is not yet scope-locked — we are still aligning with the client (Indigenomics) on what to build, and **do not yet have a green light** on any single direction. Rather than treat that as a blocker, we made the uncertainty the work. **Sprint goal: narrow the capstone direction with evidence and validate it with the client, leaving Sprint 2 ready to build a vertical slice.**

*Note on metrics:* with no velocity baseline in Sprint 1, we tracked discovery and reliability metrics (Section 4) and only *baselined* velocity for Sprint 2 — reporting a velocity number now would be meaningless.

## 2. Exploration to date (all directions, including ones the client declined)
The project has moved through three strands. We show all of them — including the idea the client was not keen on — because each one fed the next, and the engineering carries forward across them.

| # | Direction | Origin | Client stance | Evidence / artifacts | Status |
|---|-----------|--------|---------------|----------------------|--------|
| **1** | **Educational platform** — citation-first educational tool over open data (was "E1") | Our first idea | **Not keen** | Deck4 pitch + feasibility review, script, internal report (`CS7980/Project/`) | **Set aside** |
| **2** | **Consent Layers** — consent/confirmation app | Built at the Indigenomics **Tech Jam** (a client-hosted event) | Built on their turf; exploratory | App + reusability audit (`06_ConsentLayer_Reusability_Audit.md`; `Indigenomics Tech Jam/`) | **Foundation** — its confirmation engine carries into #3 |
| **3** | **RAP platform** — consent-based, Indigenous-governed infrastructure for *verified* economic data; supplier-confirmed RAP questionnaire, RAP Index as first output | Current idea | **No green light yet** | MVP design + RAP reference docs (`Week 4/rap_platform_mvp_design_10.html`, RAP brochure, impact-survey guide) | **Active exploration** |
| — | **Deck comparators** — hero simulation, conversational entry, reference layer, personal tools, B2B directory | Client deck (Deck4) | Their original menu | `01_Product_Backlog.md` (E3–E8) | **Parked** |

**The through-line:** the educational platform did not land with the client, but the **Consent Layers** work from the Tech Jam produced a confirmation engine we could reuse — and that engine is exactly what the **RAP platform** needs to let a named Indigenous supplier confirm each economic-data entry. So a declined idea and a "tangential" hackathon both became load-bearing inputs to the direction we are now exploring.

## 3. Roles & artifacts
The lead role rotates each sprint (En-Ping Su → Mengshan Li → Shiting Huang → Tong Wu → showcase). Artifacts produced/used this sprint:
- **Product backlog, sprint backlog & task board** — **Jira** Scrum board (burndown / velocity / cumulative-flow from built-in reports): https://indigenomics-capstone.atlassian.net/jira/software/projects/RAP/boards/1
- **Sprint Goal + Definition of Done** — `00_Sprint1_Plan_Goal_DoD.md`
- **Client questionnaire** — `03_Client_Questionnaire.md`
- **Risk/blocker log**, **direction scorecard**, **retrospective** — see board + `04_…`
- **Decision inputs:** data-feasibility memo (Mengshan Li) and consent-layer reusability audit (Shiting Huang, `06_…`)

## 4. What each member did
RAP-platform ownership going forward: **backend** — Shiting Huang, Mengshan Li; **frontend + client** — Tong Wu, En-Ping Su.

| Member | Role | Contribution this sprint |
|---|---|---|
| **En-Ping Su** | Sprint Lead · Frontend / Client | Backlog + Goal/DoD; ran client check-in + questionnaire; risk log; authored Direction Decision memo |
| **Tong Wu** | Frontend / UX + Client-facing | Clickable RAP-platform mockup (Data Portal); client communication; captured requirements into backlog |
| **Shiting Huang** | Backend / Engineering · Architecture | Consent-layer reusability audit (`06_…`); mapped the confirmation engine onto the RAP platform; repo + CI + dev env |
| **Mengshan Li** | Backend / Data · Feasibility | Data-feasibility memo — verified RAP/procurement/RAP-survey data sources; go/no-go table |

## 5. Metrics & results
| Metric | Result |
|---|---|
| Sprint goal met? | [Yes / Partly / No] |
| Commitment reliability (done ÷ committed) | [__ / __ = __%] |
| Avg. cycle time per card | [__ h] |
| Assumptions validated / invalidated | [__] |
| Client questions resolved | [__ / 11] |
| Directions evaluated | 3 strands + deck comparators |
| Risks closed (esp. scope) | [__ / 4] |

[1–2 sentences interpreting the numbers — e.g. what the burndown showed, where cycle time bunched.]

## 6. Outcome — current direction (not yet greenlit)
**Leading direction:** **RAP platform** — pending client confirmation; presented as our best candidate, not committed scope.
**Why (evidence):** The Consent Layers confirmation engine gives the RAP platform a real head start (see `06_…`); the educational platform was set aside after the client was not keen; and open RAP/procurement data makes the supplier-confirmation slice feasible without partner-gated data. [Add: scorecard total + the client's answer to Q2 once recorded.]
**Sprint 2 setup:** lead = Mengshan Li; focus = thin vertical slice of the RAP confirmation flow; gating items carried = [client green light; resolve consent-app LICENSE / spec review; advisor confirmation].

## 7. Retrospective (summary)
- **Went well:** [ … ]
- **Didn't:** [ … ]
- **Change next sprint:** [action — owner — by]

---
*Appendices (not counted toward the 2 pages): board export, data-feasibility memo, reusability audit (`06_…`), Deck4 review & feasibility (`Project/`), RAP platform mockup + RAP reference docs (`Week 4/`), prototype recordings (linked, not embedded).*
