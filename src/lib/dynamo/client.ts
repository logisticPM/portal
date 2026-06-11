// ===========================================================================
// DynamoDB client — the ONE place that differs between DynamoDB Local and real
// AWS DynamoDB (spec §4). Everything else (single-table.ts, repo.dynamo.ts,
// seed) is identical across both, so moving to the cloud is a config change,
// not a rewrite.
//
//   DYNAMO_ENDPOINT set   → DynamoDB Local (dummy creds)
//   DYNAMO_ENDPOINT unset → real AWS (uses the default credential chain:
//                           IAM role in prod, or AWS_ACCESS_KEY_ID/SECRET locally)
//
// Server-side only. AWS keys must NEVER use a NEXT_PUBLIC_ prefix.
// ===========================================================================
// @ts-ignore: package may be resolved at runtime / installed in the environment
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
// @ts-ignore: package may be resolved at runtime / installed in the environment
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const region = process.env.AWS_REGION ?? "us-east-1";
const endpoint = process.env.DYNAMO_ENDPOINT; // present only for DynamoDB Local

export const TABLE = process.env.DYNAMO_TABLE ?? "DataPortal";

export const ddbClient = new DynamoDBClient({
  region,
  ...(endpoint
    ? { endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } }
    : {}),
});

// The Document client lets us read/write plain JS objects instead of the
// low-level attribute-value format. removeUndefinedValues lets optional fields
// (identityTier, correctedAmount, withdrawn) simply be omitted.
export const ddbDoc = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});
