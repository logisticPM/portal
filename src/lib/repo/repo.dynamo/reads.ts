// ===========================================================================
// repo.dynamo — READS / aggregates (spec §10.2 — Sharon owns this file).
//
// Every method here is a DynamoDB query/scan + an in-repo aggregation. The
// counting rules MUST match repo.mock exactly (it's the golden reference).
// ===========================================================================
import { GetCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE } from "../../dynamo/client";
import {
  GSI1,
  GSI2,
  gsi1Supplier,
  gsi2Role,
  itemToConf,
  itemToLine,
  itemToParty,
  itemToUser,
  keys,
  prefix,
} from "../../dynamo/single-table";
import type {
  Confirmation,
  Coverage,
  ExportBundle,
  IdentityTier,
  IndexSummary,
  Party,
  PartyRole,
  FlowType,
  ReportedLine,
  Supplier,
  SupplierRecord,
  SupplierShowcase,
  User,
  Verification,
} from "../types";

type Item = Record<string, any>;

const FLOWS: FlowType[] = ["procurement", "capital"];
const TIERS: IdentityTier[] = ["nation", "ccab", "self_declared"];

function emptyFlowMap() {
  return FLOWS.reduce(
    (acc, f) => {
      acc[f] = { reported: 0, confirmed: 0 };
      return acc;
    },
    {} as Record<FlowType, { reported: number; confirmed: number }>,
  );
}

// Coverage counting rule (spec §6) — identical to repo.mock:
// confirmed at reported amount; corrected at corrected amount; pending/disputed/withdrawn → 0.
function confirmedAmount(line: ReportedLine, activeConf: Record<string, Confirmation>): number {
  if (line.withdrawn) return 0;
  if (line.status === "confirmed") return line.amount;
  if (line.status === "corrected") return activeConf[line.id]?.correctedAmount ?? line.amount;
  return 0;
}

// at most one non-withdrawn confirmation per line; index it by lineId
function indexActiveConfs(confs: Confirmation[]): Record<string, Confirmation> {
  const map: Record<string, Confirmation> = {};
  for (const c of confs) if (!c.withdrawn) map[c.lineId] = c;
  return map;
}

// AP6 — get a party profile + tier
export async function getParty(id: string): Promise<Party | null> {
  const res = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: keys.party(id) }));
  return res.Item ? itemToParty(res.Item) : null;
}

// AP7 — list parties by role (powers the picker / role-switcher). No role → both.
export async function listParties(role?: PartyRole): Promise<Party[]> {
  const roles: PartyRole[] = role ? [role] : ["company", "supplier"];
  const out: Party[] = [];
  for (const r of roles) {
    const res = await ddbDoc.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: GSI2,
        KeyConditionExpression: "GSI2PK = :pk",
        ExpressionAttributeValues: { ":pk": gsi2Role(r) },
      }),
    );
    for (const it of (res.Items ?? []) as Item[]) out.push(itemToParty(it));
  }
  return out;
}

// AP2 — all of a company's lines (begins_with LINE# also returns Conf items; filter to Lines)
export async function listLinesForCompany(companyId: string): Promise<ReportedLine[]> {
  const res = await ddbDoc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": `COMPANY#${companyId}`, ":sk": prefix.companyLines },
    }),
  );
  return ((res.Items ?? []) as Item[])
    .filter((it) => it.et === "Line" && !it.withdrawn)
    .map(itemToLine);
}

// AP3 — a supplier's pending inbox (GSI1, begins_with STATUS#pending#)
export async function listPendingForSupplier(supplierId: string): Promise<ReportedLine[]> {
  const res = await ddbDoc.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: GSI1,
      KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": gsi1Supplier(supplierId),
        ":sk": prefix.pendingForSupplier,
      },
    }),
  );
  return ((res.Items ?? []) as Item[]).filter((it) => !it.withdrawn).map(itemToLine);
}

// AP5b — a supplier's whole record (GSI1 returns all their lines + their confirmations)
export async function getSupplierRecord(supplierId: string): Promise<SupplierRecord> {
  const res = await ddbDoc.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: GSI1,
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": gsi1Supplier(supplierId) },
    }),
  );
  const items = (res.Items ?? []) as Item[];
  const lines = items.filter((it) => it.et === "Line" && !it.withdrawn).map(itemToLine);
  const active = indexActiveConfs(items.filter((it) => it.et === "Conf").map(itemToConf));
  return {
    supplierId,
    confirmedRevenue: lines.reduce((s, l) => s + confirmedAmount(l, active), 0),
    pendingCount: lines.filter((l) => l.status === "pending").length,
    disputedCount: lines.filter((l) => l.status === "disputed").length,
    lines,
  };
}

// AP5 — per-company coverage (the company query returns Lines + their Conf items)
export async function getCoverage(companyId: string): Promise<Coverage> {
  const res = await ddbDoc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": `COMPANY#${companyId}`, ":sk": prefix.companyLines },
    }),
  );
  const items = (res.Items ?? []) as Item[];
  const lines = items.filter((it) => it.et === "Line" && !it.withdrawn).map(itemToLine);
  const active = indexActiveConfs(items.filter((it) => it.et === "Conf").map(itemToConf));

  const byFlow = emptyFlowMap();
  let totalReported = 0;
  let totalConfirmed = 0;
  for (const l of lines) {
    const c = confirmedAmount(l, active);
    byFlow[l.flowType].reported += l.amount;
    byFlow[l.flowType].confirmed += c;
    totalReported += l.amount;
    totalConfirmed += c;
  }
  return {
    companyId,
    byFlow,
    totalReported,
    totalConfirmed,
    confirmedPct: totalReported ? Math.round((totalConfirmed / totalReported) * 100) : 0,
  };
}

// AP5c — macro cross-company rollup. Scan + aggregate (synthetic scale only; spec note).
export async function getIndexSummary(): Promise<IndexSummary> {
  const items: Item[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await ddbDoc.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
    items.push(...((res.Items ?? []) as Item[]));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const parties = items.filter((it) => it.et === "Party").map(itemToParty);
  const lines = items.filter((it) => it.et === "Line" && !it.withdrawn).map(itemToLine);
  const active = indexActiveConfs(items.filter((it) => it.et === "Conf").map(itemToConf));

  const tierOf = (supplierId: string): IdentityTier => {
    const p = parties.find((x) => x.id === supplierId);
    return p && p.role === "supplier" ? p.identityTier : "self_declared";
  };

  const byFlow = emptyFlowMap();
  const byTier = TIERS.reduce(
    (acc, t) => {
      acc[t] = { confirmed: 0 };
      return acc;
    },
    {} as Record<IdentityTier, { confirmed: number }>,
  );
  const byTag: Record<string, { confirmed: number }> = {};
  let totalReported = 0;
  let totalConfirmed = 0;
  for (const l of lines) {
    const c = confirmedAmount(l, active);
    byFlow[l.flowType].reported += l.amount;
    byFlow[l.flowType].confirmed += c;
    byTier[tierOf(l.supplierId)].confirmed += c;
    for (const t of l.tags ?? []) (byTag[t] ??= { confirmed: 0 }).confirmed += c;
    totalReported += l.amount;
    totalConfirmed += c;
  }
  const integrity = { certifiedNoActivity: 0, selfDeclaredWithActivity: 0 };
  for (const p of parties) {
    if (p.role !== "supplier") continue;
    const confirmed = lines
      .filter((l) => l.supplierId === p.id)
      .reduce((s, l) => s + confirmedAmount(l, active), 0);
    if (p.identityTier !== "self_declared" && confirmed === 0) integrity.certifiedNoActivity++;
    if (p.identityTier === "self_declared" && confirmed > 0) integrity.selfDeclaredWithActivity++;
  }
  return {
    totalReported,
    totalConfirmed,
    confirmedPct: totalReported ? Math.round((totalConfirmed / totalReported) * 100) : 0,
    byFlow,
    byTier,
    byTag,
    companyCount: parties.filter((p) => p.role === "company").length,
    supplierCount: parties.filter((p) => p.role === "supplier").length,
    disputedCount: lines.filter((l) => l.status === "disputed").length,
    integrity,
  };
}

// AP-showcase — public-safe supplier showcase aggregate (counts only, no named buyers)
export async function getSupplierShowcase(supplierId: string): Promise<SupplierShowcase | null> {
  const partyRes = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: keys.party(supplierId) }));
  const p = partyRes.Item ? itemToParty(partyRes.Item as Item) : null;
  if (!p || p.role !== "supplier" || p.profilePublic !== true) return null;

  const res = await ddbDoc.send(new QueryCommand({
    TableName: TABLE, IndexName: GSI1,
    KeyConditionExpression: "GSI1PK = :pk",
    ExpressionAttributeValues: { ":pk": gsi1Supplier(supplierId) },
  }));
  const items = (res.Items ?? []) as Item[];
  const lines = items.filter((it) => it.et === "Line" && !it.withdrawn).map(itemToLine);
  const active = indexActiveConfs(items.filter((it) => it.et === "Conf").map(itemToConf));

  const byFlow = FLOWS.reduce(
    (acc, f) => { acc[f] = { confirmed: 0 }; return acc; },
    {} as Record<FlowType, { confirmed: number }>,
  );
  const buyers = new Set<string>();
  const tagSet = new Set<string>();
  let confirmedRevenue = 0;
  let asOf = "";
  for (const l of lines) {
    const c = confirmedAmount(l, active);
    if (c > 0) {
      byFlow[l.flowType].confirmed += c;
      confirmedRevenue += c;
      buyers.add(l.companyId);
      for (const t of l.tags ?? []) tagSet.add(t);
      if (l.period > asOf) asOf = l.period;
    }
  }
  const isActive = (v: Verification) =>
    v.status === "verified" && (!v.expiresAt || v.expiresAt >= new Date().toISOString().slice(0, 10));
  return {
    supplierId, name: p.name, identityTier: p.identityTier, ownershipPct: p.ownershipPct,
    verifications: (p.verifications ?? []).filter(isActive),
    sector: p.sector, sectorNorm: p.sectorNorm, blurb: p.blurb, region: p.region, website: p.website,
    confirmedRevenue, byFlow, confirmedBuyerCount: buyers.size, tags: [...tagSet], asOf,
  };
}

// AP-pending-verifications — list all suppliers with pending verification claims (reviewer queue)
export async function listPendingVerifications(): Promise<{ supplier: Supplier; verification: Verification }[]> {
  const items: Item[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await ddbDoc.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
    items.push(...((res.Items ?? []) as Item[]));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const out: { supplier: Supplier; verification: Verification }[] = [];
  for (const it of items) {
    if (it.et !== "Party" || it.role !== "supplier") continue;
    const p = itemToParty(it) as Supplier;
    for (const v of (p.verifications ?? []) as Verification[]) {
      if (v.status === "pending") out.push({ supplier: p, verification: v });
    }
  }
  return out;
}

// AUTH — fetch an account by email (single GetItem; email is the key)
export async function getUserByEmail(email: string): Promise<User | null> {
  const res = await ddbDoc.send(
    new GetCommand({ TableName: TABLE, Key: keys.user(email) }),
  );
  return res.Item ? itemToUser(res.Item as Record<string, any>) : null;
}

// AP9 — export everything about a party (OCAP Access). Full record, incl. withdrawn items.
export async function exportRecords(partyId: string): Promise<ExportBundle> {
  const party = await getParty(partyId);
  if (!party) throw new Error(`party not found: ${partyId}`);

  const res =
    party.role === "supplier"
      ? await ddbDoc.send(
          new QueryCommand({
            TableName: TABLE,
            IndexName: GSI1,
            KeyConditionExpression: "GSI1PK = :pk",
            ExpressionAttributeValues: { ":pk": gsi1Supplier(partyId) },
          }),
        )
      : await ddbDoc.send(
          new QueryCommand({
            TableName: TABLE,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": `COMPANY#${partyId}` },
          }),
        );
  const items = (res.Items ?? []) as Item[];
  return {
    party,
    lines: items.filter((it) => it.et === "Line").map(itemToLine),
    confirmations: items.filter((it) => it.et === "Conf").map(itemToConf),
  };
}
