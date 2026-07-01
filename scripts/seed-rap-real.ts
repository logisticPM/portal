// ===========================================================================
// WIPE the RapData table, then seed it with REAL verified data (real-fixtures).
// Used for the us-east-1 "real-only" stack (Option A). Destructive: it deletes
// every existing item first, so run against the intended stack's table only.
//
// Run: RAP_TABLE=<table> AWS_REGION=<region> AWS_PROFILE=<profile> \
//        npx tsx scripts/seed-rap-real.ts
// ===========================================================================
import { BatchWriteCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { RAP_TABLE, toJobItem } from "../src/lib/dynamo/rap-table";
import { dynamoRapRepo } from "../src/lib/rap/repo.dynamo";
import * as seed from "../src/lib/rap/real-fixtures";

async function wipe(): Promise<number> {
  let removed = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddbDoc.send(
      new ScanCommand({ TableName: RAP_TABLE, ProjectionExpression: "PK, SK", ExclusiveStartKey }),
    );
    const items = page.Items ?? [];
    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25);
      await ddbDoc.send(
        new BatchWriteCommand({
          RequestItems: {
            [RAP_TABLE]: chunk.map((it) => ({ DeleteRequest: { Key: { PK: it.PK, SK: it.SK } } })),
          },
        }),
      );
      removed += chunk.length;
    }
    ExclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return removed;
}

async function main() {
  const removed = await wipe();
  for (const o of seed.orgs) await dynamoRapRepo.putOrganization(o);
  for (const r of seed.raps) await dynamoRapRepo.putRap(r);
  for (const c of seed.commitments) await dynamoRapRepo.putCommitment(c);
  for (const o of seed.observations) await dynamoRapRepo.putObservation(o);
  for (const r of seed.rollups) await dynamoRapRepo.putRollup(r);
  for (const j of seed.jobs) {
    await ddbDoc.send(new PutCommand({ TableName: RAP_TABLE, Item: toJobItem(j) }));
  }

  console.log(
    `🧹 wiped ${removed} old items\n` +
      `✅ seeded REAL data into "${RAP_TABLE}": ${seed.orgs.length} orgs · ${seed.raps.length} RAPs · ` +
      `${seed.commitments.length} commitments · ${seed.rollups.length} rollups`,
  );
}

main().catch((e) => {
  console.error("❌ seed-rap-real failed:", e);
  process.exit(1);
});
