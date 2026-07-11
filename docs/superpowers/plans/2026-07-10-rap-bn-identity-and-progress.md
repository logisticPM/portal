# RAP BN Identity + Company Progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Key RAP organizations on the Canadian Business Number (resolved at review against the free ISED registry), and let claimed companies append progress to their commitments — without ever silently wiping or mis-attributing that progress.

**Architecture:** BN is resolved during staff review (`verifyBN` + CBR deep-link) and becomes the org key at publish (`org-bn-<9digit>`). Progress is an append-only `Observation` layer written by a claimed company and rolled up by the existing `RollupAggregator` Lambda. Re-extraction of a RAP that already has company progress is locked (Option A).

**Tech Stack:** Next.js App Router (RSC + server actions), DynamoDB (`@aws-sdk/lib-dynamodb`), SST v3, `tsx scripts/*.ts` + `node:assert/strict` (no jest/vitest), `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-07-10-rap-bn-identity-and-progress-design.md`

## Global Constraints

- **Tests:** standalone `tsx scripts/test-*.ts` with `import assert from "node:assert/strict"`; run mock repo (`REPO_IMPL` unset) + `StubRegistryProvider` (no AWS/ISED network). Each test ends with a `console.log("OK ...")`.
- **Repos come in pairs:** every `RapRepo`/`ExtractionRepo` interface change in `src/lib/rap/types.ts` MUST be implemented in BOTH `src/lib/rap/repo.mock.ts` AND `src/lib/rap/repo.dynamo.ts`.
- **Additive types only:** new fields are nullable/optional; do not break existing rows (prod `RapData` is empty, but keep it clean).
- **Grounded fields are immutable to companies.** Progress never edits action/deliverable/target/quote.
- **BN org key = 9-digit root** (strip program suffix like `RC0001`).
- `npm run typecheck` must pass after every task.
- Verify each test FAILS before implementing (TDD).

---

## File Structure

- **Create** `src/lib/rap/bn.ts` — `isValidBN` (format + checksum + 9-digit root). Pure.
- **Create** `src/lib/rap/registry.ts` — `RegistryProvider` interface, `StubRegistryProvider`, `IsedFederalCorpProvider`, `getRegistryProvider()`, `cbrSearchUrl()`.
- **Modify** `src/lib/rap/types.ts` — new fields on `RapOrganization` + `ExtractionJob`; new `OrgClaim`; new repo methods.
- **Modify** `src/lib/rap/repo.mock.ts` + `src/lib/rap/repo.dynamo.ts` — implement new repo methods; map new item fields.
- **Modify** `src/lib/dynamo/rap-table.ts` — item mappers + keys for new fields / `OrgClaim`.
- **Modify** `src/lib/rap/stage-extraction.ts` — BN-based `orgId`; re-extraction lock.
- **Modify** `src/lib/rap/publish.ts` — carry registry fields onto the `RapOrganization`.
- **Modify** `src/lib/rap/actions.ts` — `resolveOrgAction`, publish gate, `claimOrgAction`, `recordRapProgressAction`, open upload to companies.
- **Modify** `src/app/extract/ReviewPanel.tsx` — Organization block (BN entry + CBR deep-link).
- **Create** `src/app/my-rap/page.tsx`, `src/app/my-rap/claim/page.tsx` + client components.
- **Create tests** `scripts/test-rap-bn.ts`, `test-rap-registry.ts`, `test-rap-identity.ts`, `test-rap-resolve.ts`, `test-rap-reextract-lock.ts`, `test-rap-claim.ts`, `test-rap-progress.ts`.

---

## Task 1: BN validation (`bn.ts`)

**Files:**
- Create: `src/lib/rap/bn.ts`
- Test: `scripts/test-rap-bn.ts`

**Interfaces:**
- Produces: `isValidBN(raw: string): { bn9: string } | null` — returns the 9-digit root when the input is a structurally valid BN (with an optional `RC`/`RT`/`RP`/`RM`… program identifier + 4-digit reference), else `null`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/test-rap-bn.ts
import assert from "node:assert/strict";
import { isValidBN } from "../src/lib/rap/bn";

// 9-digit BN with a valid Luhn check digit (Enbridge Inc. root from Corporations Canada)
assert.deepEqual(isValidBN("119653384"), { bn9: "119653384" }, "bare 9-digit BN");
assert.deepEqual(isValidBN("119653384RC0001"), { bn9: "119653384" }, "strips RC program account");
assert.deepEqual(isValidBN("11965 3384 RC0001"), { bn9: "119653384" }, "tolerates spacing");
assert.equal(isValidBN("123456789"), null, "bad Luhn check digit → null");
assert.equal(isValidBN("12345"), null, "too short → null");
assert.equal(isValidBN("119653384XX0001"), null, "unknown program id → null");
assert.equal(isValidBN(""), null, "empty → null");
console.log("OK test-rap-bn");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-rap-bn.ts`
Expected: FAIL — `Cannot find module '../src/lib/rap/bn'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/rap/bn.ts
// Canada Revenue Agency Business Number. Identity is the 9-digit ROOT; the
// optional program account (e.g. RC0001) denotes a program of the SAME business.
// The 9th digit is a Luhn (mod-10) check digit — a cheap pre-filter before any
// registry call; the authoritative check is registry verifyBN().
const PROGRAMS = new Set(["RC", "RT", "RP", "RM", "RR", "RZ"]);

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

export function isValidBN(raw: string): { bn9: string } | null {
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/\s+/g, "");
  const m = compact.match(/^(\d{9})([A-Z]{2}\d{4})?$/);
  if (!m) return null;
  if (m[2] && !PROGRAMS.has(m[2].slice(0, 2))) return null;
  if (!luhnValid(m[1])) return null;
  return { bn9: m[1] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-rap-bn.ts` → Expected: `OK test-rap-bn`. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rap/bn.ts scripts/test-rap-bn.ts
git commit -m "feat(rap): BN validation (9-digit root + Luhn + program-suffix strip)"
```

> **Note for the implementer:** if `119653384` fails Luhn in Step 4, the real BN check digit is correct by construction from the registry; adjust the test's sample to any Luhn-valid 9-digit string (e.g. compute one) rather than weakening the check. Keep the three-Enbridge roots (`119653384`, `102505641`, `837654714`) as the identity fixtures downstream even if one needs a Luhn-tolerant test variant.

---

## Task 2: Registry adapter + stub (`registry.ts`)

**Files:**
- Create: `src/lib/rap/registry.ts`
- Test: `scripts/test-rap-registry.ts`

**Interfaces:**
- Consumes: `isValidBN` (Task 1).
- Produces:
  - `interface RegistryEntity { businessNumber: string; legalName: string; status: string; jurisdiction: string; officeLocation: string | null; source: "ised" }`
  - `interface RegistryProvider { verifyBN(bn9: string): Promise<RegistryEntity | null>; searchByName?(q: string): Promise<RegistryEntity[]> }`
  - `class StubRegistryProvider implements RegistryProvider` — canned entities keyed by bn9.
  - `getRegistryProvider(): RegistryProvider` — env-selected (`REGISTRY_IMPL=ised` → ISED; default stub).
  - `cbrSearchUrl(name: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/test-rap-registry.ts
import assert from "node:assert/strict";
import { StubRegistryProvider, cbrSearchUrl } from "../src/lib/rap/registry";

const reg = new StubRegistryProvider({
  "119653384": { businessNumber: "119653384", legalName: "ENBRIDGE INC.", status: "Active", jurisdiction: "CA-federal", officeLocation: "CALGARY, Alberta", source: "ised" },
});

const hit = await reg.verifyBN("119653384");
assert.equal(hit?.legalName, "ENBRIDGE INC.", "known BN resolves");
assert.equal(await reg.verifyBN("000000000"), null, "unknown BN → null");

const url = cbrSearchUrl("Enbridge Inc.");
assert.ok(url.startsWith("https://ised-isde.canada.ca/cbr-rec/"), "CBR base");
assert.ok(/Enbridge/.test(decodeURIComponent(url)), "name is in the query");
console.log("OK test-rap-registry");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-rap-registry.ts` → Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/rap/registry.ts
// Business-registry lookups behind a provider seam. v1: verify-by-BN only
// (free ISED Federal Corp API); fuzzy searchByName is the pluggable v2 hook.
export interface RegistryEntity {
  businessNumber: string; // 9-digit root
  legalName: string;
  status: string;
  jurisdiction: string;
  officeLocation: string | null;
  source: "ised";
}
export interface RegistryProvider {
  verifyBN(bn9: string): Promise<RegistryEntity | null>;
  searchByName?(query: string): Promise<RegistryEntity[]>;
}

export class StubRegistryProvider implements RegistryProvider {
  constructor(private readonly canned: Record<string, RegistryEntity> = {}) {}
  async verifyBN(bn9: string) { return this.canned[bn9] ?? null; }
}

// Prefilled deep-link to Canada's Business Registries (web-only; no API). The
// exact query param is confirmed against the live site during Task 9.
export function cbrSearchUrl(name: string): string {
  return `https://ised-isde.canada.ca/cbr-rec/?search=${encodeURIComponent(name)}`;
}

// ISED provider is added in Task 9; selected here so callers never branch.
export function getRegistryProvider(): RegistryProvider {
  return new StubRegistryProvider();
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx tsx scripts/test-rap-registry.ts` → `OK test-rap-registry`; then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rap/registry.ts scripts/test-rap-registry.ts
git commit -m "feat(rap): registry adapter seam + StubRegistryProvider + cbrSearchUrl"
```

---

## Task 3: BN-keyed org identity at publish

**Files:**
- Modify: `src/lib/rap/types.ts` (add fields to `RapOrganization`, `ExtractionJob`)
- Modify: `src/lib/dynamo/rap-table.ts` (`toOrgItem`/`itemToOrg`, `toJobItem`/`itemToJob` — persist new fields)
- Modify: `src/lib/rap/publish.ts` (`buildCanonical` carries registry fields onto the org)
- Modify: `src/lib/rap/stage-extraction.ts` (`publishAndConfirm` orgId from BN)
- Test: `scripts/test-rap-identity.ts`

**Interfaces:**
- Consumes: `isValidBN` (Task 1).
- `RapOrganization` gains: `businessNumber: string | null; legalName: string | null; registryStatus: string | null; registrySource: "ised" | "self_asserted" | null; verifiedAt: string | null`.
- `ExtractionJob` gains: `businessNumber: string | null; businessNumberSource: "ised" | "self_asserted" | null; registryLegalName: string | null; registryStatus: string | null`.
- Produces: `orgIdForBN(bn9: string): string` in `stage-extraction.ts` → `"org-bn-" + bn9`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/test-rap-identity.ts
import assert from "node:assert/strict";
import { extractionRepo, rapRepo } from "../src/lib/rap/index";
import { publishAndConfirm } from "../src/lib/rap/stage-extraction";
import { runExtraction } from "../src/lib/rap/pipeline.mock";
import type { ExtractedRap } from "../src/lib/rap/types";

const base = (await runExtraction({ fileName: "x.pdf", sourceS3Key: "s3://x" })).extracted;
let seq = 0;
async function publishWithBN(name: string, bn9: string | null, file = "x.pdf") {
  const id = `job-id-${seq++}`;
  const job = await extractionRepo.createJob({ id, fileName: file, sourceS3Key: `s3://${id}` });
  // Task 4 sets these at review; here we simulate a resolved job:
  await extractionRepo.setJobOrg(id, bn9 ? { businessNumber: bn9, businessNumberSource: "ised", registryLegalName: name.toUpperCase(), registryStatus: "Active" } : null);
  const staged = (await extractionRepo.getJob(id))!;
  const extracted: ExtractedRap = { ...base, orgName: { ...base.orgName, value: name } };
  await publishAndConfirm(staged, extracted, "tester");
  return (await extractionRepo.getJob(id))!.rapId!;
}

// three real "Enbridge" entities → three distinct orgs
await publishWithBN("Enbridge", "119653384", "a.pdf");
await publishWithBN("Enbridge", "102505641", "b.pdf");
assert.ok(await rapRepo.getOrganization("org-bn-119653384"), "Enbridge Inc org keyed on BN");
assert.ok(await rapRepo.getOrganization("org-bn-102505641"), "Enbridge Pipelines org keyed on BN");
const org = await rapRepo.getOrganization("org-bn-119653384");
assert.equal(org?.legalName, "ENBRIDGE", "registry legal name stored");
assert.equal(org?.registrySource, "ised");

// program accounts of one business collapse to one org (Task 4 passes the 9-root)
// self-asserted (no BN) falls back to the name key
await publishWithBN("Tinyco", null, "c.pdf");
assert.ok(await rapRepo.getOrganization("org-tinyco"), "no BN → name fallback org");
console.log("OK test-rap-identity");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-rap-identity.ts`
Expected: FAIL — `extractionRepo.setJobOrg is not a function` (and org not BN-keyed).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/rap/types.ts`, add the fields listed above to `RapOrganization` and `ExtractionJob`, and add to `ExtractionRepo`:
```ts
setJobOrg(id: string, org: { businessNumber: string; businessNumberSource: "ised" | "self_asserted"; registryLegalName: string | null; registryStatus: string | null } | null): Promise<ExtractionJob>;
```

In `src/lib/rap/repo.mock.ts` (and mirror in `repo.dynamo.ts` via a job re-put; map the fields in `rap-table.ts`):
```ts
async setJobOrg(id, org) {
  const job = findJob(id); // dynamo: getJobOrThrow
  job.businessNumber = org?.businessNumber ?? null;
  job.businessNumberSource = org?.businessNumberSource ?? null;
  job.registryLegalName = org?.registryLegalName ?? null;
  job.registryStatus = org?.registryStatus ?? null;
  job.updatedAt = now();
  return job; // dynamo: return putJob(job)
}
```
Initialize the four new job fields to `null` in BOTH `createJob` implementations.

In `src/lib/rap/stage-extraction.ts`:
```ts
export const orgIdForBN = (bn9: string): string => `org-bn-${bn9}`;

export async function publishAndConfirm(job: ExtractionJob, extracted: ExtractedRap, reviewedBy: string) {
  const now = new Date().toISOString();
  const orgId = job.businessNumber ? orgIdForBN(job.businessNumber) : orgIdFor(extracted.orgName.value || job.id);
  const contentHash = await documentContentHash(job.sourceS3Key, job.fileName);
  const rapId = stableRapId(orgId, contentHash);

  const { org, rap, commitments, observations, rollups } = buildCanonical(
    extracted,
    { orgId, rapId, commitId: () => uuid() },
    {
      sourceS3Key: job.sourceS3Key, extractionId: job.id, now, reviewedBy,
      registry: job.businessNumber
        ? { businessNumber: job.businessNumber, legalName: job.registryLegalName, registryStatus: job.registryStatus, registrySource: job.businessNumberSource!, verifiedAt: now }
        : null,
    },
  );
  // ...unchanged writes...
}
```

In `src/lib/rap/publish.ts` — extend `buildCanonical`'s `meta` with the optional `registry` block and set the org fields (default all to `null` when absent):
```ts
const org: RapOrganization = {
  id: ids.orgId, name: meta.registry?.legalName ?? orgName, sector, sizeBand: deriveSizeBand(),
  region: val(extracted.jurisdiction) ?? "unknown", createdAt: meta.now,
  businessNumber: meta.registry?.businessNumber ?? null,
  legalName: meta.registry?.legalName ?? null,
  registryStatus: meta.registry?.registryStatus ?? null,
  registrySource: meta.registry?.registrySource ?? null,
  verifiedAt: meta.registry?.verifiedAt ?? null,
};
```
Map the new `RapOrganization` fields in `rap-table.ts` `toOrgItem`/`itemToOrg`.

- [ ] **Step 4: Run test to verify it passes** — `npx tsx scripts/test-rap-identity.ts` → `OK test-rap-identity`; `npm run typecheck`; re-run `scripts/test-rap-dedup.ts` (must still pass).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rap/types.ts src/lib/dynamo/rap-table.ts src/lib/rap/publish.ts src/lib/rap/stage-extraction.ts src/lib/rap/repo.mock.ts src/lib/rap/repo.dynamo.ts scripts/test-rap-identity.ts
git commit -m "feat(rap): BN-keyed org identity at publish (+ registry fields on org/job)"
```

---

## Task 4: `resolveOrgAction` (review-time BN resolution)

**Files:**
- Modify: `src/lib/rap/actions.ts` (add `resolveOrgAction`)
- Test: `scripts/test-rap-resolve.ts`

**Interfaces:**
- Consumes: `isValidBN` (T1), `getRegistryProvider` (T2), `extractionRepo.setJobOrg` (T3).
- Produces: `resolveOrgAction(input: { jobId: string; bnRaw: string; selfAsserted?: boolean }): Promise<{ ok: true; legalName: string | null } | { ok: false; error: string }>` (a plain async function callable from a form action wrapper; keep it unit-testable — the `"use server"` wrapper in `actions.ts` calls it).

- [ ] **Step 1: Write the failing test**

```ts
// scripts/test-rap-resolve.ts
import assert from "node:assert/strict";
import { extractionRepo } from "../src/lib/rap/index";
import { resolveOrgForJob } from "../src/lib/rap/actions";
import { StubRegistryProvider } from "../src/lib/rap/registry";

const reg = new StubRegistryProvider({ "119653384": { businessNumber: "119653384", legalName: "ENBRIDGE INC.", status: "Active", jurisdiction: "CA-federal", officeLocation: null, source: "ised" } });
const job = await extractionRepo.createJob({ id: "rj1", fileName: "x.pdf", sourceS3Key: "s3://rj1" });

const bad = await resolveOrgForJob(reg, { jobId: job.id, bnRaw: "123" });
assert.equal(bad.ok, false, "invalid BN rejected");

const ok = await resolveOrgForJob(reg, { jobId: job.id, bnRaw: "119653384RC0001" });
assert.equal(ok.ok, true);
const stored = await extractionRepo.getJob("rj1");
assert.equal(stored?.businessNumber, "119653384", "9-root stored");
assert.equal(stored?.businessNumberSource, "ised");

const miss = await resolveOrgForJob(reg, { jobId: job.id, bnRaw: "000000018" }); // luhn-valid but unknown
assert.equal(miss.ok, false, "unknown BN not silently self-asserted");
const self = await resolveOrgForJob(reg, { jobId: job.id, bnRaw: "000000018", selfAsserted: true });
assert.equal(self.ok, true);
assert.equal((await extractionRepo.getJob("rj1"))?.businessNumberSource, "self_asserted");
console.log("OK test-rap-resolve");
```

- [ ] **Step 2: Run** `npx tsx scripts/test-rap-resolve.ts` → FAIL (`resolveOrgForJob` not exported).

- [ ] **Step 3: Implement** in `src/lib/rap/actions.ts`:

```ts
import { isValidBN } from "./bn";
import { getRegistryProvider, type RegistryProvider } from "./registry";

// Testable core (provider injected). The "use server" wrapper below calls it.
export async function resolveOrgForJob(
  reg: RegistryProvider,
  input: { jobId: string; bnRaw: string; selfAsserted?: boolean },
): Promise<{ ok: true; legalName: string | null } | { ok: false; error: string }> {
  const v = isValidBN(input.bnRaw);
  if (!v) return { ok: false, error: "Invalid Business Number" };
  const entity = await reg.verifyBN(v.bn9);
  if (entity) {
    await extractionRepo.setJobOrg(input.jobId, { businessNumber: v.bn9, businessNumberSource: "ised", registryLegalName: entity.legalName, registryStatus: entity.status });
    return { ok: true, legalName: entity.legalName };
  }
  if (input.selfAsserted) {
    await extractionRepo.setJobOrg(input.jobId, { businessNumber: v.bn9, businessNumberSource: "self_asserted", registryLegalName: null, registryStatus: null });
    return { ok: true, legalName: null };
  }
  return { ok: false, error: "BN not found in the federal registry. Mark self-asserted to proceed." };
}

export async function resolveOrgAction(formData: FormData) {
  "use server";
  return resolveOrgForJob(getRegistryProvider(), {
    jobId: String(formData.get("jobId") ?? ""),
    bnRaw: String(formData.get("bn") ?? ""),
    selfAsserted: formData.get("selfAsserted") === "on",
  });
}
```

- [ ] **Step 4: Run** the test → `OK test-rap-resolve`; `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rap/actions.ts scripts/test-rap-resolve.ts
git commit -m "feat(rap): resolveOrgForJob — verify BN at review, self-asserted fallback"
```

---

## Task 5: Publish gate (require a resolved org)

**Files:**
- Modify: `src/lib/rap/actions.ts` (`confirmExtractionAction`)
- Test: extend `scripts/test-rap-resolve.ts` (or add `scripts/test-rap-publish-gate.ts`)

**Interfaces:**
- Consumes: `extractionRepo.getJob` (job now has `businessNumber`).
- Behavior: `confirmExtractionAction` returns/no-ops without publishing when `job.businessNumber` is null.

- [ ] **Step 1: Failing test** (`scripts/test-rap-publish-gate.ts`): create a job with no BN, call the gate helper `canPublish(job)`; assert `false`; set BN via `setJobOrg`; assert `true`.

```ts
import assert from "node:assert/strict";
import { canPublish } from "../src/lib/rap/actions";
assert.equal(canPublish({ businessNumber: null } as any), false, "no BN → cannot publish");
assert.equal(canPublish({ businessNumber: "119653384" } as any), true, "BN → can publish");
console.log("OK test-rap-publish-gate");
```

- [ ] **Step 2: Run** → FAIL (`canPublish` not exported).

- [ ] **Step 3: Implement** in `actions.ts`:

```ts
export function canPublish(job: { businessNumber: string | null }): boolean {
  return job.businessNumber != null;
}
```
Then in `confirmExtractionAction`, after fetching the job: `if (!canPublish(job)) { revalidatePath("/extract"); return; }` before `publishAndConfirm`.

- [ ] **Step 4: Run** → `OK test-rap-publish-gate`; `npm run typecheck`.

- [ ] **Step 5: Commit** `feat(rap): block publish until an org BN is resolved`.

---

## Task 6: Re-extraction lock

**Files:**
- Modify: `src/lib/rap/types.ts` (`RapRepo.hasCompanyProgress`)
- Modify: `src/lib/rap/repo.mock.ts` + `repo.dynamo.ts`
- Modify: `src/lib/rap/stage-extraction.ts` (guard in `publishAndConfirm`)
- Test: `scripts/test-rap-reextract-lock.ts`

**Interfaces:**
- Produces: `RapRepo.hasCompanyProgress(rapId: string): Promise<boolean>` — true iff any `Observation` on that RAP's commitments has `recordedBy !== "system"`.
- `publishAndConfirm` throws `Error("RAP is locked: company progress recorded")` when re-publishing over a rapId with company progress.

- [ ] **Step 1: Failing test**

```ts
// scripts/test-rap-reextract-lock.ts
import assert from "node:assert/strict";
import { extractionRepo, rapRepo } from "../src/lib/rap/index";
import { publishAndConfirm } from "../src/lib/rap/stage-extraction";
import { runExtraction } from "../src/lib/rap/pipeline.mock";

const base = (await runExtraction({ fileName: "lock.pdf", sourceS3Key: "s3://l" })).extracted;
async function pub(id: string) {
  const job = await extractionRepo.createJob({ id, fileName: "lock.pdf", sourceS3Key: `s3://${id}` });
  await extractionRepo.setJobOrg(id, { businessNumber: "119653384", businessNumberSource: "ised", registryLegalName: "X", registryStatus: "Active" });
  await publishAndConfirm((await extractionRepo.getJob(id))!, base, "tester");
  return (await extractionRepo.getJob(id))!.rapId!;
}

const rapId = await pub("lk1");
// only baseline system observations → re-publish allowed
await pub("lk2");
assert.equal((await rapRepo.listCommitmentsByRap(rapId)).length, base.commitments.length, "re-publish replaced, not doubled");

// company records progress → lock engages
const commit = (await rapRepo.listCommitmentsByRap(rapId))[0];
await rapRepo.putObservation({ commitId: commit.id, observedAt: new Date().toISOString(), status: "in_progress", observedValue: 40, note: null, recordedBy: "party-123" });
await assert.rejects(() => pub("lk3"), /locked/i, "re-extraction blocked after company progress");
console.log("OK test-rap-reextract-lock");
```

- [ ] **Step 2: Run** → FAIL (`hasCompanyProgress` missing; no throw).

- [ ] **Step 3: Implement**
- `repo.mock.ts`:
```ts
async hasCompanyProgress(rapId) {
  const ids = new Set(store.commitments.filter((c) => c.rapId === rapId).map((c) => c.id));
  return store.observations.some((o) => ids.has(o.commitId) && o.recordedBy !== "system");
}
```
- `repo.dynamo.ts`: query commitments by rapId, then for each, query `OBS#` and check any `recordedBy !== "system"` (short-circuit).
- `stage-extraction.ts`, at the top of `publishAndConfirm` after computing `rapId`:
```ts
if (await rapRepo.hasCompanyProgress(rapId)) {
  throw new Error("RAP is locked: company progress recorded — upload a corrected version as a new document");
}
```

- [ ] **Step 4: Run** → `OK test-rap-reextract-lock`; re-run `test-rap-dedup.ts` + `test-rap-identity.ts`; `npm run typecheck`.

- [ ] **Step 5: Commit** `feat(rap): lock RAP from re-extraction once company progress exists`.

---

## Task 7: OrgClaim + `claimOrgForParty`

**Files:**
- Modify: `src/lib/rap/types.ts` (`OrgClaim` + `RapRepo` claim methods)
- Modify: `src/lib/dynamo/rap-table.ts` (`OrgClaim` keys/mappers)
- Modify: `src/lib/rap/repo.mock.ts` + `repo.dynamo.ts`
- Modify: `src/lib/rap/actions.ts` (`claimOrgForParty` + `claimOrgAction`)
- Test: `scripts/test-rap-claim.ts`

**Interfaces:**
- `OrgClaim { businessNumber; partyId; status: "granted"; attestedAt; grantedBy }`.
- `RapRepo`: `putClaim(c: OrgClaim): Promise<OrgClaim>`, `getClaim(bn: string, partyId: string): Promise<OrgClaim | null>`, `listClaimsByParty(partyId: string): Promise<OrgClaim[]>`.
- `claimOrgForParty(reg, { partyId, bnRaw, attested }): Promise<{ ok: true; legalName } | { ok: false; error }>`.

- [ ] **Step 1: Failing test**

```ts
// scripts/test-rap-claim.ts
import assert from "node:assert/strict";
import { rapRepo } from "../src/lib/rap/index";
import { claimOrgForParty } from "../src/lib/rap/actions";
import { StubRegistryProvider } from "../src/lib/rap/registry";
const reg = new StubRegistryProvider({ "119653384": { businessNumber: "119653384", legalName: "ENBRIDGE INC.", status: "Active", jurisdiction: "CA-federal", officeLocation: null, source: "ised" } });

assert.equal((await claimOrgForParty(reg, { partyId: "p1", bnRaw: "119653384", attested: false })).ok, false, "must attest");
const ok = await claimOrgForParty(reg, { partyId: "p1", bnRaw: "119653384RC0001", attested: true });
assert.equal(ok.ok, true);
const claim = await rapRepo.getClaim("119653384", "p1");
assert.equal(claim?.status, "granted");
assert.deepEqual((await rapRepo.listClaimsByParty("p1")).map((c) => c.businessNumber), ["119653384"]);
console.log("OK test-rap-claim");
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the repo methods (mock: array filter; dynamo: `PK=ORGCLAIM#<bn>`, `SK=PARTY#<partyId>`, `GSI1PK=PARTY#<partyId>` for `listClaimsByParty`) and:
```ts
export async function claimOrgForParty(reg, { partyId, bnRaw, attested }) {
  if (!attested) return { ok: false, error: "You must attest authorization" };
  const v = isValidBN(bnRaw); if (!v) return { ok: false, error: "Invalid Business Number" };
  const entity = await reg.verifyBN(v.bn9); if (!entity) return { ok: false, error: "BN not found in the federal registry" };
  await rapRepo.putClaim({ businessNumber: v.bn9, partyId, status: "granted", attestedAt: new Date().toISOString(), grantedBy: "system:bn-verify" });
  return { ok: true, legalName: entity.legalName };
}
```
- [ ] **Step 4: Run** → `OK test-rap-claim`; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(rap): OrgClaim + claimOrgForParty (BN-verified, attested)`.

---

## Task 8: `recordRapProgressForParty`

**Files:**
- Modify: `src/lib/rap/actions.ts`
- Test: `scripts/test-rap-progress.ts`

**Interfaces:**
- Consumes: `rapRepo.getCommitment` (add if absent — mock/dynamo), `rapRepo.getClaim` (T7), `rapRepo.putObservation`.
- `recordRapProgressForParty({ partyId, commitId, status, observedValue, note }): Promise<{ ok: boolean; error?: string }>` — guards claim ownership, appends an `Observation` with `recordedBy: partyId`.

- [ ] **Step 1: Failing test**

```ts
// scripts/test-rap-progress.ts
import assert from "node:assert/strict";
import { extractionRepo, rapRepo } from "../src/lib/rap/index";
import { publishAndConfirm } from "../src/lib/rap/stage-extraction";
import { recordRapProgressForParty } from "../src/lib/rap/actions";
import { runExtraction } from "../src/lib/rap/pipeline.mock";

const base = (await runExtraction({ fileName: "p.pdf", sourceS3Key: "s3://p" })).extracted;
const job = await extractionRepo.createJob({ id: "pj1", fileName: "p.pdf", sourceS3Key: "s3://pj1" });
await extractionRepo.setJobOrg("pj1", { businessNumber: "119653384", businessNumberSource: "ised", registryLegalName: "X", registryStatus: "Active" });
await publishAndConfirm((await extractionRepo.getJob("pj1"))!, base, "tester");
const rapId = (await extractionRepo.getJob("pj1"))!.rapId!;
const commit = (await rapRepo.listCommitmentsByRap(rapId))[0];

// unclaimed party rejected
assert.equal((await recordRapProgressForParty({ partyId: "p9", commitId: commit.id, status: "in_progress", observedValue: 30, note: null })).ok, false);

await rapRepo.putClaim({ businessNumber: "119653384", partyId: "p1", status: "granted", attestedAt: "t", grantedBy: "test" });
const ok = await recordRapProgressForParty({ partyId: "p1", commitId: commit.id, status: "in_progress", observedValue: 55, note: "Q3" });
assert.equal(ok.ok, true);
const obs = await rapRepo.listObservations(commit.id);
assert.ok(obs.some((o) => o.recordedBy === "p1" && o.observedValue === 55), "company observation appended");
console.log("OK test-rap-progress");
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (`getCommitment(commitId)` finds the commitment → its `orgId` → BN root from `org-bn-<bn>`; check a granted claim links `partyId`↔bn):
```ts
export async function recordRapProgressForParty(input) {
  const c = await rapRepo.getCommitment(input.commitId);
  if (!c) return { ok: false, error: "Unknown commitment" };
  const bn = c.orgId.startsWith("org-bn-") ? c.orgId.slice("org-bn-".length) : null;
  if (!bn) return { ok: false, error: "Org has no Business Number" };
  const claim = await rapRepo.getClaim(bn, input.partyId);
  if (!claim || claim.status !== "granted") return { ok: false, error: "Not authorized for this organization" };
  await rapRepo.putObservation({ commitId: input.commitId, observedAt: new Date().toISOString(), status: input.status, observedValue: input.observedValue, note: input.note, recordedBy: input.partyId });
  return { ok: true };
}
```
Add `getCommitment` to `RapRepo` + both repos if missing (mock: array find; dynamo: needs a GSI or a scoped read — implement via `listCommitmentsByRap` is not enough; add `COMMIT#<id>` lookup or a GSI on commitId. Keep it simple: store commitments already at `PK=RAP#<rapId>`, so add `getCommitmentById` via GSI2 or a small commit→rap index. **Implementer note:** confirm the existing key layout in `rap-table.ts` and add the minimal index needed).
- [ ] **Step 4: Run** → `OK test-rap-progress`; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(rap): recordRapProgressForParty (claim-guarded, append-only)`.

---

## Task 9: ISED Federal Corp provider (real `verifyBN`)

**Files:**
- Modify: `src/lib/rap/registry.ts` (`IsedFederalCorpProvider`, wire into `getRegistryProvider`)
- Test: `scripts/test-rap-registry-ised.ts` (mock `fetch`, assert request shape + response mapping)

**Interfaces:** `IsedFederalCorpProvider implements RegistryProvider` — `verifyBN(bn9)` calls the ISED Federal Corp API and maps the response to `RegistryEntity`.

- [ ] **Step 1: Confirm the API contract** — read the OpenAPI spec at `api.ised-isde.canada.ca` (docs?api=corporations). Record the exact endpoint, whether it accepts a BN vs corp-number, auth (public plan / key), and the JSON fields for legal name / status / office. Note the 60/min rate limit.
- [ ] **Step 2: Write the failing test** with an injected `fetch` stub returning a recorded sample payload; assert the URL/method and that mapping yields the right `RegistryEntity`.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement** `IsedFederalCorpProvider` (constructor takes an optional `fetchImpl` for tests; default global `fetch`), map fields, return `null` on 404/empty; `getRegistryProvider()` returns it when `process.env.REGISTRY_IMPL === "ised"`, else `StubRegistryProvider`. Confirm `cbrSearchUrl`'s query param against the live CBR site and fix if needed.
- [ ] **Step 5: Run** → pass; `npm run typecheck`; commit `feat(rap): ISED Federal Corporation API provider (verify-by-BN)`.

---

## Task 10: Review UI — Organization block

**Files:** Modify `src/app/extract/ReviewPanel.tsx`; wire `resolveOrgAction` (T4) + `cbrSearchUrl` (T2). Modify `src/app/extract/page.tsx` if it passes job data.

- [ ] **Step 1:** Add an "Organization" section per job: shows extracted name, a **"Look up in Canada's Business Registries ↗"** link (`cbrSearchUrl(job.extracted?.orgName?.value ?? job.fileName)`), a **BN input** + **Resolve** button (form → `resolveOrgAction`), a **self-asserted** checkbox, and a confirmation line showing the resolved `registryLegalName` + `registryStatus`. Disable **Approve & publish** until `job.businessNumber` is set (mirror `canPublish`).
- [ ] **Step 2:** Manual verification via the running app (curator login → `/extract?tab=review`): resolve a BN with the stub provider, confirm publish unlocks. Add a lightweight render assertion if a component test harness exists; otherwise document the manual check. `npm run build` must pass.
- [ ] **Step 3: Commit** `feat(extract): organization/BN resolution block in review`.

---

## Task 11: Open upload to companies (auto-tag claimed BN)

**Files:** Modify `src/lib/rap/actions.ts` (`uploadRapAction`).

- [ ] **Step 1:** Read `getSession()`. Allow `kind === "indigenomics"` OR `kind === "company"`. For a company with a granted claim, set the created job's BN from its (single) claim via `setJobOrg(..., { businessNumberSource: "ised" | "self_asserted" per the claim })`. Staff uploads leave BN null (resolved at review).
- [ ] **Step 2:** Test `scripts/test-rap-upload-scope.ts` — a company-session upload with a claim tags `job.businessNumber`; a staff upload leaves it null. (Inject session + repos; keep a testable `uploadForSession(session, input)` core like the other actions.)
- [ ] **Step 3:** Run → pass; `npm run typecheck`; commit `feat(rap): companies can upload; claimed BN auto-tags the job`.

---

## Task 12: `/my-rap/claim` route

**Files:** Create `src/app/my-rap/claim/page.tsx` + a client form; wire `claimOrgAction` (T7 `"use server"` wrapper).

- [ ] **Step 1:** Company-gated page (`getSession().kind === "company"` else `redirect("/home")`). Form: BN input + attestation checkbox → `claimOrgAction`; on success show the registry legal name. 
- [ ] **Step 2:** `npm run build` passes; manual check with stub provider. Commit `feat(my-rap): claim your organization by BN`.

---

## Task 13: `/my-rap` route — record progress

**Files:** Create `src/app/my-rap/page.tsx` + client; wire `recordRapProgressAction` (T8 wrapper).

- [ ] **Step 1:** Company-gated. Load the party's granted claims → the BN'd orgs → their RAP commitments (`listClaimsByParty` → `org-bn-<bn>` → `listRapsByOrg` → `listCommitmentsByRap`). Render each commitment with its latest rollup + a small **Record progress** form (status, %, note) → `recordRapProgressAction`. Grounded fields shown read-only.
- [ ] **Step 2:** `npm run build` passes; manual check: claim → record progress → rollup updates (RollupAggregator locally recomputes on the mock via the repo path). Commit `feat(my-rap): company progress dashboard + record-progress`.

---

## Self-Review notes (author)

- **Spec coverage:** identity (T3), registry verify + CBR link (T2/T9), review resolution (T4) + publish gate (T5), re-extraction lock (T6), claim (T7), progress (T8), hybrid upload (T11), UIs (T10/12/13). All §7 flows + §5 data model + §10 tests are covered.
- **Deferred (per spec):** `searchByName` inline candidates, cross-version reconciliation, stable commit-ids, provincial verification, stricter claim proof — intentionally absent.
- **External unknowns** isolated to **T9 Step 1** (ISED endpoint/fields) and the `cbrSearchUrl` param — everything upstream uses the stub and is fully testable now.
- **Ordering vs #153:** implement + merge this feature first; then flip #153 (real extraction lands BN-keyed, no migration).
