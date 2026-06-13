<!--
  TEAM HAND-IN — Part 1 (team portion), 2 PAGES MAX.
  Sprint 2 = build sprint. Section 2 is the "what we shipped" ledger (the build analog
  of Sprint 1's exploration ledger). Per-person 1-pagers live in individual_handins/.
-->

# Sprint 2 — Team Report
**Project:** Indigenomics Capstone — public-facing companion to Indigenomics AI (RAP Data Portal)
**Sprint:** 2 (Week 5) · **Type:** Build sprint — first deployed vertical slice · **Timebox:** 1 week
**Team:** En-Ping Su, Tong Wu, Shiting Huang, Mengshan Li · **Sprint Lead (Scrum Master + acting PO):** Mengshan Li
**Dates:** Jun 8 – Jun 14, 2026

---

## 1. Sprint goal & why a build sprint
Sprint 1 chose the direction (RAP platform) and de-risked it with a prototype + spikes. **Sprint 2 goal: ship the first working vertical slice on shared infrastructure — `report → confirm → coverage → Index`, on confirmed data, at a URL a teammate (and the client) can open — and chase the client greenlight in parallel.** We did not let the client's slow turnaround gate the build, because the slice runs on synthetic data and commits no partner-gated data.

## 2. What we shipped this sprint
Sprint 1 built three of four deferred cards ahead of plan, so Sprint 2's centre of gravity moved from *build* → **deploy + harden + extend.**

| Area | Card(s) | Outcome | Status |
|---|---|---|---|
| **AWS deploy (core DoD)** | RAP-28, RAP-36 | App **live** on AWS via SST v4 + OpenNext (Next on Lambda + CloudFront + DynamoDB), per-stage tables, server-side IAM via SSO — **`d1hwn8hhp1ytc0.cloudfront.net`**; CI deploy workflow merged | RAP-28 **✅ Done** · RAP-36 **In Progress** (branch-protect pending) |
| **Data layer** | RAP-27 (carry), RAP-39 | Survey domain added as a 2nd table (`RapSurvey`, all 41 questions); interface-only seams + mock; `npm run verify` 18/18 parity; backend + frontend docs. Clean seed + parity done; equity-line seed remaining | data layer **✅** · RAP-39 **In Progress** |
| **Company / questionnaire** | RAP-34, RAP-38 | procurement \| equity pillar selector wired into the report form (RAP-34); company self-registration not started | RAP-34 **✅ Done** · RAP-38 **To Do** |
| **Supplier + institute** | RAP-40, **RAP-42**, **RAP-43**, RAP-31 | Supplier portal + pillar-aware inbox; **verified supplier showcase** (`/s/[id]`); **verification system** (claim/resolve + derived tier + status×substance integrity flag); Index/analytics hardening | RAP-40/42/43 **✅ Done** · RAP-31 **In Progress** |
| **Pillar model** | (proposal) | `Pillar → FlowType` procurement-centric refactor merged (PR #15) | **Merged — adoption pending team sign-off** |
| **Client / advisor / legal** | RAP-32, RAP-33, RAP-35 | Greenlight chase; advisor booking; consent-app LICENSE review | **To Do / carried** |

**Beyond the plan:** the supplier showcase (RAP-42) and verification system (RAP-43) were brainstormed and built mid-sprint, using an AI-agent (subagent-driven) workflow — pushing the product past the minimum slice toward the integrity story.

## 3. Roles & artifacts
Lead rotates each sprint (En-Ping → **Mengshan ← this sprint** → Shiting → Tong → showcase). Artifacts:
- **Jira** board (burndown / velocity / CFD): https://indigenomics-capstone.atlassian.net/jira/software/projects/RAP/boards/1
- **Live deploy:** `https://d1hwn8hhp1ytc0.cloudfront.net` · **repo:** `github.com/logisticPM/portal`
- Sprint 2 plan + DoD; deploy runbook (`docs/deploy.md`); backend + frontend guides; design docs (pillar model, supplier showcase, verification P1/P2); per-person hand-ins (`individual_handins/`)

## 4. What each member did
| Member | Role | Contribution this sprint |
|---|---|---|
| **Mengshan Li** | Sprint Lead · Data | Ran ceremonies + board/velocity/retro; survey data domain + interface-only seams + mock; `verify` parity harness; backend/frontend docs (Horizon-2 ingest spike + LICENSE review carried to Sprint 3) |
| **Shiting Huang** | Infra / Backend | **RAP-28 AWS deploy** (SST/OpenNext → live URL, per-stage DynamoDB, server-side IAM); CI deploy workflow (branch-protect pending, RAP-36); Index data-robustness fix |
| **Tong Wu** | Frontend (supplier/institute) + repo owner / integration | Supplier portal (RAP-40); **verified supplier showcase** (RAP-42); **verification system** (RAP-43); pillar-model refactor; merged the sprint's PRs (largest commit volume) |
| **En-Ping Su** | Client / PO + company | Questionnaire depth done (procurement+equity in the report form, RAP-34); client greenlight chase + advisor confirmation + company self-registration (carried / to do) |

## 5. Metrics & results
| Metric | Result |
|---|---|
| Sprint goal met? | **Yes** — deployed slice live on the real backend at a shared URL (vs. Sprint 1 "partly") |
| Velocity | **≈ 29 pts Done** (RAP-28 · 40 · 34 · 42 · 43); **In Progress:** RAP-31/36/39/37; **To Do:** RAP-30/38/32/33/35 — *finalise from Jira (RAP-42/43 points are estimates)* |
| Cumulative flow / burndown | Logged daily on Jira *(attach board screenshots)* |
| Commitment reliability | Core build + deploy cards Done; client/advisor + data-spike cards carried (not eng-gated) |
| Client questions resolved | *confirm count* / 11 — greenlight still the key open item |
| Scope beyond plan | RAP-42 showcase + RAP-43 verification system shipped |

## 6. Outcome
A teammate or the client can open **`d1hwn8hhp1ytc0.cloudfront.net`** and run `report → confirm → coverage → Index` end-to-end on real AWS. The Index now shows confirmed-coverage %, by-pillar, by-tier, and a verification/integrity signal — credible to demo to Indigenomics. **The client has not yet confirmed the direction (greenlight still pending — dated follow-up logged);** advisor confirmation and the consent-app LICENSE review also carry forward. Because the slice runs on synthetic, reversible data, the pending greenlight did not gate the build. We **demoed the current simple slice to our advisors (Hao, Lino) in the Thursday and Friday meetings**, and plan a more complete version to show the **client and class on Jun 17**.

## 7. Retrospective & next sprint
- **Went well:** hit the deploy DoD (localhost → shared URL); the contract-first seam let deploy + frontend land in parallel without coupling; AI-agent workflow let us ship two extra features (showcase + verification).
- **Didn't:** client greenlight + advisor still open (carried from Sprint 1); a fast AI-driven pace makes per-person attribution and review discipline harder — needs tighter PR ownership.
- **Change next sprint:** lock review ownership per card; close the client greenlight or log a dated decision; turn the Horizon-2 ingest spike into a go/no-go.
- **Leader rotation → Sprint 3 lead = Shiting Huang.** **Sprint 3 planning seed:** harden the deployed slice (real seed on production, a11y/demo polish for the August showcase), decide on the pillar-model adoption, and the verification system's partner-gated Phase 2.
