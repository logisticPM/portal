// DynamoDB impl. getCommitment = GetCommand by key. Everything else Scans the
// table and delegates to the SAME query.ts the mock uses → dynamo ≡ mock by design.
import { GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../dynamo/client";
import { commitmentKeys, itemToCommitment } from "../dynamo/commitments-table";
import { buildSummary, filterCommitments } from "./query";
import type { Commitment, CommitmentRepo } from "./types";

const TABLE = process.env.COMMITMENTS_TABLE ?? "Commitments";

async function scanAll(): Promise<Commitment[]> {
  const out: Commitment[] = [];
  let start: Record<string, any> | undefined;
  do {
    const r = await ddbDoc.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: start }));
    for (const it of r.Items ?? []) if (it.et === "Commitment") out.push(itemToCommitment(it));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

export const dynamoCommitmentsRepo: CommitmentRepo = {
  async listCommitments(filter) {
    return [...filterCommitments(await scanAll(), filter)].sort(
      (a, b) => b.targetYear - a.targetYear || a.id.localeCompare(b.id),
    );
  },
  async getCommitment(id) {
    const r = await ddbDoc.send(
      new GetCommand({ TableName: TABLE, Key: commitmentKeys.profile(id) }),
    );
    return r.Item ? itemToCommitment(r.Item) : null;
  },
  async getSummary(filter) {
    return buildSummary(filterCommitments(await scanAll(), filter));
  },
};
