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
  Pillar,
  ReportedLine,
  SupplierRecord,
} from "../types";

type Item = Record<string, any>;

const PILLARS: Pillar[] = ["equity", "capital", "procurement", "innovation"];
const TIERS: IdentityTier[] = ["nation", "ccab", "self_declared"];

function emptyPillarMap() {
  return PILLARS.reduce(
    (acc, p) => {
      acc[p] = { reported: 0, confirmed: 0 };
      return acc;
    },
    {} as Record<Pillar, { reported: number; confirmed: number }>,
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

  const byPillar = emptyPillarMap();
  let totalReported = 0;
  let totalConfirmed = 0;
  for (const l of lines) {
    const c = confirmedAmount(l, active);
    byPillar[l.pillar].reported += l.amount;
    byPillar[l.pillar].confirmed += c;
    totalReported += l.amount;
    totalConfirmed += c;
  }
  return {
    companyId,
    byPillar,
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

  const byPillar = emptyPillarMap();
  const byTier = TIERS.reduce(
    (acc, t) => {
      acc[t] = { confirmed: 0 };
      return acc;
    },
    {} as Record<IdentityTier, { confirmed: number }>,
  );
  let totalReported = 0;
  let totalConfirmed = 0;
  for (const l of lines) {
    const c = confirmedAmount(l, active);
    byPillar[l.pillar].reported += l.amount;
    byPillar[l.pillar].confirmed += c;
    byTier[tierOf(l.supplierId)].confirmed += c;
    totalReported += l.amount;
    totalConfirmed += c;
  }
  return {
    totalReported,
    totalConfirmed,
    confirmedPct: totalReported ? Math.round((totalConfirmed / totalReported) * 100) : 0,
    byPillar,
    byTier,
    companyCount: parties.filter((p) => p.role === "company").length,
    supplierCount: parties.filter((p) => p.role === "supplier").length,
    disputedCount: lines.filter((l) => l.status === "disputed").length,
  };
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
