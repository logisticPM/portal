// Idempotent backfill: set businessNumber on seeded commitments whose org is in
// ORG_BN_MAP, and stamp existing history points with authoredBy: "public-research".
// Ships WITH the schema change (ccib lesson). Re-runnable; only writes changed rows.
//   Local: DYNAMO_ENDPOINT=http://localhost:8000 COMMITMENTS_TABLE=Commitments npx tsx scripts/migrate-commitment-bn.ts
//   Cloud: AWS_PROFILE=isb COMMITMENTS_TABLE=<physical-name> npx tsx scripts/migrate-commitment-bn.ts
import { ScanCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import type { Commitment } from "../src/lib/commitments/types";
import { bnForOrgName } from "../src/lib/commitments/org-bn-map";

// Commitments live in their own table (see repo.dynamo.ts / seed-commitments.ts),
// keyed off COMMITMENTS_TABLE — NOT the shared DataPortal TABLE from client.ts.
const TABLE = process.env.COMMITMENTS_TABLE ?? "Commitments";

// Returns an updated copy when a change is needed, else null (idempotency).
export function planCommitmentBN(c: Commitment): Commitment | null {
  const bn = bnForOrgName(c.orgName);
  if (!bn) return null;
  const needsBN = c.businessNumber !== bn;
  const needsAuthor = c.history.some((h) => h.authoredBy === undefined);
  if (!needsBN && !needsAuthor) return null;
  return {
    ...c,
    businessNumber: bn,
    history: c.history.map((h) => ({ ...h, authoredBy: h.authoredBy ?? "public-research" })),
  };
}

async function main() {
  let scanned = 0, updated = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddbDoc.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
    for (const item of page.Items ?? []) {
      if (item.et !== "Commitment") continue;
      scanned++;
      // Commitments are stored under item.data (matches toCommitmentItem in
      // src/lib/dynamo/commitments-table.ts).
      const c = item.data as Commitment | undefined;
      if (!c || !c.orgName) continue;
      const next = planCommitmentBN(c);
      if (!next) continue;
      await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: { ...item, data: next } }));
      updated++;
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  console.log(`scanned ${scanned}, updated ${updated}`);
}

if (process.argv[1]?.includes("migrate-commitment-bn")) main();
