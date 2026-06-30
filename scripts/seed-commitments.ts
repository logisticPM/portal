// Seed the Commitments table with the curated fixtures (deterministic, offline).
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { toCommitmentItem } from "../src/lib/dynamo/commitments-table";
import { commitmentFixtures } from "../src/lib/commitments/fixtures";

const TABLE = process.env.COMMITMENTS_TABLE ?? "Commitments";

export async function seedCommitments() {
  const items = commitmentFixtures.map((c) => ({ PutRequest: { Item: toCommitmentItem(c) } }));
  for (let i = 0; i < items.length; i += 25) {
    await ddbDoc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: items.slice(i, i + 25) } }));
  }
  console.log(`✅ seeded ${commitmentFixtures.length} commitments into "${TABLE}"`);
  return { commitments: commitmentFixtures.length };
}

if (require.main === module) {
  seedCommitments().catch((e) => {
    console.error("❌ seed-commitments failed:", e);
    process.exit(1);
  });
}
