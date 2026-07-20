// Additive Yukon direct-court harvest (pilot, spec 2026-07-20). Enumerates the YKCA + YKSC
// judgment index pages, shortlists Indigenous/economic candidates, fetches only those PDFs
// (robots-compliant), applies the PRISMA include gate, writes ONLY new cases (never
// overwriting an existing PROFILE/core case), and inline-promotes with the double-LLM gate
// to report yield. A2AJ does not index the Yukon Supreme Court, so this is the entry path.
// Do NOT run cases:ingest for this — its blanket upsert would demote existing core.
import "./fetch-polyfill"; // must be first: patches global.fetch before live-network modules load
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseToItems } from "../src/lib/dynamo/cases-table";
import { fetchOfficialText } from "../src/lib/cases/ingest/official-source";
import { makeRobotsGate } from "../src/lib/cases/ingest/robots";
import { includeCandidate } from "../src/lib/cases/ingest/include";
import { promoteOne } from "./cases-ingest";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { YUKON_COURTS, parseYukonListing, isIndigenousEconomicCandidate, yukonToCase } from "../src/lib/cases/ingest/yukon";
import type { LegalCase } from "../src/lib/cases/types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
const BASE = "https://www.yukoncourts.ca";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SLEEP_MS = Number(process.env.YUKON_SLEEP_MS ?? 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface YukonHarvestDeps {
  fetchListing: (url: string) => Promise<string>;
  fetchText: (pdfUrl: string) => Promise<string>;
  exists: (id: string) => Promise<boolean>;
  promote: (c: LegalCase) => Promise<LegalCase | "no_consensus" | null>;
  writeCase: (c: LegalCase) => Promise<void>;
}

export interface YukonReport {
  listed: number; shortlisted: number; gotText: number; passedPrisma: number;
  alreadyPresent: number; promoted: number; excluded: Record<string, number>;
}

// Court slugs to harvest (pilot = both). `slugs` param lets tests scope to one.
export async function runYukonHarvest(
  slugs: (keyof typeof YUKON_COURTS)[],
  deps: YukonHarvestDeps,
): Promise<YukonReport> {
  const rep: YukonReport = { listed: 0, shortlisted: 0, gotText: 0, passedPrisma: 0, alreadyPresent: 0, promoted: 0, excluded: {} };
  for (const slug of slugs) {
    const html = await deps.fetchListing(`${BASE}/en/${slug}/judgments`);
    if (!html) { console.warn(`[yukon] no listing for ${slug} (robots-denied or fetch failed)`); continue; }
    const rows = parseYukonListing(html, `${BASE}/en/${slug}/judgments`);
    rep.listed += rows.length;
    const candidates = rows.filter(isIndigenousEconomicCandidate);
    rep.shortlisted += candidates.length;
    for (const row of candidates) {
      const text = await deps.fetchText(row.pdfUrl);
      if (!text) continue;
      rep.gotText++;
      const c = yukonToCase(row, text);
      const inc = includeCandidate(c);
      if (!inc.include) { rep.excluded[inc.reason ?? "excluded"] = (rep.excluded[inc.reason ?? "excluded"] ?? 0) + 1; continue; }
      rep.passedPrisma++;
      if (await deps.exists(c.id)) { rep.alreadyPresent++; continue; } // additive: never overwrite
      const p = await deps.promote(c);
      const toStore = p && p !== "no_consensus" ? p : c;
      if (p && p !== "no_consensus") rep.promoted++;
      await deps.writeCase(toStore);
    }
  }
  return rep;
}

// ---- default (live) deps ----
function liveDeps(): YukonHarvestDeps {
  const gate = makeRobotsGate(); // one per run → yukoncourts.ca/robots.txt fetched once
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
  const slugs = Object.keys(YUKON_COURTS) as (keyof typeof YUKON_COURTS)[];
  const rep = await runYukonHarvest(slugs, liveDeps());
  const exc = Object.entries(rep.excluded).map(([k, v]) => `${k}=${v}`).join(" ") || "none";
  console.log(`✅ yukon harvest: listed ${rep.listed} · shortlisted ${rep.shortlisted} · got-text ${rep.gotText} · passed-PRISMA ${rep.passedPrisma} · already-present ${rep.alreadyPresent} · promoted-to-core ${rep.promoted}`);
  console.log(`   PRISMA-excluded: ${exc}`);
}

if (require.main === module) main().catch((e) => { console.error("❌ cases-harvest-yukon failed:", e); process.exit(1); });
