// Seed the LegalCases table. For the demo this writes the curated fixtures
// directly (deterministic, offline). The A2AJ live path (fetchA2aj + a2ajToCase
// + enrichment merge) is exercised by `npm run cases:ingest` in Phase 2; the
// fixtures already encode the merged result.
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseToItems } from "../src/lib/dynamo/cases-table";
import { caseFixtures } from "../src/lib/cases/fixtures";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

export async function seedCases() {
  const items = caseFixtures.flatMap((c) => caseToItems(c).map((Item) => ({ PutRequest: { Item } })));
  for (let i = 0; i < items.length; i += 25) {
    await ddbDoc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: items.slice(i, i + 25) } }));
  }
  console.log(`✅ seeded ${caseFixtures.length} cases into "${TABLE}"`);
}

if (require.main === module) {
  seedCases().catch((e) => { console.error("❌ seed-cases failed:", e); process.exit(1); });
}
