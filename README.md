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

## Demo accounts — sign in to test each of the 3 roles

Login is real (email + password). **Every account shares the same password:**

```
Password:  demo-portal-2026
```

Pick any of the three role sections below. The email is always the entity's name, lowercased with spaces → hyphens, ending in `@demo`.

### 1 · Indigenomics institute (the curator / analyst view)

| Email | What you see |
|---|---|
| `institute@demo` | RAP Index · Organizations · **Suppliers** directory · Coverage analysis · Verification · **Alignment** radar · Extract |

### 2 · Company (a RAP-committing organization)

Lands on **My commitments** — manage your commitments and see the **AI-matched Indigenous suppliers** for each one. You can sign in as **any of the 103 real RAP-Index companies**; the email is the company name slugified + `@demo`. A few to try:

| Email | Company |
|---|---|
| `rbc-royal-bank-of-canada@demo` | RBC (Royal Bank of Canada) |
| `bell-canada@demo` | Bell Canada |
| `enbridge@demo` | Enbridge |
| `sun-life@demo` | Sun Life |
| `ontario-power-generation@demo` | Ontario Power Generation |
| `maple-leaf-foods@demo` | Maple Leaf Foods |
| `translink@demo` | TransLink |
| `cedar-trust-bank@demo` | Cedar Trust Bank *(synthetic demo co.)* |

> Any of the 103 works — browse the full list at **`/commitments`** (signed in as `institute@demo`); each org's slugified name is its login. e.g. "Maple Leaf Foods" → `maple-leaf-foods@demo`.

### 3 · Indigenous supplier (one of the 10 real Indigenous-owned businesses)

Lands on **Confirm** (approve buyer records) · **Record** · **My profile** (edit + public showcase).

| Email | Supplier |
|---|---|
| `peacehills@demo` | Peace Hills Trust |
| `bouchier@demo` | The Bouchier Group |
| `kitsaki@demo` | Kitsaki Management LP |
| `desnedhe@demo` | Des Nedhe Development |
| `norsask@demo` | NorSask Forest Products |
| `membertou@demo` | Membertou Development Corporation |
| `animikii@demo` | Animikii |
| `ntg@demo` | Nations Translation Group |
| `3ne@demo` | Three Nations Energy |
| `fch@demo` | First Canadian Health |

> ⚠️ **Demo accounts are for synthetic/demo data only.** The shared password is obviously not a secret; these accounts exist purely so the team can sign in as a seeded entity for the showcase. Never create them against an environment holding real partner data.
>
> **Note (local dev):** `npm run ddb:seed` creates the 10 suppliers, the 3 synthetic companies, and `institute@demo`. The full **103 company** logins are provisioned by the `seed-org-logins` step (run in the deployed demo). To test the whole company set, use the deployed URL or run that seed against DynamoDB Local.

To create your own account instead, use `/register` (company, supplier, or Indigenomics; password ≥ 8 characters).

---

## Tests / verification

This repo has no unit-test framework; behaviour is pinned by `tsx` assertion harnesses:

```bash
npm run verify:auth   # auth: password hashing, signed session, rate limit (+ repo parity with DynamoDB Local)
npm run verify        # data layer: repo.dynamo ≡ repo.mock parity on the seeded reads + mutations
```

(`verify`’s full coverage and `verify:auth`’s parity section need DynamoDB Local up — `npm run ddb:up`.)
