// Live ingestion. PHASE A.1: harvest → dedup → map → upsert as substrate.
// (Inclusion filter + labeling promotion added in Task 9.) Idempotent by CASE#id.
import "./fetch-polyfill"; // must be first: patches global.fetch before any live-network modules load
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { toCaseItem } from "../src/lib/dynamo/cases-table";
import { a2ajToCase, type A2ajRecord } from "../src/lib/cases/ingest/a2aj";
import { dedupeByCitation } from "../src/lib/cases/ingest/dedup";
import { harvestQuery, fetchCitation } from "../src/lib/cases/ingest/harvest";
import { THEME_QUERIES, SEED_CITATIONS, GAP_CITATIONS, DATE_FROM, DATE_TO, WINDOW_YEARS } from "../src/lib/cases/ingest/sources";
import type { LegalCase } from "../src/lib/cases/types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

async function gatherRaw(): Promise<A2ajRecord[]> {
  const all: A2ajRecord[] = [];
  for (const queries of Object.values(THEME_QUERIES))
    for (const q of queries) all.push(...(await harvestQuery(q, DATE_FROM, DATE_TO, WINDOW_YEARS)));
  for (const c of [...SEED_CITATIONS, ...GAP_CITATIONS]) { const r = await fetchCitation(c); if (r) all.push(r); }
  // NOTE: forward-citation snowball is intentionally NOT run. Snowballing the forward
  // citations of high-citation landmarks (e.g. Haida) fans out to tens of thousands of
  // mostly-irrelevant cases (measured ~23k) — the preferential-attachment explosion the
  // corpus-methodology research warns about. Query-harvest + seeds is a bounded,
  // defensible substrate; a seed-only snowball under a hard cap can be added later.
  return dedupeByCitation(all);
}

async function upsert(cases: LegalCase[]) {
  const items = cases.map((c) => ({ PutRequest: { Item: toCaseItem(c) } }));
  for (let i = 0; i < items.length; i += 25)
    await ddbDoc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: items.slice(i, i + 25) } }));
}

export async function ingest() {
  const raw = await gatherRaw();
  const substrate: LegalCase[] = raw.map((r) => ({ ...a2ajToCase(r), corpusTier: "substrate" }));
  await upsert(substrate);
  console.log(`✅ ingested ${substrate.length} substrate cases into "${TABLE}"`);
  // PHASE A.2 (Task 9) appends include-filter + label + promote-to-core here.
}

if (require.main === module) ingest().catch((e) => { console.error("❌ cases-ingest failed:", e); process.exit(1); });
