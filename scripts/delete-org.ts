// Cascade-delete an organization: all its RAPs (+ commitments, rollups,
// observations) and the org record itself.
// Run: REPO_IMPL=dynamo RAP_TABLE=<t> AWS_REGION=us-east-1 AWS_PROFILE=<p> \
//        ORG_ID=org-royal-bank-of-canada npx tsx scripts/delete-org.ts
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { rapRepo } from "../src/lib/rap";
import { ddbDoc } from "../src/lib/dynamo/client";
import { RAP_TABLE, keys } from "../src/lib/dynamo/rap-table";

async function main() {
  const orgId = process.env.ORG_ID;
  if (!orgId) throw new Error("ORG_ID env required");
  const raps = await rapRepo.listRapsByOrg(orgId);
  for (const r of raps) await rapRepo.deleteRapGraph(orgId, r.id);
  await ddbDoc.send(new DeleteCommand({ TableName: RAP_TABLE, Key: keys.org(orgId) }));
  console.log(`🧹 deleted org "${orgId}": ${raps.length} RAP(s) + their commitments/rollups + the org record`);
}

main().catch((e) => { console.error(e); process.exit(1); });
