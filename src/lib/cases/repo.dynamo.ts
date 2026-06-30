// DynamoDB impl. getCase = GetCommand by key. Everything else Scans the table
// and delegates to the SAME query.ts the mock uses → dynamo ≡ mock by design.
import { GetCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../dynamo/client";
import { caseKeys, caseToItems, itemToCase, reassembleCase } from "../dynamo/cases-table";
import { filterCases, searchCases, buildFacets, buildActivation, buildGraph } from "./query";
import type { CaseRepo, LegalCase } from "./types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

async function scanAll(): Promise<LegalCase[]> {
  const out: LegalCase[] = [];
  let start: Record<string, any> | undefined;
  do {
    const r = await ddbDoc.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: start }));
    for (const it of r.Items ?? []) if (it.et === "Case") out.push(itemToCase(it));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

/** Build BatchWrite PutRequest items for a case (PROFILE + CHUNK# items). */
export function caseWriteRequests(c: LegalCase) {
  return caseToItems(c).map((Item) => ({ PutRequest: { Item } }));
}

export const dynamoCaseRepo: CaseRepo = {
  async listCases(filter) {
    return [...filterCases(await scanAll(), filter)].sort((a, b) => b.year - a.year);
  },
  async getCase(id) {
    const profileResult = await ddbDoc.send(
      new GetCommand({ TableName: TABLE, Key: caseKeys.profile(id) })
    );
    if (!profileResult.Item) return null;
    const profileItem = profileResult.Item;

    // Fetch all CHUNK# items for this case (paginated).
    const chunkItems: Record<string, any>[] = [];
    let lastKey: Record<string, any> | undefined;
    do {
      const r = await ddbDoc.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :ck)",
          ExpressionAttributeValues: { ":pk": `CASE#${id}`, ":ck": "CHUNK#" },
          ExclusiveStartKey: lastKey,
        })
      );
      for (const it of r.Items ?? []) chunkItems.push(it);
      lastKey = r.LastEvaluatedKey;
    } while (lastKey);

    return reassembleCase(profileItem, chunkItems);
  },
  async searchCases(query, filter) {
    return searchCases(await scanAll(), query, filter);
  },
  async listFacets(filter) {
    return buildFacets(filterCases(await scanAll(), filter));
  },
  async getActivationSummary() {
    return buildActivation(filterCases(await scanAll(), { tier: "core" }));
  },
  async getCitationGraph(id) {
    return buildGraph(await scanAll(), id);
  },
  async exportCases(filter) {
    return { cases: filterCases(await scanAll(), filter), asOf: new Date().toISOString() };
  },
};
