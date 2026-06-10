// ===========================================================================
// Create the DataPortal single table (+ GSI1, GSI2). Idempotent.
//
// Local:  npm run ddb:create        (DYNAMO_ENDPOINT is set by the npm script)
// Cloud:  AWS_REGION=ca-central-1 DYNAMO_TABLE=DataPortal tsx scripts/create-table.ts
//         (no DYNAMO_ENDPOINT → hits real AWS via your credential chain)
//
// Same script, same schema, both targets — that's the no-duplicate-work payoff.
// ===========================================================================
import {
  CreateTableCommand,
  ResourceInUseException,
} from "@aws-sdk/client-dynamodb";
import { ddbClient, TABLE } from "../src/lib/dynamo/client";
import { GSI1, GSI2 } from "../src/lib/dynamo/single-table";

async function main() {
  try {
    await ddbClient.send(
      new CreateTableCommand({
        TableName: TABLE,
        BillingMode: "PAY_PER_REQUEST", // on-demand: free-tier friendly, no capacity to tune
        AttributeDefinitions: [
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
          { AttributeName: "GSI1PK", AttributeType: "S" },
          { AttributeName: "GSI1SK", AttributeType: "S" },
          { AttributeName: "GSI2PK", AttributeType: "S" },
          { AttributeName: "GSI2SK", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: GSI1,
            KeySchema: [
              { AttributeName: "GSI1PK", KeyType: "HASH" },
              { AttributeName: "GSI1SK", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
          {
            IndexName: GSI2,
            KeySchema: [
              { AttributeName: "GSI2PK", KeyType: "HASH" },
              { AttributeName: "GSI2SK", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
        ],
      }),
    );
    console.log(`✅ created table "${TABLE}" with ${GSI1} + ${GSI2}`);
  } catch (e) {
    if (e instanceof ResourceInUseException) {
      console.log(`ℹ️  table "${TABLE}" already exists — nothing to do`);
      return;
    }
    throw e;
  }
}

main().catch((e) => {
  console.error("❌ create-table failed:", e);
  process.exit(1);
});
