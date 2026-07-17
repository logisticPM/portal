// Orchestrates the us-east-1 -> ca-central-1 residency cutover for the five
// PLATFORM tables (DataPortal, RapData, RapSurvey, Commitments, Alignment).
//
// LegalCases is explicitly OUT OF SCOPE — it stays in us-east-1. Migrating it
// here would be a residency violation (it's governed separately, see
// data-governance-ocap-residency notes) and would corrupt a domain this script
// has no business touching. `isPlatformTable` enforces that at runtime, not
// just by omission from PLATFORM_STEMS.
//
// SECURITY: DataPortal's User items carry `email` + `passwordHash`. Nothing in
// this file may log a scanned/verified item's attribute values — only counts,
// table names, and PK/SK-derived key labels (already redacted by Task 1's
// copyTable/verifyParity) are ever printed.
//
//   Unit test (no AWS):  npx tsx scripts/test-migrate-orchestrator.ts
//   Live migrate:        npm run ca:migrate
//   Live verify-only:    npm run ca:verify
import {
  DynamoDBClient,
  ListTablesCommand,
  // @ts-ignore: package may be resolved at runtime / installed in the environment
} from "@aws-sdk/client-dynamodb";
import { copyTable, verifyParity, type MigrationReport, type ParityReport } from "./migrate-table-region";

export const SRC_REGION = "us-east-1";
export const DEST_REGION = "ca-central-1";

// The shared logical stem for each of the five platform tables. SST appends a
// stage prefix and a random suffix to these, e.g.
// `indigenomics-portal-production-DataPortalTable-bddkwbku` (us-east-1) and
// `indigenomics-portal-ca-DataPortalTable-<suffix>` (ca-central-1).
export const PLATFORM_STEMS = ["DataPortal", "RapData", "RapSurvey", "Commitments", "Alignment"] as const;
export type PlatformStem = (typeof PLATFORM_STEMS)[number];

// PURE — no AWS calls. Returns true only for the five platform stems, and
// FALSE for anything containing "LegalCases" (case-insensitive), even if it
// were somehow also (falsely) claiming to be a platform stem. This is the
// belt in the belt-and-suspenders: the orchestrator asserts every table name
// it is about to touch passes this check before calling copyTable/verifyParity.
export function isPlatformTable(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.includes("legalcases")) return false;
  return PLATFORM_STEMS.some((stem) => lower.includes(stem.toLowerCase()));
}

// PURE — no AWS calls. Finds the physical table name in `names` whose name
// contains `stem` (case-insensitive substring), matching SST's
// `<prefix>-<Stem>Table-<suffix>` naming. Returns null when no match is
// found. Never matches LegalCases, even if a caller mistakenly passed a stem
// that would otherwise match it (defense in depth alongside isPlatformTable).
export function matchTableByStem(names: string[], stem: string): string | null {
  const needle = stem.toLowerCase();
  const match = names.find((name) => {
    const lower = name.toLowerCase();
    if (lower.includes("legalcases")) return false;
    return lower.includes(needle);
  });
  return match ?? null;
}

interface TableResult {
  stem: PlatformStem;
  srcName: string;
  destName: string;
  copy: MigrationReport | null;
  parity: ParityReport;
}

async function listTableNames(region: string): Promise<string[]> {
  const client = new DynamoDBClient({ region });
  const names: string[] = [];
  let ExclusiveStartTableName: string | undefined;
  do {
    const res = await client.send(new ListTablesCommand({ ExclusiveStartTableName }));
    names.push(...(res.TableNames ?? []));
    ExclusiveStartTableName = res.LastEvaluatedTableName;
  } while (ExclusiveStartTableName);
  return names;
}

function resolveStemName(names: string[], stem: PlatformStem, region: string): string {
  const match = matchTableByStem(names, stem);
  if (!match) {
    throw new Error(`migrate-all-platform-tables: no table matching stem "${stem}" found in ${region}`);
  }
  if (!isPlatformTable(match)) {
    // Should be unreachable given matchTableByStem's own LegalCases guard,
    // but asserted explicitly per the "throws if LegalCases ever appears in
    // its target set" requirement — never trust a single layer of defense.
    throw new Error(`migrate-all-platform-tables: refusing to touch non-platform table "${match}" (stem "${stem}")`);
  }
  return match;
}

async function migrateOne(stem: PlatformStem, srcName: string, destName: string, verifyOnly: boolean): Promise<TableResult> {
  const opts = {
    src: { region: SRC_REGION, table: srcName },
    dest: { region: DEST_REGION, table: destName },
  };

  let copy: MigrationReport | null = null;
  if (!verifyOnly) {
    copy = await copyTable(opts);
  }
  const parity = await verifyParity(opts);
  return { stem, srcName, destName, copy, parity };
}

function printSummary(results: TableResult[]): void {
  console.log("\n=== migrate-all-platform-tables summary ===");
  for (const r of results) {
    const copyLine = r.copy
      ? `scanned=${r.copy.scanned} written=${r.copy.written} flaggedNonCanonical=${r.copy.flaggedNonCanonical.length}`
      : "copy=skipped(verify-only)";
    console.log(
      `${r.stem}: src=${r.srcName} dest=${r.destName} | ${copyLine} | parity match=${r.parity.match} ` +
        `(sourceCount=${r.parity.sourceCount} destCount=${r.parity.destCount} missingKeys=${r.parity.missingKeys.length})`
    );
  }
  console.log("============================================\n");
}

async function main(): Promise<void> {
  const verifyOnly = process.argv.includes("--verify-only");

  console.log(
    `migrate-all-platform-tables: ${verifyOnly ? "VERIFY-ONLY" : "COPY + VERIFY"} ${SRC_REGION} -> ${DEST_REGION}`
  );
  console.log(`platform stems: ${PLATFORM_STEMS.join(", ")} (LegalCases excluded)`);

  const [srcNames, destNames] = await Promise.all([listTableNames(SRC_REGION), listTableNames(DEST_REGION)]);

  const results: TableResult[] = [];
  const errors: { stem: PlatformStem; error: unknown }[] = [];

  for (const stem of PLATFORM_STEMS) {
    const srcName = resolveStemName(srcNames, stem, SRC_REGION);
    const destName = resolveStemName(destNames, stem, DEST_REGION);

    // Final assertion right before any AWS mutation/read call — every table
    // in the target set MUST pass isPlatformTable, or we abort entirely.
    if (!isPlatformTable(srcName) || !isPlatformTable(destName)) {
      throw new Error(
        `migrate-all-platform-tables: target set contains a non-platform table (src="${srcName}", dest="${destName}"). Aborting.`
      );
    }

    try {
      const result = await migrateOne(stem, srcName, destName, verifyOnly);
      results.push(result);
    } catch (error) {
      console.error(`${stem}: FAILED —`, error instanceof Error ? error.message : error);
      errors.push({ stem, error });
    }
  }

  printSummary(results);

  const anyParityMismatch = results.some((r) => !r.parity.match);
  if (anyParityMismatch) {
    console.error("FAILED: at least one table's parity check did not match.");
  }
  if (errors.length > 0) {
    console.error(`FAILED: ${errors.length} table(s) threw during migration: ${errors.map((e) => e.stem).join(", ")}`);
  }

  if (anyParityMismatch || errors.length > 0) {
    process.exit(1);
  }
  console.log("OK: all platform tables migrated/verified with parity match=true.");
}

// This repo compiles scripts as CJS, so no top-level await / import.meta.url
// equality checks. Gate live execution behind an explicit env var so that
// importing this module (e.g. from the unit test, which only exercises the
// pure functions above) never triggers a real cross-region migration.
if (process.env.RUN_MIGRATION === "1") {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
