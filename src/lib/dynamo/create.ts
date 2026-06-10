// ===========================================================================
// Reusable single-table creation (used by scripts/create-table.ts and the
// verify harness). Idempotent, and waits until the table is ACTIVE so a seed
// that runs immediately after won't race (the bug we hit creating the cloud table).
// All our tables share the same generic key shape: PK/SK + GSI1 + GSI2.
// ===========================================================================
import {
  CreateTableCommand,
  ResourceInUseException,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { ddbClient } from "./client";

export async function createSingleTable(tableName: string): Promise<"created" | "exists"> {
  let result: "created" | "exists" = "created";
  try {
    await ddbClient.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: "PAY_PER_REQUEST",
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
            IndexName: "GSI1",
            KeySchema: [
              { AttributeName: "GSI1PK", KeyType: "HASH" },
              { AttributeName: "GSI1SK", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
          {
            IndexName: "GSI2",
            KeySchema: [
              { AttributeName: "GSI2PK", KeyType: "HASH" },
              { AttributeName: "GSI2SK", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
        ],
      }),
    );
  } catch (e) {
    if (e instanceof ResourceInUseException) result = "exists";
    else throw e;
  }
  await waitUntilTableExists({ client: ddbClient, maxWaitTime: 60 }, { TableName: tableName });
  return result;
}
