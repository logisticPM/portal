# Part 1B — Individual Hand-in · Shiting Huang


**Sprint:** 2 (Week 5) · **Role:** Infra / Backend · Architecture
**Dates:** Jun 8–14, 2026 · **Time tool:** Toggl/Jira

## A. Hours, mapped to backlog items

| Task (RAP-#) | Activity | Hours |
|---|---|---:|
| RAP-28 | **Deploy to AWS** — SST v4 + OpenNext (Next on Lambda + CloudFront + DynamoDB); per-stage tables; server-side IAM via SST `link:` (no static keys); `seed-sst`; **live URL** `d1hwn8hhp1ytc0.cloudfront.net` (PRs #6, #11) | 7.5 |
| RAP-36 | CI deploy workflow (`workflow_dispatch`, OIDC role) + branch-protect setup on `main` | 3.0 |
| RAP-28 | `deploy.md` runbook + marked hosting live in `backend.md` (PR #12) | 1.25 |
| — | Index 500 fix — coerce missing `flowType` in `itemToLine` after the pillar-model change (PR #17) | 0.75 |
| RAP-27 | repo.dynamo reads/aggregates co-ownership + dynamo seed parity | 1.5 |
| — | Team ceremonies + advisor/class meetings (Hao, Lino) — **demoed the slice Thu + Fri**; fuller version for **client + class Jun 17** | 1.25 |
| **Total** | | **15.25** |

## B. AI usage & value-add

I used AI to speed up the IaC and workflow drafts, but **the deployment design and secret-handling were my calls, and I tested every deploy + read each generated config before shipping** — the live URL is the proof it actually runs.

| What I owned / decided | Where AI assisted (reviewed by me) |
|---|---|
| Choosing SST v4 + OpenNext over Amplify; scoping the Lambda's DynamoDB access via `link:` so there are **no static keys**; per-stage tables; deploying from a laptop SSO login | Drafted `sst.config.ts` + the Lambda/CloudFront wiring — I verified it against current SST and deployed/iterated |
| Using OIDC role assumption for CI instead of stored secrets | Drafted the GitHub Actions YAML — I checked the IAM scope |
| Root-causing the Index 500 to old data missing `flowType` after the pillar-model merge | Helped read the stack trace — I wrote the fix so old + new data both render |

## C. One-paragraph reflection

I owned the sprint's core Definition of Done: getting the slice off localhost and onto a real shared URL on AWS. The hard parts were judgment, not generation — secrets server-side only, SSO instead of static keys, scoping the Lambda's table access, and wiring per-stage data so production has its own DynamoDB. AI drafted the config faster than I'd type it, but SST/AWS behaviour changes quickly, so I verified everything against current docs and proved it by deploying and running the full `report → confirm → coverage → Index` loop on the live URL. The Index 500 was a useful reminder that a mid-sprint schema change (the pillar-model refactor) can break data that's already deployed, so I made the read path tolerant of older items instead of just patching the seed — that's the kind of thing only shows up once you're running on real, persisted data rather than a fresh local mock. The one thing still open is branch protection on `main` (RAP-36), which carries; next sprint I'd finish the automated deploy-on-merge so shipping doesn't depend on someone running it locally, and add an idle-teardown step to keep the sandbox comfortably within the free tier.
