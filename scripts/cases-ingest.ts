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

// Decide promotion for a single case. Returns the promoted core case; "no_consensus"
// when both label models ran but agreed on ZERO themes (policy 2026-07-05: the
// inclusion regexes over-match — tax-treaty "treaty", National-"revenue", property
// "title" — and an empty cross-model agreed set is the stronger negative signal, so
// such cases stay substrate pending human review); or null when labeling wasn't
// possible (no LLM models configured). Used by promoteSubstrate and cases-fetch-fulltext.
// NOTE: does NOT compute PRISMA tally — the callers own tallying.
export async function promoteOne(c: LegalCase): Promise<LegalCase | "no_consensus" | null> {
  const enr = enrichment[c.citation];
  if (enr) {
    return { ...c, ...enr, corpusTier: "core", enrichmentLevel: "deep",
      labelMeta: { method: "curated", confidence: "high", needsReview: false } };
  }
  if (!includeCandidate(c).include) return null;
  // Label only on full text: a styleOfCause-only prompt is too weak to promote on,
  // and its distinct cache key would let a fresh title-only "consensus" bypass the
  // gate's cached full-text verdict (re-promoting demoted noise). Chunk-less
  // candidates wait for cases:fetch-fulltext, which promotes with full text inline.
  if (!c.chunks || c.chunks.length === 0) return null;
  try {
    const text = [c.styleOfCause, ...(c.chunks?.map((x) => x.text) ?? [])].join(" ");
    const labeled = await labelCase(text);
    if (labeled.themes.length === 0) return "no_consensus";
    return { ...c, themes: labeled.themes as Theme[], corpusTier: "core", labelMeta: labeled.labelMeta };
  } catch {
    return null; // no LLM models configured → leave in substrate (null also = chunk-less, above)
  }
}

export async function promoteSubstrate(substrate: LegalCase[]): Promise<{ core: LegalCase[]; prisma: ReturnType<typeof emptyPrisma> }> {
  const prisma = emptyPrisma();
  prisma.identified = substrate.length;
  prisma.deduped = substrate.length;
  const core: LegalCase[] = [];
  for (const c of substrate) {
    prisma.screened++;
    // Check enrichment first (curated flagship → always include, no PRISMA exclude)
    if (enrichment[c.citation]) {
      const promoted = await promoteOne(c);
      if (promoted && promoted !== "no_consensus") { core.push(promoted); prisma.included++; }
      continue;
    }
    // Check inclusion filter so we can tally the exclude reason
    const verdict = includeCandidate(c);
    if (!verdict.include) { tallyExclude(prisma, verdict.reason ?? "unknown"); continue; }
    // Passes filter → attempt label (promoteOne handles the try/catch)
    const promoted = await promoteOne(c);
    if (promoted === "no_consensus") { tallyExclude(prisma, "no_model_consensus"); continue; }
    if (promoted) { core.push(promoted); prisma.included++; }
    // null here = labelCase threw or chunk-less → stays substrate (no tally)
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
