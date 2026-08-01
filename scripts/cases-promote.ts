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

// Rewrites src/lib/cases/screening.ts, preserving its header comment. The file is a module
// rather than JSON so it needs no tsconfig flag and carries its own explanation of why it
// is generated at all.
async function writeScreening(s: { asOf: string; substrate: number; promoted: number; excluded: Record<string, number> }) {
  const p = "src/lib/cases/screening.ts";
  const src = await fs.readFile(p, "utf8");
  const next = src.replace(
    /export const SCREENING: Screening = \{[\s\S]*?\n\};/,
    "export const SCREENING: Screening = " + JSON.stringify(s, null, 2).replace(/"([a-zA-Z_][\w]*)":/g, "$1:") + " as Screening;");
  if (next === src) throw new Error(`could not find the SCREENING literal in ${p} — refusing to leave it stale`);
  await fs.writeFile(p, next);
  console.log(`✅ rewrote ${p} (asOf ${s.asOf}) — commit it with this run`);
}

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
  // Also rewrite the TRACKED copy the methodology page renders. The .cache file above is
  // gitignored and never deployed, so without this the published screening funnel would
  // silently keep showing whatever figures were last hand-written.
  await writeScreening({
    asOf: new Date().toISOString().slice(0, 10),
    substrate: substrate.length,
    promoted: core.length,
    excluded: prisma.excluded,
  });
  console.log(`✅ promoted: core ${core.length} of ${substrate.length} substrate · excluded ${substrate.length - core.length}`);
  console.log("PRISMA:", JSON.stringify(prisma.excluded));
}
main().catch((e) => { console.error("❌ cases-promote failed:", e); process.exit(1); });
