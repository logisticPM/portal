# Backend · DynamoDB Single-Table Design + `repo.dynamo.ts` Plan

**Owners:** Shiting Huang + Mengshan Li (Data Architecture group) · **Cards:** RAP-7/RAP-8 backend · **Date:** 2026-06-07
**Status:** Proposal — reconcile against `src/lib/repo/types.ts` (the seam) and `repo.mock.ts` (reference behavior) before coding.

> The DynamoDB implementation must be behaviorally identical to `repo.mock.ts` and satisfy every access pattern in the design spec's Appendix A. Switching is one env flag: `REPO_IMPL=dynamo`.

---

## 1. Entities (from `types.ts`)

`Party` = `Company | Supplier` (discriminated by `role`; suppliers carry `identityTier`: `nation | ccab | self_declared`). `ReportedLine` (companyId, supplierId, amount CAD, pillar, period, status, `withdrawn?`). `Confirmation` (lineId, status, correctedAmount?, byPartyId, `withdrawn?`). Derived: `Coverage`, `SupplierRecord`, `IndexSummary`.

**Coverage counting rule (must match the mock exactly):** `reported` = sum of all line amounts (any status); `confirmed` = `confirmed` lines at reported amount **+** `corrected` lines at corrected amount; `pending/disputed/withdrawn` contribute 0. `confirmedPct = round(confirmed/reported*100)`.

---

## 2. Single-table schema — `DataPortal`

Keys: `PK`, `SK`, plus `GSI1PK`/`GSI1SK` and `GSI2PK`.

| Entity | PK | SK | GSI1PK | GSI1SK | GSI2PK |
|---|---|---|---|---|---|
| Party (profile) | `PARTY#<id>` | `PROFILE` | — | — | `ROLE#<role>` |
| ReportedLine | `COMPANY#<companyId>` | `LINE#<lineId>` | `SUPPLIER#<supplierId>` | `STATUS#<status>#LINE#<lineId>` | — |
| Confirmation | `COMPANY#<companyId>` | `CONF#<lineId>` | `SUPPLIER#<byPartyId>` | `CONF#<lineId>` | — |

Item attributes mirror the `types.ts` fields plus an `entity` discriminator (`"party" | "line" | "confirmation"`) and `withdrawn` (boolean, default false — **never delete**).

### Access patterns → operations (Appendix A)

| # | Access pattern | Method | DynamoDB |
|---|---|---|---|
| AP1 | Create a line | `createReportedLine` | `PutItem` line (status `pending`) |
| AP2 | List a company's lines | `listLinesForCompany` | `Query PK=COMPANY#<id>, SK begins_with LINE#` (filter `withdrawn=false`) |
| AP3 | Supplier's pending inbox | `listPendingForSupplier` | `Query GSI1 PK=SUPPLIER#<id>, GSI1SK begins_with STATUS#pending#` |
| AP4 | Record confirm/dispute/correct | `recordConfirmation` | `UpdateItem` line (set `status`, refresh `GSI1SK=STATUS#<new>#LINE#<id>`) + `PutItem` confirmation |
| AP5 | Company coverage | `getCoverage` | `Query` company lines → aggregate in repo by status × pillar |
| AP5b | Supplier "My Record" | `getSupplierRecord` | `Query GSI1 PK=SUPPLIER#<id>` (all statuses) → aggregate in repo |
| AP5c | Macro Index | `getIndexSummary` | `Scan` (synthetic scale only) → aggregate; materialize later for real data |
| AP6 | Get a party | `getParty` | `GetItem PK=PARTY#<id>, SK=PROFILE` |
| AP7 | List parties by role | `listParties` | `Query GSI2 PK=ROLE#<role>` |
| AP8 | Withdraw (OCAP) | `withdraw` | `Query GSI1 PK=SUPPLIER#<id>` confs → `UpdateItem` set `withdrawn=true`, revert each line to `pending` (refresh GSI1SK). **Never delete.** |
| AP9 | Export a party's records | `exportRecords` | company → `Query PK=COMPANY#<id>`; supplier → `Query GSI1 PK=SUPPLIER#<id>` |
| AP10 | Register a supplier (stretch) | `registerSupplier` | `PutItem` party (`role=supplier`, `registered=true`) + `GSI2PK=ROLE#supplier` |

> **Critical:** `GSI1SK` encodes the line's status (`STATUS#pending#…`). Whenever `recordConfirmation` or `withdraw` changes a line's status, you must rewrite `GSI1SK` so AP3 (the pending inbox) stays correct. This is the single trickiest invariant — bake it into one helper.

---

## 3. `repo.dynamo.ts` skeleton (proposal — do not put in `src/` until reviewed)

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand,
         UpdateCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { PortalRepo, Party, ReportedLine, Confirmation } from "./types";

const TABLE = process.env.DYNAMO_TABLE ?? "DataPortal";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({
  region: process.env.AWS_REGION ?? "ca-central-1",
  ...(process.env.DYNAMO_ENDPOINT ? { endpoint: process.env.DYNAMO_ENDPOINT } : {}),
}));

const k = {
  party:  (id: string) => ({ PK: `PARTY#${id}`, SK: "PROFILE" }),
  line:   (companyId: string, lineId: string) => ({ PK: `COMPANY#${companyId}`, SK: `LINE#${lineId}` }),
  conf:   (companyId: string, lineId: string) => ({ PK: `COMPANY#${companyId}`, SK: `CONF#${lineId}` }),
  g1line: (supplierId: string, status: string, lineId: string) =>
            ({ GSI1PK: `SUPPLIER#${supplierId}`, GSI1SK: `STATUS#${status}#LINE#${lineId}` }),
};

export const dynamoRepo: PortalRepo = {
  async getParty(id) { /* GetCommand k.party(id) → strip keys → Party | null */ },
  async listParties(role) { /* Query GSI2 PK=ROLE#<role>, or two queries if role omitted */ },
  async createReportedLine(input) {
    const line: ReportedLine = { id: `l-${crypto.randomUUID()}`, ...input,
      reportedAt: new Date().toISOString(), status: "pending" };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: {
      entity: "line", ...k.line(input.companyId, line.id),
      ...k.g1line(input.supplierId, "pending", line.id), ...line, withdrawn: false }}));
    return line;
  },
  async listLinesForCompany(companyId) { /* Query PK=COMPANY#<id> SK begins_with LINE#, filter !withdrawn */ },
  async listPendingForSupplier(supplierId) { /* Query GSI1 PK=SUPPLIER#<id> GSI1SK begins_with STATUS#pending# */ },
  async recordConfirmation(input) {
    // 1) UpdateItem the line: set status, REWRITE GSI1SK to STATUS#<new>#LINE#<id>
    // 2) retire any prior active confirmation (withdrawn=true), PutItem the new Confirmation
    // return the Confirmation
  },
  async getSupplierRecord(supplierId) { /* Query GSI1 PK=SUPPLIER#<id> (all), apply counting rule */ },
  async getCoverage(companyId) { /* Query company lines, aggregate by pillar with counting rule */ },
  async getIndexSummary() { /* Scan, aggregate totals/byPillar/byTier; synthetic scale only */ },
  async exportRecords(partyId) { /* company vs supplier branch (AP9) */ },
  async withdraw(partyId) {
    // AP8: for each active confirmation by this supplier → withdrawn=true,
    // and revert its line.status to "pending" (REWRITE GSI1SK). Never delete.
  },
  async registerSupplier(input) { /* PutItem party role=supplier, registered=true, GSI2PK=ROLE#supplier */ },
};
```

`confirmedAmount(line)` and the aggregation helpers can be **copied verbatim from `repo.mock.ts`** so the math is provably identical — only the data-fetching differs.

---

## 4. Seed plan (`seed/`)

- `seed/fixtures.ts` — the synthetic dataset (mirror the mock's: ~3 companies, ~6 suppliers across all three identity tiers, ~12–15 lines spanning statuses confirmed/pending/disputed/corrected so the coverage view and `byTier` integrity lens are convincing). Reuse the mock's fixtures as the source of truth.
- `seed/seed.ts` — create the table (+ GSI1/GSI2) in DynamoDB Local if absent, then `BatchWrite` all items. Idempotent (safe to re-run). Wire as an npm script (`npm run seed`).

---

## 5. Suggested split (per spec §10.2)

| Person | Owns | Implements |
|---|---|---|
| **Writes / integrity (e.g. Shiting)** | `dynamo/client.ts`, `dynamo/single-table.ts` (key helpers), seed loader, the **status-machine + GSI1SK rewrite** + soft-delete rules | `createReportedLine`, `recordConfirmation`, `withdraw`, `registerSupplier` |
| **Reads / aggregates (e.g. Mengshan)** | the GSIs these reads need, the counting rules, `seed/fixtures.ts` | `getParty`, `listParties`, `listLinesForCompany`, `listPendingForSupplier`, `exportRecords`, `getCoverage`, `getSupplierRecord`, `getIndexSummary` |

Both write into `repo.dynamo.ts` (split into `repo.dynamo/reads.ts` + `repo.dynamo/writes.ts`, assembled in an index, so you never edit the same file). The **withdrawal rule is shared** — agree on the GSI1SK-rewrite helper once.

---

## 6. Acceptance test

The DoD: `repo.dynamo.ts` passes the **same calls** the mock does, on DynamoDB Local with seed data. Quick parity check to write: run a handful of `PortalRepo` calls against both impls and assert equal outputs (especially the coverage number before/after a confirm and after a withdraw → reverts to pending, number drops).
