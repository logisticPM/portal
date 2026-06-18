# Sprint 3 — Plan, Goal, Roles & Definition of Done

**Project:** Indigenomics capstone — public-facing companion to Indigenomics AI (RAP Data Portal)
**Sprint:** 3 (Week 6) · **Type:** Harden & showcase-ready sprint — turn the deployed slice into a client/class-demo-ready product
**Sprint Lead (Scrum Master + acting Product Owner):** Shiting Huang *(rotation, per `sprint1/00 §rotation`)*
**Team size:** 4 · **Timebox:** 1 week (Jun 15–21, 2026) · **Release target:** Aug showcase

> ⚠️ **SCAFFOLD — needs lead sign-off.** Generated 2026-06-17 from the Sprint 2 retro seed (`sprint2/08 §7`), the carried-forward cards, and work already merged this week. Confirm dates, finalise the card list + story points at planning, and reconcile RAP-## ids against Jira before this is the source of truth.

---

## Sprint Goal

> **Turn the deployed vertical slice into a product credible to demo to the client and the class — three persona portals behind a mock login, hardened on real production seed — and convert the two big open product decisions (pillar-model adoption, verification Phase 2) plus the carried client/advisor/legal items into committed, dated outcomes.**

Sprint 2 shipped the slice to a shared AWS URL and pushed past the minimum (supplier showcase + verification system). Sprint 3 is **not** "build more features" — it is **harden, decide, and close**: make the deployed thing demo-solid for the August showcase, lock the scope decisions Sprint 2 deferred, and clear the client/advisor/legal items carried since Sprint 1.

---

## Carry-forward reconciliation (read this first)

Between the Sprint 2 retro (Jun 14) and this plan (Jun 17), the team again **built ahead of the plan**: the three-persona IA + mock login from `sprint2/03_Portal_IA_and_Login_Routing` is already merged (PRs #22 login/identity routing, #23 register-all-roles, #24 pre-login landing + per-persona dashboards). So a chunk of Sprint 3's "harden the IA" work exists; we re-centre on what's genuinely left.

| Source | Item | Status (Jun 17) | Remaining S3 work |
|---|---|---|---|
| `sprint2/03` IA & login | three-portal split + "sign in as…" landing + mock cookie session | ✅ **Merged** (#22/#23/#24) | a11y + demo polish on the new portals; reconcile with `?as=` switcher; track as cards |
| RAP-31 | Indigenomics portal / Index hardening | 🔄 In Progress (S2) | finish by-tier / confirmable-vs-context framing; demo on URL |
| RAP-39 | clean demo seed + equity lines + phantom-JV signal | 🔄 In Progress (S2) | land the seed **on production** (auto-deploy doesn't reseed) |
| RAP-36 / #7 | branch protection on `main` | ⏳ gated on repo admin | nudge `logisticPM`; governance, not a blocker |
| RAP-30 | Horizon-2 ingest spike | 📋 To Do (S2) | turn into an explicit go/no-go |
| RAP-32/33/35 | client greenlight · advisor confirm · consent LICENSE | 📋 carried since S1 | **close or log a dated decision** |
| RAP-38 | company self-registration | likely closed by #23 (register-all-roles) | verify the company path works end-to-end, then close |
| (decision) | pillar-model adoption (PR #15 merged, sign-off pending) | ⏳ pending team sign-off | decide adopt / revert this sprint |
| RAP-43 P2 | verification Phase 2 (partner-gated: CCIB/ISC/NACCA-FNPO + VC) | 📋 designed, not built | scope go/no-go — likely Horizon-2, decide |

**Implication:** Sprint 3's centre of gravity is **harden + decide + close**, not net-new features.

---

## Roles & responsibilities (4 members)

Lead rotates to **Shiting Huang**. Roles otherwise follow demonstrated specialty.

| Member | Sprint 3 role | Primary deliverable *(to finalise at planning)* |
|---|---|---|
| **Shiting Huang** | **Sprint Lead** (SM + acting PO) + Infra | Run ceremonies + board/burndown/velocity (now with a real S2 baseline); **production seed + deploy hardening** (reseed prod, branch protection #7, cost guardrail); demo-infra readiness |
| **Tong Wu** | Frontend (supplier/institute) + integration | a11y + demo polish on the three portals; finish Index/analytics hardening (RAP-31); review ownership per card |
| **Mengshan Li** | Data | Horizon-2 ingest spike → **go/no-go** (RAP-30); equity-line seed (RAP-39); consent-app LICENSE review (RAP-35) |
| **En-Ping Su** | Client / PO + company | **Close client greenlight or log a dated decision** (RAP-32); advisor confirmation (RAP-33); verify company self-registration path (RAP-38) |

### Role rotation (unchanged)

| Sprint | Week | Lead |
|---|---|---|
| 1 | 4 | En-Ping Su ✅ |
| 2 | 5 | Mengshan Li ✅ |
| **3** | **6** | **Shiting Huang ← this sprint** |
| 4 | 7 | Tong Wu |
| 5 | 8 | En-Ping Su / showcase |

---

## Definition of Done (build/harden sprint — same bar as S2)

| Work type | Done means… |
|---|---|
| **Feature / page** | Merged via PR · CI green · **auto-deployed to the production URL** · a11y-checked · screen-recorded (≤2 min) |
| **Hardening task** | Demonstrable improvement on the **production URL** (not localhost) — e.g. real seed visible, a11y audit passing |
| **Decision** | Written go/no-go or adopt/revert, posted to the repo, with the rationale and who signed off |
| **Spike** | Written findings + explicit go/no-go, posted to the repo |
| **Client task** | Question logged · answer captured into the backlog · matching gating risk updated · **a dated decision if still open** |
| **Any card** | Owner assigned · **review owner assigned** (S2 retro action) · estimated in points · moved to Done · time logged |

**New this sprint (S2 retro §7):** every card has a named **review owner** at pickup — the fast AI-driven pace made attribution + review discipline harder; lock it per card.

---

## Metrics tracked this sprint

S2 produced the first real velocity number (~29 pts). Sprint 3 **plans against that baseline**.

- **Velocity** — commit ≤ the S2 achieved number until the baseline stabilises; report achieved vs committed.
- **Cumulative flow / burndown** — log card states daily (To Do / In Progress / In Review / Done).
- **Release / epic burndown** — track toward the **August showcase** (the release epic is now the frame, not a single sprint).
- **Client questions resolved** — still partly discovery until the greenlight closes.

---

## Risk / blocker log (carried + new)

| # | Risk / blocker | Owner | Mitigation | Status |
|---|---|---|---|---|
| 1 | **Client greenlight still pending** — converts recommendation → committed scope | En-Ping Su | Close it or log a dated decision **this sprint** (no longer just "chase") | **Open (carried 2 sprints)** |
| 2 | Advisor dependency (cultural + economic) not confirmed | En-Ping Su | Book + confirm; escalate if still open | **Open (carried)** |
| 3 | Consent-app LICENSE / spec review before public reuse | Mengshan Li | Complete before any public/partner sharing of the deploy | **Open (carried)** |
| 4 | **Auto-deploy doesn't reseed** — prod can drift from intended demo seed | Shiting Huang | Reseed prod after seed changes; document in `deploy.md`; consider a seed step in `deploy.yml` | **New** |
| 5 | Pillar-model adoption unresolved — code merged but not signed off | All / lead | Decide adopt/revert this sprint; don't let it linger | **Open** |
| 6 | Fast AI-driven pace → weak per-person attribution + review discipline | Shiting Huang (lead) | Review owner per card (DoD); tighter PR ownership | **New (S2 retro)** |
| 7 | Branch protection on `main` still off | Shiting Huang / repo admin | Nudge `logisticPM` (#7) | **Open** |

---

## Sprint 3 outcome target (what "done" looks like Friday)

1. **Production URL demo-solid** for the client/class — three persona portals, real seed, a11y-passing, no known 500s.
2. **Client greenlight captured — or a dated decision logged** (the 2-sprint carry closes one way or the other).
3. **Pillar-model adoption decided** (adopt or revert) and **verification Phase 2 scoped** (build / Horizon-2).
4. **Horizon-2 ingest spike → explicit go/no-go.**
5. **Second velocity data point** recorded → trend visible for Sprint 4 planning.
</content>
</invoke>
