# RAP-7 Hand-off — where each file goes

**Owner:** Shiting Huang · **Card:** RAP-7 "Stand up team repo + CI + dev env + README"

These are copy-paste-ready proposal files. Place them at the repo root unless noted:

| File here | Goes in the repo at | Notes |
|---|---|---|
| `.github/workflows/ci.yml` | `.github/workflows/ci.yml` | GitHub Actions: typecheck + lint + build on push/PR to `main` |
| `README.md` | `README.md` (root) | Project overview + quick start; the repo currently has no root README |
| `docker-compose.yml` | `docker-compose.yml` (root) | DynamoDB Local on :8000, matches `.env.local.example` |
| `docs/DEV_SETUP.md` | `docs/DEV_SETUP.md` | Full local dev guide (mock + DynamoDB Local) |

## Decisions / notes

- **Repo already exists** (`logisticPM/portal`) with `package.json` scripts `dev/build/start/lint/typecheck` — the CI uses those verbatim.
- **CI builds on the mock** (`REPO_IMPL=mock`) so it needs **no AWS credentials**. Good: keeps CI hermetic.
- **Lint caveat:** `npm run lint` = `next lint`, which needs an ESLint config. If the repo doesn't have one yet, run `npx next lint` once and commit `eslint-config-next` + the generated `.eslintrc.json`, **or** drop the lint step from `ci.yml`. Typecheck + build are the hard gates and work as-is (verified locally this session).
- **Node 20** in CI (matches a current LTS; the app builds on Next 14).
- **`.env.local` stays gitignored**; `.env.local.example` already documents the keys (`REPO_IMPL`, `AWS_REGION=ca-central-1`, `DYNAMO_TABLE=DataPortal`, `DYNAMO_ENDPOINT`).
- The `npm run seed` step referenced in the README/DEV_SETUP depends on the data group shipping `seed/` (see `Backend_DynamoDB_DataModel_and_repo-dynamo.md`). Until then, the mock path is the dev/demo default.

## Suggested follow-up

- Add a `seed` script to `package.json` once `seed/seed.ts` exists (e.g. `"seed": "tsx seed/seed.ts"`).
- Optionally add a branch-protection rule on `main` requiring the CI check to pass before merge.
