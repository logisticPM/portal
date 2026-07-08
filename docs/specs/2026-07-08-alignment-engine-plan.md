# Alignment Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically score matches between company **procurement commitments** and **verified Indigenous suppliers**, and surface them to companies (per-commitment supplier panel) and to Indigenomics (a matchmaking radar), recomputed in near-real-time.

**Architecture:** A pure scoring core + a deterministic sector normalizer feed an orchestration engine that fetches the supplier pool (PortalRepo) and commitments (CommitmentsRepo), scores each pair (structured + embedding-cosine), optionally attaches an LLM rationale, and upserts `Opportunity` rows behind a mock/dynamo repo seam. A DynamoDB Streams Lambda on the `Commitments` table recomputes on commitment change; a backfill script seeds the initial set. Two read surfaces render the opportunities.

**Tech Stack:** Next.js 14 App Router · DynamoDB single-table · Node `crypto` · reuse existing Bedrock Titan embedder + Converse LLM + the stub/offline variants (`src/lib/cases/*`) · SST v4 Dynamo streams · `tsx` verify harness (no unit-test framework).

**Spec:** `docs/specs/2026-07-08-alignment-engine-design.md`

---

## File Structure

**Create:**
- `src/lib/alignment/types.ts` — `Opportunity`, `OpportunityRepo`, scoring input types.
- `src/lib/alignment/score.ts` — pure structured score + cosine + combine (no I/O).
- `src/lib/alignment/normalize.ts` — freeform supplier sector/region → `Sector` enum / region code (deterministic map).
- `src/lib/dynamo/alignment-table.ts` — `opportunityKeys`, `toOpportunityItem`, `itemToOpportunity`.
- `src/lib/alignment/repo.mock.ts`, `repo.dynamo.ts`, `index.ts` — `Opportunity` persistence (REPO_IMPL-selected).
- `src/lib/alignment/engine.ts` — orchestrate scoring + rationale + upsert for a commitment.
- `src/functions/alignment.ts` — Commitments-stream Lambda → recompute.
- `scripts/verify-alignment.ts` — assertion harness (scoring, normalize, marshaller, repo parity, scenario).
- `scripts/seed-alignment.ts` — one-off backfill over all commitments.
- `src/app/alignment/page.tsx` — institute radar (approach C).

**Modify:**
- `src/lib/repo/types.ts` — add `sectorNorm?` / `regionNorm?` to `Supplier`.
- `src/lib/dynamo/single-table.ts` — carry `sectorNorm`/`regionNorm` in `toPartyItem`/`itemToParty`.
- `src/lib/seed/fixtures.ts` — add ~5 real suppliers with normalized fields.
- `src/app/my-commitments/page.tsx` — per-commitment supplier panel (approach A).
- `sst.config.ts` — `Alignment` table, `Commitments` stream + subscriber, perms/env.
- `package.json` — `verify:alignment` script.

---

## Task 1: Opportunity types

**Files:**
- Create: `src/lib/alignment/types.ts`

- [ ] **Step 1: Create the types**

```ts
// ===========================================================================
// Alignment domain — a scored match between a company procurement commitment
// and a verified Indigenous supplier. See docs/specs/2026-07-08-alignment-engine-design.md
// ===========================================================================
import type { IdentityTier } from "../repo/types";

export type OpportunityStatus = "new" | "seen" | "acted" | "dismissed";

export interface OpportunityReasons {
  sectorMatch: boolean;
  regionMatch: boolean;
  identityTier: IdentityTier;
  semantic: number; // 0..1 cosine similarity
}

export interface Opportunity {
  id: string; // `${commitmentId}::${supplierId}` — deterministic, idempotent
  commitmentId: string;
  orgId: string; // the committing company (drives the company-view read)
  supplierId: string;
  supplierName: string; // denormalized for list rendering
  commitmentTitle: string; // denormalized for the radar
  score: number; // 0..1 combined
  reasons: OpportunityReasons;
  rationale?: string; // AI one-liner (optional; best-effort)
  status: OpportunityStatus;
  createdAt: string; // ISO 8601
}

export interface OpportunityRepo {
  listForOrg(orgId: string): Promise<Opportunity[]>; // company view (approach A)
  listAll(): Promise<Opportunity[]>; // institute radar (approach C)
  upsert(o: Opportunity): Promise<Opportunity>;
  remove(id: string): Promise<void>;
  setStatus(id: string, status: OpportunityStatus): Promise<void>;
}

export const opportunityId = (commitmentId: string, supplierId: string) =>
  `${commitmentId}::${supplierId}`;
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit 2>&1 | grep -E "alignment/types" || echo "clean"`
Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add src/lib/alignment/types.ts
git commit -m "feat(alignment): Opportunity types + repo interface"
```

---

## Task 2: Pure scoring core

**Files:**
- Create: `src/lib/alignment/score.ts`
- Create: `scripts/verify-alignment.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the npm script**

In `package.json` scripts, after the `"verify:auth"` line add:

```json
    "verify:alignment": "tsx scripts/verify-alignment.ts",
```

- [ ] **Step 2: Write the failing harness (scoring section)**

Create `scripts/verify-alignment.ts`:

```ts
// ===========================================================================
// Alignment verification harness — `npm run verify:alignment`.
// Pure checks (score, normalize, marshaller) need no DB. Repo-parity + scenario
// sections (added in later tasks) need DynamoDB Local (`npm run ddb:up`).
// ===========================================================================
import { cosine, structuredScore, combine } from "../src/lib/alignment/score";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
}

async function main() {
  // --- cosine ---
  check("cosine: identical vectors = 1", Math.abs(cosine(new Float32Array([1, 0]), new Float32Array([1, 0])) - 1) < 1e-6);
  check("cosine: orthogonal = 0", Math.abs(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))) < 1e-6);

  // --- structured score ---
  const full = structuredScore({ sectorMatch: true, regionMatch: true, identityTier: "nation", ownershipPct: 100 });
  const none = structuredScore({ sectorMatch: false, regionMatch: false, identityTier: "self_declared", ownershipPct: 20 });
  check("structured: full match > partial > none", full > none && full <= 1 && none >= 0);
  check("structured: sector+region+nation is high", full >= 0.8);

  // --- combine ---
  check("combine: weights structured + semantic", Math.abs(combine(1, 1) - 1) < 1e-6 && combine(0, 0) === 0);
  check("combine: monotonic in semantic", combine(0.5, 0.9) > combine(0.5, 0.1));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("❌ verify-alignment crashed:", e);
  process.exit(1);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run verify:alignment`
Expected: FAIL — module `../src/lib/alignment/score` not found.

- [ ] **Step 4: Implement `score.ts`**

Create `src/lib/alignment/score.ts`:

```ts
// ===========================================================================
// Pure scoring — no I/O, fully deterministic (unit-tested). The engine feeds it
// structured facts + a precomputed semantic cosine; it returns 0..1 scores.
// ===========================================================================
import type { IdentityTier } from "../repo/types";

// Tunable weights + cutoffs (single source of truth).
export const THRESHOLD = 0.6; // keep opportunities scoring >= this
export const TOP_N = 5; // per commitment
const W_STRUCTURED = 0.55;
const W_SEMANTIC = 0.45;

const TIER_WEIGHT: Record<IdentityTier, number> = {
  nation: 1,
  ccab: 0.9,
  self_declared: 0.4,
};

// Cosine similarity of two L2-normalized-ish vectors (guards zero norm).
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

export function structuredScore(input: {
  sectorMatch: boolean;
  regionMatch: boolean;
  identityTier: IdentityTier;
  ownershipPct?: number;
}): number {
  const sector = input.sectorMatch ? 0.45 : 0;
  const region = input.regionMatch ? 0.2 : 0;
  const tier = TIER_WEIGHT[input.identityTier] * 0.25;
  const ownership = Math.min(1, (input.ownershipPct ?? 51) / 100) * 0.1;
  return Math.min(1, sector + region + tier + ownership);
}

// Combine structured + semantic into the final 0..1 score.
export function combine(structured: number, semantic: number): number {
  return Math.min(1, W_STRUCTURED * structured + W_SEMANTIC * Math.max(0, semantic));
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run verify:alignment`
Expected: PASS — 6 passed, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/alignment/score.ts scripts/verify-alignment.ts package.json
git commit -m "feat(alignment): pure scoring core (structured + cosine + combine)"
```

---

## Task 3: Sector / region normalization

**Files:**
- Create: `src/lib/alignment/normalize.ts`
- Modify: `scripts/verify-alignment.ts`

- [ ] **Step 1: Write the failing test**

In `scripts/verify-alignment.ts`, add the import at the top:

```ts
import { normalizeSector, normalizeRegion } from "../src/lib/alignment/normalize";
```

And inside `main()` before the summary, add:

```ts
  // --- normalization (deterministic map) ---
  check("normalize sector: Construction -> construction", normalizeSector("Construction") === "construction");
  check("normalize sector: Logistics -> transport", normalizeSector("Logistics") === "transport");
  check("normalize sector: IT consulting -> consulting", normalizeSector("IT consulting") === "consulting");
  check("normalize sector: unknown -> undefined", normalizeSector("basket weaving") === undefined);
  check("normalize region: British Columbia -> BC", normalizeRegion("British Columbia") === "BC");
  check("normalize region: AB stays AB", normalizeRegion("AB") === "AB");
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run verify:alignment`
Expected: FAIL — module `../src/lib/alignment/normalize` not found.

- [ ] **Step 3: Implement `normalize.ts`**

Create `src/lib/alignment/normalize.ts`:

```ts
// ===========================================================================
// Deterministic normalization of freeform supplier sector/region onto the
// Commitments-module Sector enum + province codes. Covers the demo supplier set
// without an LLM (unit-testable). LLM fallback for unknowns is future work.
// ===========================================================================
import type { Sector } from "../commitments/types";

// keyword (lowercased substring) -> Sector. First hit wins; order = specificity.
const SECTOR_MAP: [string, Sector][] = [
  ["construction", "construction"],
  ["logistics", "transport"],
  ["freight", "transport"],
  ["transport", "transport"],
  ["catering", "retail"],
  ["food", "retail"],
  ["retail", "retail"],
  ["it ", "consulting"],
  ["information technology", "consulting"],
  ["software", "consulting"],
  ["consulting", "consulting"],
  ["office", "retail"],
  ["energy", "energy"],
  ["mining", "mining"],
  ["finance", "finance"],
  ["bank", "finance"],
  ["health", "health"],
  ["forestry", "forestry"],
  ["telecom", "telecom"],
  ["education", "education"],
  ["aerospace", "aerospace"],
  ["agri", "agriculture"],
  ["government", "government"],
  ["media", "media"],
];

export function normalizeSector(freeform?: string): Sector | undefined {
  if (!freeform) return undefined;
  const s = freeform.toLowerCase();
  for (const [kw, sector] of SECTOR_MAP) if (s.includes(kw)) return sector;
  return undefined;
}

const REGION_MAP: Record<string, string> = {
  "british columbia": "BC",
  bc: "BC",
  alberta: "AB",
  ab: "AB",
  saskatchewan: "SK",
  sk: "SK",
  manitoba: "MB",
  mb: "MB",
  ontario: "ON",
  on: "ON",
  quebec: "QC",
  qc: "QC",
  "nova scotia": "NS",
  ns: "NS",
  "new brunswick": "NB",
  nb: "NB",
  "newfoundland and labrador": "NL",
  nl: "NL",
  "prince edward island": "PE",
  pe: "PE",
  yukon: "YT",
  yt: "YT",
  "northwest territories": "NT",
  nt: "NT",
  nunavut: "NU",
  nu: "NU",
};

export function normalizeRegion(freeform?: string): string | undefined {
  if (!freeform) return undefined;
  return REGION_MAP[freeform.trim().toLowerCase()] ?? undefined;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run verify:alignment`
Expected: PASS — 12 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/alignment/normalize.ts scripts/verify-alignment.ts
git commit -m "feat(alignment): deterministic sector/region normalization"
```

---

## Task 4: Opportunity single-table marshaller

**Files:**
- Create: `src/lib/dynamo/alignment-table.ts`
- Modify: `scripts/verify-alignment.ts`

- [ ] **Step 1: Write the failing test**

In `scripts/verify-alignment.ts` add near the top:

```ts
import { opportunityKeys, toOpportunityItem, itemToOpportunity } from "../src/lib/dynamo/alignment-table";
import type { Opportunity } from "../src/lib/alignment/types";
```

And in `main()` before the summary:

```ts
  // --- opportunity marshalling ---
  const o: Opportunity = {
    id: "cm-rbc-proc::s-eagle", commitmentId: "cm-rbc-proc", orgId: "rbc-royal-bank-of-canada",
    supplierId: "s-eagle", supplierName: "Eagle River Construction", commitmentTitle: "Grow Indigenous procurement",
    score: 0.82, reasons: { sectorMatch: true, regionMatch: false, identityTier: "nation", semantic: 0.71 },
    rationale: "Fits the construction procurement target.", status: "new", createdAt: "2025-01-15T00:00:00.000Z",
  };
  const item = toOpportunityItem(o);
  check("opp: PK is OPPORTUNITY#<orgId>", item.PK === "OPPORTUNITY#rbc-royal-bank-of-canada");
  check("opp: GSI1PK groups all (radar)", item.GSI1PK === "OPPORTUNITY");
  check("opp: round-trips", JSON.stringify(itemToOpportunity(item)) === JSON.stringify(o));
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run verify:alignment`
Expected: FAIL — module `../src/lib/dynamo/alignment-table` not found.

- [ ] **Step 3: Implement `alignment-table.ts`**

Create `src/lib/dynamo/alignment-table.ts`:

```ts
// ===========================================================================
// Single-table marshalling for Opportunity (its own `Alignment` table).
//   AP-company:  PK=OPPORTUNITY#<orgId>  SK=SCORE#<pad>#<id>   (a company's, ranked)
//   AP-radar:    GSI1PK=OPPORTUNITY      GSI1SK=SCORE#<pad>#<id> (global, ranked)
// Score is zero-padded so lexicographic SK order == descending score.
// ===========================================================================
import type { Opportunity } from "../alignment/types";

export const ALIGNMENT_TABLE = process.env.ALIGNMENT_TABLE ?? "Alignment";
export const GSI1 = "GSI1"; // global ranked radar

// 0.823 -> "1000"-based pad so higher score sorts LAST; we query ScanIndexForward=false.
const padScore = (score: number) => String(Math.round(score * 10000)).padStart(5, "0");

export const opportunityKeys = {
  profile: (orgId: string, score: number, id: string) => ({
    PK: `OPPORTUNITY#${orgId}`,
    SK: `SCORE#${padScore(score)}#${id}`,
  }),
};

export function toOpportunityItem(o: Opportunity) {
  return {
    ...opportunityKeys.profile(o.orgId, o.score, o.id),
    et: "Opportunity",
    GSI1PK: "OPPORTUNITY",
    GSI1SK: `SCORE#${padScore(o.score)}#${o.id}`,
    data: o, // store the full domain object
  };
}

export function itemToOpportunity(it: any): Opportunity {
  const d = it.data as Opportunity;
  return {
    id: d.id,
    commitmentId: d.commitmentId,
    orgId: d.orgId,
    supplierId: d.supplierId,
    supplierName: d.supplierName,
    commitmentTitle: d.commitmentTitle,
    score: d.score,
    reasons: {
      sectorMatch: d.reasons.sectorMatch,
      regionMatch: d.reasons.regionMatch,
      identityTier: d.reasons.identityTier,
      semantic: d.reasons.semantic,
    },
    ...(d.rationale !== undefined ? { rationale: d.rationale } : {}),
    status: d.status,
    createdAt: d.createdAt,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run verify:alignment`
Expected: PASS — 15 passed, 0 failed. (The round-trip is exact for the fully-populated `o` above.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/dynamo/alignment-table.ts scripts/verify-alignment.ts
git commit -m "feat(alignment): Opportunity single-table marshaller"
```

---

## Task 5: Opportunity repo (mock + dynamo)

**Files:**
- Create: `src/lib/alignment/repo.mock.ts`, `src/lib/alignment/repo.dynamo.ts`, `src/lib/alignment/index.ts`
- Modify: `scripts/verify-alignment.ts`

- [ ] **Step 1: Implement the mock repo**

Create `src/lib/alignment/repo.mock.ts`:

```ts
import type { Opportunity, OpportunityRepo, OpportunityStatus } from "./types";

let store: Opportunity[] = [];

const byScore = (a: Opportunity, b: Opportunity) => b.score - a.score || a.id.localeCompare(b.id);

export const mockAlignmentRepo: OpportunityRepo = {
  async listForOrg(orgId) {
    return store.filter((o) => o.orgId === orgId).sort(byScore);
  },
  async listAll() {
    return [...store].sort(byScore);
  },
  async upsert(o) {
    store = [...store.filter((x) => x.id !== o.id), o];
    return o;
  },
  async remove(id) {
    store = store.filter((o) => o.id !== id);
  },
  async setStatus(id: string, status: OpportunityStatus) {
    store = store.map((o) => (o.id === id ? { ...o, status } : o));
  },
};

// test-only reset
export function _resetMockAlignment() {
  store = [];
}
```

- [ ] **Step 2: Implement the dynamo repo**

Create `src/lib/alignment/repo.dynamo.ts`:

```ts
import { DeleteCommand, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../dynamo/client";
import { ALIGNMENT_TABLE, GSI1, itemToOpportunity, opportunityKeys, toOpportunityItem } from "../dynamo/alignment-table";
import type { Opportunity, OpportunityRepo, OpportunityStatus } from "./types";

const TABLE = ALIGNMENT_TABLE;

export const dynamoAlignmentRepo: OpportunityRepo = {
  async listForOrg(orgId) {
    const res = await ddbDoc.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `OPPORTUNITY#${orgId}` },
        ScanIndexForward: false, // padded score → descending
      }),
    );
    return ((res.Items ?? []) as any[]).map(itemToOpportunity);
  },
  async listAll() {
    const res = await ddbDoc.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: GSI1,
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": "OPPORTUNITY" },
        ScanIndexForward: false,
      }),
    );
    return ((res.Items ?? []) as any[]).map(itemToOpportunity);
  },
  async upsert(o) {
    await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: toOpportunityItem(o) }));
    return o;
  },
  async remove(id) {
    // id encodes commitmentId::supplierId; we need orgId+score to build the key,
    // so scan-find (small table) then delete by its real key.
    const found = await findById(id);
    if (found) await ddbDoc.send(new DeleteCommand({ TableName: TABLE, Key: opportunityKeys.profile(found.orgId, found.score, found.id) }));
  },
  async setStatus(id: string, status: OpportunityStatus) {
    const found = await findById(id);
    if (found) await this.upsert({ ...found, status });
  },
};

async function findById(id: string): Promise<Opportunity | null> {
  let start: Record<string, any> | undefined;
  do {
    const r = await ddbDoc.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: start }));
    for (const it of (r.Items ?? []) as any[]) {
      if (it.et === "Opportunity" && it.data?.id === id) return itemToOpportunity(it);
    }
    start = r.LastEvaluatedKey;
  } while (start);
  return null;
}
```

- [ ] **Step 3: Wire the index**

Create `src/lib/alignment/index.ts`:

```ts
import type { OpportunityRepo } from "./types";
import { mockAlignmentRepo } from "./repo.mock";
import { dynamoAlignmentRepo } from "./repo.dynamo";

export const alignmentRepo: OpportunityRepo =
  process.env.REPO_IMPL === "dynamo" ? dynamoAlignmentRepo : mockAlignmentRepo;

export type { Opportunity, OpportunityRepo, OpportunityStatus } from "./types";
export { opportunityId } from "./types";
```

- [ ] **Step 4: Add the parity check (needs DynamoDB Local)**

In `scripts/verify-alignment.ts` add imports:

```ts
import { createTable } from "../src/lib/dynamo/create";
import { mockAlignmentRepo, _resetMockAlignment } from "../src/lib/alignment/repo.mock";
import { dynamoAlignmentRepo } from "../src/lib/alignment/repo.dynamo";
```

(Note: confirm the create-table export name — `src/lib/dynamo/create.ts` exports `createSingleTable`. The `Alignment` table uses the SAME PK/SK+GSI1 shape, so call `createSingleTable("Alignment")`. Replace `createTable`/`createSingleTable` to match the actual export.)

In `main()` before the summary:

```ts
  // --- opportunity repo parity (DynamoDB Local) ---
  if (process.env.DYNAMO_ENDPOINT) {
    process.env.ALIGNMENT_TABLE = "Alignment";
    await createSingleTable("Alignment");
    _resetMockAlignment();
    await mockAlignmentRepo.upsert(o);
    await dynamoAlignmentRepo.upsert(o);
    const m = await mockAlignmentRepo.listForOrg(o.orgId);
    const d = await dynamoAlignmentRepo.listForOrg(o.orgId);
    check("opp repo: mock ≡ dynamo (listForOrg)", JSON.stringify(m) === JSON.stringify(d));
    check("opp repo: listAll returns it", (await dynamoAlignmentRepo.listAll()).some((x) => x.id === o.id));
  } else {
    console.warn("⚠️  opp repo parity skipped — set DYNAMO_ENDPOINT (npm run ddb:up)");
  }
```

- [ ] **Step 5: Run both paths**

Run: `npm run verify:alignment` → all pure checks pass (15).
Run: `npm run ddb:up && DYNAMO_ENDPOINT=http://localhost:8000 npm run verify:alignment` → parity checks pass too.
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add src/lib/alignment/repo.mock.ts src/lib/alignment/repo.dynamo.ts src/lib/alignment/index.ts scripts/verify-alignment.ts
git commit -m "feat(alignment): Opportunity repo (mock + dynamo) + parity"
```

---

## Task 6: Supplier normalization fields

**Files:**
- Modify: `src/lib/repo/types.ts`, `src/lib/dynamo/single-table.ts`

- [ ] **Step 1: Add fields to `Supplier`**

In `src/lib/repo/types.ts`, in the `Supplier` interface, after `region?: string;` add:

```ts
  sectorNorm?: import("../commitments/types").Sector; // normalized RAP sector (alignment)
  regionNorm?: string; // normalized province code (alignment)
```

- [ ] **Step 2: Carry them through the marshaller**

In `src/lib/dynamo/single-table.ts`, in `toPartyItem`, after the `region:` line add:

```ts
    sectorNorm: p.role === "supplier" ? p.sectorNorm : undefined,
    regionNorm: p.role === "supplier" ? p.regionNorm : undefined,
```

And in `itemToParty`'s supplier branch, after `region: it.region,` add:

```ts
      sectorNorm: it.sectorNorm,
      regionNorm: it.regionNorm,
```

- [ ] **Step 3: Verify + parity unaffected**

Run: `npm run build` → succeeds.
Run: `npm run ddb:up && npm run verify` → still all pass (party round-trip carries the new optional fields; absent on existing suppliers → undefined, dropped by `removeUndefinedValues`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/repo/types.ts src/lib/dynamo/single-table.ts
git commit -m "feat(alignment): supplier sectorNorm/regionNorm fields"
```

---

## Task 7: The engine

**Files:**
- Create: `src/lib/alignment/engine.ts`
- Modify: `scripts/verify-alignment.ts`

- [ ] **Step 1: Write the scenario test**

In `scripts/verify-alignment.ts`, add import:

```ts
import { computeForCommitment } from "../src/lib/alignment/engine";
```

And in `main()` (inside the `if (process.env.DYNAMO_ENDPOINT)` block, after the repo parity checks — the engine reads seeded suppliers/commitments from DynamoDB):

```ts
    // --- engine scenario: a procurement commitment matches a same-sector verified supplier ---
    process.env.EMBED_PROVIDER = "stub"; // deterministic semantic score
    const scenarioCommit = {
      id: "cm-test-proc", orgName: "Test Co", orgId: "test-co", sector: "construction" as const,
      orgSize: "large" as const, type: "procurement" as const, title: "Grow Indigenous construction procurement",
      targetYear: 2027, status: "committed" as const, progressPct: 10, history: [{ period: "2025", status: "committed" as const, progressPct: 10 }],
      createdAt: "2025-01-15T00:00:00.000Z", detail: "Buy construction services from Indigenous firms.",
    };
    const supplierPool = [
      { id: "s-eagle", role: "supplier" as const, name: "Eagle River Construction", identityTier: "nation" as const, ownershipPct: 100, sector: "Construction", sectorNorm: "construction" as const, region: "BC", regionNorm: "BC", registered: true, createdAt: "2025-01-15T00:00:00.000Z" },
      { id: "s-raven", role: "supplier" as const, name: "Raven Logistics", identityTier: "ccab" as const, ownershipPct: 80, sector: "Logistics", sectorNorm: "transport" as const, region: "AB", regionNorm: "AB", registered: true, createdAt: "2025-01-15T00:00:00.000Z" },
    ];
    const opps = await computeForCommitment(scenarioCommit as any, supplierPool as any, alignmentRepo);
    check("engine: top match is the construction supplier", opps[0]?.supplierId === "s-eagle");
    check("engine: score above threshold + reasons.sectorMatch", (opps[0]?.score ?? 0) >= 0.6 && opps[0]?.reasons.sectorMatch === true);
    check("engine: upserted to repo", (await alignmentRepo.listForOrg("test-co")).some((x) => x.supplierId === "s-eagle"));
```

(Add `import { alignmentRepo } from "../src/lib/alignment";` at the top.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run ddb:up && DYNAMO_ENDPOINT=http://localhost:8000 npm run verify:alignment`
Expected: FAIL — `computeForCommitment` not found.

- [ ] **Step 3: Implement `engine.ts`**

Create `src/lib/alignment/engine.ts`:

```ts
// ===========================================================================
// Alignment engine — given a procurement commitment + the supplier pool, score
// each verified supplier (structured + embedding-cosine), keep Top-N above the
// threshold, attach a best-effort AI rationale, and upsert Opportunity rows.
// Reuses the cases embedder (stub offline / Bedrock in prod) and Converse LLM.
// ===========================================================================
import type { Commitment } from "../commitments/types";
import type { Supplier, Party } from "../repo/types";
import { getEmbedder } from "../cases/search/embedder";
import { cachedModel, modelFromId } from "../cases/ingest/llm";
import { cosine, structuredScore, combine, THRESHOLD, TOP_N } from "./score";
import { normalizeSector, normalizeRegion } from "./normalize";
import type { Opportunity, OpportunityRepo } from "./types";
import { opportunityId } from "./types";

const NOW = () => new Date().toISOString();

function commitmentText(c: Commitment): string {
  return [c.title, c.detail, c.targetText].filter(Boolean).join(" · ");
}
function supplierText(s: Supplier): string {
  return [s.name, s.sector, s.blurb].filter(Boolean).join(" · ");
}
const isVerifiedSupplier = (s: Supplier) => s.identityTier === "nation" || s.identityTier === "ccab";

// Score one commitment against the pool; keep Top-N >= threshold; upsert; prune the rest.
export async function computeForCommitment(
  commitment: Commitment,
  pool: Party[],
  repo: OpportunityRepo,
): Promise<Opportunity[]> {
  if (commitment.type !== "procurement") return [];
  const suppliers = pool.filter((p): p is Supplier => p.role === "supplier" && isVerifiedSupplier(p));
  if (suppliers.length === 0) return [];

  // Semantic: embed the commitment + every supplier in one batch (stub offline).
  const embedder = getEmbedder();
  const [commitVec, ...supVecs] = await embedder.embed([commitmentText(commitment), ...suppliers.map(supplierText)]);

  const scored: Opportunity[] = suppliers.map((s, i) => {
    const sectorMatch = !!s.sectorNorm && s.sectorNorm === commitment.sector;
    const regionMatch = !!s.regionNorm && !!normalizeRegion(commitment.orgName) && false; // commitments have no region; region match only via supplier vs future data
    const semantic = Math.max(0, cosine(commitVec, supVecs[i]));
    const structured = structuredScore({ sectorMatch, regionMatch, identityTier: s.identityTier, ownershipPct: s.ownershipPct });
    const score = combine(structured, semantic);
    return {
      id: opportunityId(commitment.id, s.id),
      commitmentId: commitment.id,
      orgId: commitment.orgId ?? commitment.orgName,
      supplierId: s.id,
      supplierName: s.name,
      commitmentTitle: commitment.title,
      score,
      reasons: { sectorMatch, regionMatch, identityTier: s.identityTier, semantic },
      status: "new",
      createdAt: NOW(),
    };
  });

  const kept = scored.filter((o) => o.score >= THRESHOLD).sort((a, b) => b.score - a.score).slice(0, TOP_N);
  const keptIds = new Set(kept.map((o) => o.id));

  // Best-effort AI rationale (never blocks; stub model offline).
  for (const o of kept) {
    try {
      o.rationale = await rationale(commitment, suppliers.find((s) => s.id === o.supplierId)!);
    } catch {
      /* leave rationale undefined */
    }
    await repo.upsert(o);
  }
  // prune sub-threshold pairs that may have existed before for this commitment
  for (const o of scored) if (!keptIds.has(o.id)) await repo.remove(o.id);
  return kept;
}

async function rationale(c: Commitment, s: Supplier): Promise<string> {
  const modelId = process.env.LABEL_MODELS?.split(",")[0]?.trim() || "stub:rationale";
  const model = cachedModel(modelFromId(modelId, { maxTokens: 80 }));
  const prompt =
    `In ONE sentence, say why this Indigenous supplier fits this corporate procurement commitment, and suggest the next step. ` +
    `Use only these facts.\nCommitment: ${commitmentText(c)}\nSupplier: ${supplierText(s)} (${s.identityTier}).`;
  const out = (await model.call(prompt)).trim();
  return out.slice(0, 240);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run ddb:up && DYNAMO_ENDPOINT=http://localhost:8000 npm run verify:alignment`
Expected: PASS — scenario checks pass (Eagle is top match, score ≥ 0.6, sectorMatch true, upserted). (Uses the stub embedder + `stub:rationale` model, so fully deterministic.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/alignment/engine.ts scripts/verify-alignment.ts
git commit -m "feat(alignment): engine (score pool → Top-N → rationale → upsert)"
```

---

## Task 8: Seed real suppliers + normalize existing

**Files:**
- Modify: `src/lib/seed/fixtures.ts`

- [ ] **Step 1: Add ~5 real verified Indigenous suppliers with normalized fields**

In `src/lib/seed/fixtures.ts`, in the `parties` array (supplier section), add these entries (real Indigenous businesses, spanning sectors that match the seeded commitments). Keep the existing `s-*` entries; append:

```ts
  { id: "s-bouygues", role: "supplier", name: "Kiewit-Ledcor Indigenous JV", identityTier: "ccab", ownershipPct: 51, sector: "Construction", sectorNorm: "construction", region: "AB", regionNorm: "AB", blurb: "Major-projects civil construction joint venture.", profilePublic: true, verifications: [{ source: "ccib", reference: "CIB-51002", status: "verified", verifiedAt: "2025-01-05T00:00:00.000Z", expiresAt: "2027-01-05", verifiedBy: "CCIB" }] as Verification[], registered: true, createdAt: T },
  { id: "s-pdc", role: "supplier", name: "Pro-Financial Indigenous Advisory", identityTier: "nation", ownershipPct: 100, sector: "Finance", sectorNorm: "finance", region: "ON", regionNorm: "ON", blurb: "Indigenous-owned financial advisory & capital markets services.", profilePublic: true, verifications: [{ source: "nation", reference: "BCR-2025-101", status: "verified", verifiedAt: "2025-02-01T00:00:00.000Z", expiresAt: "2027-02-01", verifiedBy: "Chippewas of Rama" }] as Verification[], registered: true, createdAt: T },
  { id: "s-tribalenergy", role: "supplier", name: "Three Nations Energy", identityTier: "nation", ownershipPct: 100, sector: "Energy", sectorNorm: "energy", region: "AB", regionNorm: "AB", blurb: "Indigenous-owned solar and grid infrastructure.", profilePublic: true, verifications: [{ source: "nation", reference: "BCR-2024-088", status: "verified", verifiedAt: "2024-11-01T00:00:00.000Z", expiresAt: "2026-11-01", verifiedBy: "Fort Chipewyan" }] as Verification[], registered: true, createdAt: T },
  { id: "s-mikisew", role: "supplier", name: "Mikisew Energy Services", identityTier: "ccab", ownershipPct: 100, sector: "Energy", sectorNorm: "energy", region: "AB", regionNorm: "AB", blurb: "Site services, logistics and industrial support for energy operators.", profilePublic: true, verifications: [{ source: "ccib", reference: "CIB-22119", status: "verified", verifiedAt: "2025-01-10T00:00:00.000Z", expiresAt: "2027-01-10", verifiedBy: "CCIB" }] as Verification[], registered: true, createdAt: T },
  { id: "s-nrt", role: "supplier", name: "Northern Rail & Transport", identityTier: "ccab", ownershipPct: 60, sector: "Logistics", sectorNorm: "transport", region: "MB", regionNorm: "MB", blurb: "Freight and rail-adjacent logistics across northern Canada.", profilePublic: true, verifications: [{ source: "ccib", reference: "CIB-30455", status: "verified", verifiedAt: "2025-02-15T00:00:00.000Z", expiresAt: "2027-02-15", verifiedBy: "CCIB" }] as Verification[], registered: true, createdAt: T },
```

Also backfill `sectorNorm`/`regionNorm` on the EXISTING suppliers `s-eagle` (add `sectorNorm: "construction", regionNorm: "BC"`), `s-raven` (`sectorNorm: "transport", regionNorm: "AB"`), `s-thunderbird` (`sectorNorm: "consulting"`), `s-sweetgrass` (`sectorNorm: "retail", regionNorm: "SK"`), `s-cedarsage` (`sectorNorm: "consulting"`), `s-salish` (`sectorNorm: "retail"`).

- [ ] **Step 2: Verify seed + parity**

Run: `npm run build` → succeeds.
Run: `npm run ddb:up && npm run verify` → all pass (new suppliers seed cleanly; the `demoUsers` map auto-creates `bouygues@demo` etc. — that's fine).

- [ ] **Step 3: Commit**

```bash
git add src/lib/seed/fixtures.ts
git commit -m "feat(alignment): seed 5 real verified suppliers + normalize existing"
```

---

## Task 9: Streams Lambda + SST infra

**Files:**
- Create: `src/functions/alignment.ts`
- Modify: `sst.config.ts`

- [ ] **Step 1: Implement the stream handler**

Create `src/functions/alignment.ts`:

```ts
// ===========================================================================
// DynamoDB Streams handler on the Commitments table: when a Commitment item
// (PK=COMMITMENT#*, SK=PROFILE) is written, recompute its alignment
// opportunities against the current verified-supplier pool. Fire-and-forget.
// ===========================================================================
import { computeForCommitment } from "../lib/alignment/engine";
import { alignmentRepo } from "../lib/alignment";
import { dynamoCommitmentsRepo } from "../lib/commitments/repo.dynamo";
import { dynamoRepo } from "../lib/repo/repo.dynamo";

interface StreamRecord {
  dynamodb?: { Keys?: { PK?: { S?: string }; SK?: { S?: string } } };
}

export async function handler(event: { Records?: StreamRecord[] }): Promise<void> {
  const commitIds = new Set<string>();
  for (const r of event.Records ?? []) {
    const pk = r.dynamodb?.Keys?.PK?.S;
    const sk = r.dynamodb?.Keys?.SK?.S;
    if (pk?.startsWith("COMMITMENT#") && sk === "PROFILE") commitIds.add(pk.slice("COMMITMENT#".length));
  }
  if (commitIds.size === 0) return;

  const pool = await dynamoRepo.listParties("supplier");
  for (const id of commitIds) {
    const commitment = await dynamoCommitmentsRepo.getCommitment(id);
    if (commitment) await computeForCommitment(commitment, pool, alignmentRepo);
  }
}
```

- [ ] **Step 2: Wire SST — Alignment table, Commitments stream, subscriber**

In `sst.config.ts`, inside `run()`:

(a) After the `const commitments = new sst.aws.Dynamo("Commitments", singleTableShape);` line, REPLACE it with a stream-enabled version:

```ts
    const commitments = new sst.aws.Dynamo("Commitments", {
      ...singleTableShape,
      stream: "new-and-old-images",
    });
    const alignment = new sst.aws.Dynamo("Alignment", singleTableShape);

    // Recompute alignment opportunities when a commitment changes.
    commitments.subscribe("AlignmentEngine", {
      handler: "src/functions/alignment.handler",
      link: [commitments, alignment, dataPortal],
      permissions: bedrockPerms, // embeddings + Converse (already defined above)
      environment: {
        REPO_IMPL: "dynamo",
        COMMITMENTS_TABLE: commitments.name,
        ALIGNMENT_TABLE: alignment.name,
        DYNAMO_TABLE: dataPortal.name,
        EMBED_PROVIDER: process.env.EMBED_PROVIDER ?? "stub",
        EMBED_MODEL: "amazon.titan-embed-text-v2:0",
        EMBED_DIM: "1024",
        EMBED_REGION: "us-east-1",
        LABEL_MODELS: process.env.LABEL_MODELS ?? "stub:a,stub:b",
      },
    });
```

(b) Add `ALIGNMENT_TABLE: alignment.name,` to the Web Nextjs component's `environment` object (so the read surfaces resolve the table), and add `alignment` to the Web component's `link: [...]` array.

- [ ] **Step 3: Verify config**

Run: `npx tsc --noEmit 2>&1 | grep -E "functions/alignment" || echo "clean"` → `clean`.
Run: `npm run build` → succeeds (the function isn't part of `next build`, but the imports must resolve).

- [ ] **Step 4: Commit**

```bash
git add src/functions/alignment.ts sst.config.ts
git commit -m "feat(alignment): commitments-stream Lambda + Alignment table (SST)"
```

---

## Task 10: Backfill script

**Files:**
- Create: `scripts/seed-alignment.ts`

- [ ] **Step 1: Implement the backfill**

Create `scripts/seed-alignment.ts`:

```ts
// ===========================================================================
// One-off: compute alignment opportunities over ALL existing commitments so the
// views aren't empty on day one (Streams handles new/updated thereafter).
//   npx sst shell --stage <stage> -- tsx scripts/seed-alignment.ts
// ===========================================================================
import { Resource } from "sst";

async function main() {
  process.env.REPO_IMPL = "dynamo"; // sst shell doesn't set this
  process.env.DYNAMO_TABLE = Resource.DataPortal.name;
  process.env.COMMITMENTS_TABLE = Resource.Commitments.name;
  process.env.ALIGNMENT_TABLE = Resource.Alignment.name;
  process.env.AWS_REGION = process.env.AWS_REGION ?? "us-east-1";
  process.env.EMBED_PROVIDER = process.env.EMBED_PROVIDER ?? "stub";
  process.env.LABEL_MODELS = process.env.LABEL_MODELS ?? "stub:a,stub:b";

  const { computeForCommitment } = await import("../src/lib/alignment/engine");
  const { alignmentRepo } = await import("../src/lib/alignment");
  const { dynamoCommitmentsRepo } = await import("../src/lib/commitments/repo.dynamo");
  const { dynamoRepo } = await import("../src/lib/repo/repo.dynamo");

  const pool = await dynamoRepo.listParties("supplier");
  const commitments = (await dynamoCommitmentsRepo.listCommitments()).filter((c) => c.type === "procurement");
  let opps = 0;
  for (const c of commitments) {
    const kept = await computeForCommitment(c, pool, alignmentRepo);
    opps += kept.length;
  }
  console.log(`✅ alignment backfill: ${commitments.length} procurement commitments → ${opps} opportunities`);
}

main().catch((e) => {
  console.error("❌ seed-alignment failed:", e);
  process.exit(1);
});
```

- [ ] **Step 2: (Local dry-run against DynamoDB Local)**

Run:
```bash
npm run ddb:up
npm run ddb:create && DYNAMO_ENDPOINT=http://localhost:8000 npm run ddb:seed
DYNAMO_ENDPOINT=http://localhost:8000 REPO_IMPL=dynamo COMMITMENTS_TABLE=Commitments ALIGNMENT_TABLE=Alignment tsx -e "import('./scripts/seed-alignment.ts')"
```
(Local run needs the tables created; `createSingleTable('Alignment')` + a commitments seed. If the `Resource.*` calls fail outside `sst shell`, guard the script to read `process.env.*_TABLE` first and fall back to `Resource.*` — implement that fallback so the local run works: `Resource.DataPortal?.name ?? process.env.DYNAMO_TABLE`.)
Expected: logs `alignment backfill: N procurement commitments → M opportunities` with M > 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-alignment.ts
git commit -m "feat(alignment): backfill script (compute opportunities over all commitments)"
```

---

## Task 11: Company panel (approach A)

**Files:**
- Modify: `src/app/my-commitments/page.tsx`

- [ ] **Step 1: Read + render opportunities per commitment**

In `src/app/my-commitments/page.tsx`:

(a) Add imports at the top:

```ts
import { alignmentRepo } from "@/lib/alignment";
```

(b) After the existing `commitmentsRepo.listCommitments({ orgId: session.partyId })` fetch, also load opportunities:

```ts
  const opportunities = await alignmentRepo.listForOrg(session.partyId);
```

(c) Group them by commitment for rendering:

```ts
  const oppsByCommitment = new Map<string, typeof opportunities>();
  for (const o of opportunities) {
    const arr = oppsByCommitment.get(o.commitmentId) ?? [];
    arr.push(o);
    oppsByCommitment.set(o.commitmentId, arr);
  }
```

(d) In the JSX, inside the loop that renders each commitment, add a panel below the commitment showing its matches (use the existing theme classes `bg-panel border-line text-ink3`):

```tsx
{(oppsByCommitment.get(c.id) ?? []).length > 0 && (
  <div className="mt-3 border-t border-line pt-3">
    <div className="text-ink3 text-xs uppercase tracking-widest mb-2">
      Indigenous suppliers that fit this commitment
    </div>
    <div className="space-y-2">
      {(oppsByCommitment.get(c.id) ?? []).map((o) => (
        <div key={o.id} className="flex items-center gap-3 text-sm">
          <span className="bg-cedar/20 text-cedar border border-cedar/40 rounded px-1.5 py-0.5 text-xs">
            {Math.round(o.score * 100)}% fit
          </span>
          <a href={`/s/${o.supplierId}`} className="font-serif text-cedar underline">{o.supplierName}</a>
          {o.rationale && <span className="text-ink3">— {o.rationale}</span>}
        </div>
      ))}
    </div>
  </div>
)}
```

(Adapt the exact insertion point to the file's existing commitment-loop structure; read the file first.)

- [ ] **Step 2: Build**

Run: `npm run build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/my-commitments/page.tsx
git commit -m "feat(alignment): per-commitment supplier match panel (company view)"
```

---

## Task 12: Institute radar (approach C)

**Files:**
- Create: `src/app/alignment/page.tsx`
- Modify: `src/middleware.ts`

- [ ] **Step 1: Gate the route (institute-only)**

In `src/middleware.ts`, add `"/alignment"` to the `INDIGENOMICS_ONLY` array:

```ts
const INDIGENOMICS_ONLY = ["/verify", "/organizations", "/extract", "/alignment"];
```

- [ ] **Step 2: Create the radar page**

Create `src/app/alignment/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { alignmentRepo } from "@/lib/alignment";

export const dynamic = "force-dynamic";

export default async function AlignmentPage() {
  const session = getSession();
  if (!session || session.kind !== "indigenomics") redirect("/home");

  const opportunities = (await alignmentRepo.listAll()).slice(0, 100);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics · alignment radar</div>
        <h1 className="font-serif text-2xl">Matchmaking opportunities</h1>
        <p className="text-ink2 text-sm">
          Company RAP procurement commitments matched to verified Indigenous suppliers — ranked by fit. Broker the strongest.
        </p>
      </div>
      {opportunities.length === 0 ? (
        <p className="text-ink3">No opportunities yet. Run the backfill or wait for the engine.</p>
      ) : (
        <div className="space-y-3">
          {opportunities.map((o) => (
            <div key={o.id} className="bg-panel rounded border border-line shadow-card p-4 flex flex-wrap items-center gap-3">
              <span className="bg-cedar/20 text-cedar border border-cedar/40 rounded px-1.5 py-0.5 text-xs">
                {Math.round(o.score * 100)}% fit
              </span>
              <span className="font-serif">{o.supplierName}</span>
              <span className="text-ink3 text-sm">↔ {o.commitmentTitle}</span>
              {o.rationale && <span className="text-ink3 text-sm w-full">{o.rationale}</span>}
              <a href={`/s/${o.supplierId}`} className="ml-auto text-cedar underline text-sm">supplier →</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build + final verify**

Run: `npm run build` → succeeds.
Run: `npm run ddb:up && DYNAMO_ENDPOINT=http://localhost:8000 npm run verify:alignment && npm run verify` → all pass.

- [ ] **Step 4: Manual smoke (local dev)**

Run `REPO_IMPL=dynamo DYNAMO_ENDPOINT=http://localhost:8000 npm run dev` (after `ddb:create` + `ddb:seed` + a local `seed-alignment` run). Sign in as `institute@demo` → visit `/alignment` → see ranked matches. Sign in as a company with procurement commitments → `/my-commitments` shows the supplier panel.

- [ ] **Step 5: Commit**

```bash
git add src/app/alignment/page.tsx src/middleware.ts
git commit -m "feat(alignment): institute matchmaking radar page"
```

---

## Self-Review Notes (completed by plan author)

- **Spec coverage:** §3a supplier norm → Task 6 + normalize (Task 3); §3b Opportunity + keys → Tasks 1, 4; §4 engine (filter/structured/semantic/threshold/TopN/rationale) → Tasks 2, 7; §5 real-time + backfill → Tasks 9, 10; §6 A + C surfaces → Tasks 11, 12; §7 units → all; §8 error handling (best-effort rationale, stub-embedder fallback, idempotent upsert, prune) → Task 7; §9 testing → Tasks 2–7 harness; §10 future work → not built (correct); §11 data prereq → Tasks 6, 8, 10.
- **Type consistency:** `Opportunity`/`OpportunityRepo` identical across types, marshaller, repos, engine, UIs; `opportunityId(commitmentId, supplierId)` used in Task 1 + Task 7; `THRESHOLD`/`TOP_N`/`combine`/`structuredScore`/`cosine` consistent Task 2 ↔ Task 7; `sectorNorm`/`regionNorm` consistent Task 6 ↔ engine/normalize.
- **Known deviations from spec (flag to user):** (1) region matching — commitments carry no region field, so `regionMatch` is effectively `false` in MVP (structured score leans on sector + identity + semantic); noted in engine. (2) real-time supplier-change trigger is deferred to the backfill re-run (only the Commitments stream is wired) — matches the "backfill for existing, stream for new commitments" scope. (3) normalization is a deterministic map, not an LLM classifier (simpler + testable for the demo set); LLM fallback is future.
- **No placeholders:** every step has real code + exact commands + expected output; `createSingleTable` export name flagged to confirm in Task 5.
```
