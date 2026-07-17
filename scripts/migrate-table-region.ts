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

// Injectable for tests that need to simulate DynamoDB behaviors (e.g.
// UnprocessedItems under throttling) that DynamoDB Local won't reproduce with
// a handful of items. Real callers never pass this — copyTable builds a real
// client from src/dest region+endpoint by default.
export interface DocClientLike {
  send: DynamoDBDocumentClient["send"];
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
  // True when sourceCount === 0. Surfaced explicitly so an empty-source
  // "match" (both counts 0, no missing keys) can never be mistaken for a
  // genuine successful migration — see expectNonEmpty below.
  sourceEmpty: boolean;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry backoff schedule (ms) for UnprocessedItems from BatchWriteCommand.
// DynamoDB returns partial-success batches under throttling; retrying with
// backoff is the documented mitigation (see AWS SDK BatchWrite docs).
const UNPROCESSED_RETRY_DELAYS_MS = [50, 100, 200, 400, 800];

export async function copyTable(
  opts: CopyVerifyOpts & {
    shouldCheckTaxonomy?: (item: Item) => boolean;
    // Test-only overrides: inject fake doc clients to simulate
    // UnprocessedItems/throttling behavior DynamoDB Local won't produce, and
    // to keep that test free of any real network/DynamoDB Local dependency.
    // Real callers never set these — real clients are built from src/dest
    // region+endpoint by default.
    srcDocClient?: DocClientLike;
    destDocClient?: DocClientLike;
  }
): Promise<MigrationReport> {
  const srcDoc: DocClientLike = opts.srcDocClient ?? makeDocClient(opts.src);
  const destDoc: DocClientLike = opts.destDocClient ?? makeDocClient(opts.dest);
  const checkTaxonomy = opts.shouldCheckTaxonomy ?? shouldCheckTaxonomy;

  let scanned = 0;
  let written = 0;
  const flaggedNonCanonical: string[] = [];
  const buffer: Item[] = [];

  async function writeBatch(batch: Item[]) {
    let pending = batch;
    for (let attempt = 0; pending.length > 0; attempt++) {
      const res = await destDoc.send(
        new BatchWriteCommand({
          RequestItems: {
            [opts.dest.table]: pending.map((record) => ({ PutRequest: { Item: record } })),
          },
        })
      );
      const unprocessed = (res.UnprocessedItems?.[opts.dest.table] ?? [])
        .map((req) => req.PutRequest?.Item)
        .filter((item): item is Item => item != null);

      const confirmed = pending.length - unprocessed.length;
      written += confirmed;

      if (unprocessed.length === 0) return;

      if (attempt >= UNPROCESSED_RETRY_DELAYS_MS.length) {
        const keys = unprocessed.map((item) => keyLabel(item)).join(", ");
        throw new Error(
          `copyTable: ${unprocessed.length} item(s) remained UnprocessedItems after ` +
            `${UNPROCESSED_RETRY_DELAYS_MS.length} retries and were NOT written to ` +
            `${opts.dest.table}. Migration aborted to avoid silent data loss. Keys: ${keys}`
        );
      }

      await sleep(UNPROCESSED_RETRY_DELAYS_MS[attempt]);
      pending = unprocessed;
    }
  }

  async function flushBuffer() {
    if (buffer.length === 0) return;
    for (const batch of chunk(buffer, 25)) {
      await writeBatch(batch);
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
      // Commitments-table items nest their domain fields under `data`
      // (toCommitmentItem writes `data: c`), so there is no top-level
      // `item.sector` for them — RapData commit items spread `...c` and DO
      // have a top-level `sector`. Check both shapes; shouldCheckTaxonomy
      // still gates this to genuine commitment items only.
      const sector = item.sector ?? (item.data as Item | undefined)?.sector;
      if (
        typeof sector === "string" &&
        checkTaxonomy(item) &&
        !CANONICAL_SECTORS.includes(sector as (typeof CANONICAL_SECTORS)[number])
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

export async function verifyParity(
  opts: CopyVerifyOpts & {
    // When true, a source count of 0 forces match=false — an empty source
    // table (e.g. because the wrong/dev table was resolved) must never be
    // reported as a successful migration just because dest is also empty.
    // Tables known to legitimately be empty in the source region (e.g.
    // RapData in us-east-1) pass false/omit this.
    expectNonEmpty?: boolean;
  }
): Promise<ParityReport> {
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

  const sourceEmpty = sourceCount === 0;
  const match = sourceCount === destCount && missingKeys.length === 0 && !(opts.expectNonEmpty && sourceEmpty);
  return { sourceCount, destCount, match, missingKeys, sourceEmpty };
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
