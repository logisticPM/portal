// Idempotent migration: rewrite the legacy CCAB identity tier + verification
// strings to CCIB on supplier PARTY items in the DataPortal table. Ships with the
// ccab->ccib rename (PR #147) — a code enum rename on a POPULATED table needs the
// stored data migrated too, else reads keyed on the new enum crash (byTier).
//   Local: DYNAMO_ENDPOINT=http://localhost:8000 npx tsx scripts/migrate-supplier-ccib.ts
//   Cloud: AWS_PROFILE=isb DYNAMO_TABLE=<physical-name> npx tsx scripts/migrate-supplier-ccib.ts
import { ScanCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE } from "../src/lib/dynamo/client";

// "CCAB Certified (PAR Gold)" -> "CCIB Certified (PAR Gold)", "CCAB" -> "CCIB".
export function fixCcab(s: string): string { return s.replace(/CCAB/g, "CCIB"); }

async function main() {
  let scanned = 0, updated = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddbDoc.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
    for (const item of page.Items ?? []) {
      scanned++;
      let changed = false;
      // DataPortal PARTY items: the supplier's own identity tier + its verifications.
      if (item.identityTier === "ccab") { item.identityTier = "ccib"; changed = true; }
      if (Array.isArray(item.verifications)) {
        for (const v of item.verifications) {
          if (typeof v.reference === "string" && v.reference.includes("CCAB")) { v.reference = fixCcab(v.reference); changed = true; }
          if (typeof v.verifiedBy === "string" && v.verifiedBy.includes("CCAB")) { v.verifiedBy = fixCcab(v.verifiedBy); changed = true; }
        }
      }
      // AlignmentTable Opportunity items: the tier is nested under data.reasons.
      const reasons = (item.data as { reasons?: { identityTier?: string } } | undefined)?.reasons;
      if (reasons && reasons.identityTier === "ccab") { reasons.identityTier = "ccib"; changed = true; }
      if (changed) { await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: item })); updated++; }
    }
    ExclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  console.log(`migrate-supplier-ccib: scanned ${scanned}, updated ${updated}`);
}

if (process.argv[1] && process.argv[1].endsWith("/migrate-supplier-ccib.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
