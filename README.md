# Indigenomics RAP Data Portal

Public-facing companion to Indigenomics AI — a vertical slice of the RAP (Reconciliation Action Plan) data portal: `report → confirm → coverage → Index`, on confirmed data, across three persona portals (company · Indigenous supplier · Indigenomics institute).

**Stack:** Next.js 14 (App Router) · DynamoDB (single-table, contract-first `PortalRepo` seam) · SST v4 + OpenNext on AWS. See [`docs/deploy.md`](docs/deploy.md), [`docs/backend.md`](docs/backend.md), [`docs/frontend-api.md`](docs/frontend-api.md).

---

## Running locally

```bash
npm install
```

**Option A — quick UI loop (in-memory mock):**

```bash
npm run dev
```

Uses the in-memory mock repo. The seed parties/lines are present, but **no login accounts exist** in mock mode — use it to browse the UI or to **register** a fresh account from `/register`.

**Option B — full flow with seeded demo logins (DynamoDB Local):**

```bash
npm run ddb:up                                          # start DynamoDB Local (Docker)
npm run ddb:create                                      # create the tables
DYNAMO_ENDPOINT=http://localhost:8000 npm run ddb:seed  # seed parties/lines + demo accounts
REPO_IMPL=dynamo DYNAMO_ENDPOINT=http://localhost:8000 npm run dev
```

Then open the printed URL (usually <http://localhost:3000>).

---

## Demo accounts

Login is real (email + password). The seed creates one account per demo entity. **All seeded accounts share the same password:**

```
Password:  demo-portal-2026
```

| Email | Persona | Portal / starting page |
|---|---|---|
| `northway@demo` | Company — Northway Energy | report · coverage |
| `cedartrust@demo` | Company — Cedar Trust Bank | report · coverage |
| `mapletel@demo` | Company — Maple Telecom | report · coverage |
| `eagle@demo` | Supplier — Eagle River Construction | confirm · record · profile |
| `raven@demo` | Supplier — Raven Logistics | confirm · record · profile |
| `thunderbird@demo` | Supplier — Thunderbird IT Services | confirm · record · profile |
| `sweetgrass@demo` | Supplier — Sweetgrass Catering | confirm · record · profile |
| `cedarsage@demo` | Supplier — Cedar & Sage Consulting | confirm · record · profile |
| `salish@demo` | Supplier — Salish Office Supplies | confirm · record · profile |
| `institute@demo` | Indigenomics (institute) | analytics (the Index) · verify |

> ⚠️ **Demo accounts are for synthetic data only.** The shared password is obviously not a secret; these accounts exist purely so the team can sign in as a seeded entity during local dev and the showcase. They are seeded only by the local/synthetic seed and must **never** be created against an environment holding real partner data.

To create your own account instead, use `/register` (company, supplier, or Indigenomics; password ≥ 8 characters).

---

## Tests / verification

This repo has no unit-test framework; behaviour is pinned by `tsx` assertion harnesses:

```bash
npm run verify:auth   # auth: password hashing, signed session, rate limit (+ repo parity with DynamoDB Local)
npm run verify        # data layer: repo.dynamo ≡ repo.mock parity on the seeded reads + mutations
```

(`verify`’s full coverage and `verify:auth`’s parity section need DynamoDB Local up — `npm run ddb:up`.)
