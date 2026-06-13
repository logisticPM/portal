// ===========================================================================
// repo.dynamo — WRITES / integrity (spec §10.2 — Sunny owns this file).
//
// The status machine + soft-delete rules live here. The hard constraint:
// whenever a line's status changes, rewrite its GSI1SK too (it encodes status),
// or Sharon's pending-inbox query goes stale. And NEVER hard-delete (OCAP).
// ===========================================================================
import { randomUUID } from "crypto";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE } from "../../dynamo/client";
import {
  GSI1,
  gsi1Supplier,
  itemToLine,
  itemToParty,
  keys,
  toConfItem,
  toLineItem,
  toPartyItem,
} from "../../dynamo/single-table";
import type { Confirmation, FlowTag, FlowType, IdentityTier, ReportedLine, Supplier } from "../types";

type Item = Record<string, any>;
const now = () => new Date().toISOString();

// Resolve a line by id via the acting supplier's GSI1 partition. The supplier
// confirming a line is the one named on it, so byPartyId === line.supplierId,
// which means the line lives in this supplier's GSI1 partition.
async function findLineForSupplier(byPartyId: string, lineId: string): Promise<ReportedLine | null> {
  const res = await ddbDoc.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: GSI1,
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": gsi1Supplier(byPartyId) },
    }),
  );
  const it = ((res.Items ?? []) as Item[]).find((x) => x.et === "Line" && x.id === lineId);
  return it ? itemToLine(it) : null;
}

// AP1 — company reports a new itemized line (always starts 'pending')
export async function createReportedLine(input: {
  companyId: string;
  supplierId: string;
  amount: number;
  flowType: FlowType;
  tags?: FlowTag[];
  period: string;
}): Promise<ReportedLine> {
  const line: ReportedLine = {
    id: `l-${randomUUID()}`,
    ...input,
    reportedAt: now(),
    status: "pending",
  };
  await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: toLineItem(line) }));
  return line;
}

// AP4 — supplier confirms / disputes / corrects a line
export async function recordConfirmation(input: {
  lineId: string;
  status: "confirmed" | "disputed" | "corrected";
  correctedAmount?: number;
  byPartyId: string;
}): Promise<Confirmation> {
  const line = await findLineForSupplier(input.byPartyId, input.lineId);
  if (!line) throw new Error(`line not found: ${input.lineId}`);

  // retire any prior active confirmation for this line (soft-delete it)
  const prior = await ddbDoc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `COMPANY#${line.companyId}`,
        ":sk": `LINE#${line.id}#CONF#`,
      },
    }),
  );
  for (const c of (prior.Items ?? []) as Item[]) {
    if (c.withdrawn) continue;
    await ddbDoc.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: c.PK, SK: c.SK },
        UpdateExpression: "SET withdrawn = :t",
        ExpressionAttributeValues: { ":t": true },
      }),
    );
  }

  // flip the line's status AND its GSI1SK (status is encoded in the sort key)
  await ddbDoc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: keys.line(line.companyId, line.id),
      UpdateExpression: "SET #s = :s, GSI1SK = :g",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": input.status,
        ":g": keys.lineGsi1Sk(input.status, line.id),
      },
    }),
  );

  const conf: Confirmation = {
    lineId: input.lineId,
    status: input.status,
    correctedAmount: input.correctedAmount,
    byPartyId: input.byPartyId,
    respondedAt: now(),
  };
  await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: toConfItem(conf, line.companyId) }));
  return conf;
}

// AP8 — OCAP withdraw: soft-delete the supplier's confirmations; their lines revert
// to 'pending'. The company's reported claim REMAINS. Never hard-delete.
export async function withdraw(partyId: string): Promise<void> {
  const res = await ddbDoc.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: GSI1,
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": gsi1Supplier(partyId) },
    }),
  );
  for (const c of (res.Items ?? []) as Item[]) {
    if (c.et !== "Conf" || c.withdrawn) continue;
    // soft-delete the confirmation
    await ddbDoc.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: c.PK, SK: c.SK },
        UpdateExpression: "SET withdrawn = :t",
        ExpressionAttributeValues: { ":t": true },
      }),
    );
    // revert the line to pending (and its GSI1SK)
    await ddbDoc.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: keys.line(c.companyId, c.lineId),
        UpdateExpression: "SET #s = :s, GSI1SK = :g",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":s": "pending",
          ":g": keys.lineGsi1Sk("pending", c.lineId),
        },
      }),
    );
  }
}

// AP10 — register a supplier (STRETCH)
export async function registerSupplier(input: {
  name: string;
  identityTier: IdentityTier;
}): Promise<Supplier> {
  const supplier: Supplier = {
    id: `s-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
    role: "supplier",
    name: input.name,
    identityTier: input.identityTier,
    registered: true,
    createdAt: now(),
  };
  await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: toPartyItem(supplier) }));
  return supplier;
}

// AP-profile — supplier edits their own showcase profile fields + public toggle
export async function updateSupplierProfile(supplierId: string, input: {
  sector?: string; blurb?: string; region?: string; website?: string; profilePublic?: boolean;
}): Promise<Supplier> {
  const res = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: keys.party(supplierId) }));
  const p = res.Item ? itemToParty(res.Item as Item) : null;
  if (!p || p.role !== "supplier") throw new Error(`supplier not found: ${supplierId}`);
  const updated: Supplier = {
    ...p,
    sector: input.sector ?? p.sector,
    blurb: input.blurb ?? p.blurb,
    region: input.region ?? p.region,
    website: input.website ?? p.website,
    profilePublic: input.profilePublic ?? p.profilePublic,
  };
  await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: toPartyItem(updated) }));
  return updated;
}
