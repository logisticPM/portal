// Cross-region DynamoDB table copy + parity verification.
//
// Built for the us-east-1 → ca-central-1 residency cutover: copy-then-verify,
// never destructive. Source and dest are always separate connection params
// (separate clients) so a real run can point srcRegion !== destRegion; the
// local test just happens to pass the same endpoint/region for both.
//
// SECURITY: DataPortal's User items carry `email` + `passwordHash`. Nothing in
// this file may log a scanned item's attribute values — only counts and keys
// (PK/SK) are ever printed or returned in a report.
//
//   Local:  DYNAMO_ENDPOINT=http://localhost:8000 npx tsx scripts/test-migrate-table-region.ts
//   Cloud:  MIGRATE_CLI=1 SRC_REGION=us-east-1 SRC_TABLE=DataPortal \
//           DEST_REGION=ca-central-1 DEST_TABLE=DataPortal npx tsx scripts/migrate-table-region.ts
import {
  DynamoDBClient,
  // @ts-ignore: package may be resolved at runtime / installed in the environment
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  BatchWriteCommand,
  GetCommand,
  // @ts-ignore: package may be resolved at runtime / installed in the environment
} from "@aws-sdk/lib-dynamodb";
import { CANONICAL_SECTORS } from "../src/lib/taxonomy";

export interface ConnOpts {
  endpoint?: string; // present → DynamoDB Local; absent → real AWS via default credential chain
  region: string;
  table: string;
}

export interface CopyVerifyOpts {
  src: ConnOpts;
  dest: ConnOpts;
}

export interface MigrationReport {
  scanned: number;
  written: number;
  // Keys of items whose `sector` attribute was present but not in
  // CANONICAL_SECTORS, per the RAP-commitment-scoped predicate below. The item
  // is ALWAYS written regardless — this only flags rot for operator review.
  flaggedNonCanonical: string[];
}

export interface ParityReport {
  sourceCount: number;
  destCount: number;
  match: boolean;
  missingKeys: string[];
}

type Item = Record<string, unknown>;

// Mirrors src/lib/dynamo/client.ts: endpoint present → DynamoDB Local (dummy
// creds); endpoint absent → real AWS via the default credential chain + region.
function makeDocClient(conn: ConnOpts): DynamoDBDocumentClient {
  const raw = new DynamoDBClient({
    region: conn.region,
    ...(conn.endpoint
      ? { endpoint: conn.endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } }
      : {}),
  });
  return DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });
}

// Default predicate: only genuine RAP-commitment items are taxonomy-checked.
// DataPortal `Party` rows legitimately carry free-text `sector` values that
// were never meant to be canonical — checking those would false-flag every row.
export function shouldCheckTaxonomy(item: Item): boolean {
  return item.et === "Commitment";
}

function keyLabel(item: Item): string {
  return `${String(item.PK ?? "")}/${String(item.SK ?? "")}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function copyTable(
  opts: CopyVerifyOpts & { shouldCheckTaxonomy?: (item: Item) => boolean }
): Promise<MigrationReport> {
  const srcDoc = makeDocClient(opts.src);
  const destDoc = makeDocClient(opts.dest);
  const checkTaxonomy = opts.shouldCheckTaxonomy ?? shouldCheckTaxonomy;

  let scanned = 0;
  let written = 0;
  const flaggedNonCanonical: string[] = [];
  const buffer: Item[] = [];

  async function flushBuffer() {
    if (buffer.length === 0) return;
    for (const batch of chunk(buffer, 25)) {
      await destDoc.send(
        new BatchWriteCommand({
          RequestItems: {
            [opts.dest.table]: batch.map((Item) => ({ PutRequest: { Item } })),
          },
        })
      );
      written += batch.length;
    }
    buffer.length = 0;
  }

  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await srcDoc.send(
      new ScanCommand({ TableName: opts.src.table, ExclusiveStartKey })
    );
    for (const item of page.Items ?? []) {
      scanned++;
      if (
        typeof item.sector === "string" &&
        checkTaxonomy(item) &&
        !CANONICAL_SECTORS.includes(item.sector as (typeof CANONICAL_SECTORS)[number])
      ) {
        flaggedNonCanonical.push(keyLabel(item));
      }
      buffer.push(item);
      if (buffer.length >= 25) await flushBuffer();
    }
    ExclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);

  await flushBuffer();

  return { scanned, written, flaggedNonCanonical };
}

export async function verifyParity(opts: CopyVerifyOpts): Promise<ParityReport> {
  const srcDoc = makeDocClient(opts.src);
  const destDoc = makeDocClient(opts.dest);

  async function countTable(doc: DynamoDBDocumentClient, table: string): Promise<number> {
    let count = 0;
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await doc.send(
        new ScanCommand({ TableName: table, Select: "COUNT", ExclusiveStartKey })
      );
      count += page.Count ?? 0;
      ExclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ExclusiveStartKey);
    return count;
  }

  const [sourceCount, destCount] = await Promise.all([
    countTable(srcDoc, opts.src.table),
    countTable(destDoc, opts.dest.table),
  ]);

  // Collect every source {PK,SK} and confirm it exists in dest.
  const srcKeys: { PK: unknown; SK: unknown }[] = [];
  {
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await srcDoc.send(
        new ScanCommand({
          TableName: opts.src.table,
          ProjectionExpression: "PK, SK",
          ExclusiveStartKey,
        })
      );
      for (const item of page.Items ?? []) srcKeys.push({ PK: item.PK, SK: item.SK });
      ExclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ExclusiveStartKey);
  }

  const missingKeys: string[] = [];
  for (const key of srcKeys) {
    const res = await destDoc.send(new GetCommand({ TableName: opts.dest.table, Key: key }));
    if (!res.Item) missingKeys.push(`${String(key.PK)}/${String(key.SK)}`);
  }

  const match = sourceCount === destCount && missingKeys.length === 0;
  return { sourceCount, destCount, match, missingKeys };
}

// ---------------------------------------------------------------------------
// CLI entrypoint. This repo compiles scripts as CJS, so `import.meta.url`
// equality checks aren't available — gate on an explicit env var instead.
// ---------------------------------------------------------------------------
async function main() {
  const src: ConnOpts = {
    endpoint: process.env.DYNAMO_ENDPOINT,
    region: process.env.SRC_REGION ?? "us-east-1",
    table: process.env.SRC_TABLE ?? "DataPortal",
  };
  const dest: ConnOpts = {
    endpoint: process.env.DYNAMO_ENDPOINT,
    region: process.env.DEST_REGION ?? "ca-central-1",
    table: process.env.DEST_TABLE ?? "DataPortal",
  };

  console.log(`migrate-table-region: copying ${src.region}/${src.table} -> ${dest.region}/${dest.table}`);
  const migrationReport = await copyTable({ src, dest });
  console.log(
    `copy: scanned=${migrationReport.scanned} written=${migrationReport.written} flaggedNonCanonical=${migrationReport.flaggedNonCanonical.length}`
  );
  if (migrationReport.flaggedNonCanonical.length > 0) {
    console.log(`  flagged keys: ${migrationReport.flaggedNonCanonical.join(", ")}`);
  }

  console.log("verifying parity...");
  const parityReport = await verifyParity({ src, dest });
  console.log(
    `parity: sourceCount=${parityReport.sourceCount} destCount=${parityReport.destCount} match=${parityReport.match} missingKeys=${parityReport.missingKeys.length}`
  );
  if (parityReport.missingKeys.length > 0) {
    console.log(`  missing keys: ${parityReport.missingKeys.join(", ")}`);
  }

  if (!parityReport.match) process.exit(1);
}

if (process.env.MIGRATE_CLI === "1") {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
