// DynamoDB impl. getCase = GetCommand by key. Everything else Scans the table
// and delegates to the SAME query.ts the mock uses → dynamo ≡ mock by design.
import { GetCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../dynamo/client";
import { caseKeys, caseToItems, itemToCase, reassembleCase } from "../dynamo/cases-table";
import { filterCases, searchCases, buildFacets, buildActivation, buildGraph, buildCorpusStats } from "./query";
import type { CaseRepo, LegalCase } from "./types";
import { getSearchIndex } from "./search/build-index";
import { hybridRank } from "./search/hybrid";
import { getEmbedder } from "./search/embedder";

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
  // Brute-force hybrid retrieval: BM25 + dense cosine fused by RRF(k=60), aggregated
  // to the case by max. Ranks over the whole indexed haystack, then applies the
  // post-filter (core-only by default, like browse). Degrades to BM25-only when no
  // vectors exist or the active embedder ≠ the one that wrote them (logged).
  async hybridSearch(query, filter) {
    const idx = await getSearchIndex();
    const embedder = getEmbedder();
    let queryVec = null as Float32Array | null;
    if (idx.embedderId === embedder.id && idx.vdim === embedder.dim) {
      queryVec = (await embedder.embed([query]))[0];
    } else if (idx.embedderId) {
      console.warn(`[hybrid] embedder/dim mismatch active=${embedder.id}/${embedder.dim} stored=${idx.embedderId}/${idx.vdim} → BM25-only`);
    } else {
      console.warn(`[hybrid] no stored vectors → BM25-only`);
    }
    const ranked = hybridRank(idx.units, query, queryVec);
    const ordered = ranked
      .map((r) => idx.cases.get(r.caseId))
      .filter((c): c is LegalCase => !!c);
    return filterCases(ordered, filter); // Array.filter preserves rank order
  },
  async listFacets(filter) {
    return buildFacets(filterCases(await scanAll(), filter));
  },
  async getActivationSummary() {
    return buildActivation(filterCases(await scanAll(), { tier: "core" }));
  },
  async getCorpusStats() {
    return buildCorpusStats(await scanAll());
  },
  async getCitationGraph(id) {
    return buildGraph(await scanAll(), id);
  },
  async exportCases(filter) {
    return { cases: filterCases(await scanAll(), filter), asOf: new Date().toISOString() };
  },
};
