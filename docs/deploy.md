# Deploy to AWS — how to ship the portal

This is the single place to learn how the portal
gets onto AWS and how to push changes. Backend/data layer is in
[`backend.md`](./backend.md); frontend integration in [`frontend-api.md`](./frontend-api.md).

We host on **AWS via [SST](https://sst.dev) v4 + OpenNext**: the Next.js app runs
as a Lambda behind CloudFront, talking to DynamoDB. `sst.config.ts` (repo root)
defines everything — the site, both tables, and a stub export bucket.

---

## TL;DR — deploy in 3 commands

```bash
aws sso login                                                  # 1. refresh creds
npx sst deploy --stage production                              # 2. go live → prints a CloudFront URL
npx sst shell --stage production -- tsx scripts/seed-sst.ts    # 3. load demo data
```

Then open the URL it printed and run `report → confirm → coverage → Index`.

> **Live now:** https://d1hwn8hhp1ytc0.cloudfront.net (stage `production`, us-east-1).

That's it — no admin rights, no static keys, no GitHub setup needed. You deploy
straight from your laptop using your own SSO login.

---

## What gets created (one `sst deploy`)

```
CloudFront (CDN) ──┬── static assets ─▶ S3 (Web assets bucket)
                   └── SSR / Server Actions ─▶ Lambda (Next server, via OpenNext)
                                                │  IAM role auto-scoped by SST `link:`
                                                ▼
                          DynamoDB:  DataPortal + RapSurvey   (per-stage tables)
                          S3:        Exports bucket           (Horizon-2 OCAP, stubbed)
```

- **Region:** `us-east-1`. **Account:** `106189426706` (SSO / IAM Identity Center).
- **Per-stage isolation:** each stage (`production`, your dev stage, …) gets its
  **own** tables, auto-named like `indigenomics-portal-production-DataPortalTable-xxxx`.
- The app reads `REPO_IMPL=dynamo` + the table names from env — SST injects them
  automatically (see `sst.config.ts` → `environment`). The data layer is unchanged
  from local; only the client endpoint differs.

---

## Prerequisites (one-time)

1. **AWS SSO configured** in `~/.aws/config` (the `capstone` sso-session +
   `default` profile → account `106189426706`, region `us-east-1`). See the Cloud
   section of [`backend.md`](./backend.md). SSO region is `us-west-2`; **deploy
   region is `us-east-1`**.
2. **Dependencies installed:** `npm install` (this brings in `sst`).
3. **Logged in:** `aws sso login` (sessions last ~8h; re-run when expired).
   Verify with `aws sts get-caller-identity`.

---

## Commands reference

| Command | What it does |
|---|---|
| `aws sso login` | Refresh AWS credentials (do this first; expires ~8h) |
| `npx sst deploy --stage production` | Build + deploy the `production` stage → CloudFront URL |
| `npx sst shell --stage production -- tsx scripts/seed-sst.ts` | Seed that stage's tables (auto-resolves the table names) |
| `npx sst dev` | Local dev loop: runs the app on **localhost** against live cloud resources (uses your personal stage = your username — **not** a shared URL) |
| `npx sst remove --stage production` | Tear the stage down — deletes all its AWS resources (stops cost) |

> ⚠️ Don't run `npm run ddb:create:cloud` / `ddb:seed:cloud` against deployed
> stages — those target a bare `DataPortal` name and predate SST. For SST-managed
> stages always use `seed:sst`, which resolves the real per-stage table names.

---

## Ship a change

After editing app code, just redeploy the same stage:

```bash
aws sso login                      # if creds expired
npx sst deploy --stage production  # ships the new build; URL stays the same
```

Data persists across deploys (the tables aren't recreated), so you only re-seed
if you changed the fixtures or want a clean demo state.

---

## Verify a deploy

```bash
URL=https://d1hwn8hhp1ytc0.cloudfront.net
curl -s -o /dev/null -w "%{http_code}\n" "$URL/coverage"   # expect 200
```
Then open the URL and walk the full flow. To confirm data is really in DynamoDB:
```bash
T=$(aws dynamodb list-tables --region us-east-1 \
      --query "TableNames[?contains(@,'production-DataPortal')]|[0]" --output text)
aws dynamodb scan --table-name "$T" --select COUNT --region us-east-1 --query Count
# 28 = 9 parties + 11 lines + 8 confirmations
```

---

## Cost

Demo traffic is effectively free (DynamoDB on-demand + Lambda + CloudFront free
tiers). A budget alert guards against surprises: **`indigenomics-portal-monthly`**,
$250/month, emails at $200 (80%) and on forecast-over. Total project budget is
$1000 over 4 months. **When the demo is done, run `npx sst remove --stage
production`** to stop all spend.

---

## CI / automated deploy (optional, not required)

`.github/workflows/deploy.yml` can deploy on every push to `main` via GitHub
OIDC (no static keys). It's **not needed** — the manual `sst deploy` above is the
supported path. The workflow stays red until a repo/AWS admin sets up the OIDC
role + `AWS_DEPLOY_ROLE_ARN` secret (tracked in GitHub issue #8). Until then,
deploy manually.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Token has expired and refresh failed` / `ExpiredToken` | `aws sso login` |
| `seed:sst` writes to the wrong/empty table | Make sure `--stage` matches the deployed stage; `sst shell` resolves names for the stage it targets |
| App shows no data after deploy | Tables exist but weren't seeded → run the `seed:sst` command for that stage |
| `AccessDenied` during `sst deploy` | Your SSO role lacks a permission — note the exact action and escalate to the AWS account admin (`logisticPM`) |
| Want a throwaway environment | Deploy a named stage, e.g. `--stage demo2`, then `sst remove --stage demo2` when done |
