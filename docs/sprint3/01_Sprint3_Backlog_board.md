# Sprint 3 — Sprint Backlog (Task Board)

Move cards left→right. Owner in **bold**. **Pts** = story points; Est = ideal hours. **Rev** = review owner (S2 retro action — assign at pickup).
Card IDs continue the `RAP-##` series. New S3 cards proposed at **RAP-44+** (max used in S2 was RAP-43; RAP-41 = the deferred Next.js upgrade).

> ⚠️ **SCAFFOLD — needs lead sign-off.** RAP-44/45/46 are proposed ids for work **already merged this week** (tracked by PR# only). Reconcile all ids against Jira at planning, then set points.

## To Do

| ID | Task | Owner | Rev | Epic | Pts | Est |
|----|------|-------|-----|------|:---:|----:|
| RAP-30 | Horizon-2 ingest spike — federal 5% + Indigenous Business Directory sample → `Supplier` seed behind the seam → **explicit go/no-go** | **Mengshan Li** | — | Data | 5 | 6 |
| RAP-39 | Land clean demo seed **on production** — 6-supplier / 82% confirmed + equity lines incl. one self-declared phantom-JV signal (auto-deploy doesn't reseed) | **Mengshan Li** | — | Data | 2 | 2 |
| RAP-48 | **a11y + demo polish** across the three persona portals (landing, company, supplier, Indigenomics) — for the Aug showcase | **Tong Wu** | — | Frontend | 5 | 6 |
| RAP-49 | **Decision:** pillar-model adoption (PR #15 merged) — adopt or revert; post rationale + sign-off | **All / lead** | — | Product | 2 | 2 |
| RAP-50 | **Decision:** verification Phase 2 (partner-gated CCIB/ISC/NACCA-FNPO + VC, `sprint2/07`) — build vs Horizon-2 go/no-go | **All / lead** | — | Product | 2 | 2 |
| RAP-32 | **Close client greenlight or log a dated decision** (carried 2 sprints — escalate) | **En-Ping Su** | — | Client | 3 | 3 |
| RAP-33 | Advisor confirmation (cultural + economic) — book + confirm | **En-Ping Su** | — | Client | 2 | 2 |
| RAP-35 | Consent-app LICENSE / spec review before public reuse | **Mengshan Li** | — | Legal | 2 | 2 |
| RAP-38 | Verify company self-registration path end-to-end (likely closed by #23) → confirm & close | **En-Ping Su** | — | Company | 1 | 1 |
| RAP-36 | Branch protection on `main` (#7) — nudge repo admin `logisticPM` | **Shiting Huang** | — | Process | 1 | 1 |
| RAP-37 | Velocity / CFD / burndown reporting (2nd data point) + run Sprint 3 retro | **Shiting Huang** | — | Process | 2 | 2 |
| RAP-51 | Deploy hardening — document reseed in `deploy.md`, ~$5 budget guardrail confirmed, consider seed step in `deploy.yml` | **Shiting Huang** | — | Infra | 2 | 2 |

**Proposed committed points: ~29** (matches the S2 achieved velocity baseline — refine at planning).

## In Progress
_(keep WIP low, ideally ≤1 per person)_

| ID | Task | Owner | Rev | Pts | Status (2026-06-17) |
|----|------|-------|-----|:---:|---------------------|
| RAP-31 | Indigenomics portal (`analytics`/Index) — by-tier breakdown, confirmable-vs-context framing, demo polish | **Tong Wu** | — | 5 | Carried from S2 (In Progress). Finish + demo on the production URL. |

## In Review
_(peer-check against the DoD — must be demoed on the production URL, not localhost)_

| ID | Task | Owner | Rev | Pts | Note |
|----|------|-------|-----|:---:|------|
| — | PR #21 — Questionnaire: read-only profile + self-report context sections (A/C/D) | (author) | **assign** | — | Open PR, CI green. Triage: assign a review owner + merge or close. |

## Done
_(meets DoD: owner · review owner · points · time logged · merged + CI green + auto-deployed)_

| ID | Task | Owner | Pts | Done | Note |
|----|------|-------|:---:|------|------|
| RAP-44 | Three-persona IA + **mock login** (cookie session) + identity routing — realises `sprint2/03` IA | **Tong Wu** | 3 | #22 (Jun 17) | Auto-deployed. Reconcile with the `?as=` entity switcher. |
| RAP-45 | Register supports all three roles (company / supplier / Indigenomics) | **Tong Wu** | 2 | #23 (Jun 17) | Auto-deployed. Likely closes RAP-38 company path — verify. |
| RAP-46 | Pre-login landing + per-persona home dashboard | **Tong Wu** | 3 | #24 (Jun 17) | Auto-deployed. The "sign in as…" door picker from `sprint2/03 §4`. |

---

## Deploy track — current state (RAP-28 closed; RAP-36 open)

| Ref | What | State |
|---|---|---|
| **Live URL** | Auto-deploys on every push to `main` (GitHub OIDC) | ✅ **https://d1hwn8hhp1ytc0.cloudfront.net** — current with `main` (last deploy Jun 17) |
| [#8] | AWS OIDC role + `AWS_DEPLOY_ROLE_ARN` secret | ✅ **RESOLVED** — secret added by `logisticPM`; `deploy.yml` green since Jun 13 |
| [#7] | Branch protection on `main` | ⏳ repo admin — RAP-36, governance only |
| [#9] | RAP-41 — Next.js 14→16 upgrade (audit advisories) | 🅿️ deferred tech debt (not in committed scope) |

[#7]: https://github.com/logisticPM/portal/issues/7
[#9]: https://github.com/logisticPM/portal/issues/9

---

## Dependency order & sequencing

```
RAP-39 (prod seed) ──▶ RAP-31 (Index demos real equity data) ──▶ RAP-48 (polish on real seed)
RAP-49 (pillar decision) ──▶ unblocks whether RAP-31/48 build on the procurement-centric model
RAP-32 (greenlight) ──▶ converts the whole direction to committed scope (no longer eng-gated)
RAP-30 (ingest spike) ──▶ feeds Sprint 4+ real-supplier data (Horizon-2)
```

**Sequencing rules:**
1. **Land RAP-39 (prod seed) early** — RAP-31 and RAP-48 demo against it; auto-deploy won't reseed for you.
2. **Make the two decisions (RAP-49 pillar, RAP-50 verification P2) by mid-sprint** — they're cheap but they gate scope; don't let them slip to Friday like the greenlight did.
3. **Demo-polish (RAP-48) runs after seed + Index land**, then record the ≤2-min demos for the Jun 17 client/class showing and the August showcase.

## Notes
- **Lead = Shiting Huang** (Week 6 rotation). Owns ceremonies + board + the 2nd velocity number + deploy hardening.
- **Review owner per card is new** (S2 retro §7) — assign `Rev` at pickup, not after.
- **August showcase is the release frame** — track epic burndown across S3→S5, not just per-sprint.
- **Auth stays mock** (cookie "sign in as", no Cognito) — Cognito is still Horizon-2 (`SH_RAP8_AWS_Architecture §6`). Don't let it creep in.
</content>
