# Design: Migrate portal → `indigenomics-data-platform` + `indigenomics-legal-cases`

**Date:** 2026-07-08
**Source:** `logisticPM/portal` (the monolith) @ the SHA captured at migration time
**Targets:**
- `indigenomicsxyz/indigenomics-data-platform` (skeleton: `app/ integrations/ docs/`)
- `indigenomicsxyz/indigenomics-legal-cases` (skeleton: `data/ evaluator/ architect/ portal/ docs/`)

## Goal

Copy the portal's two decoupled domains into their two mapped, currently-empty repos so
each becomes a **runnable Next.js app** plus semantic dirs populated with offline tooling,
corpus, and docs. The portal repo stays the untouched source of truth.

## Decisions (locked with Nate, 2026-07-08)

1. **Snapshot copy, not history migration.** One import commit per repo (`Import <domain>
   from portal @ <sha>`). No git filter-repo/subtree; paths are reorganizing anyway.
2. **Keep the app runnable, map loosely to each skeleton.** The runnable Next.js app lands
   under the closest skeleton dir; the other skeleton dirs are honored semantically (below).
3. **data-platform = full portal MINUS cases.** RAP Index + commitments + extraction
   pipeline + shell/auth all go to data-platform. The RAP extraction pipeline is included
   here for now (the separate `indigenomics-rap` repo is out of scope for this migration).
4. **Code stays consolidated; semantic dirs hold artifacts + pointers.** The runnable app
   imports `@/lib/...` and the `scripts/*` CLIs import it too — physically splitting the
   library across `data/`/`evaluator/`/`architect/` would break both. So the *code* stays
   under the runnable app dir; the semantic dirs receive corpus artifacts, docs, and README
   pointers into that code. This honors the skeleton without a non-runnable reorg.
5. **Copy app only; deploy config deferred.** Exclude `sst.config.ts`, `sst-env.d.ts`,
   `.sst/`, `.open-next/`. Acceptance is dev-build/typecheck/tests, not deploy. (Verified:
   no `src/lib` code imports `sst`/`Resource`, so dropping the SST type shim does not break
   typecheck. Deploy docs are kept under `docs/` as reference only.)

## Source domain boundary (verified)

The two domains are decoupled at the code level:
- `lib/cases` and `lib/rap`/`lib/commitments`/`lib/rap-index` do **not** import each other.
- The cases app (`src/app/cases`) imports only `@/lib/cases/*` and `@/lib/auth` beyond itself.
- Cases has its own app layout/nav, its own `scripts/cases-*` + `scripts/test-cases-*`, and
  its own DynamoDB table (`src/lib/dynamo/cases-table.ts`).
- Shared surface = generic infra only: `lib/auth`, `lib/dynamo/client`, root config,
  `components/ui`, `globals.css`, `login/`, `register/`.

## Repo A — `indigenomics-legal-cases` (cases slice)

| Target dir | Contents |
|---|---|
| `portal/` | **Runnable cases-only Next.js app.** `src/app/`: `cases/` (incl. `[id]`, `activation`, `briefings`, `methodology`, `error`, `highlight`, `layout`, `ui`), `layout.tsx`, `globals.css`, `login/`, `register/`. `src/lib/`: `cases/` (incl. `briefs/`, `ingest/`, `search/`, `validate/`, `enrichment`, `lenses`, `query`, `fixtures`, `repo.dynamo`, `repo.mock`, `types`, `index`), `auth.ts`, `dynamo/` (`client.ts`, `cases-table.ts`, `create.ts`, `single-table.ts`), `components/ui.tsx`. Root: `package.json`, `next.config.mjs`, `tailwind.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `.gitignore`, `.env.local.example`, `next-env.d.ts`. |
| `data/` | Cases corpus + provenance artifacts. README pointing at the ingestion CLIs (`portal/scripts/cases-ingest`, `cases-fetch-fulltext`, `cases-embed`, `cases-index-build`, `seed-cases`). |
| `evaluator/` | README pointing at the analysis code (`portal/src/lib/cases/lenses`, `enrichment`, `validate`) and eval CLIs (`cases-eval`, `cases-validate`, `cases-promote`, `test-cases-*`). |
| `architect/` | README pointing at briefs code (`portal/src/lib/cases/briefs`, `cases-summarize`). |
| `docs/` | Cases methodology notes + `MIGRATION.md` (records source SHA, exclusions, how to run). |

**Cases scripts** kept under `portal/scripts/`: `cases-*.ts`, `test-cases-*.ts`,
`seed-cases.ts`, plus shared `create-table.ts`, `fetch-polyfill.ts`.

## Repo B — `indigenomics-data-platform` (portal minus cases)

| Target dir | Contents |
|---|---|
| `app/` | **Runnable portal, everything except cases.** `src/app/`: all routes except `cases/` — `commitments`, `extract`, `analytics`, `coverage`, `home`, `my-commitments`, `organizations`, `report`, `verify`, `s`, `(supplier)`, `api`, `login`, `register`, `layout.tsx`, `page.tsx`, `globals.css`. `src/lib/`: `rap`, `commitments`, `rap-index`, `survey`, `repo`, `seed`, `auth.ts`, `dynamo/` (minus `cases-table.ts`). `src/components/`: all. `scripts/`: rap/commitments/survey + `test-*` (NOT `cases-*`/`test-cases-*`): `seed-rap*`, `seed-commitments`, `seed-survey`, `seed-sst`, `seed`, `approve-job`, `finish-extraction`, `make-test-job`, `create-table`, `delete-org`, `fetch-polyfill`, `test-explore-facts`, `test-survey-*`, `verify`. Root config + `DATA_VERIFICATION.md`. |
| `integrations/` | README describing the `rap-index` seam (`app/src/lib/rap-index/facts-source.ts`, `commitments-to-facts.ts`) as the adapter layer, and the future RAP / legal-cases consumers. |
| `docs/` | All rap/portal docs: `rap-dashboard-architecture`, `rap-data-verification-and-sources`, `rap-extraction-findings`, `rap-index-grounded-corpus-plan`, `backend`, `frontend-api`, `HANDOFF-stage2-bedrock`, `deploy*` (reference only), `sprint1/2/3`, `research`, `superpowers/plans`. Plus `MIGRATION.md`. |

## Cross-cutting rules

- **Never copy:** `node_modules`, `.next`, `.open-next`, `.sst`, `.git`, `tsconfig.tsbuildinfo`,
  `.DS_Store`, `sst.config.ts`, `sst-env.d.ts`, and **`.env.local`** (secrets — only
  `.env.local.example` goes).
- **Do not overwrite** the targets' curated `README.md` / `ROADMAP.md` / `CONTRIBUTING.md`.
  Add `MIGRATION.md` in each `docs/`.
- `package.json` copied whole; dependency pruning is an optional follow-up (pruning risks
  breaking transitive imports — defer).
- **Delivery:** each import lands on a branch (`import/from-portal`) with a PR into the
  target's `main`. **No direct push to `main`.**

## Acceptance per repo

1. `npm install` clean.
2. `npm run typecheck` (tsc --noEmit) passes.
3. `npm run build` (next build) passes.
4. The domain's standalone tests pass: cases → `tsx scripts/test-cases-*.ts`; data-platform
   → `tsx scripts/test-explore-facts.ts`, `test-survey-*.ts`.
5. No secret material committed (grep the tree for `.env.local`, AWS keys).

## Risks / open items

- **Push access:** confirm Reverie1234 can push to the private `indigenomicsxyz` org repos
  before delivery. Do not push without Nate's explicit go (outward-facing action).
- **Dep pruning deferred:** both repos carry the full `package.json`; unused deps remain.
- **Deploy wiring deferred:** neither repo is deployable until `sst.config.ts` is
  re-authored per repo (out of scope here).
- **`integrations/`/semantic dirs are pointers, not code homes** — a future refactor may
  physically relocate the adapter/pipeline code if the team wants stricter separation.
