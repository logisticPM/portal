// ===========================================================================
// Backfill `dataClass` onto pre-governance RapData rows (spec §6, Phase 1).
//
// Conservative by construction: an untagged row cannot prove it is public
// disclosure, so it becomes `org_submitted`. Already-tagged rows are never
// touched — a `public` row is NOT downgraded, and a re-run is a no-op.
//
//   RAP_TABLE=<table> AWS_PROFILE=<profile> npx tsx scripts/migrate-rap-dataclass.ts
// ===========================================================================
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import type { DataClass } from "../src/lib/governance";

const VALID: DataClass[] = ["public", "org_submitted"];

// Plan scope (governance spec §6, Phase 1): document-derived RAP entities only.
// `et` is the entity-type discriminator every RapData row carries (see `keys`
// and the `to*Item` marshallers in src/lib/dynamo/rap-table.ts). OrgClaim rows
// (`et: "Claim"`) are deliberately excluded — a claim is a grant record, not
// document-derived content, and is out of this backfill's stated scope.
const IN_SCOPE_ENTITY_TYPES = new Set(["Job", "Org", "Rap", "Commitment", "Observation", "Rollup"]);

// Pure + testable: what class should this row get, or null to leave it alone?
export function planRapDataClass(item: Record<string, any>): DataClass | null {
  if (!IN_SCOPE_ENTITY_TYPES.has(item.et)) return null; // out of scope (e.g. OrgClaim)
  if (VALID.includes(item.dataClass)) return null; // already classified — idempotent
  return "org_submitted"; // untagged or invalid ⇒ conservative default
}

async function main() {
  const table = process.env.RAP_TABLE;
  if (!table) throw new Error("RAP_TABLE not set");

  let startKey: Record<string, any> | undefined;
  let scanned = 0;
  let updated = 0;

  do {
    const res: any = await ddbDoc.send(
      new ScanCommand({ TableName: table, ExclusiveStartKey: startKey }),
    );
    for (const item of res.Items ?? []) {
      scanned++;
      const next = planRapDataClass(item);
      if (!next) continue;
      await ddbDoc.send(
        new UpdateCommand({
          TableName: table,
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression: "SET dataClass = :d",
          ExpressionAttributeValues: { ":d": next },
        }),
      );
      updated++;
    }
    startKey = res.LastEvaluatedKey;
  } while (startKey);

  console.log(`scanned ${scanned} rows, tagged ${updated}`);
}

// Anchored so `test-migrate-rap-dataclass.ts` importing this file does NOT run it.
if (process.argv[1]?.endsWith("/migrate-rap-dataclass.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
