# Backend (data layer) — status & how to run

Owned by the **Data group** (Sunny + Sharon). This is the single place to learn
what the backend is, what's done, and how to run it. Frontend integration is in
[`frontend-api.md`](./frontend-api.md).

---

## TL;DR — get it running in 4 commands

```bash
npm install
npm run ddb:up        # start DynamoDB Local (Docker)
npm run ddb:create && npm run ddb:seed            # portal table + data
npm run survey:create && npm run survey:seed      # survey table + data
```

Then either:

- **Run the app** on the data layer → create `.env.local` (see [Running the app](#running-the-app)) and `npm run dev`.
- **Check everything works** → `npm run verify` (18 checks).

> The app runs on an **in-memory mock by default** — teammates can build pages
> with no database at all. DynamoDB is opt-in via `REPO_IMPL=dynamo`.

---

## Architecture in one picture

```
  UI (Next.js pages)              ← Q+C group (Nate / Jack)
        │ imports `repo` / `surveyRepo` — only sees the INTERFACE
        ▼
  PortalRepo / SurveyRepo  (the seam)
        │ selected by REPO_IMPL
   ┌────┴─────┐
   ▼          ▼
 mock      DynamoDB            ← Data group (Sunny / Sharon)
(default)  (REPO_IMPL=dynamo)
```

- **Contract-first:** the frontend never imports DynamoDB. It calls typed methods
  on `repo` (portal) and `surveyRepo` (survey). Implementation is swappable.
- **Two domains, two tables**, both DynamoDB single-table design:

| Table | Domain | Entities |
|---|---|---|
| `DataPortal` | report → confirm → coverage | Party / ReportedLine / Confirmation |
| `RapSurvey` | RAP Impact Survey (41 questions) | Organization / SurveyResponse |

---

## Status

| Item | State |
|---|---|
| `DataPortal` + `RapSurvey` schemas (single-table, PK/SK + GSI1 + GSI2) | ✅ |
| Portal `repo.dynamo` (reads + writes), behaviour ≡ mock | ✅ verified |
| Survey data layer (all 41 questions modelled) | ✅ |
| Both domains expose interface only + mock fallback | ✅ |
| `npm run verify` regression harness (18 checks) | ✅ |
| Cloud tables (real AWS, us-east-1) | ✅ created + seeded |
| App hosting on cloud (Amplify/Vercel) | ⏳ deferred |
| Survey aggregation method, richer fixtures | ⏳ optional |

Against the design spec's Data-group Definition of Done
(*"repo.dynamo passes the same calls the mock does, on DynamoDB Local, with seed data"*),
the backend is **complete**.

---

## File map

```
src/lib/
  repo/                         # PORTAL domain
    types.ts                    # THE SEAM (PortalRepo) — shared with frontend; do not break
    index.ts                    # selects mock | dynamo via REPO_IMPL
    repo.mock.ts                # in-memory impl
    repo.dynamo/
      reads.ts                  # Sharon — reads / aggregates
      writes.ts                 # Sunny  — writes / integrity (status machine, soft-delete)
      index.ts                  # assembles dynamoRepo
    actions.ts                  # server actions (createLine / respond / withdraw / register)
  survey/                       # SURVEY domain (mirrors the portal structure)
    types.ts                    # Organization + SurveyResponse (all 41 Qs annotated)
    index.ts                    # selects mock | dynamo via REPO_IMPL
    repo.mock.ts
    repo.dynamo.ts
    fixtures.ts / seed.ts       # 2 test orgs
  dynamo/
    client.ts                   # env-driven client (Local vs real AWS)
    single-table.ts             # portal keys + item (un)marshalling
    survey-table.ts             # survey keys + item (un)marshalling
    create.ts                   # createSingleTable() — shared, waits for ACTIVE
  seed/
    fixtures.ts / seed.ts       # portal: 3 companies, 6 suppliers, 11 lines
scripts/
  create-table.ts  seed.ts  seed-survey.ts  verify.ts
docker-compose.yml              # DynamoDB Local
```

Ownership: **Sunny** = writes / integrity / infra / seed loaders. **Sharon** =
reads / aggregates / fixtures. Each edits their own files; the only shared file
with the frontend is `src/lib/repo/types.ts`.

---

## Key design (both tables)

Generic keys: `PK` / `SK` (main) + `GSI1PK`/`GSI1SK` + `GSI2PK`/`GSI2SK`.

**`DataPortal`**

| Entity | PK / SK | GSI1 (supplier view) | GSI2 (role view) |
|---|---|---|---|
| Party | `PARTY#<id>` / `PROFILE` | — | `ROLE#<role>` / `PARTY#<id>` |
| ReportedLine | `COMPANY#<id>` / `LINE#<id>` | `SUPPLIER#<id>` / `STATUS#<status>#LINE#<id>` | — |
| Confirmation | `COMPANY#<id>` / `LINE#<id>#CONF#<ts>` | `SUPPLIER#<id>` / `CONF#<ts>#LINE#<id>` | — |

**`RapSurvey`**

| Entity | PK / SK | GSI1 (by year) | GSI2 (by industry) |
|---|---|---|---|
| Organization | `ORG#<id>` / `PROFILE` | — | `INDUSTRY#<industry>` / `ORG#<id>` |
| SurveyResponse | `ORG#<id>` / `SURVEY#<year>` | `YEAR#<year>` / `ORG#<id>` | — |

> The 41 survey questions map to **fields** on these items (each annotated with its
> Q number in `survey/types.ts`); they don't change the key design. We borrowed the
> survey's field mechanics (procurement $, identity tier, period) — *"Australia for
> mechanics, Indigenomics for taxonomy."*

---

## Commands reference

| Command | What it does |
|---|---|
| `npm run ddb:up` / `ddb:down` | start / stop DynamoDB Local (Docker) |
| `npm run ddb:create` / `ddb:seed` | create + seed the **portal** table (Local) |
| `npm run survey:create` / `survey:seed` | create + seed the **survey** table (Local) |
| `npm run verify` | run the 18-check regression harness (needs `ddb:up`) |
| `npm run typecheck` | `tsc --noEmit` |
| `*:cloud` variants | same against **real AWS** (us-east-1) — see below |

---

## Running the app

Copy `.env.local.example` → `.env.local` and pick a mode:

**Mock (default, no setup):** delete/empty `.env.local` → `npm run dev`.

**DynamoDB Local:**
```
REPO_IMPL=dynamo
DYNAMO_ENDPOINT=http://localhost:8000
DYNAMO_TABLE=DataPortal
```
(run `ddb:up` + `ddb:create` + `ddb:seed` first)

**Real AWS DynamoDB (app local → cloud table):**
```
REPO_IMPL=dynamo
AWS_REGION=us-east-1
DYNAMO_TABLE=DataPortal
```
(no `DYNAMO_ENDPOINT`; needs valid AWS creds — see below)

---

## Cloud (real AWS DynamoDB)

Tables `DataPortal` + `RapSurvey` already exist in account `106189426706`,
region **us-east-1**. The same scripts target the cloud (no `DYNAMO_ENDPOINT`):

```bash
aws sso login                       # refresh creds when they expire
npm run ddb:create:cloud && npm run ddb:seed:cloud
npm run survey:create:cloud && npm run survey:seed:cloud
```

Credentials are AWS IAM Identity Center (SSO). If the SDK reports `ExpiredToken`,
run `aws sso login`. The console is **us-east-1 (N. Virginia)** — not Ohio.

---

## What's not done (by design / optional)

- **App hosting on the cloud** (Amplify/Vercel) — deferred; the app currently runs
  locally against either Local or the cloud table.
- **Survey aggregation** (cross-org rollup beyond `listResponsesByYear`) — add only
  if the demo shows survey analytics.
- **Scale / real identity verification / dispute resolution** — Horizon 2 (spec §15).
- **Browser end-to-end test** — blocked until the Q+C group fills in the page stubs.
