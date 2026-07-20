// Additive generic court harvest (spec 2026-07-20). Enumerates a court's judgment index (BFS over
// index pages — NB has monthly sub-pages), shortlists Indigenous/economic candidates, fetches only
// those PDFs (robots-compliant), applies the PRISMA include gate, writes ONLY new cases (never
// overwriting an existing PROFILE/core case), and inline-promotes with the double-LLM gate. Pick the
// court with HARVEST_COURT=yukon|nb|mb. A2AJ does not index these courts. Do NOT run cases:ingest.
import "./fetch-polyfill"; // must be first: patches global.fetch before live-network modules load
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseToItems } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { fetchOfficialText } from "../src/lib/cases/ingest/official-source";
import { makeRobotsGate } from "../src/lib/cases/ingest/robots";
import { includeCandidate } from "../src/lib/cases/ingest/include";
import { promoteOne } from "./cases-ingest";
import { isCandidate, courtToCase, type CourtAdapter, type CourtListingRow } from "../src/lib/cases/ingest/court-harvest";
import { ADAPTERS } from "../src/lib/cases/ingest/court-adapters";
import type { LegalCase } from "../src/lib/cases/types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SLEEP_MS = Number(process.env.HARVEST_SLEEP_MS ?? 400);
const MAX_INDEX_PAGES = Number(process.env.HARVEST_MAX_INDEX_PAGES ?? 200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CourtHarvestDeps {
  fetchListing: (url: string) => Promise<string>;
  fetchText: (pdfUrl: string) => Promise<string>;
  exists: (id: string) => Promise<boolean>;
  promote: (c: LegalCase) => Promise<LegalCase | "no_consensus" | null>;
  writeCase: (c: LegalCase) => Promise<void>;
}

export interface CourtReport {
  indexPages: number; listed: number; shortlisted: number; gotText: number;
  passedPrisma: number; alreadyPresent: number; promoted: number; excluded: Record<string, number>;
}

export async function runCourtHarvest(adapter: CourtAdapter, deps: CourtHarvestDeps): Promise<CourtReport> {
  const rep: CourtReport = { indexPages: 0, listed: 0, shortlisted: 0, gotText: 0, passedPrisma: 0, alreadyPresent: 0, promoted: 0, excluded: {} };
  // BFS over index pages (bounded + cycle-guarded).
  const queue = [...adapter.indexUrls];
  const visited = new Set<string>();
  const seenCite = new Set<string>();
  const allRows: CourtListingRow[] = [];
  while (queue.length && visited.size < MAX_INDEX_PAGES) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    const html = await deps.fetchListing(url);
    if (!html) { console.warn(`[harvest:${adapter.id}] no listing for ${url}`); continue; }
    rep.indexPages++;
    const { rows, subIndexUrls } = adapter.parseListing(html, url);
    for (const r of rows) if (!seenCite.has(r.citation)) { seenCite.add(r.citation); allRows.push(r); }
    for (const s of subIndexUrls) if (!visited.has(s)) queue.push(s);
  }
  rep.listed = allRows.length;
  const candidates = allRows.filter((r) => isCandidate(r, adapter));
  rep.shortlisted = candidates.length;
  for (const row of candidates) {
    const text = await deps.fetchText(row.pdfUrl);
    if (!text) continue;
    rep.gotText++;
    const c = courtToCase(row, text, adapter);
    const inc = includeCandidate(c);
    if (!inc.include) { rep.excluded[inc.reason ?? "excluded"] = (rep.excluded[inc.reason ?? "excluded"] ?? 0) + 1; continue; }
    rep.passedPrisma++;
    if (await deps.exists(c.id)) { rep.alreadyPresent++; continue; } // additive: never overwrite
    const p = await deps.promote(c);
    const toStore = p && p !== "no_consensus" ? p : c;
    if (p && p !== "no_consensus") rep.promoted++;
    await deps.writeCase(toStore);
  }
  return rep;
}

function liveDeps(): CourtHarvestDeps {
  const gate = makeRobotsGate(); // one per run → each host's robots.txt fetched once
  return {
    fetchListing: async (url) => {
      if (!(await gate.allows(url))) return "";
      try {
        const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
        return res.ok ? await res.text() : "";
      } catch { return ""; }
    },
    fetchText: async (pdfUrl) => { const t = await fetchOfficialText(pdfUrl, undefined, gate.allows); await sleep(SLEEP_MS); return t; },
    exists: async (id) => (await dynamoCaseRepo.getCase(id)) != null,
    promote: promoteOne,
    writeCase: async (c) => {
      const reqs = caseToItems(c).map((Item) => ({ PutRequest: { Item } }));
      for (let i = 0; i < reqs.length; i += 25)
        await ddbDoc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: reqs.slice(i, i + 25) } }));
    },
  };
}

async function main() {
  const court = process.env.HARVEST_COURT ?? "";
  const adapter = ADAPTERS[court];
  if (!adapter) { console.error(`❌ set HARVEST_COURT to one of: ${Object.keys(ADAPTERS).join(", ")}`); process.exit(1); }
  const rep = await runCourtHarvest(adapter, liveDeps());
  const exc = Object.entries(rep.excluded).map(([k, v]) => `${k}=${v}`).join(" ") || "none";
  console.log(`✅ ${court} harvest: index-pages ${rep.indexPages} · listed ${rep.listed} · shortlisted ${rep.shortlisted} · got-text ${rep.gotText} · passed-PRISMA ${rep.passedPrisma} · already-present ${rep.alreadyPresent} · promoted-to-core ${rep.promoted}`);
  console.log(`   PRISMA-excluded: ${exc}`);
}

if (require.main === module) main().catch((e) => { console.error("❌ cases-harvest-court failed:", e); process.exit(1); });
