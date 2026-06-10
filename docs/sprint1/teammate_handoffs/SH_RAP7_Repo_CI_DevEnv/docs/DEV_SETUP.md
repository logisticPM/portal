# Dev Environment Setup

## Prerequisites

- **Node.js 20+** and npm
- **Docker** (for DynamoDB Local) — only needed when running against DynamoDB
- (Later, for AWS deploy) an AWS account + the AWS CLI configured for `ca-central-1`

## 1. Clone & install

```bash
git clone https://github.com/logisticPM/portal.git
cd portal
npm install
```

## 2. Run on the mock (fastest — no DB)

```bash
npm run dev      # http://localhost:3000
```

The app defaults to the in-memory mock (`src/lib/repo/repo.mock.ts`), seeded with synthetic companies/suppliers/lines. State resets on restart. This is enough to develop and demo the full flow.

## 3. Run against DynamoDB Local

```bash
# a) start the local database
docker compose up -d            # DynamoDB Local on http://localhost:8000

# b) configure env
cp .env.local.example .env.local
#   set:
#     REPO_IMPL=dynamo
#     AWS_REGION=ca-central-1
#     DYNAMO_TABLE=DataPortal
#     DYNAMO_ENDPOINT=http://localhost:8000
#   (dummy AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are fine for DynamoDB Local)

# c) create the table + load fixtures   (available once repo.dynamo.ts + seed/ land)
npm run seed

# d) run
npm run dev
```

> `.env.local` is gitignored. Never commit AWS keys, and never prefix AWS vars with `NEXT_PUBLIC_` (that would ship them to the browser).

## 4. Quality checks (what CI runs)

```bash
npm run typecheck
npm run lint
npm run build
```

## Troubleshooting

- **Port 8000 in use:** `docker compose down`, or change the host port in `docker-compose.yml`.
- **`next lint` asks to set up ESLint:** run `npx next lint` once and commit the generated config (or remove the lint step from CI until configured).
- **App still hits the mock after setting REPO_IMPL=dynamo:** ensure `.env.local` exists and the dev server was restarted; confirm `src/lib/repo/index.ts` reads `process.env.REPO_IMPL`.
- **Wipe local DB:** `docker compose down -v` (removes the volume), then re-run `npm run seed`.
