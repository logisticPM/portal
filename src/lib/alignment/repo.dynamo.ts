import { DeleteCommand, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../dynamo/client";
import { ALIGNMENT_TABLE, ALIGNMENT_GSI1, itemToOpportunity, opportunityKeys, toOpportunityItem } from "../dynamo/alignment-table";
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
        IndexName: ALIGNMENT_GSI1,
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
