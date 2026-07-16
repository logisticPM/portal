# Data Classification Tag (`dataClass`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every RAP-extraction artifact carries a `dataClass: "public" | "org_submitted"` tag, decided at ingestion and defaulted conservatively, so the governance layer (spec §6) has the ground truth it needs before the first private upload.

**Architecture:** A new pure seam module `src/lib/governance/` owns the `DataClass` type and the one classification decision (`classifyUpload`). The tag is set once at upload on `ExtractionJob`, then carried through `buildCanonical` onto every entity it publishes. The RAP domain's Dynamo mapping uses `strip()` (not a whitelist), so the field round-trips with no mapping changes — the opposite of the commitments-domain trap. An idempotent backfill script ships with the schema.

**Tech Stack:** TypeScript, Next.js App Router server actions, DynamoDB (`@aws-sdk/lib-dynamodb`), `npx tsx` scripts. **No test framework** — tests are `scripts/test-*.ts` using the repo's `check(name, ok)` helper idiom.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-15-data-governance-ocap-residency-design.md` — this plan implements **§10 Phase 1 only**.
- **Tag values, exactly:** `"public" | "org_submitted"`. No other values. No `private`, no `internal`.
- **Conservative default is the whole point** (spec §3.4, §6, and the client's verbatim rule *"flag it, don't assume"*): if the ingestion path cannot **prove** an artifact is public disclosure, it is `org_submitted`. Never default to `public`. Never infer classification after the fact.
- **Pure-additive, NO infra.** No IAM, KMS, S3 tagging, bucket, or `sst.config.ts` changes in this plan. (S3 object tagging needs an `s3:PutObjectTagging` grant — that is infra, and its consumer is ABAC in Phase 3. Deferred, deliberately.)
- **`dataClass` is non-optional on the entities that carry it.** A required field forces every construction site to make the decision — an optional one lets a write path silently omit it, which is exactly the failure the tag exists to prevent.
- **No test framework.** Do NOT add vitest/jest. Tests are standalone `scripts/test-*.ts`, run with `npx tsx`, using the `check(name, ok)` helper pattern (✅/❌ per assertion, `process.exit(fail ? 1 : 0)`). Copy the shape from `scripts/test-migrate-commitment-bn.ts`.
- **Verification = ** `npm run typecheck` && `npm run build` && the new `scripts/test-*.ts` all green.
- **Domain isolation:** `src/lib/governance/` must not import from `src/lib/commitments/` or `src/lib/repo/`. It is a pure seam, like `src/lib/identity/` and `src/lib/index-evidence/`.
- Commit after each task.

## File Structure

- **Create** `src/lib/governance/types.ts` — the `DataClass` union + doc comment.
- **Create** `src/lib/governance/classify.ts` — `classifyUpload()`, the single conservative decision point. Pure.
- **Create** `src/lib/governance/index.ts` — barrel re-export.
- **Create** `scripts/test-governance-classify.ts` — resolver tests.
- **Modify** `src/lib/rap/types.ts` — add `dataClass` to `ExtractionJob`, `NewExtractionJob`, `RapOrganization`, `RapDocument`, `Commitment`, `Observation`, `CommitmentRollup`.
- **Modify** `src/lib/rap/repo.mock.ts` + `src/lib/rap/repo.dynamo.ts` — carry `dataClass` from `NewExtractionJob` onto the constructed `ExtractionJob`.
- **Modify** `src/lib/rap/actions.ts` — `uploadRapAction` calls `classifyUpload` and passes the result to `createJob`.
- **Modify** `src/lib/rap/publish.ts` — `buildCanonical` takes `dataClass` in `meta` and stamps it on every entity it builds.
- **Create** `scripts/test-rap-dataclass.ts` — job round-trip + `buildCanonical` propagation tests.
- **Create** `scripts/migrate-rap-dataclass.ts` + `scripts/test-migrate-rap-dataclass.ts` — idempotent conservative backfill.

**Not in scope (named so nobody adds them):** S3 object tagging; `ownerBN` as a separate field (`businessNumber` already exists on job + org — derive it, don't duplicate); `OrgClaim` (a grant record, not document-derived content); the commitments / legal-cases / alignment corpora (all `public`, and their tagging belongs with the Phase 2 residency work).

---

### Task 1: The `governance` seam — `DataClass` + `classifyUpload`

**Files:**
- Create: `src/lib/governance/types.ts`
- Create: `src/lib/governance/classify.ts`
- Create: `src/lib/governance/index.ts`
- Test: `scripts/test-governance-classify.ts`

**Interfaces:**
- Consumes: nothing (leaf module, pure).
- Produces: `type DataClass = "public" | "org_submitted"`; `function classifyUpload(input: ClassifyUploadInput): DataClass`; `interface ClassifyUploadInput { sessionKind: "indigenomics" | "company" | null; declaredPublic?: boolean }`.

**Design decision this task encodes (flagged for review):** classification is decided by **who uploaded**, because that is the only thing the ingestion path actually knows:
- `sessionKind === "company"` → **always** `org_submitted`. A company uploading its own RAP is submitting its own data, full stop — `declaredPublic` is ignored, because the greenwashing incentive means a company must not be able to declare its own submission public.
- `sessionKind === "indigenomics"` (staff) **and** `declaredPublic === true` → `public`. Staff curating a published disclosure is the one path that can prove public.
- Everything else — staff without an explicit declaration, `null` session, an unrecognized kind → `org_submitted`. This is "flag it, don't assume".

- [ ] **Step 1: Write the failing test**

Create `scripts/test-governance-classify.ts`:

```ts
// Tests the one conservative classification decision (spec §6).
// Run: npx tsx scripts/test-governance-classify.ts
import { classifyUpload } from "../src/lib/governance";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

// A company's own upload is ALWAYS org_submitted.
check(
  "company upload → org_submitted",
  classifyUpload({ sessionKind: "company" }) === "org_submitted",
);
check(
  "company CANNOT declare its own upload public",
  classifyUpload({ sessionKind: "company", declaredPublic: true }) === "org_submitted",
);

// Staff can prove public only by declaring it explicitly.
check(
  "staff + declaredPublic → public",
  classifyUpload({ sessionKind: "indigenomics", declaredPublic: true }) === "public",
);
check(
  "staff without declaration → org_submitted (flag it, don't assume)",
  classifyUpload({ sessionKind: "indigenomics" }) === "org_submitted",
);
check(
  "staff + declaredPublic false → org_submitted",
  classifyUpload({ sessionKind: "indigenomics", declaredPublic: false }) === "org_submitted",
);

// No session / unknown → conservative.
check(
  "null session → org_submitted",
  classifyUpload({ sessionKind: null }) === "org_submitted",
);
check(
  "null session + declaredPublic → org_submitted",
  classifyUpload({ sessionKind: null, declaredPublic: true }) === "org_submitted",
);

process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-governance-classify.ts`
Expected: FAIL — cannot resolve module `../src/lib/governance`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/governance/types.ts`:

```ts
// ===========================================================================
// Data classification (governance spec §6). The tag that decides which key
// encrypts an artifact, which IAM policy governs it, and whether it is in the
// CloudTrail audit scope.
//
//   public       — published disclosure; may be hosted anywhere (client rule).
//   org_submitted — a company's own submission; Canadian hosting + access
//                   controls (client rule). The CONSERVATIVE default.
// ===========================================================================
export type DataClass = "public" | "org_submitted";
```

Create `src/lib/governance/classify.ts`:

```ts
import type { DataClass } from "./types";

export interface ClassifyUploadInput {
  // The uploading session's kind. null ⇒ unauthenticated/unknown.
  sessionKind: "indigenomics" | "company" | null;
  // Staff-only: an explicit assertion that this document is a published
  // disclosure. Ignored for company sessions (a company must not be able to
  // declare its own submission public — the greenwashing incentive).
  declaredPublic?: boolean;
}

// The single classification decision, at ingestion (spec §6). Conservative by
// construction: only a staff session explicitly declaring a published
// disclosure yields `public`. Everything else — including a staff upload with
// no declaration — is `org_submitted`. "Flag it, don't assume."
export function classifyUpload(input: ClassifyUploadInput): DataClass {
  if (input.sessionKind === "indigenomics" && input.declaredPublic === true) {
    return "public";
  }
  return "org_submitted";
}
```

Create `src/lib/governance/index.ts`:

```ts
export type { DataClass } from "./types";
export type { ClassifyUploadInput } from "./classify";
export { classifyUpload } from "./classify";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-governance-classify.ts`
Expected: 7 ✅, exit 0.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/governance scripts/test-governance-classify.ts
git commit -m "feat(governance): add DataClass + conservative classifyUpload resolver"
```

---

### Task 2: Carry `dataClass` onto `ExtractionJob` at upload

**Files:**
- Modify: `src/lib/rap/types.ts` (`ExtractionJob`, `NewExtractionJob`)
- Modify: `src/lib/rap/repo.mock.ts` (`createJob`, ~line 63)
- Modify: `src/lib/rap/repo.dynamo.ts` (`createJob`)
- Modify: `src/lib/rap/actions.ts` (`uploadRapAction`, ~line 34-67)
- Test: `scripts/test-rap-dataclass.ts` (create; extended in Task 3)

**Interfaces:**
- Consumes: `classifyUpload`, `DataClass` from Task 1.
- Produces: `ExtractionJob.dataClass: DataClass` (required); `NewExtractionJob.dataClass: DataClass` (required).

**Context the implementer needs:**
- `src/lib/dynamo/rap-table.ts` unmarshals with `strip<T>()` (line ~102), which keeps every non-key attribute. So `dataClass` round-trips with **no change to `toJobItem`/`itemToJob`**. Do NOT add a whitelist. (The commitments domain's `itemToCommitment` *is* a whitelist — different table, not touched here.)
- `uploadRapAction` (`src/lib/rap/actions.ts:34`) already reads `const session = getSession();` at line 39 and guards `session.kind !== "indigenomics" && session.kind !== "company"` at line 40. Reuse that session — do not call `getSession()` twice.
- `createJob` is called at `actions.ts:67` as `extractionRepo.createJob({ id: docId, fileName, sourceS3Key })`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-rap-dataclass.ts`:

```ts
// dataClass threads from upload → job, and survives a Dynamo item round-trip.
// Run: npx tsx scripts/test-rap-dataclass.ts
import { toJobItem, itemToJob } from "../src/lib/dynamo/rap-table";
import type { ExtractionJob } from "../src/lib/rap/types";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const job: ExtractionJob = {
  id: "doc-1",
  fileName: "rap.pdf",
  sourceS3Key: "uploads/doc-1/rap.pdf",
  status: "PENDING",
  schemaVersion: "test",
  engine: null,
  classification: null,
  extracted: null,
  validationIssues: [],
  verdicts: [],
  reviewedBy: null,
  reviewNote: null,
  rapId: null,
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
  businessNumber: null,
  businessNumberSource: null,
  registryLegalName: null,
  registryStatus: null,
  dataClass: "org_submitted",
};

// The trap this guards: a mapping that silently drops the field on read.
const roundTripped = itemToJob(toJobItem(job));
check("dataClass survives the Dynamo item round-trip", roundTripped.dataClass === "org_submitted");

const publicJob = itemToJob(toJobItem({ ...job, dataClass: "public" }));
check("public dataClass round-trips too", publicJob.dataClass === "public");

process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-rap-dataclass.ts`
Expected: FAIL — TypeScript error, `dataClass` does not exist on `ExtractionJob`.

- [ ] **Step 3: Add the field to the types**

In `src/lib/rap/types.ts`, add this import at the top (with the other imports):

```ts
import type { DataClass } from "../governance";
```

In `interface ExtractionJob`, add after `registryStatus: string | null;`:

```ts
  // --- governance (spec §6): set once at ingestion, never inferred later ---
  dataClass: DataClass;
```

In `interface NewExtractionJob`, add after `sourceS3Key: string;`:

```ts
  dataClass: DataClass; // decided by classifyUpload() at the upload action
```

- [ ] **Step 4: Carry it through both repos**

In `src/lib/rap/repo.mock.ts` `createJob` (~line 63), add to the constructed `ExtractionJob` object literal:

```ts
      dataClass: input.dataClass,
```

Do the same in `src/lib/rap/repo.dynamo.ts` `createJob` — find where it builds the `ExtractionJob` from `input` and add the identical line.

- [ ] **Step 5: Wire the upload action**

In `src/lib/rap/actions.ts`, add to the imports:

```ts
import { classifyUpload } from "@/lib/governance";
```

Change the `createJob` call (~line 67) from:

```ts
  const job = await extractionRepo.createJob({ id: docId, fileName, sourceS3Key });
```

to:

```ts
  // Governance (spec §6): classify at ingestion, conservatively. A company's
  // own upload is always org_submitted; staff uploads are too unless the
  // document is explicitly declared a published disclosure.
  const dataClass = classifyUpload({
    sessionKind: session.kind,
    declaredPublic: formData.get("declaredPublic") === "on",
  });
  const job = await extractionRepo.createJob({ id: docId, fileName, sourceS3Key, dataClass });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx scripts/test-rap-dataclass.ts`
Expected: 2 ✅, exit 0.

- [ ] **Step 7: Typecheck and commit**

`npm run typecheck` will surface every other construction site of `ExtractionJob`/`NewExtractionJob` that now needs the field (fixtures, tests, seed scripts). Fix each by adding `dataClass: "org_submitted"` — the conservative default — unless the site is unambiguously seeding curated public research data (`src/lib/rap/real-fixtures.ts`), which takes `dataClass: "public"`.

```bash
npm run typecheck
git add -A
git commit -m "feat(governance): classify RAP uploads at ingestion (ExtractionJob.dataClass)"
```

---

### Task 3: Propagate `dataClass` through `buildCanonical` to the published graph

**Files:**
- Modify: `src/lib/rap/types.ts` (`RapOrganization`, `RapDocument`, `Commitment`, `Observation`, `CommitmentRollup`)
- Modify: `src/lib/rap/publish.ts` (`buildCanonical`, line ~172)
- Modify: `src/lib/rap/actions.ts` (the confirm/publish call site that invokes `buildCanonical`)
- Test: `scripts/test-rap-dataclass.ts` (extend)

**Interfaces:**
- Consumes: `DataClass`; `ExtractionJob.dataClass` from Task 2.
- Produces: `dataClass: DataClass` (required) on `RapOrganization`, `RapDocument`, `Commitment`, `Observation`, `CommitmentRollup`; `buildCanonical`'s `meta` gains a required `dataClass: DataClass`.

**Context the implementer needs:**
- `buildCanonical` (`src/lib/rap/publish.ts:172`) is a **pure** function: `(extracted, ids, meta) => PublishResult` where `PublishResult = { org, rap, commitments, observations, rollups }`. Keep it pure — the tag arrives via `meta`, it is not read from a session or env inside.
- The tag on the published graph must come from **the job that produced it** (`job.dataClass`), never be re-derived. Re-deriving at publish time would let a reclassification silently diverge from what the uploader was told.
- `meta.dataClass` is **required**, not defaulted. `buildCanonical` has a `claimBasis?` optional with a `?? "self_reported"` default at line 191 — do NOT copy that pattern here. A defaulted classification is a silent classification.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-rap-dataclass.ts`, before the `process.exit` line:

```ts
// --- buildCanonical propagation ---
import { buildCanonical } from "../src/lib/rap/publish";
import type { ExtractedRap } from "../src/lib/rap/types";

const g = <T>(value: T) => ({ value, confidence: 1, quote: "q", page: 1 });

const extracted = {
  orgName: g("Acme Ltd"),
  sector: g("other"),
  jurisdiction: g("CA"),
  rapTitle: g("Acme RAP"),
  rapType: g("reflect"),
  publicationDate: g("2026-01-01"),
  periodCovered: g({ start: "2026-01-01", end: "2026-12-31" }),
  commitments: [
    {
      pillarNormalized: "other",
      commitmentType: g("other"),
      action: g("Do the thing"),
      deliverable: g("A thing"),
      targetText: g("10%"),
      dueDate: g("2026-12-31"),
      owner: g("Someone"),
    },
  ],
} as unknown as ExtractedRap;

const built = buildCanonical(
  extracted,
  { orgId: "org-1", rapId: "rap-1", commitId: (i) => `commit-${i}` },
  {
    sourceS3Key: "uploads/doc-1/rap.pdf",
    extractionId: "doc-1",
    now: "2026-07-16T00:00:00.000Z",
    reviewedBy: "system:auto",
    dataClass: "org_submitted",
  },
);

check("org carries dataClass", built.org.dataClass === "org_submitted");
check("rap document carries dataClass", built.rap.dataClass === "org_submitted");
check("every commitment carries dataClass", built.commitments.every((c) => c.dataClass === "org_submitted"));
check("every observation carries dataClass", built.observations.every((o) => o.dataClass === "org_submitted"));
check("every rollup carries dataClass", built.rollups.every((r) => r.dataClass === "org_submitted"));

const builtPublic = buildCanonical(
  extracted,
  { orgId: "org-2", rapId: "rap-2", commitId: (i) => `commit-${i}` },
  {
    sourceS3Key: "uploads/doc-2/rap.pdf",
    extractionId: "doc-2",
    now: "2026-07-16T00:00:00.000Z",
    reviewedBy: "system:auto",
    dataClass: "public",
  },
);
check("a public job publishes a public graph", builtPublic.rap.dataClass === "public");
check("public propagates to commitments", builtPublic.commitments.every((c) => c.dataClass === "public"));
```

Move the two `import` lines to the top of the file with the others (TypeScript hoists them, but keep the file tidy).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-rap-dataclass.ts`
Expected: FAIL — `dataClass` does not exist in the `meta` type / on `RapDocument`.

- [ ] **Step 3: Add the field to the five entity types**

In `src/lib/rap/types.ts`, add `dataClass: DataClass;` as the last field of each of these interfaces: `RapOrganization`, `RapDocument`, `Commitment`, `Observation`, `CommitmentRollup`. Add this comment above the field in `RapDocument` only (the others inherit the explanation):

```ts
  // governance (spec §6) — inherited from the ExtractionJob that produced this
  // graph; never re-derived at publish time.
  dataClass: DataClass;
```

- [ ] **Step 4: Thread it through `buildCanonical`**

In `src/lib/rap/publish.ts`, add to the `meta` parameter type (after `reviewedBy: string | null;`):

```ts
    dataClass: DataClass; // REQUIRED — from the job. Never defaulted (spec §6).
```

Add the import:

```ts
import type { DataClass } from "../governance";
```

Then add `dataClass: meta.dataClass,` to each object literal `buildCanonical` constructs: `org`, `rap`, each pushed `commitments` entry, each pushed `observations` entry, and each pushed `rollups` entry.

- [ ] **Step 5: Pass the job's class at the call site**

In `src/lib/rap/actions.ts`, find the `buildCanonical(...)` call in the confirm/publish path and add to its `meta` argument:

```ts
      dataClass: job.dataClass,
```

where `job` is the `ExtractionJob` already loaded in that action. If the publish path lives in `src/lib/rap/publish.ts`'s caller rather than `actions.ts`, thread it from the job there — the rule is that the value comes from the job, not from the session.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx scripts/test-rap-dataclass.ts`
Expected: 9 ✅ total, exit 0.

- [ ] **Step 7: Typecheck, build, commit**

```bash
npm run typecheck
npm run build
git add -A
git commit -m "feat(governance): propagate dataClass from job to the published RAP graph"
```

---

### Task 4: Idempotent backfill for existing RapData rows

**Files:**
- Create: `scripts/migrate-rap-dataclass.ts`
- Test: `scripts/test-migrate-rap-dataclass.ts`

**Interfaces:**
- Consumes: `DataClass` from Task 1.
- Produces: `export function planRapDataClass(item: Record<string, any>): DataClass | null` — returns the class to write, or `null` if the row already has one (idempotence).

**Context the implementer needs:**
- **Read `scripts/migrate-commitment-bn.ts` first and follow its shape exactly** — it is the house pattern for this: a pure `plan*` function (unit-testable, no AWS), a `main()` that scans + writes, and a `main()` guard.
- **The `main()` guard bit us before.** `migrate-commitment-bn.ts` originally guarded with `.includes("migrate-commitment-bn")`, which also matched `test-migrate-commitment-bn.ts` — so the test run executed the migration. Anchor it: `process.argv[1]?.endsWith("/migrate-rap-dataclass.ts")`.
- **Use the right table.** This migration targets **RapData**, so resolve `process.env.RAP_TABLE`. (The BN migration's original bug was reading the wrong table env var.) Do not hardcode a prod table name.
- Prod's RapData table is currently **empty** (spec §4), so this is expected to be a no-op against prod today. It ships anyway — the ccib lesson is that the migration ships **with** the schema, not after someone notices untagged rows.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-migrate-rap-dataclass.ts`:

```ts
// Run: npx tsx scripts/test-migrate-rap-dataclass.ts
import { planRapDataClass } from "./migrate-rap-dataclass";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

check(
  "an untagged row backfills conservatively to org_submitted",
  planRapDataClass({ PK: "RAP#1", SK: "META" }) === "org_submitted",
);
check(
  "an already-tagged org_submitted row is left alone (idempotent)",
  planRapDataClass({ PK: "RAP#1", SK: "META", dataClass: "org_submitted" }) === null,
);
check(
  "an already-tagged public row is NOT downgraded",
  planRapDataClass({ PK: "RAP#2", SK: "META", dataClass: "public" }) === null,
);
check(
  "a garbage dataClass value is re-tagged conservatively",
  planRapDataClass({ PK: "RAP#3", SK: "META", dataClass: "banana" }) === "org_submitted",
);

process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-migrate-rap-dataclass.ts`
Expected: FAIL — cannot resolve `./migrate-rap-dataclass`.

- [ ] **Step 3: Write the migration**

Create `scripts/migrate-rap-dataclass.ts`:

```ts
// ===========================================================================
// Backfill `dataClass` onto pre-governance RapData rows (spec §6, Phase 1).
//
// Conservative by construction: an untagged row cannot prove it is public
// disclosure, so it becomes `org_submitted`. Already-tagged rows are never
// touched — a `public` row is NOT downgraded, and a re-run is a no-op.
//
//   RAP_TABLE=<table> AWS_PROFILE=<profile> npx tsx scripts/migrate-rap-dataclass.ts
// ===========================================================================
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import type { DataClass } from "../src/lib/governance";

const VALID: DataClass[] = ["public", "org_submitted"];

// Pure + testable: what class should this row get, or null to leave it alone?
export function planRapDataClass(item: Record<string, any>): DataClass | null {
  if (VALID.includes(item.dataClass)) return null; // already classified — idempotent
  return "org_submitted"; // untagged or invalid ⇒ conservative default
}

async function main() {
  const table = process.env.RAP_TABLE;
  if (!table) throw new Error("RAP_TABLE not set");

  let startKey: Record<string, any> | undefined;
  let scanned = 0;
  let updated = 0;

  do {
    const res: any = await ddbDoc.send(
      new ScanCommand({ TableName: table, ExclusiveStartKey: startKey }),
    );
    for (const item of res.Items ?? []) {
      scanned++;
      const next = planRapDataClass(item);
      if (!next) continue;
      await ddbDoc.send(
        new UpdateCommand({
          TableName: table,
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression: "SET dataClass = :d",
          ExpressionAttributeValues: { ":d": next },
        }),
      );
      updated++;
    }
    startKey = res.LastEvaluatedKey;
  } while (startKey);

  console.log(`scanned ${scanned} rows, tagged ${updated}`);
}

// Anchored so `test-migrate-rap-dataclass.ts` importing this file does NOT run it.
if (process.argv[1]?.endsWith("/migrate-rap-dataclass.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-migrate-rap-dataclass.ts`
Expected: 4 ✅, exit 0. **Confirm the migration did not run** — no `scanned N rows` line in the output.

- [ ] **Step 5: Run the full verification and commit**

```bash
npm run typecheck
npm run build
npx tsx scripts/test-governance-classify.ts
npx tsx scripts/test-rap-dataclass.ts
npx tsx scripts/test-migrate-rap-dataclass.ts
git add scripts/migrate-rap-dataclass.ts scripts/test-migrate-rap-dataclass.ts
git commit -m "feat(governance): idempotent dataClass backfill for RapData"
```

---

## Open questions for the team (surface in the PR, do not block the build)

1. **Staff uploads default to `org_submitted`.** That is the conservative reading of "flag it, don't assume", but it means today's staff research uploads get tagged private until someone adds the `declaredPublic` control to the `/extract` UI. Task 2 wires the form field (`declaredPublic`); **adding the actual checkbox to the staff upload form is deliberately not in this plan** — it is a UI decision for the team, and the conservative default is safe without it.
2. **`ownerBN` is derived, not stored.** Spec §5 (Ownership) pairs `dataClass` with an owner BN; `businessNumber` already exists on `ExtractionJob` and `RapOrganization`, so this plan does not duplicate it. If Phase 3's ABAC needs a literal `ownerBN` resource tag, it comes from there.
3. **No S3 object tag yet** (see Global Constraints). Phase 1 classifies the *records*; classifying the *objects* needs an IAM change and lands with Phase 2/3.
