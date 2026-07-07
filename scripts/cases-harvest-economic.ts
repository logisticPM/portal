// Additive economic corpus supplementation (spec 2026-07-06). Harvests ONLY the
// economic surface (expanded resource_revenue queries + candidate economic seeds)
// and writes ONLY new PROFILEs via a conditional put — it NEVER overwrites an
// existing PROFILE or its CHUNK items, so full-texted/promoted cases are left
// untouched. New substrate is promoted by the normal pipeline
// (cases:fetch-fulltext → cases:embed → cases:index-build). Do NOT run
// cases:ingest for supplementation — its blanket upsert demotes existing core.
import "./fetch-polyfill"; // must be first: patches global.fetch before live-network modules load
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseToItems } from "../src/lib/dynamo/cases-table";
import { a2ajToCase, type A2ajRecord } from "../src/lib/cases/ingest/a2aj";
import { dedupeByCitation } from "../src/lib/cases/ingest/dedup";
import { harvestQuery, fetchCitation } from "../src/lib/cases/ingest/harvest";
import { THEME_QUERIES, ECON_CANDIDATE_SEEDS, DATE_FROM, DATE_TO, WINDOW_YEARS } from "../src/lib/cases/ingest/sources";
import type { LegalCase } from "../src/lib/cases/types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

export async function gatherEconomic(): Promise<A2ajRecord[]> {
  const all: A2ajRecord[] = [];
  for (const q of THEME_QUERIES.resource_revenue)
    all.push(...(await harvestQuery(q, DATE_FROM, DATE_TO, WINDOW_YEARS)));
  for (const c of ECON_CANDIDATE_SEEDS) { const r = await fetchCitation(c); if (r) all.push(r); }
  return dedupeByCitation(all);
}

// Additive-safe: write the PROFILE only if PK does not already exist. A
// ConditionalCheckFailed means the case is already present → skip (never
// overwrite). `send` is injectable for testing; defaults to the live client.
export async function upsertIfAbsent(
  cases: LegalCase[],
  send: (cmd: any) => Promise<any> = (cmd) => ddbDoc.send(cmd),
): Promise<{ added: number; skipped: number }> {
  let added = 0, skipped = 0;
  for (const c of cases) {
    const [profile] = caseToItems(c); // bare substrate → PROFILE only (no chunks)
    try {
      await send(new PutCommand({ TableName: TABLE, Item: profile, ConditionExpression: "attribute_not_exists(PK)" }));
      added++;
    } catch (e: any) {
      if (e?.name === "ConditionalCheckFailedException") { skipped++; continue; }
      throw e;
    }
  }
  return { added, skipped };
}

export async function harvestEconomic() {
  const raw = await gatherEconomic();
  const substrate: LegalCase[] = raw.map((r) => ({ ...a2ajToCase(r), corpusTier: "substrate" as const }));
  const { added, skipped } = await upsertIfAbsent(substrate);
  console.log(`✅ economic harvest: candidates ${substrate.length} · new-substrate ${added} · already-present ${skipped}`);
}

if (require.main === module) harvestEconomic().catch((e) => { console.error("❌ cases-harvest-economic failed:", e); process.exit(1); });
