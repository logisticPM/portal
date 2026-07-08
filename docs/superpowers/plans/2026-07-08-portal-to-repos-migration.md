# Portal → data-platform + legal-cases Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshot-copy the portal's two decoupled domains into their mapped repos so `indigenomics-data-platform` holds a runnable portal (RAP + commitments + extraction, no cases) and `indigenomics-legal-cases` holds a runnable cases-only app, each delivered by PR.

**Architecture:** For each target we do a **subtractive copy**: copy the full portal tree into the target's skeleton dir (data-platform → `app/`, legal-cases → `portal/`), delete the *other* domain's files, trim the shared shell's visible nav, then prove correctness with `tsc --noEmit` + `next build` + the domain's `tsx` test scripts. Subtractive + typecheck is complete by construction: any file left behind that imports a deleted module is a compile error. The semantic dirs (`integrations/`, `data/`, `evaluator/`, `architect/`) get `MIGRATION.md` + pointer READMEs, not relocated code.

**Tech Stack:** Next.js App Router (RSC + server actions), TypeScript, DynamoDB (`@aws-sdk/lib-dynamodb`), `tsx` for standalone test/seed scripts. No jest/vitest — tests are `tsx scripts/test-*.ts` with `node:assert/strict`.

## Global Constraints

- **Never copy:** `node_modules`, `.next`, `.open-next`, `.sst`, `.git`, `tsconfig.tsbuildinfo`, `.DS_Store`, `sst.config.ts`, `sst-env.d.ts`, and **`.env.local`** (secrets). Only `.env.local.example` is copied.
- **Do not overwrite** each target's existing `README.md` / `ROADMAP.md` / `CONTRIBUTING.md` / `.gitignore`. Add new files only; the migration adds a `docs/MIGRATION.md`.
- **No direct push to `main`.** All work lands on branch `import/from-portal` in each target, delivered as a PR into `main`.
- **Push access** to the private `indigenomicsxyz` org repos is assumed (Nate confirmed). If a push 403s, stop and report — do not retry against a fork.
- `package.json` is copied whole; dependency pruning is out of scope (deferred).
- Deploy config is out of scope: no `sst.config.ts` in either target. Verified: no `src` code imports `sst`/`Resource`, so dropping the SST type shim does not break typecheck.
- Source of truth is `logisticPM/portal` — it is **never modified** by this plan (except the spec/plan docs already committed on branch `migrate/portal-to-repos`).
- Commit trailer for every commit in this migration:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## File Structure (what each task produces)

- **Phase 0** — a workspace with both target repos cloned as siblings of `portal/`, and the captured source SHA. No code changes.
- **Track A (Tasks A1–A4)** — `indigenomics-data-platform`: `app/` = runnable portal minus cases; `integrations/README.md`; `docs/` = rap docs + `MIGRATION.md`; PR opened.
- **Track B (Tasks B1–B5)** — `indigenomics-legal-cases`: `portal/` = runnable cases-only app; `data/`,`evaluator/`,`architect/` pointer READMEs; `docs/MIGRATION.md`; PR opened.

Tracks A and B are independent and may be executed in parallel by separate workers. Within a track, tasks are sequential.

---

## Phase 0 — Workspace setup (shared prerequisite)

### Task 0: Clone targets and capture source SHA

**Files:**
- Create: `../indigenomics-data-platform/` (clone), `../indigenomics-legal-cases/` (clone)
- Create: `/tmp/.../scratchpad/source-sha.txt` (the captured portal SHA)

**Interfaces:**
- Produces: `SRC` = absolute path to the portal checkout; `SHA` = source commit; `DP` = data-platform clone path; `LC` = legal-cases clone path. Later tasks reference these.

- [ ] **Step 1: Capture the source SHA and paths**

Run from the portal checkout:
```bash
cd "/Users/eps/Desktop/Work/NEU/Summer 2026/CS7980/portal"
git rev-parse HEAD | tee "$(git rev-parse --show-toplevel)/../source-sha.txt"
```
Expected: prints a 40-char SHA (this is `SHA`). Note it — it goes in both `MIGRATION.md` files and both import commit messages.

- [ ] **Step 2: Clone both targets as siblings of portal**

```bash
cd "/Users/eps/Desktop/Work/NEU/Summer 2026/CS7980"
gh repo clone indigenomicsxyz/indigenomics-data-platform
gh repo clone indigenomicsxyz/indigenomics-legal-cases
```
Expected: two new dirs, each containing the README/ROADMAP scaffold and skeleton dirs.

- [ ] **Step 3: Create the import branch in each**

```bash
cd "/Users/eps/Desktop/Work/NEU/Summer 2026/CS7980/indigenomics-data-platform" && git checkout -b import/from-portal
cd "/Users/eps/Desktop/Work/NEU/Summer 2026/CS7980/indigenomics-legal-cases" && git checkout -b import/from-portal
```
Expected: `Switched to a new branch 'import/from-portal'` twice.

- [ ] **Step 4: Verify targets are empty scaffolds (no accidental overwrite risk)**

```bash
cd "/Users/eps/Desktop/Work/NEU/Summer 2026/CS7980/indigenomics-data-platform" && git ls-files
cd "/Users/eps/Desktop/Work/NEU/Summer 2026/CS7980/indigenomics-legal-cases" && git ls-files
```
Expected: only `README.md`, `ROADMAP.md`, `CONTRIBUTING.md`, `.gitignore`, and `*/README.md` stubs. No `src/`, no `package.json`.

No commit for this task (setup only).

---

## Track A — `indigenomics-data-platform` (portal minus cases)

Let `SRC="/Users/eps/Desktop/Work/NEU/Summer 2026/CS7980/portal"` and
`DP="/Users/eps/Desktop/Work/NEU/Summer 2026/CS7980/indigenomics-data-platform"` throughout Track A.

### Task A1: Copy the portal tree into `app/`

**Files:**
- Create: `$DP/app/src/**`, `$DP/app/scripts/**`, `$DP/app/package.json`, `$DP/app/next.config.mjs`, `$DP/app/tailwind.config.ts`, `$DP/app/tsconfig.json`, `$DP/app/postcss.config.mjs`, `$DP/app/.env.local.example`, `$DP/app/next-env.d.ts`, `$DP/app/.gitignore`, `$DP/app/DATA_VERIFICATION.md`, `$DP/docs/**`

**Interfaces:**
- Produces: a full (still cases-containing) copy of the portal under `$DP/app/`. Task A2 removes cases.

- [ ] **Step 1: Copy the runnable app files with excludes**

Use `rsync` with explicit excludes (the Global Constraints never-copy list):
```bash
cd "$SRC"
rsync -a \
  --exclude='.git' --exclude='node_modules' --exclude='.next' --exclude='.open-next' \
  --exclude='.sst' --exclude='tsconfig.tsbuildinfo' --exclude='.DS_Store' \
  --exclude='.env.local' --exclude='sst.config.ts' --exclude='sst-env.d.ts' \
  --exclude='docs' --exclude='pitch' --exclude='docker-compose.yml' \
  ./ "$DP/app/"
```
Expected: no output on success. `$DP/app/` now holds `src/`, `scripts/`, config files, `.env.local.example`, `DATA_VERIFICATION.md`.

- [ ] **Step 2: Copy the docs separately into `docs/` (not under `app/`)**

```bash
rsync -a --exclude='.DS_Store' "$SRC/docs/" "$DP/docs/"
```
Expected: `$DP/docs/` gains `rap-*.md`, `backend.md`, `frontend-api.md`, `deploy*.md`, `HANDOFF-stage2-bedrock.md`, `sprint1/2/3/`, `research/`, `superpowers/`, `specs/`.

- [ ] **Step 3: Verify no secrets or build junk landed**

```bash
cd "$DP"
git status --porcelain=v1 --untracked-files=all | grep -E '\.env\.local$|node_modules|\.next/|\.sst/' && echo "LEAK" || echo "clean"
```
Expected: `clean`.

- [ ] **Step 4: Commit the raw copy**

```bash
cd "$DP"
git add -A
git commit -m "chore: copy portal tree into app/ (pre-cases-removal)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Expected: one commit; `git show --stat HEAD | tail -3` shows hundreds of files added.

### Task A2: Remove the cases domain

**Files:**
- Delete: `$DP/app/src/app/cases/`, `$DP/app/src/lib/cases/`, `$DP/app/src/lib/dynamo/cases-table.ts`, `$DP/app/scripts/cases-*.ts`, `$DP/app/scripts/test-cases-*.ts`, `$DP/app/scripts/seed-cases.ts`

**Interfaces:**
- Consumes: the full copy from A1.
- Produces: an app tree with zero cases files. Task A3 trims the shell nav that still links to `/cases`.

- [ ] **Step 1: Delete cases app, lib, table, and scripts**

```bash
cd "$DP/app"
rm -rf src/app/cases src/lib/cases
rm -f src/lib/dynamo/cases-table.ts
rm -f scripts/cases-*.ts scripts/test-cases-*.ts scripts/seed-cases.ts
```
Expected: no output.

- [ ] **Step 2: Verify no surviving code imports cases**

```bash
cd "$DP/app"
grep -rn "lib/cases\|dynamo/cases-table\|\"../cases/\|'../cases/" src scripts || echo "no cases imports"
```
Expected: `no cases imports`. (If any line prints, a kept file references cases — record it; Step below resolves it.)

- [ ] **Step 3: Verify no cases test/seed scripts remain**

```bash
cd "$DP/app" && ls scripts | grep -E 'cases' && echo "LEFTOVER" || echo "clean"
```
Expected: `clean`.

- [ ] **Step 4: Commit the removal**

```bash
cd "$DP"
git add -A
git commit -m "refactor: remove cases domain (lives in indigenomics-legal-cases)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task A3: Trim the shared shell nav + verify build

**Files:**
- Modify: `$DP/app/src/app/layout.tsx` (remove the `/cases` "Legal Cases" header link)
- Modify: `$DP/app/src/app/home/page.tsx` (remove the three `/cases` LinkCards)

**Interfaces:**
- Consumes: cases-free tree from A2.
- Produces: a portal with no user-facing link to a nonexistent `/cases` route; typecheck + build pass.

- [ ] **Step 1: Remove the Legal Cases link from the root layout**

In `$DP/app/src/app/layout.tsx`, delete exactly this block:
```tsx
            <a href="/cases" className="text-ink2 hover:text-ink">
              Legal Cases
            </a>
```
Leave the `/commitments` "RAP Index" link in place.

- [ ] **Step 2: Remove the three `/cases` cards from home**

In `$DP/app/src/app/home/page.tsx`, delete the three `LinkCard` lines whose `href="/cases"` (the "Legal cases — economic justice →" cards in the indigenomics, supplier, and default branches). Leave all non-cases cards untouched.

- [ ] **Step 3: Confirm no dead `/cases` links remain**

```bash
cd "$DP/app"
grep -rn 'href="/cases\|href={`/cases\|"/cases"' src/app || echo "no /cases links"
```
Expected: `no /cases links`.

- [ ] **Step 4: Install, typecheck, build**

```bash
cd "$DP/app"
npm install
npm run typecheck
npm run build
```
Expected: `npm run typecheck` exits 0 (no TS errors); `npm run build` completes with "Compiled successfully" and a route list that includes `/commitments`, `/extract`, `/analytics` and **excludes** `/cases`. If typecheck reports a dangling cases import, fix the offending kept file (it should not exist per the domain-decoupling analysis) and re-run.

- [ ] **Step 5: Run the data-platform domain tests**

```bash
cd "$DP/app"
npx tsx scripts/test-explore-facts.ts
npx tsx scripts/test-survey-context-form.ts
npx tsx scripts/test-survey-defaults.ts
```
Expected: each prints its `OK ...` line and exits 0, output pristine.

- [ ] **Step 6: Commit**

```bash
cd "$DP"
git add -A
git commit -m "fix: trim cases links from shell; verify typecheck+build

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task A4: Populate `integrations/`, `docs/MIGRATION.md`, push, open PR

**Files:**
- Create: `$DP/integrations/README.md` (overwrite the stub — this is the migration's own scaffold dir, not a curated top-level README)
- Create: `$DP/docs/MIGRATION.md`

**Interfaces:**
- Consumes: verified app from A3.
- Produces: the delivered PR.

- [ ] **Step 1: Write `integrations/README.md`**

```markdown
# integrations/

Adapters that feed the portal's RAP Index. The seam already lives in the app at
`app/src/lib/rap-index/`:

- `facts-source.ts` — `getIndexFacts()` reads `RAP_INDEX_SOURCE` (default `commitments`)
  and returns a unified `Fact[]`. This is the cutover point for the grounded corpus.
- `commitments-to-facts.ts` — adapts the illustrative `@/lib/commitments` rows to `Fact`.

Future consumers (RAP extraction outputs, the legal-cases index) will land here as
additional adapters. Imported from `indigenomicsxyz/portal` @ <SHA>.
```
Replace `<SHA>` with the captured source SHA.

- [ ] **Step 2: Write `docs/MIGRATION.md`**

```markdown
# Migration record

Imported from `logisticPM/portal` @ <SHA> on 2026-07-08 (snapshot copy, no git history).

## What is here
- `app/` — the runnable portal: RAP Index, commitments, extraction pipeline, shell/auth.
- `integrations/` — the rap-index adapter seam (see its README).
- `docs/` — rap/portal architecture, corpus plan, extraction findings, deploy notes.

## What was intentionally excluded
- The **cases** domain → migrated to `indigenomicsxyz/indigenomics-legal-cases`.
- Deploy config (`sst.config.ts`, SST type shim) — deferred; re-author per repo before deploying.
- `node_modules`, build artifacts, and `.env.local` (secrets). Copy `app/.env.local.example`.

## Run it
    cd app && npm install && npm run typecheck && npm run build
    # dev default is mock repos/extraction; no AWS creds needed to build.
```
Replace `<SHA>`.

- [ ] **Step 3: Commit, push, open PR**

```bash
cd "$DP"
git add -A
git commit -m "docs: integrations README + migration record

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push -u origin import/from-portal
gh pr create --repo indigenomicsxyz/indigenomics-data-platform --base main --head import/from-portal \
  --title "Import portal (RAP + commitments + extraction) into app/" \
  --body "Snapshot copy from logisticPM/portal @ <SHA>. Cases excluded (own repo). Deploy config deferred. Verified: typecheck + build + domain tests pass. See docs/MIGRATION.md."
```
Expected: `gh pr create` prints the PR URL. **If `git push` returns 403, STOP and report** — do not push to a fork.

---

## Track B — `indigenomics-legal-cases` (cases slice)

Let `SRC="/Users/eps/Desktop/Work/NEU/Summer 2026/CS7980/portal"` and
`LC="/Users/eps/Desktop/Work/NEU/Summer 2026/CS7980/indigenomics-legal-cases"` throughout Track B.

### Task B1: Copy the portal tree into `portal/`

**Files:**
- Create: `$LC/portal/src/**`, `$LC/portal/scripts/**`, `$LC/portal/package.json` + config files (same set as Task A1, minus `DATA_VERIFICATION.md` which is rap-specific).

**Interfaces:**
- Produces: a full (still rap-containing) copy under `$LC/portal/`. Task B2 removes everything non-cases.

- [ ] **Step 1: Copy with excludes (also exclude DATA_VERIFICATION.md and docs)**

```bash
cd "$SRC"
rsync -a \
  --exclude='.git' --exclude='node_modules' --exclude='.next' --exclude='.open-next' \
  --exclude='.sst' --exclude='tsconfig.tsbuildinfo' --exclude='.DS_Store' \
  --exclude='.env.local' --exclude='sst.config.ts' --exclude='sst-env.d.ts' \
  --exclude='docs' --exclude='pitch' --exclude='docker-compose.yml' \
  --exclude='DATA_VERIFICATION.md' \
  ./ "$LC/portal/"
```
Expected: no output on success.

- [ ] **Step 2: Verify no secrets/junk landed**

```bash
cd "$LC"
git status --porcelain=v1 --untracked-files=all | grep -E '\.env\.local$|node_modules|\.next/|\.sst/' && echo "LEAK" || echo "clean"
```
Expected: `clean`.

- [ ] **Step 3: Commit the raw copy**

```bash
cd "$LC"
git add -A
git commit -m "chore: copy portal tree into portal/ (pre-trim)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task B2: Remove all non-cases domains

**Files:**
- Delete (app routes): `$LC/portal/src/app/{analytics,commitments,coverage,extract,my-commitments,organizations,report,s,verify,(supplier),api}`
- Delete (libs): `$LC/portal/src/lib/{rap,commitments,rap-index,survey,seed}`, `$LC/portal/src/lib/dynamo/{rap-table.ts,commitments-table.ts,survey-table.ts}`
- Delete (components): `$LC/portal/src/components/{ExtractTabs,RapIndexTabs,InstituteNav,FilterRow,SupplierNav,ScrollLink}.tsx`
- Delete (scripts): everything except `cases-*.ts`, `test-cases-*.ts`, `seed-cases.ts`, `create-table.ts`, `fetch-polyfill.ts`

**Interfaces:**
- Consumes: full copy from B1.
- Produces: a cases-only tree. Kept shell: `src/app/{cases,login,register,layout.tsx,page.tsx,globals.css,home}`, `src/lib/{cases,auth,repo,dynamo/{client,cases-table,create,single-table}}`, `src/components/{ThemeMenu,ui}.tsx`. Task B3 fixes the shell's rap-facing nav.

- [ ] **Step 1: Delete non-cases app routes**

```bash
cd "$LC/portal/src/app"
rm -rf analytics commitments coverage extract my-commitments organizations report s verify '(supplier)' api
```
Expected: no output. Surviving dirs: `cases login register home` + `layout.tsx page.tsx globals.css`.

- [ ] **Step 2: Delete non-cases libs and dynamo tables**

```bash
cd "$LC/portal/src/lib"
rm -rf rap commitments rap-index survey seed
rm -f dynamo/rap-table.ts dynamo/commitments-table.ts dynamo/survey-table.ts
```
Expected: no output. Surviving `lib/`: `cases auth.ts repo dynamo/{client.ts,cases-table.ts,create.ts,single-table.ts}`.

- [ ] **Step 3: Delete non-cases components**

```bash
cd "$LC/portal/src/components"
rm -f ExtractTabs.tsx RapIndexTabs.tsx InstituteNav.tsx FilterRow.tsx SupplierNav.tsx ScrollLink.tsx
```
Expected: surviving `components/`: `ThemeMenu.tsx ui.tsx`.

- [ ] **Step 4: Delete non-cases scripts**

```bash
cd "$LC/portal/scripts"
for f in *.ts; do
  case "$f" in
    cases-*|test-cases-*|seed-cases.ts|create-table.ts|fetch-polyfill.ts) : ;;
    *) rm -f "$f" ;;
  esac
done
ls
```
Expected: only `cases-*.ts`, `test-cases-*.ts`, `seed-cases.ts`, `create-table.ts`, `fetch-polyfill.ts` remain.

- [ ] **Step 5: Verify no surviving file imports a deleted domain**

```bash
cd "$LC/portal"
grep -rn "lib/rap\|lib/commitments\|lib/rap-index\|lib/survey\|lib/seed\|dynamo/rap-table\|dynamo/commitments-table\|dynamo/survey-table\|components/InstituteNav\|components/ExtractTabs\|components/RapIndexTabs\|components/FilterRow\|components/SupplierNav\|components/ScrollLink" src scripts || echo "no dangling domain imports"
```
Expected: `no dangling domain imports`. (Any hit is a kept file still referencing removed code — record it for B3 Step 4.)

- [ ] **Step 6: Commit the trim**

```bash
cd "$LC"
git add -A
git commit -m "refactor: remove non-cases domains (RAP/commitments/survey/shell)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task B3: Fix the shell for a cases-only app + verify build

**Files:**
- Modify: `$LC/portal/src/app/layout.tsx` (remove the `/commitments` "RAP Index" header link)
- Create (replace): `$LC/portal/src/app/home/page.tsx` (redirect to `/cases`, replacing the rap/supplier hub)

**Interfaces:**
- Consumes: cases-only tree from B2. The login flow redirects to `/home` (`src/lib/repo/actions.ts` `redirect("/home")`); keeping `/home` as a redirect to `/cases` preserves auth without a dead route.
- Produces: typecheck + build pass; no dead rap links.

- [ ] **Step 1: Remove the RAP Index link from the root layout**

In `$LC/portal/src/app/layout.tsx`, delete exactly this block:
```tsx
            <a href="/commitments" className="text-ink2 hover:text-ink">
              RAP Index
            </a>
```
Leave the `/cases` "Legal Cases" link in place.

- [ ] **Step 2: Replace `home/page.tsx` with a redirect to `/cases`**

Overwrite `$LC/portal/src/app/home/page.tsx` with exactly:
```tsx
import { redirect } from "next/navigation";

// This app is cases-only; the shared post-login hub lived at /home in the portal.
// Send authenticated users straight to the Legal Cases index.
export default function Home() {
  redirect("/cases");
}
```

- [ ] **Step 3: Confirm no dead rap links remain in kept pages**

```bash
cd "$LC/portal"
grep -rn 'href="/commitments\|href="/extract\|href="/analytics\|href="/coverage\|href="/report\|href="/verify\|href="/organizations\|href="/my-commitments' src/app || echo "no rap links"
```
Expected: `no rap links`.

- [ ] **Step 4: Install, typecheck, build**

```bash
cd "$LC/portal"
npm install
npm run typecheck
npm run build
```
Expected: typecheck exits 0; build prints "Compiled successfully" with a route list containing `/cases`, `/cases/[id]`, `/cases/briefings`, `/cases/activation`, `/cases/methodology`, `/login`, `/register`, `/home` and **no** rap routes. If typecheck flags a dangling import, fix the kept file flagged in B2 Step 5 and re-run.

- [ ] **Step 5: Run the cases domain tests**

```bash
cd "$LC/portal"
for t in scripts/test-cases-*.ts; do echo "== $t =="; npx tsx "$t" || exit 1; done
```
Expected: every `test-cases-*.ts` prints its `OK ...`/pass output and exits 0, output pristine. (These are the same suite the portal runs; any failure indicates a missing infra file — copy it from `$SRC` and re-run.)

- [ ] **Step 6: Commit**

```bash
cd "$LC"
git add -A
git commit -m "fix: cases-only shell (home→/cases, drop RAP nav); verify typecheck+build+tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task B4: Populate semantic dirs (`data/`, `evaluator/`, `architect/`) + `docs/MIGRATION.md`

**Files:**
- Create (replace stubs): `$LC/data/README.md`, `$LC/evaluator/README.md`, `$LC/architect/README.md`
- Create: `$LC/docs/MIGRATION.md`

**Interfaces:**
- Consumes: verified app from B3.
- Produces: skeleton dirs that point into the runnable code, per the "code consolidated / semantic dirs hold pointers" decision.

- [ ] **Step 1: `data/README.md`**

```markdown
# data/

Legal-case corpus + ingestion tooling. The runnable code lives under `portal/`:

- Ingestion CLIs: `portal/scripts/cases-ingest.ts`, `cases-fetch-fulltext.ts`,
  `cases-embed.ts`, `cases-index-build.ts`, `seed-cases.ts`.
- Ingestion library: `portal/src/lib/cases/ingest/`, `portal/src/lib/cases/search/`.

Corpus artifacts (provenance, fixtures) are seeded via the CLIs above.
Imported from `indigenomicsxyz/portal` @ <SHA>.
```
Replace `<SHA>`.

- [ ] **Step 2: `evaluator/README.md`**

```markdown
# evaluator/

The analysis engine — Indigenomics dimensions, precedent + deficiency detection.
Runnable code under `portal/`:

- Lenses & enrichment: `portal/src/lib/cases/lenses.ts`, `enrichment.ts`.
- Validation/eval: `portal/src/lib/cases/validate/`, `portal/scripts/cases-eval.ts`,
  `cases-validate.ts`, `cases-promote.ts`, `portal/scripts/test-cases-*.ts`.

Imported from `indigenomicsxyz/portal` @ <SHA>.
```
Replace `<SHA>`.

- [ ] **Step 3: `architect/README.md`**

```markdown
# architect/

Precedent → economic-reconciliation synthesis (briefings). Runnable code under `portal/`:

- Briefs: `portal/src/lib/cases/briefs/`, `portal/scripts/cases-summarize.ts`.
- UI: `portal/src/app/cases/briefings/`.

Imported from `indigenomicsxyz/portal` @ <SHA>.
```
Replace `<SHA>`.

- [ ] **Step 4: `docs/MIGRATION.md`**

```markdown
# Migration record

Imported from `logisticPM/portal` @ <SHA> on 2026-07-08 (snapshot copy, no git history).

## What is here
- `portal/` — the runnable cases-only Next.js app (Legal Case Index, briefings,
  activation, methodology) + shared shell (auth, account repo, theme).
- `data/`, `evaluator/`, `architect/` — README pointers into the code under `portal/`.

## What was intentionally excluded
- The **RAP / commitments / extraction** domains → they stay in
  `indigenomicsxyz/indigenomics-data-platform`.
- Deploy config (`sst.config.ts`, SST type shim) — deferred.
- `node_modules`, build artifacts, `.env.local`. Copy `portal/.env.local.example`.

## Run it
    cd portal && npm install && npm run typecheck && npm run build
    npx tsx scripts/test-cases-*.ts   # domain tests
```
Replace `<SHA>`.

- [ ] **Step 5: Commit**

```bash
cd "$LC"
git add -A
git commit -m "docs: semantic-dir pointers + migration record

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task B5: Push and open PR

**Files:** none (delivery only).

- [ ] **Step 1: Push and open PR**

```bash
cd "$LC"
git push -u origin import/from-portal
gh pr create --repo indigenomicsxyz/indigenomics-legal-cases --base main --head import/from-portal \
  --title "Import cases slice (Legal Case Index) into portal/" \
  --body "Snapshot copy from logisticPM/portal @ <SHA>. Cases-only runnable app under portal/; data//evaluator//architect/ are pointer READMEs. Deploy config deferred. Verified: typecheck + build + test-cases-* pass. See docs/MIGRATION.md."
```
Expected: PR URL printed. **If `git push` returns 403, STOP and report.**

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Snapshot copy, no history → Tasks A1/B1 (single import commits per repo). ✅
- data-platform = full portal minus cases → A1–A3. ✅
- Cases slice → legal-cases → B1–B4. ✅
- Runnable app under `app/`/`portal/` → A1/B1 target dirs; verified in A3/B3. ✅
- Semantic dirs = pointers not code → A4 `integrations/`, B4 `data/evaluator/architect/`. ✅
- Never-copy list (secrets, build junk, deploy config) → rsync excludes in A1/B1 + leak checks. ✅
- Don't overwrite curated READMEs → only `MIGRATION.md` + skeleton-dir READMEs written. ✅
- Branch + PR, no direct push → Task 0 branch, A4/B5 PRs; 403 guard. ✅
- Acceptance (typecheck + build + domain tests + no secrets) → A3/B3 steps + leak checks. ✅
- Deploy deferred (verified no `sst`/`Resource` in src) → Global Constraints + excludes. ✅

**Placeholder scan:** `<SHA>` is the one intentional token, filled from Task 0's captured value at each use site; every command and file body is concrete. No TBD/TODO. ✅

**Type/name consistency:** `SRC`/`DP`/`LC`/`SHA` defined in Task 0 and used verbatim. Kept/deleted file sets in A2/B2 match the traced dependency closure (cases ← auth + dynamo/{client,cases-table}; shell repo ← auth + dynamo/client; layout ← repo + auth + ThemeMenu). ✅

## Notes for the executor
- Tracks A and B touch different repos and can run in parallel.
- The decisive check in each track is Task A3/B3 Step 4 (`typecheck` + `build`). A green build with the delete-lists applied proves the split is complete — a leftover cross-domain import would fail to compile.
- If a `test-cases-*` script needs a runtime AWS/embedding resource and fails for that reason (not a missing-file reason), note it in the PR as environment-gated rather than copying more files.
