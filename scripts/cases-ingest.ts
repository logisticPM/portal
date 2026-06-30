// Live ingestion. PHASE A.1: harvest → dedup → map → upsert as substrate.
// PHASE A.2 (Task 9): inclusion filter + enrichment-merge / dual-LLM label → promote to core.
// Idempotent by CASE#id.
import "./fetch-polyfill"; // must be first: patches global.fetch before any live-network modules load
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseToItems } from "../src/lib/dynamo/cases-table";
import { a2ajToCase, type A2ajRecord } from "../src/lib/cases/ingest/a2aj";
import { dedupeByCitation } from "../src/lib/cases/ingest/dedup";
import { harvestQuery, fetchCitation } from "../src/lib/cases/ingest/harvest";
import { THEME_QUERIES, SEED_CITATIONS, GAP_CITATIONS, DATE_FROM, DATE_TO, WINDOW_YEARS } from "../src/lib/cases/ingest/sources";
import type { LegalCase, Theme } from "../src/lib/cases/types";
import { includeCandidate, emptyPrisma, tallyExclude } from "../src/lib/cases/ingest/include";
import { labelCase } from "../src/lib/cases/ingest/labeler";
import { enrichment } from "../src/lib/cases/enrichment";
import { promises as fs } from "node:fs";

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
  const items = cases.flatMap((c) => caseToItems(c).map((Item) => ({ PutRequest: { Item } })));
  for (let i = 0; i < items.length; i += 25)
    await ddbDoc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: items.slice(i, i + 25) } }));
}

export async function promoteSubstrate(substrate: LegalCase[]): Promise<{ core: LegalCase[]; prisma: ReturnType<typeof emptyPrisma> }> {
  const prisma = emptyPrisma();
  prisma.identified = substrate.length;
  prisma.deduped = substrate.length;
  const core: LegalCase[] = [];
  for (const c of substrate) {
    prisma.screened++;
    const enr = enrichment[c.citation];
    if (enr) {
      core.push({ ...c, ...enr, corpusTier: "core", enrichmentLevel: "deep",
        labelMeta: { method: "curated", confidence: "high", needsReview: false } });
      prisma.included++;
      continue;
    }
    const verdict = includeCandidate(c);
    if (!verdict.include) { tallyExclude(prisma, verdict.reason ?? "unknown"); continue; }
    let labeled;
    try {
      const text = [c.styleOfCause, ...(c.chunks?.map((x) => x.text) ?? [])].join(" ");
      labeled = await labelCase(text);
    } catch {
      continue; // no LLM models configured → leave in substrate
    }
    core.push({ ...c, themes: labeled.themes as Theme[], corpusTier: "core", labelMeta: labeled.labelMeta });
    prisma.included++;
  }
  return { core, prisma };
}

export async function ingest() {
  const raw = await gatherRaw();
  const substrate: LegalCase[] = raw.map((r) => ({ ...a2ajToCase(r), corpusTier: "substrate" }));
  await upsert(substrate);
  const { core, prisma } = await promoteSubstrate(substrate);
  await upsert(core);
  await fs.writeFile("scripts/.cache/prisma.json", JSON.stringify(prisma, null, 2));
  console.log(`✅ substrate ${substrate.length} · core ${core.length} · excluded ${substrate.length - core.length}`);
  console.log("PRISMA:", JSON.stringify(prisma.excluded));
}

if (require.main === module) ingest().catch((e) => { console.error("❌ cases-ingest failed:", e); process.exit(1); });
