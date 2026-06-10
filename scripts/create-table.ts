// ===========================================================================
// Create the single table (+ GSI1, GSI2). Idempotent; waits until ACTIVE.
//
// Local:  npm run ddb:create        (DataPortal)  ·  npm run survey:create (RapSurvey)
// Cloud:  AWS_REGION=us-east-1 DYNAMO_TABLE=DataPortal tsx scripts/create-table.ts
//         (no DYNAMO_ENDPOINT → hits real AWS via your credential chain)
// ===========================================================================
import { TABLE } from "../src/lib/dynamo/client";
import { createSingleTable } from "../src/lib/dynamo/create";

async function main() {
  const result = await createSingleTable(TABLE);
  console.log(
    result === "created"
      ? `✅ created table "${TABLE}" with GSI1 + GSI2`
      : `ℹ️  table "${TABLE}" already exists — nothing to do`,
  );
}

main().catch((e) => {
  console.error("❌ create-table failed:", e);
  process.exit(1);
});
