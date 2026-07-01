// ===========================================================================
// Seed the RapData table from the RAP fixtures (canonical entities + one
// PENDING_REVIEW extraction job). Mirrors the mock store's seed so cloud/local
// DynamoDB matches the dev experience.
//
// Local:  npm run rap:create && npm run rap:seed
// Cloud:  npm run rap:create:cloud && npm run rap:seed:cloud
// ===========================================================================
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { RAP_TABLE, toJobItem } from "../src/lib/dynamo/rap-table";
import { dynamoRapRepo } from "../src/lib/rap/repo.dynamo";
import * as seed from "../src/lib/rap/fixtures";

async function main() {
  for (const o of seed.orgs) await dynamoRapRepo.putOrganization(o);
  for (const r of seed.raps) await dynamoRapRepo.putRap(r);
  for (const c of seed.commitments) await dynamoRapRepo.putCommitment(c);
  for (const o of seed.observations) await dynamoRapRepo.putObservation(o);
  for (const r of seed.rollups) await dynamoRapRepo.putRollup(r);
  // extraction jobs have no public "put" on the repo — write the item directly
  for (const j of seed.jobs) {
    await ddbDoc.send(new PutCommand({ TableName: RAP_TABLE, Item: toJobItem(j) }));
  }

  console.log(
    `✅ seeded "${RAP_TABLE}": ${seed.orgs.length} orgs · ${seed.raps.length} RAPs · ` +
      `${seed.commitments.length} commitments · ${seed.observations.length} observations · ` +
      `${seed.rollups.length} rollups · ${seed.jobs.length} review job(s)`,
  );
}

main().catch((e) => {
  console.error("❌ seed-rap failed:", e);
  process.exit(1);
});
