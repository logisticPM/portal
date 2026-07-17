// Run: npm run ddb:up && DYNAMO_ENDPOINT=http://localhost:8000 npx tsx scripts/test-migrate-table-region.ts
//
// Exercises copyTable/verifyParity entirely against DynamoDB Local, using two
// tables in the same local endpoint as stand-ins for source-region/dest-region
// tables. Prints a skip line (not a failure) if DynamoDB Local isn't reachable.
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { copyTable, verifyParity } from "./migrate-table-region";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const ENDPOINT = process.env.DYNAMO_ENDPOINT ?? "http://localhost:8000";
const raw = new DynamoDBClient({ endpoint: ENDPOINT, region: "local", credentials: { accessKeyId: "l", secretAccessKey: "l" } });
const doc = DynamoDBDocumentClient.from(raw);
const SRC = "MigSrc";
const DST = "MigDst";

async function makeTable(name: string) {
  await raw.send(new DeleteTableCommand({ TableName: name })).catch(() => {});
  await raw.send(new CreateTableCommand({
    TableName: name,
    AttributeDefinitions: [{ AttributeName: "PK", AttributeType: "S" }, { AttributeName: "SK", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "PK", KeyType: "HASH" }, { AttributeName: "SK", KeyType: "RANGE" }],
    BillingMode: "PAY_PER_REQUEST",
  }));
}

async function main() {
  // Fail fast with a clear skip line rather than a confusing connection-refused stack.
  try {
    await raw.send(new DeleteTableCommand({ TableName: "__ddb_reachability_probe__" })).catch(() => {});
  } catch {
    console.log(`SKIP: DynamoDB Local unreachable at ${ENDPOINT} (run "npm run ddb:up" first)`);
    process.exit(0);
  }

  await makeTable(SRC);
  await makeTable(DST);
  await doc.send(new PutCommand({ TableName: SRC, Item: { PK: "ORG#1", SK: "META", sector: "finance" } }));
  // Stale RAP-commitment item — this is where the real non-canonical rot lived
  // (pre-#145 finance_banking/mining_extractive). Must be flagged.
  await doc.send(
    new PutCommand({ TableName: SRC, Item: { PK: "ORG#2", SK: "META", et: "Commitment", sector: "finance_banking" } })
  );
  await doc.send(new PutCommand({ TableName: SRC, Item: { PK: "ORG#3", SK: "META" } })); // no sector — fine
  // Party-like item: free-text sector, NOT a Commitment. Must NOT be flagged —
  // this is the false-positive case the scoped predicate exists to avoid
  // (DataPortal Party rows legitimately carry non-canonical free-text sectors).
  await doc.send(
    new PutCommand({ TableName: SRC, Item: { PK: "ORG#4", SK: "META", sector: "finance_banking" } })
  );

  // Local test stands one endpoint in for both "regions"; a real cutover run
  // passes distinct src/dest connection params (see CLI entrypoint below).
  const opts = {
    src: { endpoint: ENDPOINT, region: "local", table: SRC },
    dest: { endpoint: ENDPOINT, region: "local", table: DST },
  };

  const rep = await copyTable(opts);
  check("copies every source item", rep.written === 4);
  check("scans every source item", rep.scanned === 4);
  check(
    "flags the non-canonical sector row on a Commitment item (does not silently carry it)",
    rep.flaggedNonCanonical.length === 1 && rep.flaggedNonCanonical[0].includes("ORG#2")
  );
  check(
    "does NOT flag a non-canonical sector on a non-Commitment (Party-like) item",
    !rep.flaggedNonCanonical.some((k) => k.includes("ORG#4"))
  );
  check("Party-like non-canonical-sector item is still copied (data is data)", rep.written === 4);

  const parity = await verifyParity(opts);
  check("parity: dest count equals source count", parity.destCount === parity.sourceCount);
  check("parity: match is true when counts agree and no key missing", parity.match === true);
  check("parity: no missing keys after a full copy", parity.missingKeys.length === 0);

  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
