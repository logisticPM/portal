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
