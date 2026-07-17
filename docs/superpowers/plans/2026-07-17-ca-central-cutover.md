# ca-central-1 Cutover (Residency Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan is a hybrid.** Tasks 1–3 are ordinary test-first code and are executed like any other plan. Tasks 4–8 are a **live-AWS runbook**: they mutate a real account, cannot be unit-tested, and contain **human gates** (a person must decide/approve before proceeding). A subagent MUST stop at each `⛔ GATE` and hand back to the operator — it may not self-approve a gate.

**Goal:** Make the `ca` stage (ca-central-1) the real production deployment of the RAP platform — all platform data hosted in Canada behind a stable custom domain — while the legal-cases domain stays in us-east-1, per the residency spec.

**Architecture:** One SST (Ion/Pulumi) app, region-overridable via `SST_AWS_REGION`. The `ca` stage deploys every platform resource (DataPortal, RapData, RapSurvey, Commitments, Alignment tables + uploads/exports/analytics buckets + the Next.js origin) to ca-central-1. Legal cases (`LegalCases` table, Titan vectors, briefing model) stay pinned to us-east-1 by the explicit ARNs already in `sst.config.ts`. A custom domain is added **before** cutover so the public URL stops being load-bearing. Real public platform data is copied us-east-1 → ca-central-1 with a verify pass; the stale pre-#145 `ca` fixtures are discarded.

**Tech Stack:** SST v3 (Ion, Pulumi-backed) · AWS DynamoDB / S3 / CloudFront / ACM / Route 53 (or external DNS) · TypeScript · `@aws-sdk/client-dynamodb` + `lib-dynamodb` · `tsx` test scripts with a `check(name, ok)` helper (no test framework).

## Global Constraints

- **The residency boundary is the DOMAIN, not the data class** (spec §4). Everything in the RAP *platform* domain moves to ca-central-1: DataPortal, RapData, RapSurvey, **Commitments, Alignment**, and the uploads/exports/analytics buckets. **Legal cases does NOT move** — its `LegalCases` table, Titan v2 vectors, `EMBED_REGION`, and briefing model stay us-east-1 (spec §4; verified there is no re-embed-free way to move its ~43k-vector corpus).
- **Legal cases must keep working after cutover.** `/cases` runs in the ca origin Lambda but reaches back to the `LegalCases` table + Bedrock in us-east-1 via the explicit ARNs in `sst.config.ts:224-248`. Do NOT let those inherit the platform's ca-central-1 region. A cutover that breaks `/cases` is a failed cutover.
- **Custom domain FIRST** (spec §10 Phase 2 note). The public URL `d1hwn8hhp1ytc0.cloudfront.net` is cited in `DATA_VERIFICATION.md`, sprint hand-ins, and showcase materials. Add a stable custom domain and cut over behind it so the URL never changes again.
- **Legal cases seeding stays us-east-1.** The `cases:*:cloud` npm scripts already pin `AWS_REGION=us-east-1` and target the literal `LegalCases` table — correct under the split. Do NOT region-parameterize them.
- **No test framework.** Tests are `scripts/test-*.ts` run via `npx tsx`, using a local `check(name, ok)` helper. Do NOT add vitest/jest.
- **Verification of code tasks** = `npm run typecheck` (check the REAL exit code — do not pipe through `tail`) && `npm run build` && the task's `scripts/test-*.ts`.
- **Commit after each task.**
- **Never delete or overwrite a us-east-1 production table until the ca parity gate (Task 6) has passed and the operator has approved teardown (Task 8).** Migration is copy-then-verify, never move.

## Execution decisions (locked 2026-07-17 by Nate)

- **No custom domain.** The public URL is not important for the showcase, so accept the new
  CloudFront URL the ca stack generates and update the handful of references (Task 7). **Task 2
  (custom domain) is DROPPED**, and the ACM-cert-in-us-east-1 gotcha no longer applies.
- **Keep the us-east-1 platform stack ALIVE — do not tear it down.** It serves the old URL + old
  data as a backup we may revisit. **Task 8 (teardown) is DEFERRED indefinitely.** The migration is
  therefore a pure COPY: us-east-1 stays intact, ca becomes the working deployment alongside it.
  This is the safest shape — the 117 real user accounts are never at risk from the cutover.

## Decisions this plan rides on (from spec §11 — recommended defaults, confirm before Task 4)

These are the spec's own recommendations; the plan assumes them. If the team disagrees, revisit before the runbook.

- **§11.6 Region SCP → convention only.** No org-level Service Control Policy. Residency is enforced by deploy-time region config, not an unconditional deny. (Rationale: the unconditional deny is incompatible with keeping legal cases in us-east-1, and AWS Organizations management access is unverified.) *If the team wants a real SCP, that is separate work — see spec §11.6 options (a)/(b).*
- **§11.1 / §11.4 Extraction → all-Option-B in ca.** Private (`org_submitted`) uploads can only use Option B (BDA cannot process Canadian-resident data — §11.4, resolved). Public docs *may* still use BDA, but that is a follow-up (spec Phase 5), not part of this cutover.
- **§11.5 Residency bar → hosting (data at rest), not inference.** The design already satisfies this; no self-hosted-model work in scope.

## What the us-east-1 platform data actually is (inspected live 2026-07-17 — read-only)

This is the migrate-vs-reseed answer, and it raised the stakes. **All four platform tables hold real production data. None are reseedable fixtures.**

| Table | Items | What it is | Sensitivity |
|---|---|---|---|
| **DataPortal** | 167 | The **live application database**: `User` (117 — with `email` + `passwordHash`), `Line`/`Conf` (supplier-flow reporting ledger), `Party` (company/supplier profiles, some `profilePublic`). | **Real users + credentials + PII.** Mixed public/private. This is exactly the `org_submitted`-class data the residency rule exists for — strongly reinforces ca. |
| **Commitments** | 106 | Real commitments corpus (`Commitment` items). Public. | Public, real. |
| **Alignment** | 82 | `Opportunity` rows the AlignmentEngine computed. Derived. | Public, real. |
| **RapSurvey** | 4 | 2 `Org` + 2 `Response`. Real survey data. | Real. |

**Consequences for this plan (folded into the tasks below):**
1. **The cutover moves real user accounts with password hashes.** Migration is sensitive-data movement (TLS in transit — SDK default; **KMS/SSE-KMS at rest is NOT optional for DataPortal** — it graduates from Task 4 Step 3's gate to a requirement). The migration script must **never log item bodies** — counts and keys only.
2. **The taxonomy-rot guard (Task 1) is mis-scoped as first drafted.** `Party` carries a free-text `sector` *and* a normalized `sectorNorm`; the RAP canonical taxonomy applies to RAP-commitment sectors, not questionnaire party descriptions. The guard must run ONLY on RAP-commitment sector fields (RapData `COMMIT` items and the Commitments table), never blanket on any attribute named `sector` — otherwise it false-flags all 167 DataPortal rows.
3. **Teardown (Task 8) deletes real user accounts from us-east-1.** The parity gate is now load-bearing for user data, not demo data — treat the final gate accordingly, and consider a maintenance window / read-only announcement for the cutover moment.
4. RapData: us-east-1 holds 0; the `ca` stage holds 68 **stale pre-#145 fixtures** (`finance_banking` etc.) — discard those, do not migrate them.

## Prerequisites (do before Task 4; Tasks 1–3 need none of this)

1. **A domain you control** for the custom URL (e.g. `rap.indigenomics.xyz`). Decide the exact hostname and whether DNS is Route 53 (SST can manage cert + records) or external (you'll add a CNAME + validate an ACM cert manually). **This is a human input — the plan cannot invent it.**
2. **AWS access re-auth.** `aws sso login --profile isb` — the session token expires; every runbook step assumes a fresh token.
3. **Confirm the current us-east-1 platform data is what should move.** The operator stated Commitments is real-but-public. Task 5 verifies each table's content and taxonomy conformance before trusting it.

---

## Task 1: Cross-region table-copy + verify script

**Files:**
- Create: `scripts/migrate-table-region.ts`
- Test: `scripts/test-migrate-table-region.ts`

**Interfaces:**
- Consumes: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb` (already deps).
- Produces: `copyTable(opts): Promise<MigrationReport>` and `verifyParity(opts): Promise<ParityReport>`, both **exported and pure of any hardcoded region/table** (every endpoint/region/table is a parameter, so both are testable against DynamoDB Local acting as source AND dest).
  - `interface MigrationReport { scanned: number; written: number; skippedInvalidTaxonomy: string[] }`
  - `interface ParityReport { sourceCount: number; destCount: number; match: boolean; missingKeys: string[] }`

**Context:** the seed scripts (`scripts/seed.ts`) are already env-parameterized (`AWS_REGION`, `DYNAMO_TABLE`) but only *create fixtures*. The cutover moves **real** data (incl. DataPortal's user accounts + password hashes — see the data-inventory section above), so it needs copy-then-verify, not reseed. `src/lib/dynamo/client.ts:18-26` shows the region/endpoint/creds pattern to mirror.

**Two guards this script must get right:**
- **Never log item bodies.** DataPortal holds `email` + `passwordHash`. Reports carry counts and keys (`PK`/`SK`) only — never a scanned item's attributes.
- **Taxonomy-rot flag, correctly scoped.** The stale `ca` RapData held `finance_banking`/`mining_extractive`, NOT in `CANONICAL_SECTORS` (`@/lib/taxonomy`) post-#145. The guard flags a non-canonical sector ONLY on RAP-commitment items (RapData `et === "Commitment"` / the Commitments table), because `Party` rows in DataPortal legitimately carry free-text `sector` values that were never meant to be canonical. A guard that flags any attribute named `sector` false-flags all 167 DataPortal rows — pass the guard a predicate (`shouldCheckTaxonomy(item): boolean`) rather than hardcoding the attribute name.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-migrate-table-region.ts`. It runs entirely against DynamoDB Local (two tables standing in for two regions), so it needs Docker up (`npm run ddb:up`) — the test prints a clear skip line if `DYNAMO_ENDPOINT` is unreachable rather than failing spuriously.

```ts
// Run: npm run ddb:up && DYNAMO_ENDPOINT=http://localhost:8000 npx tsx scripts/test-migrate-table-region.ts
import { CreateTableCommand, DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { copyTable, verifyParity } from "./migrate-table-region";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const ENDPOINT = process.env.DYNAMO_ENDPOINT ?? "http://localhost:8000";
const raw = new DynamoDBClient({ endpoint: ENDPOINT, region: "local", credentials: { accessKeyId: "l", secretAccessKey: "l" } });
const doc = DynamoDBDocumentClient.from(raw);
const SRC = "MigSrc";
const DST = "MigDst";

async function makeTable(name: string) {
  await raw.send(new DeleteTableCommand({ TableName: name })).catch(() => {});
  await raw.send(new CreateTableCommand({
    TableName: name,
    AttributeDefinitions: [{ AttributeName: "PK", AttributeType: "S" }, { AttributeName: "SK", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "PK", KeyType: "HASH" }, { AttributeName: "SK", KeyType: "RANGE" }],
    BillingMode: "PAY_PER_REQUEST",
  }));
}

async function main() {
  await makeTable(SRC);
  await makeTable(DST);
  await doc.send(new PutCommand({ TableName: SRC, Item: { PK: "ORG#1", SK: "META", sector: "finance" } }));
  await doc.send(new PutCommand({ TableName: SRC, Item: { PK: "ORG#2", SK: "META", sector: "finance_banking" } })); // stale, non-canonical
  await doc.send(new PutCommand({ TableName: SRC, Item: { PK: "ORG#3", SK: "META" } })); // no sector — fine

  const opts = { endpoint: ENDPOINT, region: "local", srcTable: SRC, destTable: DST };
  const rep = await copyTable(opts);
  check("copies every source item", rep.written === 3);
  check("scans every source item", rep.scanned === 3);
  check("flags the non-canonical sector row (does not silently carry it)", rep.skippedInvalidTaxonomy.length === 1 && rep.skippedInvalidTaxonomy[0].includes("ORG#2"));

  const parity = await verifyParity(opts);
  check("parity: dest count equals source count", parity.destCount === parity.sourceCount);
  check("parity: match is true when counts agree and no key missing", parity.match === true);
  check("parity: no missing keys after a full copy", parity.missingKeys.length === 0);

  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it and confirm it fails**

`npm run ddb:up && DYNAMO_ENDPOINT=http://localhost:8000 npx tsx scripts/test-migrate-table-region.ts` → FAIL, cannot resolve `./migrate-table-region`.

- [ ] **Step 3: Implement `scripts/migrate-table-region.ts`**

Requirements (all covered by the test):
- `copyTable({ endpoint?, region, srcTable, destTable })`: paginated `ScanCommand` over `srcTable`; `BatchWriteCommand` (≤25/batch) into `destTable`; return `{ scanned, written, skippedInvalidTaxonomy }`. A row whose `sector` attribute is present and **not** in `CANONICAL_SECTORS` (import from `@/lib/taxonomy`) is STILL copied (data is data), but its key is pushed to `skippedInvalidTaxonomy` so the operator sees rot before trusting the migration. (Naming: the field records "flagged", not "skipped from the write" — the item is written; keep the field name but document this in a comment, or rename to `flaggedNonCanonical`. Pick one and keep it consistent with the test.)
- `verifyParity(...)`: `Select: "COUNT"` scan on both tables; collect all `{PK,SK}` keys from source, confirm each exists in dest (`GetCommand`); return `{ sourceCount, destCount, match, missingKeys }` where `match = sourceCount === destCount && missingKeys.length === 0`.
- Client construction mirrors `src/lib/dynamo/client.ts`: `endpoint` present → DynamoDB Local dummy creds; absent → real AWS via the credential chain and the given `region`.
- A thin CLI entrypoint (`if (import.meta.url === ...)` guard is unavailable under CJS — instead gate on `process.env.MIGRATE_CLI === "1"`) that reads `SRC_REGION`, `SRC_TABLE`, `DEST_REGION`, `DEST_TABLE` and runs copy then verify, printing both reports. Cross-region real runs use two clients (source region ≠ dest region), so accept `srcRegion`/`destRegion` as distinct params in the CLI even though the local test uses one endpoint for both.

> Decide up front: the test uses one `region`/`endpoint` for both tables (local). Real runs need `srcRegion` ≠ `destRegion`. Implement `copyTable`/`verifyParity` to take **separate** `src`/`dest` connection params, and have the local test pass the same values for both. Adjust the test's `opts` to `{ src: {endpoint, region, table}, dest: {endpoint, region, table} }` shape if that reads cleaner — keep test and impl in sync.

- [ ] **Step 4: Run it and confirm it passes** → 6 ✅, exit 0.

- [ ] **Step 5: Typecheck (real exit code) and commit**

```bash
npm run typecheck; echo "typecheck exit=$?"
git add scripts/migrate-table-region.ts scripts/test-migrate-table-region.ts
git commit -m "feat(migrate): cross-region DynamoDB copy + parity verify, with taxonomy-rot flagging"
```

---

## Task 2: Add a stable custom domain to the SST web origin

**Files:**
- Modify: `sst.config.ts` (the `new sst.aws.Nextjs("Web", {...})` block, ~line 276)

**Interfaces:**
- Consumes: an operator-supplied hostname (Prerequisite 1) and its DNS mode.
- Produces: a `domain` config on the `Web` component so the `ca` stage serves the stable hostname.

**Context:** `sst.config.ts:276` is `new sst.aws.Nextjs("Web", {...})` with **no** `domain:` today, which is exactly why a region cutover changes the public URL. SST's `domain` accepts `{ name, dns }` (Route 53) or `{ name, cert }` (external DNS + a pre-validated ACM cert). This is config, not runtime code — its "test" is `sst diff` showing the domain added with no unintended resource churn.

- [ ] **Step 1: Add the domain config, stage-gated**

Only the `ca` (production) stage should claim the real hostname; dev stages keep the generated URL. Example (Route 53 form — adjust to the operator's DNS choice):

```ts
new sst.aws.Nextjs("Web", {
  // ...existing config...
  domain: $app.stage === "ca"
    ? { name: process.env.WEB_DOMAIN!, dns: sst.aws.dns() } // e.g. WEB_DOMAIN=rap.indigenomics.xyz
    : undefined,
});
```

If DNS is external (not Route 53), use `{ name: process.env.WEB_DOMAIN!, cert: process.env.WEB_CERT_ARN! }` and document that the operator must create + validate the ACM cert in **us-east-1** (CloudFront requires certs in us-east-1 regardless of the origin region — this is a real gotcha; the cert is NOT in ca-central-1).

- [ ] **Step 2: Typecheck the config**

Run: `npm run typecheck; echo "typecheck exit=$?"` → 0. (`sst.config.ts` is type-checked with the app.)

- [ ] **Step 3: Commit** (no deploy yet — deploy is Task 4)

```bash
git add sst.config.ts
git commit -m "feat(infra): stable custom domain on the ca web origin (URL stops being load-bearing)"
```

---

## Task 3: `ca` seeding + migration npm scripts (fixtures for empty tables, migration for real ones)

**Files:**
- Modify: `package.json` (scripts block)

**Interfaces:**
- Produces: `ca:*` npm scripts that target ca-central-1 with the SST-generated table names resolved at run time.

**Context:** the underlying `scripts/seed*.ts` are already env-parameterized; the gap is convenience wiring for the `ca` stage and resolving the SST-generated physical names (e.g. `indigenomics-portal-ca-DataPortalTable-bddkwbku`), which are only known after deploy. Rather than hardcode a random suffix, resolve it from SST outputs at run time.

- [ ] **Step 1: Add a name-resolver helper invocation**

SST exposes resource names via `sst shell` (which injects the linked resource env). The simplest robust pattern is to wrap the seed/migrate command in `sst shell --stage ca -- <cmd>` so `Resource.DataPortal.name` etc. are available, OR resolve names once via `aws dynamodb list-tables --region ca-central-1` filtered by the `indigenomics-portal-ca-` prefix and pass them in. Add scripts of the form:

```jsonc
// package.json "scripts"
"ca:tables":    "AWS_REGION=ca-central-1 tsx scripts/list-ca-tables.ts",           // prints resolved SST names
"ca:migrate":   "tsx scripts/migrate-all-platform-tables.ts",                       // orchestrates Task 1's copyTable per table, us-east-1 -> ca
"ca:verify":    "tsx scripts/migrate-all-platform-tables.ts --verify-only"
```

`scripts/list-ca-tables.ts` and `scripts/migrate-all-platform-tables.ts` are thin orchestrators over Task 1's exported functions and the AWS SDK's `ListTablesCommand`; they contain no new logic worth its own TDD task — fold their creation into this task. `migrate-all-platform-tables.ts` maps each us-east-1 production table to its ca counterpart (resolved by the shared logical stem: `DataPortal`, `RapData`, `RapSurvey`, `Commitments`, `Alignment`) and runs `copyTable` then `verifyParity`, printing a per-table report. It must **refuse to touch `LegalCases`** (assert the name never matches) — legal cases does not move.

- [ ] **Step 2: Typecheck and commit** (these run live in Task 5; here we only wire + typecheck)

```bash
npm run typecheck; echo "typecheck exit=$?"
git add package.json scripts/list-ca-tables.ts scripts/migrate-all-platform-tables.ts
git commit -m "chore(ca): wire ca migration/verify npm scripts (LegalCases explicitly excluded)"
```

---

## ⛔ RUNBOOK — Tasks 4–8 mutate live AWS. Re-auth first (`aws sso login --profile isb`). Stop at every GATE.

## Task 4: Redeploy the `ca` stage with all five tables + at-rest protections

**This is a live deploy, not a code change.** The current `ca` stage is stale (missing `Commitments` + `Alignment`, holds pre-#145 fixture data).

- [ ] **Step 1: Confirm the plan's deploy assumptions against live state** (SSO must be fresh)

```bash
AWS_PROFILE=isb aws dynamodb list-tables --region ca-central-1 --output text
```
Expect the 4 stale tables. Note: SST provider-region change **replaces** resources; the existing `ca` tables carry `removal: retain` in prod, so redeploying may create NEW physical tables and orphan the old ones. That is acceptable here **because the stale data is discarded anyway** — but the operator must confirm no one is relying on the current `ca` URL/data. ⛔ **GATE:** operator confirms the stale `ca` stage is disposable.

- [ ] **Step 2: Deploy the ca stage**

```bash
WEB_DOMAIN=<chosen-host> SST_AWS_REGION=ca-central-1 AWS_PROFILE=isb npx sst deploy --stage ca
```
Verify: all five platform tables now exist in ca-central-1 (`Commitments`, `Alignment` included), plus the uploads/exports/analytics buckets, plus the custom domain resolves.

- [ ] **Step 3: Apply at-rest protections on the private uploads bucket** (spec §10 Phase 2, §7)

KMS CMK + SSE-KMS + Block Public Access + Object Lock on the RapUploads bucket. If these are expressed in `sst.config.ts` (preferred, so they are reproducible), that is a code change — fold it back into Task 2's config commit and redeploy. If applied out-of-band, document exactly what was set. ⛔ **GATE:** operator confirms whether KMS/Object Lock is in scope for THIS cutover or a follow-up (spec lists it under Phase 2 but it is separable from the region move).

- [ ] **Step 4: Verify `/cases` still reaches us-east-1** from the freshly deployed ca origin — hit the deployed `/cases` route and confirm results return (proves the us-east-1 `LegalCases` + Bedrock ARNs did NOT inherit ca-central-1). This is the single most important post-deploy check.

---

## Task 5: Migrate the real platform data us-east-1 → ca-central-1

- [ ] **Step 1: Inspect each source table's content and taxonomy** (SSO fresh)

For DataPortal, RapData, Commitments, Alignment, RapSurvey in us-east-1: sample items, confirm they are real content (not stale fixtures like the old `ca` RapData), and check `sector` values against `CANONICAL_SECTORS`. If a table is pre-#145 (`finance_banking` etc.), decide whether to migrate-then-fix or fix-at-source first. ⛔ **GATE:** operator confirms, per table, "real data → migrate" vs "fixtures → reseed instead".

- [ ] **Step 2: Run the migration**

```bash
AWS_PROFILE=isb npm run ca:migrate
```
Per table: `copyTable` (us-east-1 → ca-central-1) then `verifyParity`. The run prints, per table, `scanned/written`, `flaggedNonCanonical[]`, and `sourceCount == destCount`.

- [ ] **Step 3: Parity gate**

```bash
AWS_PROFILE=isb npm run ca:verify
```
⛔ **GATE:** every platform table must show `match: true` and an empty `missingKeys`. Any `flaggedNonCanonical` rows are surfaced to the operator to decide (fix in ca, or accept). Do NOT proceed to cutover until parity is green.

---

## Task 6: Cut the public domain over to ca + verify end-to-end

- [ ] **Step 1: Point the custom domain at the ca CloudFront distribution** (done by Task 4's deploy if Route 53; a manual CNAME + cert validation if external DNS).

- [ ] **Step 2: End-to-end smoke against the custom domain:** Explore loads and aggregates (pillars/sector charts render — this exercises the migrated Commitments/Fact data), a RAP detail page renders, `/cases` returns results (us-east-1 reach-back intact), an upload reaches the ca uploads bucket. ⛔ **GATE:** operator confirms the app is fully functional on the custom domain against ca data.

---

## Task 7: Update every reference to the old URL

**Files:**
- Modify: `DATA_VERIFICATION.md`, any showcase/hand-in docs, and repo references to `d1hwn8hhp1ytc0.cloudfront.net`.

- [ ] **Step 1: Find and replace the old URL with the custom domain**

```bash
grep -rIl "d1hwn8hhp1ytc0.cloudfront.net" . --exclude-dir=.git --exclude-dir=node_modules
```
Replace each with the custom domain. Commit.

```bash
git commit -am "docs: point all references at the stable custom domain (ca cutover)"
```

---

## Task 8: Retire the us-east-1 platform stack (NOT legal cases)

- [ ] **Step 1: ⛔ FINAL GATE — operator go/no-go.** Only after Tasks 6–7 are green for long enough that the team trusts ca. Teardown is irreversible for the us-east-1 platform tables (data already copied + verified, so this is safe, but confirm the parity reports are retained).

- [ ] **Step 2: Remove the us-east-1 platform stack while preserving legal cases.** The `production` stage's `LegalCases` table + cases buckets must survive — they are referenced by the ca origin. If the `production` SST stage bundles both platform and cases, this is NOT a blanket `sst remove --stage production`; identify and retain the cases resources (or confirm cases lives in its own stack). ⛔ **GATE:** operator confirms the teardown command's blast radius excludes `LegalCases` and cases buckets before running it.

- [ ] **Step 3: Post-teardown verification** — `/cases` on the custom domain still returns results; platform pages still work. Record the final state in `docs/rap-extraction-findings.md` or a short `docs/ca-cutover-record.md`.

---

## Self-review notes

- **Spec coverage:** §4 residency boundary (Tasks 4–5, legal-cases exclusion asserted in Tasks 3/8), §7 at-rest protections (Task 4 Step 3, gated as possibly-follow-up), §10 Phase 2 "custom domain first / replace-not-move / URL is load-bearing" (Tasks 2, 4, 7), §11.6 SCP (explicitly out of scope, convention-only). Extraction routing (§11.1/Phase 5) is deliberately **not** in this plan — it is a separate follow-up.
- **Honest gaps this plan cannot pre-fill:** the custom hostname + DNS mode (operator input), the exact SST teardown blast radius (depends on whether cases shares the `production` stack — must be checked live), and whether KMS/Object Lock rides this cutover or a follow-up (gated). These are marked as GATEs, not fabricated.
- **The one thing that most commonly breaks this cutover:** letting the us-east-1 legal-cases ARNs inherit ca-central-1. Verified explicitly in Task 4 Step 4 and Task 8 Step 3.
