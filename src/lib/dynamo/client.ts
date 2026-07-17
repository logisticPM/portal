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

// ---------------------------------------------------------------------------
// Legal-cases client — pinned to the cases region, NOT the Lambda's AWS_REGION.
//
// Under the residency split (spec §4) the LegalCases table stays in us-east-1
// while the platform runs in ca-central-1. `ddbDoc` above follows AWS_REGION, so
// in the ca Lambda it points at ca-central-1 — where LegalCases does not exist,
// so every cases read fails ("corpus isn't reachable"). This only worked before
// because the app had only ever run IN us-east-1, where AWS_REGION happened to
// match. Cases access must therefore use a client pinned to the cases region.
//
// Local dev is unchanged: DYNAMO_ENDPOINT still routes to DynamoDB Local. Only
// the cloud region differs, and it defaults to us-east-1 (where the corpus +
// its Titan vectors live), overridable via CASES_REGION.
const casesRegion = process.env.CASES_REGION ?? "us-east-1";

export const casesDdbClient = new DynamoDBClient({
  region: casesRegion,
  ...(endpoint
    ? { endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } }
    : {}),
});

export const casesDdbDoc = DynamoDBDocumentClient.from(casesDdbClient, {
  marshallOptions: { removeUndefinedValues: true },
});
