// Dynamo access for scan reports. Items live in the LegalCases table but are
// invisible to the corpus: no GSI1PK (scanAll scans GSI1), et ∉ {Case,CaseChunk},
// listed via GSI2 under a dedicated "SCAN#ALL" partition. Own repo — NOT CaseRepo.
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { casesDdbDoc as ddbDoc } from "../../dynamo/client";
import { GSI2 } from "../../dynamo/cases-table";
import type { ScanReport } from "./types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

export const scanKeys = { scan: (ts: string) => ({ PK: `SCAN#${ts}`, SK: "SCAN" }) };

// Pure item builder (unit-tested): no GSI1PK, non-Case et, GSI2 listing key.
export function scanItem(r: ScanReport): Record<string, unknown> {
  return { ...scanKeys.scan(r.ts), et: "Scan", GSI2PK: "SCAN#ALL", GSI2SK: r.ts, data: r };
}

export async function writeScan(r: ScanReport): Promise<void> {
  await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: scanItem(r) }));
}

export async function listScans(limit = 20): Promise<ScanReport[]> {
  const res = await ddbDoc.send(new QueryCommand({
    TableName: TABLE, IndexName: GSI2,
    KeyConditionExpression: "GSI2PK = :p",
    ExpressionAttributeValues: { ":p": "SCAN#ALL" },
    ScanIndexForward: false, Limit: limit,
  }));
  return (res.Items ?? []).map((i) => i.data as ScanReport);
}
