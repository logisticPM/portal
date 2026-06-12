# Sprint 2 — Sprint Backlog (Task Board)

Move cards left→right. Owner in **bold**. **Pts** = story points (velocity baseline this sprint); Est = ideal hours.
Card IDs continue the `RAP-##` series from Sprint 1 (which used RAP-7/9/11/23/27/28/29).

## To Do

| ID | Task | Owner | Epic | Pts | Est |
|----|------|-------|------|:---:|----:|
| RAP-30 | Horizon-2 ingest spike — pull federal 5% + Indigenous Business Directory sample; map to `Supplier` seed behind the seam (go/no-go) | **Mengshan Li** | Data | 5 | 6 |
| RAP-31 | **Indigenomics portal** (`analytics`/Index) — build the institute portal shell; surface the **equity** pillar next to procurement, **by-tier** breakdown, **confirmable-vs-context** framing; a11y + demo polish | **Data group** | Indigenomics | 5 | 6 |
| RAP-38 | Company self-registration entry — mirror `/register` for companies (closes the "no company sign-up entry" gap) | **En-Ping Su** (company) | Company | 2 | 2 |
| RAP-39 | Clean demo seed state — reset script back to 6-supplier / 82% confirmed (clears the `verify`-run residue); seed the **equity** lines incl. one self-declared phantom-JV signal | **Data group** | Data | 2 | 2 |
| RAP-40 | **Supplier portal** (Jack) — confirm / record / register into a supplier portal shell; surface each line's `pillar` so **equity** claims read in the inbox; keep OCAP export/withdraw | **Tong Wu** | Frontend | 3 | 4 |
| RAP-32 | Chase client greenlight (day 2, parallel) + capture answers into backlog | **En-Ping Su** | Client | 3 | 3 |
| RAP-33 | Advisor confirmation (cultural + economic) — book + confirm | **En-Ping Su** | Client | 2 | 2 |
| RAP-34 | Questionnaire depth — AU→CA reportable fields wired into the company report flow | **En-Ping Su** | Product | 5 | 5 |
| RAP-35 | Consent-app LICENSE / spec review before public reuse | **Mengshan Li**+all | Legal | 2 | 2 |
| RAP-37 | Set up velocity / cumulative-flow / burndown reporting; run Sprint 2 retro | **Mengshan Li** | Process | 2 | 2 |

**Committed points: 42** (velocity baseline — Sprint 3 plans against the *achieved* number, not this commitment).

## In Progress
_(keep WIP low, ideally ≤1 per person)_

| ID | Task | Owner | Pts | Status (2026-06-10) |
|----|------|-------|:---:|---------------------|
| **RAP-36** | CI + branch-protect `main` | **Shiting Huang** | 3 | CI workflow **done + merged + green** ([PR #6]). Branch protection still pending → **[#7]**. ⚠️ Note: the automated deploy path uses OIDC (**[#8]**) — **not needed for the demo** (the live URL was shipped via a manual `sst deploy`); only required if we want push-to-`main` auto-deploy. Scope deviation (deploy-on-merge vs per-PR preview) still needs team sign-off. |

## In Review
_(peer-check against the Definition of Done — must be demoed on the deploy URL, not localhost)_

## Done
_(meets DoD: owner · points · time logged · merged + CI green)_

| ID | Task | Owner | Pts | Done (2026-06-12) |
|----|------|-------|:---:|-------------------|
| **RAP-28** | Deploy to AWS — SST/OpenNext → shared URL | **Shiting Huang** | 8 | ✅ **LIVE: https://d1hwn8hhp1ytc0.cloudfront.net** — `sst deploy --stage production` (CloudFront + Lambda/OpenNext + production `DataPortal`/`RapSurvey` tables, us-east-1), seeded via `seed:sst`. Smoke-test: all pages 200; coverage renders seeded companies from DynamoDB → `report → confirm → coverage → Index` runs on the real backend. Shipped with the owner's own SSO creds — **no admin/OIDC needed for the URL**. Infra in [PR #6]. |

---

## Deploy track — GitHub artifacts (RAP-28 / RAP-36)

| Ref | What | State |
|---|---|---|
| **Live URL** | `sst deploy --stage production` (manual, owner's SSO creds) | ✅ **https://d1hwn8hhp1ytc0.cloudfront.net** — seeded + smoke-tested 2026-06-12 |
| [PR #6] | SST config + `seed:sst` + CI/deploy workflows + `sst` devDep | ✅ Merged, CI green |
| [#7] | Enable branch protection on `main` | ⏳ repo admin — **not a demo blocker** (governance only) |
| [#8] | AWS OIDC role + `AWS_DEPLOY_ROLE_ARN` secret | ⏳ IAM admin — **downgraded**: only needed for *automated* push-to-`main` deploy; the live URL was shipped manually |
| [#9] | **RAP-41** (deferred) — Next.js 14→16 upgrade, resolves `npm audit` advisories | 🅿️ post-sprint tech debt (not in the committed 42) |

[PR #6]: https://github.com/logisticPM/portal/pull/6
[#7]: https://github.com/logisticPM/portal/issues/7
[#8]: https://github.com/logisticPM/portal/issues/8
[#9]: https://github.com/logisticPM/portal/issues/9

---

## Card → owner → S1 lineage

| Card | Continues from Sprint 1 |
|---|---|
| RAP-28, RAP-36 | RAP-28 (AWS hosting) — the one carried build card not yet started |
| RAP-30 | `ML_RAP4_Data_Feasibility_Memo` — rated federal 5% + IBD ingestable for a Horizon-2 pilot |
| RAP-31 | RAP-29 frontend; **reassigned to the Data group (2026-06-10)** — they own the Indigenomics portal *and* AWS |
| RAP-34, RAP-38 | `08`/`09` + `02_Questionnaire_Expansion_Design`; company-side report form + sign-up → **company owner (Nate / En-Ping Su)** |
| RAP-39 | Seed residue from the verify run + the new **equity** seed (`02_Questionnaire_Expansion_Design §5`) |
| RAP-40 | Jack's narrowed scope (2026-06-10): **supplier portal only**; Index + AWS moved to the Data group |
| RAP-32, RAP-33, RAP-35 | Decision Memo §5 open gating items + retro §4 action items |

## Dependency order & sequencing

The board is a flat list, but the cards are **not** independent. Hidden chain:

```
RAP-39 (equity seed) ─┬─▶ RAP-31 (Index shows equity)
                      └─▶ RAP-40 (supplier inbox shows equity)
RAP-34 (equity report form) ──▶ company-side create path for equity (complements the seed)
RAP-28 (deploy URL) ──▶ gates the "demoed on the deploy URL" DoD for RAP-31 (and any feature demo)
RAP-36 (CI/branch-protect) ──▶ supports RAP-28
```

**Three sequencing rules (so the week doesn't collide):**

1. **RAP-39 (equity seed) is the unblocker — land it Day 1.** Both display cards (RAP-31, RAP-40) are meaningless without equity data; the report form (RAP-34) also wants it to test against.
2. **Start RAP-28 (deploy) Day 1, not end-of-week.** It's the largest (8) + riskiest (first-ever AWS) + RAP-31's DoD depends on it. An 8-pt unknown left to late week collides with every feature demo.
3. **Display/build cards run *after* their data, demo *after* the URL.** RAP-31/40/34/38 build mid-week once RAP-39 lands; their on-URL demo happens after RAP-28 is up.

**Suggested day map (1-week):**

| When | Cards |
|---|---|
| **Day 1–2 (unblock)** | RAP-39 (seed) · RAP-28 started (deploy) · RAP-36 |
| **Day 2–4 (build on data)** | RAP-34 (form) · RAP-31 (Index) · RAP-40 (supplier) · RAP-38 (company reg) |
| **Parallel, any time** | RAP-30 (spike) · RAP-32/33 (client/advisor) · RAP-35 (LICENSE) |
| **Day 4–5 (integrate + demo on URL)** | point feature demos at the RAP-28 URL · RAP-37 (velocity + retro) |

## Notes
- **Ownership reassignment (2026-06-10):** the **Data group now owns both the Indigenomics portal (RAP-31) and the AWS deploy (RAP-28/36)** — the institute view sits closest to the data/Index layer they build. **Jack (Tong Wu) narrows to the supplier portal (RAP-40).** Company-side report form + sign-up (RAP-34/38) belong to the company owner. Reflected in `02_Questionnaire_Expansion_Design` and `03_Portal_IA_and_Login_Routing`.
- **Why RAP-28 is the headline:** the slice already runs locally on the real backend (`REPO_IMPL=dynamo`, read-parity verified). Sprint 2's distinctive deliverable is making it *shared and durable* — a URL the client can open during the greenlight conversation (RAP-32), which is the fastest path to converting recommendation → committed scope.
- **Auth stays deferred:** the demo role-switcher remains; Amazon Cognito is Horizon-2 (`SH_RAP8_AWS_Architecture §6`). Don't let it creep into this sprint.
- **OCAP export over S3 signed URLs** is also Horizon-2 — the inline JSON export is sufficient for the demo.
