# Indigenomics Data Portal

A consent-based, Indigenous-governed web app for **verified** Indigenous-economic data. A company reports itemized procurement spend naming Indigenous suppliers; each named supplier **confirms / disputes / corrects** the entry; the output is a **RAP Index** — a "reported vs confirmed" coverage view. Modelled on Australia's RAP questionnaire, with the supplier-confirmation layer it never had, for the Canadian context (CCIB, OCAP/CARE).

> This is a capstone MVP running on **synthetic data**. Demo target: June 24.

## Architecture (contract-first)

The UI and the data layer meet at one shared interface, `src/lib/repo/types.ts` (`PortalRepo`):

```
UI (Next.js App Router pages)  →  PortalRepo (the seam)  →  repo.mock.ts  (in-memory, default)
                                                          →  repo.dynamo.ts (AWS DynamoDB)  [REPO_IMPL=dynamo]
```

The UI never imports the AWS SDK; only `repo.dynamo.ts` does. Switching backends is one env flag. Target infra is **AWS** (DynamoDB single-table; see `docs/sprint1/teammate_handoffs/`).

## Quick start (mock — no database needed)

```bash
npm install
npm run dev        # http://localhost:3000, runs on the in-memory mock
```

Open `/` for the role switcher (act as a company / supplier / Indigenomics).

## Run against DynamoDB Local

```bash
docker compose up -d            # starts DynamoDB Local on :8000
cp .env.local.example .env.local && # set REPO_IMPL=dynamo (keep DYNAMO_ENDPOINT=http://localhost:8000)
npm run seed                    # create table + load synthetic fixtures (once repo.dynamo + seed land)
npm run dev
```

See `docs/DEV_SETUP.md` for the full walkthrough.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server (mock by default) |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | `next lint` (requires ESLint config) |
| `npm run typecheck` | `tsc --noEmit` |

## Repo structure

```
src/app/        Next.js pages: landing, report, coverage, confirm, record, analytics, register, api/export
src/components/ shared UI (money(), TierBadge, StatusBadge)
src/lib/repo/   types.ts (the seam) · repo.mock.ts · repo.dynamo.ts (data group) · index.ts (selector) · actions.ts
docs/specs/     design spec (source of truth)
docs/sprint1/   sprint artifacts + teammate handoffs
```

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck + lint + build on every push/PR to `main`.

## Docs

- **Design spec:** `docs/specs/2026-06-05-data-portal-demo-design.md`
- **Sprint 1 artifacts + handoffs:** `docs/sprint1/`
