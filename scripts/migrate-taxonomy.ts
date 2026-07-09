// Idempotent taxonomy migration for RAP-domain items in the RapData table.
// Rewrites legacy sector/commitmentType values (and the SECTOR# GSI2 key) to the
// canonical enum. Commitments-domain items are already canonical and untouched.
//   Local: npx tsx scripts/migrate-taxonomy.ts
//   Cloud: (set AWS creds/region) npx tsx scripts/migrate-taxonomy.ts
import { ScanCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { RAP_TABLE } from "../src/lib/dynamo/rap-table";

const SECTOR_MAP: Record<string, string> = {
  finance_banking: "finance", mining_extractive: "mining",
};
const TYPE_MAP: Record<string, string> = {
  cultural_awareness: "cultural_learning",
};

export function remapSector(s: string): string { return SECTOR_MAP[s] ?? s; }
export function remapType(t: string): string { return TYPE_MAP[t] ?? t; }

// GSI2SK for a commitment is `COMMIT#<commitmentType>#<id>` — remap the type segment.
export function remapGsi2Sk(sk: string): string {
  if (!sk.startsWith("COMMIT#")) return sk;
  const parts = sk.split("#"); // ["COMMIT", <type>, ...idParts]
  if (parts.length < 3) return sk;
  parts[1] = remapType(parts[1]);
  return parts.join("#");
}

async function main() {
  let scanned = 0, updated = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddbDoc.send(new ScanCommand({ TableName: RAP_TABLE, ExclusiveStartKey }));
    for (const item of page.Items ?? []) {
      scanned++;
      let changed = false;
      if (typeof item.sector === "string") {
        const ns = remapSector(item.sector);
        if (ns !== item.sector) { item.sector = ns; changed = true; }
      }
      if (typeof item.commitmentType === "string") {
        const nt = remapType(item.commitmentType);
        if (nt !== item.commitmentType) { item.commitmentType = nt; changed = true; }
      }
      if (typeof item.GSI2PK === "string" && item.GSI2PK.startsWith("SECTOR#")) {
        const raw = item.GSI2PK.slice("SECTOR#".length);
        const ng = `SECTOR#${remapSector(raw)}`;
        if (ng !== item.GSI2PK) { item.GSI2PK = ng; changed = true; }
      }
      if (typeof item.GSI2SK === "string" && item.GSI2SK.startsWith("COMMIT#")) {
        const nsk = remapGsi2Sk(item.GSI2SK);
        if (nsk !== item.GSI2SK) { item.GSI2SK = nsk; changed = true; }
      }
      if (changed) {
        await ddbDoc.send(new PutCommand({ TableName: RAP_TABLE, Item: item }));
        updated++;
      }
    }
    ExclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  console.log(`migrate-taxonomy: scanned ${scanned}, updated ${updated}`);
}

// Only run main() when invoked directly (not when imported by the test).
// Use a more specific check to avoid matching "test-migrate-taxonomy.ts"
if (process.argv[1] && (process.argv[1].endsWith("/migrate-taxonomy.ts") || process.argv[1] === "migrate-taxonomy.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
