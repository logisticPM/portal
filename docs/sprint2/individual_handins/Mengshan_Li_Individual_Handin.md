# Part 1B — Individual Hand-in · Mengshan Li

**Sprint:** 2 (Week 5) · **Role:** Sprint Lead (Scrum Master + acting PO) + Backend / Data
**Dates:** Jun 8–14, 2026 · **Time tool:** Toggl/Jira

## A. Hours, mapped to backlog items

| Task (RAP-#) | Activity | Hours |
|---|---|---:|
| RAP-37 | Sprint Lead: board + velocity/CFD/burndown setup; ran planning, standups, and the retro | 3.25 |
| RAP-27 | Modelled the full 41-question RAP Impact Survey as a 2nd DynamoDB domain (`RapSurvey`); built `surveyRepo` + mock (PRs #2, #3) | 4.5 |
| RAP-27 | Designed the interface-only seam the frontend builds against; wrote `backend.md` + `frontend-api.md` (PRs #3, #5) | 2.5 |
| RAP-39 | `npm run verify` 18-check parity harness + reusable `createSingleTable` + clean seed (PR #4) | 2.25 |
| — | Team ceremonies + advisor/class meetings (Hao, Lino) — **demoed the current simple slice Thu + Fri**; planning a fuller version for the **client + class on Jun 17** | 1.5 |
| **Total** | | **14.0** |

> RAP-30 (Horizon-2 ingest spike) and RAP-35 (LICENSE review) are assigned to me and **carry to Sprint 3**.

## B. AI usage & value-add

I used AI as an accelerator for boilerplate and first drafts. The architecture and the "what must be true" decisions were mine, and **I reviewed and corrected every generated file before it was merged** — nothing went in unread.

| What I owned / decided | Where AI assisted (reviewed by me) |
|---|---|
| The 2-table design and modelling all 41 survey questions (nested vs. separate fields); keeping the survey **additive** so it never broke the confirmed-data seam | Scaffolded the TypeScript types + single-table marshalling — I read and fixed each before merge |
| Defining the correctness bar for the data layer (dynamo must equal the mock) and spotting two paths that had never run (`corrected`, `registerSupplier`) | Drafted the `verify` assertion skeleton — I checked the logic and the numbers |
| Curating the run guides against the actual scripts and keys | Drafted doc prose — I verified every command myself |

## C. One-paragraph reflection

As Sprint Lead I ran the sprint where the team turned the prototype into a deployed slice, and my own work was the data layer. The contribution I'm most confident in is a design judgment, not code volume: keeping the backend swappable behind one interface, which let Shiting's AWS deploy and the frontend features land in parallel without coupling, and keeping the survey model additive — a separate `RapSurvey` table — rather than reshaping the confirmed-data model the demo depends on. On the process side I kept the board, reconciled it against what had actually merged (several feature cards had shipped while the board still read "To Do"), and prepared the team's hand-ins from the sprint artifacts. AI sped up the scaffolding and first drafts, but I owned those calls and reviewed every generated file before merge — the `verify` harness exists precisely so a fast, AI-driven pace can't slip a regression past us. What I'd change: I let my own ingest spike (RAP-30) and the LICENSE review carry because I prioritised unblocking the deploy and the frontend; next sprint I'd timebox my lead duties so my individual cards don't slip, and lock per-card review ownership so attribution stays clean as we keep moving quickly.
