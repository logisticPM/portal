# Sprint 2 — Plan, Goal, Roles & Definition of Done

**Project:** Indigenomics capstone — public-facing companion to Indigenomics AI (RAP Data Portal)
**Sprint:** 2 (Week 5) · **Type:** Build sprint — first deployed vertical slice
**Sprint Lead (Scrum Master + acting Product Owner):** Mengshan Li *(rotation, per `sprint1/00 §rotation`)*
**Team size:** 4 · **Timebox:** 1 week (Jun 8–14, 2026) · **Release target:** Aug showcase

---

## Sprint Goal

> **Ship the first working vertical slice of the RAP Data Portal on shared infrastructure — `report → confirm → coverage → Index`, on confirmed data, at a URL a teammate (and the client) can open — and convert the Sprint-1 recommendation into committed scope.**

Sprint 1 was a discovery sprint: it *chose* the direction (RAP platform, 30/35 on the scorecard) **pending client greenlight**, and de-risked it with a running prototype + AWS/data/questionnaire spikes. Sprint 2 turns that prototype into a deployed slice **and chases the greenlight in parallel** (retro action item) — we do not let the client's slow turnaround gate the build, because the slice runs on synthetic data and commits no partner-gated data.

---

## Carry-forward reconciliation (read this first)

Honesty note for the hand-in: between the Sprint 1 retro (Jun 7) and Sprint 2 planning (Jun 10), the team built **ahead of the plan**. Three of the four cards the Decision Memo deferred to Sprint 2 are already done. This is good news, but it means Sprint 2's real scope is *not* "build the slice" — most of it exists. We re-center on what's genuinely left.

| S1-deferred card | Planned for S2 | Actual status (Jun 10) | Remaining S2 work |
|---|---|---|---|
| **RAP-7** repo / CI / dev-env | set up | ✅ Done — `logisticPM/portal`, `ci.yml`, contract-first `PortalRepo` seam | keep CI green; branch-protect `main` (RAP-36) |
| **RAP-27** DynamoDB layer | build | ✅ Done — `repo.dynamo` single-table (GSI1/GSI2), seed scripts, `verify` 18/18, cross-env Windows fix | provision a *real* table on deploy (folds into RAP-28) |
| **RAP-29** frontend slice | finalize | ✅ Largely done — 7 pages, warm editorial theme, **supplier self-registration** (was a "stretch") | Index-page depth + a11y + demo polish (RAP-31) |
| **RAP-28** AWS hosting | deploy | ❌ **Not started — still local Docker DynamoDB** | **the core build card this sprint (RAP-28)** |

**Implication:** Sprint 2's center of gravity moves from *build* → **deploy + harden + lock scope.** The slice already runs locally on the real backend (REPO_IMPL=dynamo verified for read parity); Sprint 2 makes it shared, durable, and client-ready.

---

## Roles & responsibilities (4 members)

Roles follow each member's demonstrated Sprint-1 specialty; the lead rotates to Mengshan Li.

| Member | Sprint 2 role | Primary deliverable |
|---|---|---|
| **Mengshan Li** | **Sprint Lead** (SM + acting PO) + Data feasibility | Board / burndown / **velocity baseline**, run ceremonies + retro; **Horizon-2 ingest spike** (federal 5% + Indigenous Business Directory sample → seed *real* suppliers behind the seam) |
| **Shiting Huang** | Infra / Backend | **RAP-28: deploy to AWS** (SST/OpenNext → shared URL, real DynamoDB table, server-side secrets); CI deploy preview + branch protection |
| **Tong Wu** | Frontend | **Index page hardening** (the `analytics` RAP-analysis view) + accessibility pass + demo polish; company self-registration entry; clean demo seed state |
| **En-Ping Su** | Client / PO support | **Chase client greenlight (day 2, in parallel)** + capture answers; advisor confirmation; **questionnaire depth** (AU→CA reportable fields into the report flow); consent-app LICENSE / spec review |

Each member also submits (Part 1B, individual): hours mapped to their backlog cards (Toggl/Clockify) + an AI-usage log — see `../sprint1/05_TimeTracking_and_AI_Log_template.md`.

### Role rotation (unchanged from Sprint 1)

| Sprint | Week | Lead |
|---|---|---|
| 1 | 4 | En-Ping Su ✅ |
| **2** | **5** | **Mengshan Li ← this sprint** |
| 3 | 6 | Shiting Huang |
| 4 | 7 | Tong Wu |
| 5 | 8 | En-Ping Su / showcase |

---

## Definition of Done (build sprint — stricter than S1)

| Work type | Done means… |
|---|---|
| **Feature / page** | Merged via PR · CI green · **demoed on the shared deploy URL** (not just localhost) · screen-recorded (≤2 min) |
| **Deploy task** | A teammate can open the URL and run `report → confirm → coverage → Index` end-to-end **on the real backend** |
| **Spike** | Written findings + explicit go/no-go, posted to the repo |
| **Client task** | Question logged · answer captured into the backlog · matching gating risk updated |
| **Any card** | Owner assigned · **estimated in points** · moved to Done on the board · time logged |

---

## Metrics tracked this sprint

Sprint 1 only *baselined* these; **Sprint 2 reports them for real** (per `sprint1/00 §metrics`):

- **Velocity** — cards estimated in story points; this sprint produces the **first real velocity number** (Sprint 3 plans against it).
- **Cumulative flow** — log card states daily (To Do / In Progress / In Review / Done).
- **Sprint burndown** — points remaining vs. day (no end-of-sprint cliff).
- **Release / epic burndown** — set up toward the **August showcase** now that direction is locked.
- **Carry-over discovery metric** — # client questions resolved (the greenlight chase is still partly discovery).

---

## Risk / blocker log (carried from `sprint1/00 §risk` + retro §4)

| # | Risk / blocker | Owner | Mitigation | Status |
|---|---|---|---|---|
| 1 | **Client greenlight still pending** — converts the recommendation into committed scope | En-Ping Su | Chase day 2, in parallel; don't gate the build (slice is on synthetic data) | **Open (carried)** |
| 2 | Advisor dependency (cultural + economic) not confirmed | En-Ping Su | Questionnaire item 2; book the advisor this sprint | **Open (carried)** |
| 3 | Consent-app LICENSE / spec review before public reuse | All / Mengshan | Review before the deploy is shared beyond the team | **Open (carried)** |
| 4 | **AWS deploy is new ground** — cost + secret handling | Shiting Huang | Stay within free tier; secrets server-side only, **never `NEXT_PUBLIC_`**; tear down on idle | **New** |
| 5 | Building ahead of greenlight commits eng. to an unvalidated direction | Mengshan Li | Slice is synthetic + reversible; no partner-gated data; re-pointable behind the seam | **Mitigated** |

---

## Sprint 2 outcome target (what "done" looks like Friday)

1. **A shared deploy URL** running the slice end-to-end on the real backend.
2. **Client greenlight captured** — or a dated follow-up logged if still outstanding.
3. **Velocity baseline recorded** → handed to the Sprint 3 lead (Shiting Huang).
4. **Index view** credible enough to demo to Indigenomics (confirmed-coverage %, by-pillar, by-tier, disputed count).
