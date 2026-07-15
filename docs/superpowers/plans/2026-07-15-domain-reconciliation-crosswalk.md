# Domain-Reconciliation Crosswalk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a company's verified Business Number the shared key that links its seeded public commitments to its claimed identity, so a claimed company can see and update progress on its own seeded commitments — without merging the two data domains.

**Architecture:** Additive, non-destructive. Add a nullable `businessNumber` to the commitments domain and a shared `src/lib/identity/` seam that resolves a party's granted BNs and fans out reads by BN (deps point *up* into the seam; the commitments and RAP domains never import each other). Reroute `updateCommitmentAction` ownership through the same granted-`OrgClaim`-on-BN gate that already guards RAP progress. A curated, confidence-gated BN map + an idempotent migration ship together (the ccib-incident lesson: an identity change on a populated table needs its data migration in the same PR).

**Tech Stack:** TypeScript, Next.js App Router (server actions), DynamoDB (single-table + per-domain tables), `tsx` for scripts/tests. No test framework in this repo — tests are `scripts/test-*.ts` run via `npx tsx`.

## Global Constraints

- **No new test framework.** Tests are `scripts/test-<name>.ts` run with `npx tsx scripts/test-<name>.ts`, using a local `check(name, ok)` helper (✅/❌ + pass/fail tally, `process.exit(fail ? 1 : 0)`). Pure logic is tested against the in-memory mock repos (`repo.mock`) — no DynamoDB needed unless a step says otherwise.
- **Verification gates.** Every task that touches app/runtime code ends by confirming `npm run typecheck` and `npm run build` pass.
- **BN validity.** Every Business Number (map, fixtures, tests) must pass `isValidBN` from `src/lib/rap/bn.ts` (Luhn-valid 9 digits). Runnable synthetic test BNs: `123456782` and `100000009` (both Luhn-valid).
- **Additive only.** `businessNumber?` and `authoredBy?` are optional. Existing reads must work when they are absent; `/commitments` and the org rollups must render identically for any org without a BN.
- **Company edits stay bounded.** Progress-only, capped at `reported` (`SUBMITTABLE_STATUS`), each appended `ProgressPoint` stamped `authoredBy = session.partyId`. `title`, `targetYear`, and the public `source` are never company-editable.
- **Migration ships with the schema** (ccib lesson), is idempotent (second run is a no-op), and is run on prod under `AWS_PROFILE=isb` after merge (`aws sso login --profile isb` first).
- **Domain isolation.** The commitments and RAP domains must not import each other. The shared identity concern lives in `src/lib/identity/`; the `OrgClaim` store stays in the RAP repo behind a `ClaimReader` interface.
- **Backfill breadth.** Top-N (~15–25) high-confidence orgs in the first map. Real BN values are a **manual curation step** sourced from Corporations Canada — never invented in code. Ambiguous/multi-entity brands are left out (stay `businessNumber` absent).

---

## File Structure

- `src/lib/commitments/types.ts` — **modify.** Add `businessNumber?` to `Commitment`, `authoredBy?` to `ProgressPoint`, `businessNumber?` to `CommitmentFilter`.
- `src/lib/commitments/repo.mock.ts` — **modify.** `listCommitments` honors the `businessNumber` filter.
- `src/lib/commitments/repo.dynamo.ts` — **modify.** `listCommitments` honors the `businessNumber` filter (post-scan predicate).
- `src/lib/identity/claim-reader.ts` — **create.** `ClaimReader` interface + `rapClaimReader` adapter over `rapRepo`.
- `src/lib/identity/index.ts` — **create.** `resolveOrgForParty` + `listCommitmentsForBNs`.
- `src/lib/commitments/actions-core.ts` — **create.** Testable `updateCommitmentCore` + `createBusinessNumberFor` helpers (no `"use server"`).
- `src/lib/commitments/actions.ts` — **modify.** Wire the core into `updateCommitmentAction`; stamp BN in `createCommitmentAction`.
- `src/lib/commitments/org-bn-map.ts` — **create.** Curated `{ [orgNameSlug]: bn9 }` + `bnForOrgName` helper.
- `scripts/migrate-commitment-bn.ts` — **create.** Idempotent backfill; exports pure `planCommitmentBN`.
- `src/app/my-commitments/page.tsx` — **modify.** Also list BN-matched seeded commitments the company may edit, badged.
- `scripts/test-*.ts` — **create per task.**

---

## Task 1: Schema — `businessNumber`, `authoredBy`, filter support

**Files:**
- Modify: `src/lib/commitments/types.ts:18-59`
- Modify: `src/lib/commitments/repo.mock.ts:10-14`
- Modify: `src/lib/commitments/repo.dynamo.ts:23-27`
- Test: `scripts/test-commitment-schema.ts`

**Interfaces:**
- Produces: `Commitment.businessNumber?: string`; `ProgressPoint.authoredBy?: string`; `CommitmentFilter.businessNumber?: string`. `commitmentsRepo.listCommitments({ businessNumber })` returns only rows whose `businessNumber` matches.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-commitment-schema.ts`:
```ts
import { mockCommitmentsRepo } from "../src/lib/commitments/repo.mock";
import type { Commitment } from "../src/lib/commitments/types";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); ok ? pass++ : fail++; };

function make(id: string, bn?: string): Commitment {
  return {
    id, orgName: "Test Org", sector: "finance", orgSize: "large", type: "procurement",
    title: id, targetYear: 2027, status: "committed", progressPct: 0,
    history: [{ period: "2026", status: "committed", progressPct: 0 }],
    createdAt: "2026-01-01T00:00:00.000Z", businessNumber: bn,
  };
}

async function main() {
  await mockCommitmentsRepo.createCommitment(make("cm-a", "123456782"));
  await mockCommitmentsRepo.createCommitment(make("cm-b", "100000009"));
  await mockCommitmentsRepo.createCommitment(make("cm-c")); // no BN

  const byBn = await mockCommitmentsRepo.listCommitments({ businessNumber: "123456782" });
  check("filters by businessNumber", byBn.length === 1 && byBn[0].id === "cm-a");

  const all = await mockCommitmentsRepo.listCommitments();
  check("no filter returns all (incl. BN-less)", all.some((c) => c.id === "cm-c") && all.length >= 3);

  process.exit(fail ? 1 : 0);
}
main();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-commitment-schema.ts`
Expected: FAIL — TypeScript error `businessNumber` does not exist on `Commitment` / `CommitmentFilter` (or the filter check returns all rows).

- [ ] **Step 3: Add the optional fields**

In `src/lib/commitments/types.ts`, add to `interface ProgressPoint`:
```ts
  authoredBy?: string; // partyId of the claiming company, or "public-research" for seeded points
```
add to `interface Commitment`:
```ts
  businessNumber?: string; // 9-digit BN root; the crosswalk key. Absent ⇒ not yet attributed.
```
add to `interface CommitmentFilter`:
```ts
  businessNumber?: string; // exact-match on the BN crosswalk key
```

- [ ] **Step 4: Honor the filter in both repos**

In `src/lib/commitments/repo.mock.ts`, inside `listCommitments(filter)` where other filter fields are applied, add:
```ts
    if (filter?.businessNumber && c.businessNumber !== filter.businessNumber) return false;
```
In `src/lib/commitments/repo.dynamo.ts`, inside the post-scan predicate of `listCommitments(filter)`, add the same guard:
```ts
    if (filter?.businessNumber && c.businessNumber !== filter.businessNumber) return false;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/test-commitment-schema.ts`
Expected: PASS — both ✅.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/commitments/types.ts src/lib/commitments/repo.mock.ts src/lib/commitments/repo.dynamo.ts scripts/test-commitment-schema.ts
git commit -m "feat(commitments): add businessNumber + authoredBy schema + BN filter"
```

---

## Task 2: Identity seam — resolve a party's BNs and fan out reads

**Files:**
- Create: `src/lib/identity/claim-reader.ts`
- Create: `src/lib/identity/index.ts`
- Test: `scripts/test-identity-crosswalk.ts`

**Interfaces:**
- Consumes: `rapRepo.listClaimsByParty` (from `src/lib/rap`); `commitmentsRepo.listCommitments` (Task 1).
- Produces:
  - `interface ClaimReader { listGrantedBNs(partyId: string): Promise<string[]> }`
  - `rapClaimReader: ClaimReader`
  - `resolveOrgForParty(partyId: string, reader?: ClaimReader): Promise<{ bns: string[] }>`
  - `listCommitmentsForBNs(bns: string[], repo?): Promise<Commitment[]>`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-identity-crosswalk.ts`:
```ts
import { resolveOrgForParty, listCommitmentsForBNs } from "../src/lib/identity";
import type { ClaimReader } from "../src/lib/identity/claim-reader";
import { mockCommitmentsRepo } from "../src/lib/commitments/repo.mock";
import type { Commitment } from "../src/lib/commitments/types";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); ok ? pass++ : fail++; };

const fakeReader: ClaimReader = {
  async listGrantedBNs(partyId) { return partyId === "c-northway" ? ["123456782"] : []; },
};

function make(id: string, bn?: string): Commitment {
  return { id, orgName: "Northway", sector: "finance", orgSize: "large", type: "procurement",
    title: id, targetYear: 2027, status: "committed", progressPct: 0,
    history: [{ period: "2026", status: "committed", progressPct: 0 }],
    createdAt: "2026-01-01T00:00:00.000Z", businessNumber: bn };
}

async function main() {
  const r1 = await resolveOrgForParty("c-northway", fakeReader);
  check("resolves granted BNs", r1.bns.length === 1 && r1.bns[0] === "123456782");
  const r2 = await resolveOrgForParty("c-nobody", fakeReader);
  check("no claim ⇒ empty", r2.bns.length === 0);

  await mockCommitmentsRepo.createCommitment(make("cm-x", "123456782"));
  await mockCommitmentsRepo.createCommitment(make("cm-y")); // no BN
  const rows = await listCommitmentsForBNs(["123456782"], mockCommitmentsRepo);
  check("fans out commitments by BN", rows.length === 1 && rows[0].id === "cm-x");
  const none = await listCommitmentsForBNs([], mockCommitmentsRepo);
  check("empty BN list ⇒ no reads, empty result", none.length === 0);

  process.exit(fail ? 1 : 0);
}
main();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-identity-crosswalk.ts`
Expected: FAIL — module `../src/lib/identity` not found.

- [ ] **Step 3: Create the ClaimReader adapter**

Create `src/lib/identity/claim-reader.ts`:
```ts
// The shared identity seam's read boundary. The OrgClaim store stays in the RAP
// repo (v1); this narrow interface is what both domains depend on, so neither
// imports the other directly.
import { rapRepo } from "@/lib/rap";

export interface ClaimReader {
  listGrantedBNs(partyId: string): Promise<string[]>;
}

export const rapClaimReader: ClaimReader = {
  async listGrantedBNs(partyId: string): Promise<string[]> {
    const claims = await rapRepo.listClaimsByParty(partyId);
    return claims.filter((c) => c.status === "granted").map((c) => c.businessNumber);
  },
};
```

- [ ] **Step 4: Create the seam entrypoint**

Create `src/lib/identity/index.ts`:
```ts
// Shared identity crosswalk. Resolves a party's granted Business Numbers and
// fans out reads by BN into each domain's own repo. Deps point UP into here;
// the commitments and RAP domains never import each other.
import { commitmentsRepo } from "@/lib/commitments";
import type { Commitment, CommitmentRepo } from "@/lib/commitments/types";
import { rapClaimReader, type ClaimReader } from "./claim-reader";

export type { ClaimReader } from "./claim-reader";
export { rapClaimReader } from "./claim-reader";

export async function resolveOrgForParty(
  partyId: string,
  reader: ClaimReader = rapClaimReader,
): Promise<{ bns: string[] }> {
  return { bns: await reader.listGrantedBNs(partyId) };
}

export async function listCommitmentsForBNs(
  bns: string[],
  repo: CommitmentRepo = commitmentsRepo,
): Promise<Commitment[]> {
  if (bns.length === 0) return [];
  const batches = await Promise.all(bns.map((bn) => repo.listCommitments({ businessNumber: bn })));
  return batches.flat();
}
```
> If `@/lib/commitments` does not already export `CommitmentRepo`, import the type from `@/lib/commitments/types` (as shown) — it is exported there (`types.ts:87`).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/test-identity-crosswalk.ts`
Expected: PASS — all four ✅.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/identity/ scripts/test-identity-crosswalk.ts
git commit -m "feat(identity): shared BN seam — resolveOrgForParty + listCommitmentsForBNs"
```

---

## Task 3: Authz — claimed-BN ownership + `authoredBy` stamping

**Files:**
- Create: `src/lib/commitments/actions-core.ts`
- Modify: `src/lib/commitments/actions.ts:73-94` (`updateCommitmentAction`), `:39-71` (`createCommitmentAction`)
- Test: `scripts/test-commitment-authz.ts`

**Interfaces:**
- Consumes: `resolveOrgForParty` (Task 2); `SUBMITTABLE_STATUS` (from `actions.ts`, export it).
- Produces:
  - `updateCommitmentCore(deps: UpdateDeps, input: { id; status; progressPct }): Promise<{ ok: boolean }>`
  - `UpdateDeps = { getCommitment; updateCommitment; orgId: string; claimedBNs: Set<string>; now: string }`

- [ ] **Step 1: Export `SUBMITTABLE_STATUS`**

In `src/lib/commitments/actions.ts`, change:
```ts
const SUBMITTABLE_STATUS: CommitmentStatus[] = ["committed", "in_progress", "reported", "stalled"];
```
to:
```ts
export const SUBMITTABLE_STATUS: CommitmentStatus[] = ["committed", "in_progress", "reported", "stalled"];
```

- [ ] **Step 2: Write the failing test**

Create `scripts/test-commitment-authz.ts`:
```ts
import { updateCommitmentCore } from "../src/lib/commitments/actions-core";
import type { Commitment } from "../src/lib/commitments/types";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); ok ? pass++ : fail++; };

function seed(over: Partial<Commitment> = {}): Commitment {
  return { id: "cm-1", orgName: "Northway", sector: "finance", orgSize: "large", type: "procurement",
    title: "seeded", targetYear: 2027, status: "committed", progressPct: 0,
    history: [{ period: "2026", status: "committed", progressPct: 0, authoredBy: "public-research" }],
    createdAt: "2026-01-01T00:00:00.000Z", businessNumber: "123456782", ...over };
}

function deps(cur: Commitment | null, orgId: string, claimedBNs: string[]) {
  let saved: { id: string; patch: any } | null = null;
  return {
    d: {
      getCommitment: async (_id: string) => cur,
      updateCommitment: async (id: string, patch: any) => { saved = { id, patch }; return { ...(cur as Commitment), ...patch }; },
      orgId, claimedBNs: new Set(claimedBNs), now: "2026-07-15T00:00:00.000Z",
    },
    saved: () => saved,
  };
}

async function main() {
  // 1. claimed-BN owner may update a seeded row (orgId mismatch, BN match)
  const a = deps(seed(), "c-northway", ["123456782"]);
  const r1 = await updateCommitmentCore(a.d, { id: "cm-1", status: "reported", progressPct: 40 });
  check("claimed-BN owner may update seeded row", r1.ok === true);
  check("stamps authoredBy = partyId on the new point",
    a.saved()?.patch.history.at(-1).authoredBy === "c-northway");
  check("appends a fresh point for the current year",
    a.saved()?.patch.history.length === 2 && a.saved()?.patch.history.at(-1).period === "2026");

  // 2. party without a claim on the BN is rejected
  const b = deps(seed(), "c-someoneelse", []);
  const r2 = await updateCommitmentCore(b.d, { id: "cm-1", status: "reported", progressPct: 90 });
  check("no claim on the BN ⇒ rejected", r2.ok === false && b.saved() === null);

  // 3. self-created row owned by partyId (no BN) still works
  const c = deps(seed({ businessNumber: undefined, orgId: "c-self" }), "c-self", []);
  const r3 = await updateCommitmentCore(c.d, { id: "cm-1", status: "in_progress", progressPct: 10 });
  check("partyId owner still works", r3.ok === true);

  // 4. status above the submittable cap is rejected
  const d = deps(seed(), "c-northway", ["123456782"]);
  const r4 = await updateCommitmentCore(d.d, { id: "cm-1", status: "confirmed" as any, progressPct: 100 });
  check("status past 'reported' cap rejected", r4.ok === false && d.saved() === null);

  process.exit(fail ? 1 : 0);
}
main();
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx scripts/test-commitment-authz.ts`
Expected: FAIL — module `actions-core` not found.

- [ ] **Step 4: Write the testable core**

Create `src/lib/commitments/actions-core.ts`:
```ts
// Testable core for company commitment edits — no "use server". actions.ts wraps
// this with the real session + repo + identity-seam dependencies. Ownership is the
// crosswalk's core behavioral change: a caller owns a row if it created it
// (orgId === partyId) OR holds a granted OrgClaim on the row's businessNumber.
import { SUBMITTABLE_STATUS } from "./actions";
import type { Commitment, CommitmentPatch, CommitmentStatus, ProgressPoint } from "./types";

export interface UpdateDeps {
  getCommitment(id: string): Promise<Commitment | null>;
  updateCommitment(id: string, patch: CommitmentPatch): Promise<Commitment | null>;
  orgId: string;              // session.partyId
  claimedBNs: Set<string>;    // granted BNs from resolveOrgForParty
  now: string;                // ISO timestamp (injected for testability)
}

export async function updateCommitmentCore(
  deps: UpdateDeps,
  input: { id: string; status: CommitmentStatus; progressPct: number },
): Promise<{ ok: boolean }> {
  const cur = await deps.getCommitment(input.id);
  const owns =
    !!cur &&
    (cur.orgId === deps.orgId ||
      (!!cur.businessNumber && deps.claimedBNs.has(cur.businessNumber)));
  if (!cur || !owns) return { ok: false };
  if (!SUBMITTABLE_STATUS.includes(input.status)) return { ok: false };

  const progressPct = Math.max(0, Math.min(100, Math.round(input.progressPct)));
  const year = new Date(deps.now).getFullYear().toString();
  const point: ProgressPoint = { period: year, status: input.status, progressPct, authoredBy: deps.orgId };
  const history = [...cur.history];
  const last = history[history.length - 1];
  if (last && last.period === year) history[history.length - 1] = point;
  else history.push(point);

  await deps.updateCommitment(input.id, { status: input.status, progressPct, history });
  return { ok: true };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/test-commitment-authz.ts`
Expected: PASS — all six ✅.

- [ ] **Step 6: Wire the core into the server action**

In `src/lib/commitments/actions.ts`, add imports at the top:
```ts
import { resolveOrgForParty } from "@/lib/identity";
import { updateCommitmentCore } from "./actions-core";
```
Replace the body of `updateCommitmentAction` (currently `actions.ts:73-94`) with:
```ts
export async function updateCommitmentAction(formData: FormData) {
  const ctx = await companyContext();
  if (!ctx) return;
  const { bns } = await resolveOrgForParty(ctx.orgId);
  const res = await updateCommitmentCore(
    {
      getCommitment: (id) => commitmentsRepo.getCommitment(id),
      updateCommitment: (id, patch) => commitmentsRepo.updateCommitment(id, patch),
      orgId: ctx.orgId,
      claimedBNs: new Set(bns),
      now: new Date().toISOString(),
    },
    {
      id: String(formData.get("id") ?? ""),
      status: String(formData.get("status")) as CommitmentStatus,
      progressPct: clampPct(formData.get("progressPct")),
    },
  );
  if (res.ok) revalidate();
}
```

- [ ] **Step 7: Stamp BN on company-created rows**

In `createCommitmentAction` (`actions.ts:39-71`), stamp the company's BN when it holds exactly one granted claim — resolved via the **identity seam** (not a direct RAP-domain import, preserving domain isolation). `resolveOrgForParty` is already imported from Step 6. After `const ctx = await companyContext();` (and its guard), before `const c: Commitment = {`:
```ts
  const { bns } = await resolveOrgForParty(ctx.orgId);
  const businessNumber = bns.length === 1 ? bns[0] : undefined; // exactly-one-claim rule
```
and add to the `Commitment` literal (replacing the existing `history:` line so the seeded point is authored):
```ts
    businessNumber,
    history: [{ period, status, progressPct, authoredBy: ctx.orgId }],
```

- [ ] **Step 8: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/commitments/actions.ts src/lib/commitments/actions-core.ts scripts/test-commitment-authz.ts
git commit -m "feat(commitments): claimed-BN ownership on updates + authoredBy stamping"
```

---

## Task 4: Curated BN map + `bnForOrgName`

**Files:**
- Create: `src/lib/commitments/org-bn-map.ts`
- Test: `scripts/test-org-bn-map.ts`

**Interfaces:**
- Consumes: `slugifyOrg` (`src/lib/commitments/orgs.ts:20`); `isValidBN` (`src/lib/rap/bn.ts`).
- Produces: `ORG_BN_MAP: Record<string, string>`; `bnForOrgName(orgName: string): string | undefined`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-org-bn-map.ts`:
```ts
import { ORG_BN_MAP, bnForOrgName } from "../src/lib/commitments/org-bn-map";
import { isValidBN } from "../src/lib/rap/bn";
import { slugifyOrg } from "../src/lib/commitments/orgs";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); ok ? pass++ : fail++; };

async function main() {
  check("every mapped BN is Luhn-valid",
    Object.values(ORG_BN_MAP).every((bn) => isValidBN(bn) !== null));
  check("keys are already slugified",
    Object.keys(ORG_BN_MAP).every((k) => slugifyOrg(k) === k));
  // lookup goes through slugifyOrg, so a raw org name resolves
  const [firstSlug, firstBn] = Object.entries(ORG_BN_MAP)[0] ?? [];
  if (firstSlug) check("bnForOrgName resolves a mapped org", bnForOrgName(firstSlug) === firstBn);
  check("unmapped org ⇒ undefined", bnForOrgName("Definitely Not A Real Seeded Org 9Z") === undefined);
  process.exit(fail ? 1 : 0);
}
main();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-org-bn-map.ts`
Expected: FAIL — module `org-bn-map` not found.

- [ ] **Step 3: Create the map + helper**

Create `src/lib/commitments/org-bn-map.ts`:
```ts
// Curated, confidence-gated crosswalk: seeded org (by slug) → 9-digit Business
// Number root, sourced from Corporations Canada. CONFIDENCE RULE: include an org
// ONLY when its legal entity is unambiguous. Ambiguous / multi-entity brands
// (e.g. "Enbridge") are LEFT OUT — they stay display-only (businessNumber absent).
// Every value MUST pass isValidBN (Luhn-valid 9 digits).
//
// ⚠️ CURATION IS A HUMAN STEP. The entries below are placeholders using
// Luhn-valid synthetic BNs for the demo orgs. Replace each with the real
// Corporations Canada BN before running the prod migration; expand top-N over time.
import { slugifyOrg } from "./orgs";

export const ORG_BN_MAP: Record<string, string> = {
  // Starter entry — a REAL seeded org (Cameco Corporation, cm-cameco-proc) with a
  // synthetic Luhn-valid BN standing in until curated. Cameco is an unambiguous
  // single legal entity, so it satisfies the confidence rule.
  "cameco": "123456782",
  // add ~15–25 high-confidence seeded orgs here, slug: realBN9
};

export function bnForOrgName(orgName: string): string | undefined {
  return ORG_BN_MAP[slugifyOrg(orgName)];
}
```
> `"cameco"` is `slugifyOrg("Cameco")` for the seeded row `orgName: "Cameco"` (confirmed in `src/lib/commitments/fixtures.ts`). Its BN value here is a synthetic placeholder — replace with Cameco's real Corporations Canada BN before the prod migration.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-org-bn-map.ts`
Expected: PASS — all ✅.

- [ ] **Step 5: Commit**

```bash
git add src/lib/commitments/org-bn-map.ts scripts/test-org-bn-map.ts
git commit -m "feat(commitments): curated org→BN crosswalk map (top-N, confidence-gated)"
```

---

## Task 5: Idempotent backfill migration

**Files:**
- Create: `scripts/migrate-commitment-bn.ts`
- Test: `scripts/test-migrate-commitment-bn.ts`

**Interfaces:**
- Consumes: `ORG_BN_MAP` / `bnForOrgName` (Task 4).
- Produces: pure `planCommitmentBN(c: Commitment): Commitment | null` — returns the updated commitment when a change is needed, else `null` (idempotency signal).

- [ ] **Step 1: Write the failing test**

Create `scripts/test-migrate-commitment-bn.ts`:
```ts
import { planCommitmentBN } from "./migrate-commitment-bn";
import type { Commitment } from "../src/lib/commitments/types";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); ok ? pass++ : fail++; };

function make(over: Partial<Commitment>): Commitment {
  return { id: "cm", orgName: "Cameco", sector: "mining", orgSize: "large",
    type: "procurement", title: "t", targetYear: 2027, status: "committed", progressPct: 0,
    history: [{ period: "2026", status: "committed", progressPct: 0 }],
    createdAt: "2026-01-01T00:00:00.000Z", ...over };
}

async function main() {
  const mapped = planCommitmentBN(make({}));
  check("sets BN for a mapped org", mapped?.businessNumber === "123456782");
  check("stamps public-research authorship on existing history",
    mapped?.history.every((h) => h.authoredBy === "public-research") === true);

  const already = planCommitmentBN(make({ businessNumber: "123456782",
    history: [{ period: "2026", status: "committed", progressPct: 0, authoredBy: "public-research" }] }));
  check("idempotent: already-migrated row ⇒ null", already === null);

  const unmapped = planCommitmentBN(make({ orgName: "Totally Unmapped Org 9Z" }));
  check("unmapped org ⇒ null (untouched)", unmapped === null);

  process.exit(fail ? 1 : 0);
}
main();
```
> Ensure the mapped-org name/slug matches the real entry you curated in Task 4.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-migrate-commitment-bn.ts`
Expected: FAIL — module `migrate-commitment-bn` not found.

- [ ] **Step 3: Write the migration (pure core + DynamoDB shell)**

Create `scripts/migrate-commitment-bn.ts` (mirrors `scripts/migrate-supplier-ccib.ts` — pure helper is unit-tested; the scan/put shell is verified by running against local DynamoDB):
```ts
// Idempotent backfill: set businessNumber on seeded commitments whose org is in
// ORG_BN_MAP, and stamp existing history points with authoredBy: "public-research".
// Ships WITH the schema change (ccib lesson). Re-runnable; only writes changed rows.
//   Local: DYNAMO_ENDPOINT=http://localhost:8000 COMMITMENTS_TABLE=Commitments npx tsx scripts/migrate-commitment-bn.ts
//   Cloud: AWS_PROFILE=isb DYNAMO_TABLE=<physical-name> npx tsx scripts/migrate-commitment-bn.ts
import { ScanCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE } from "../src/lib/dynamo/client";
import type { Commitment } from "../src/lib/commitments/types";
import { bnForOrgName } from "../src/lib/commitments/org-bn-map";

// Returns an updated copy when a change is needed, else null (idempotency).
export function planCommitmentBN(c: Commitment): Commitment | null {
  const bn = bnForOrgName(c.orgName);
  if (!bn) return null;
  const needsBN = c.businessNumber !== bn;
  const needsAuthor = c.history.some((h) => h.authoredBy === undefined);
  if (!needsBN && !needsAuthor) return null;
  return {
    ...c,
    businessNumber: bn,
    history: c.history.map((h) => ({ ...h, authoredBy: h.authoredBy ?? "public-research" })),
  };
}

async function main() {
  let scanned = 0, updated = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddbDoc.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
    for (const item of page.Items ?? []) {
      scanned++;
      // Commitments are stored under item.data (matches repo.dynamo write shape).
      const c = item.data as Commitment | undefined;
      if (!c || !c.orgName) continue;
      const next = planCommitmentBN(c);
      if (!next) continue;
      await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: { ...item, data: next } }));
      updated++;
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  console.log(`scanned ${scanned}, updated ${updated}`);
}

if (process.argv[1]?.includes("migrate-commitment-bn")) main();
```
> Verify the stored item shape in `src/lib/commitments/repo.dynamo.ts` (`createCommitment`) — if commitments are not stored under `item.data`, adjust the read/write of `c` to match the real shape. The `if (process.argv[1]…)` guard lets the test import `planCommitmentBN` without running `main()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-migrate-commitment-bn.ts`
Expected: PASS — all four ✅.

- [ ] **Step 5: Verify the migration end-to-end against local DynamoDB**

```bash
npm run ddb:up
npm run commitments:create && npm run commitments:seed
DYNAMO_ENDPOINT=http://localhost:8000 COMMITMENTS_TABLE=Commitments npx tsx scripts/migrate-commitment-bn.ts   # prints "scanned N, updated M"
DYNAMO_ENDPOINT=http://localhost:8000 COMMITMENTS_TABLE=Commitments npx tsx scripts/migrate-commitment-bn.ts   # second run prints "updated 0"  ← idempotent
```
Expected: first run `updated ≥ 1`, second run `updated 0`.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-commitment-bn.ts scripts/test-migrate-commitment-bn.ts
git commit -m "feat(commitments): idempotent BN backfill migration (ships with schema)"
```

---

## Task 6: Unified company view — edit your seeded commitments

**Files:**
- Modify: `src/app/my-commitments/page.tsx`
- Test: `scripts/test-my-commitments-read.ts` (data-layer read) + manual app drive

**Interfaces:**
- Consumes: `resolveOrgForParty`, `listCommitmentsForBNs` (Task 2); `updateCommitmentAction` (Task 3).

- [ ] **Step 1: Read the current page**

Run: `sed -n '1,80p' src/app/my-commitments/page.tsx` — note how it fetches the company's own commitments (by `orgId === partyId`) and renders the edit form wired to `updateCommitmentAction`.

- [ ] **Step 2: Write the failing data-layer test**

Create `scripts/test-my-commitments-read.ts` — verifies the union read (own rows + BN-matched seeded rows, de-duplicated by id):
```ts
import { listCommitmentsForBNs } from "../src/lib/identity";
import { mockCommitmentsRepo } from "../src/lib/commitments/repo.mock";
import type { Commitment } from "../src/lib/commitments/types";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); ok ? pass++ : fail++; };

function make(id: string, over: Partial<Commitment>): Commitment {
  return { id, orgName: "Northway", sector: "finance", orgSize: "large", type: "procurement",
    title: id, targetYear: 2027, status: "committed", progressPct: 0,
    history: [{ period: "2026", status: "committed", progressPct: 0 }],
    createdAt: "2026-01-01T00:00:00.000Z", ...over };
}

// mirrors the page's union helper (extract it to a pure function on the page or a sibling)
async function unionForCompany(partyId: string, bns: string[]) {
  const own = (await mockCommitmentsRepo.listCommitments()).filter((c) => c.orgId === partyId);
  const seeded = await listCommitmentsForBNs(bns, mockCommitmentsRepo);
  const byId = new Map<string, Commitment>();
  for (const c of [...own, ...seeded]) byId.set(c.id, c);
  return [...byId.values()];
}

async function main() {
  await mockCommitmentsRepo.createCommitment(make("own-1", { orgId: "c-northway" }));
  await mockCommitmentsRepo.createCommitment(make("seed-1", { businessNumber: "123456782" }));
  const rows = await unionForCompany("c-northway", ["123456782"]);
  check("union includes own + BN-matched seeded", rows.some((c) => c.id === "own-1") && rows.some((c) => c.id === "seed-1"));
  check("de-duplicates by id", new Set(rows.map((c) => c.id)).size === rows.length);
  process.exit(fail ? 1 : 0);
}
main();
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx scripts/test-my-commitments-read.ts`
Expected: FAIL — assertion fails (no union logic yet) or the seeded row is missing.

- [ ] **Step 4: Implement the union read on the page**

In `src/app/my-commitments/page.tsx`, after resolving the session's `partyId`, add:
```ts
import { resolveOrgForParty, listCommitmentsForBNs } from "@/lib/identity";
// ...
const { bns } = await resolveOrgForParty(partyId);
const own = (await commitmentsRepo.listCommitments()).filter((c) => c.orgId === partyId);
const seeded = await listCommitmentsForBNs(bns);
const byId = new Map<string, typeof own[number]>();
for (const c of [...own, ...seeded]) byId.set(c.id, c);
const commitments = [...byId.values()];
```
Render seeded rows (those where `c.orgId !== partyId`) with a small **"Public record — sourced by Indigenomics"** badge, above the same edit form already wired to `updateCommitmentAction`. Company inputs stay limited to status (`SUBMITTABLE_STATUS`) + progress %; do not render `title`/`targetYear` as editable.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/test-my-commitments-read.ts`
Expected: PASS — both ✅.

- [ ] **Step 6: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both pass.

- [ ] **Step 7: Drive it in the running app**

```bash
npm run ddb:up && npm run commitments:create && npm run commitments:seed
DYNAMO_ENDPOINT=http://localhost:8000 COMMITMENTS_TABLE=Commitments npx tsx scripts/migrate-commitment-bn.ts
npm run dev
```
Sign in as the demo company that holds a granted claim on the mapped BN, open `/my-commitments`, confirm a seeded (public-badged) row appears, update its progress, and confirm the change persists with `authoredBy` = the company's partyId (inspect the row via `commitmentsRepo` or the DB). If no demo company holds a matching claim, use the claim flow on `/my-rap/claim` first.

- [ ] **Step 8: Commit**

```bash
git add src/app/my-commitments/page.tsx scripts/test-my-commitments-read.ts
git commit -m "feat(my-commitments): company can view + update its BN-matched seeded commitments"
```

---

## Task 7: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run every crosswalk test**

```bash
for t in commitment-schema identity-crosswalk commitment-authz org-bn-map migrate-commitment-bn my-commitments-read; do
  echo "== $t =="; npx tsx scripts/test-$t.ts || exit 1
done
```
Expected: all ✅, exit 0.

- [ ] **Step 2: Typecheck + build + auth regression**

```bash
npm run typecheck && npm run build && npm run verify:auth
```
Expected: all pass (auth harness unaffected).

- [ ] **Step 3: Regression — non-BN orgs render unchanged**

Confirm `/commitments` and an org scorecard for an org NOT in `ORG_BN_MAP` render identically to `main` (no BN, no badges, same rollups). Drive both pages in the running app.

- [ ] **Step 4: Open the PR**

```bash
gh pr create --repo logisticPM/portal --base main \
  --title "feat(commitments): BN crosswalk foundation — schema + identity seam + backfill + claimed-BN authz" \
  --body "Implements docs/superpowers/specs/2026-07-14-domain-reconciliation-crosswalk-design.md (PR-1..PR-5 foundation). Additive businessNumber + authoredBy; src/lib/identity seam; curated top-N org→BN map + idempotent migration (run on prod after merge); claimed-BN ownership on updateCommitmentAction; /my-commitments unified view. No RapData migration (already BN-keyed)."
```

- [ ] **Step 5: Post-merge prod migration (run by Nate)**

```bash
aws sso login --profile isb
AWS_PROFILE=isb DYNAMO_TABLE=<Commitments-physical-name> npx tsx scripts/migrate-commitment-bn.ts   # run twice; second = "updated 0"
```

---

## Notes for the evidence-precedence plan (next)

This foundation exposes exactly what the evidence-precedence spec (`2026-07-15-…`) consumes: `resolveOrgForParty`, `listCommitmentsForBNs`, and `Commitment.businessNumber`. The `ClaimReader` seam is where that plan will add `showcaseOptIn`. Do **not** start it until this PR is merged and the prod migration has run.

**Deliberate simplification (spec §5.2):** this plan does not implement `listRapsForBNs` or a single page merging both domains. Task 6 surfaces seeded commitments on `/my-commitments`; uploaded RAPs stay on `/my-rap`. The core authz value (a company edits its own seeded commitments) is fully delivered; the RAP-side fan-out and the one-page merge land with the evidence-precedence surfacing (its PR-D), which is where a genuinely unified view earns its keep.
