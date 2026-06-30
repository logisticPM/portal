// Live: re-run core promotion over the current substrate (no re-harvest). Uses the
// shared promoteSubstrate() so logic matches cases:ingest exactly.
//
// NOTE on full-text filtering: listCases returns chunk-less PROFILE items, so
// promoteSubstrate sees no chunks. To filter on full text (includeCandidate uses
// chunk text), we reassemble each substrate case via getCase (PROFILE + CHUNK# items)
// before promoting. This is correct for standalone re-promotion after cases:fetch-fulltext.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseToItems } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { promoteSubstrate } from "./cases-ingest";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

async function main() {
  const subs = await dynamoCaseRepo.listCases({ tier: "substrate" });
  // Reassemble each case from PROFILE + CHUNK# items so promoteSubstrate sees full text.
  const full = await Promise.all(subs.map((s) => dynamoCaseRepo.getCase(s.id)));
  const substrate = full.filter((c): c is NonNullable<typeof c> => c !== null);
  const { core, prisma } = await promoteSubstrate(substrate);
  // Write promoted cases as PROFILE+CHUNK items (multi-item, model B)
  const requests = core.flatMap((c) => caseToItems(c).map((Item) => ({ PutRequest: { Item } })));
  for (let i = 0; i < requests.length; i += 25)
    await ddbDoc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: requests.slice(i, i + 25) } }));
  await fs.writeFile("scripts/.cache/prisma.json", JSON.stringify(prisma, null, 2));
  console.log(`✅ promoted: core ${core.length} of ${substrate.length} substrate · excluded ${substrate.length - core.length}`);
  console.log("PRISMA:", JSON.stringify(prisma.excluded));
}
main().catch((e) => { console.error("❌ cases-promote failed:", e); process.exit(1); });
