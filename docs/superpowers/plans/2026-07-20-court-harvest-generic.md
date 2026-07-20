# Generic Court Harvest + NB/MB Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Yukon harvester into a generic adapter-driven `runCourtHarvest`, and add New Brunswick + Manitoba Court-of-Appeal adapters.

**Architecture:** A pure core (`court-harvest.ts`: types + shortlist + map) + per-court adapters (`court-adapters.ts`: index URLs, listing parser, level, region keywords) + one additive runner (`cases-harvest-court.ts`: BFS index-page crawl → shortlist → robots-compliant PDF fetch → PRISMA → exists-guard → inline double-LLM promote). Yukon becomes an adapter with byte-identical output; NB/MB are new adapters.

**Tech Stack:** TypeScript, `tsx` tests (async-IIFE + `node:assert/strict`), DynamoDB, reused `fetchOfficialText`/`makeRobotsGate`/`promoteOne`/`includeCandidate`/`slugCitation`/`chunkText`.

**Spec:** `docs/superpowers/specs/2026-07-20-court-harvest-generic-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/cases/ingest/court-harvest.ts` | **New, pure.** `CourtListingRow`/`CourtAdapter` types, `SHARED_SIGNAL`, `isCandidate`, `styleFromFileName`, `courtToCase`. |
| `src/lib/cases/ingest/court-adapters.ts` | **New, pure.** `extractPdfRows` helper + `yukonAdapter`/`nbAdapter`/`mbAdapter` + `ADAPTERS`. |
| `scripts/cases-harvest-court.ts` | **New.** `runCourtHarvest(adapter, deps)` (BFS + orchestration) + live deps + `main` (HARVEST_COURT). |
| `scripts/test-cases-court-harvest.ts` | **New.** Pure tests: adapter parseListing ×3, isCandidate ×3, courtToCase. |
| `scripts/test-cases-harvest-court.ts` | **New.** Runner test: BFS + additive-safety (injected deps). |
| `src/lib/cases/ingest/official-source.ts` | OPEN_HOSTS += NB + MB hosts. |
| `package.json` | yukon script → cases-harvest-court; add nb/mb (+:cloud). |
| `src/lib/cases/ingest/yukon.ts` · `scripts/cases-harvest-yukon.ts` · `scripts/test-cases-yukon.ts` · `scripts/test-cases-harvest-yukon.ts` | **Remove** (folded into the generic; removed in Task 2 once the runner replaces them). |

---

## Task 1: Generic pure core + adapters + pure tests

**Files:**
- Create: `src/lib/cases/ingest/court-harvest.ts`
- Create: `src/lib/cases/ingest/court-adapters.ts`
- Create: `scripts/test-cases-court-harvest.ts`

(The old `yukon.ts` and its tests stay in place this task — both old and new compile side-by-side; removals happen in Task 2.)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-court-harvest.ts`:
```ts
// court-harvest + adapters unit tests. Async IIFE — this repo is NOT ESM.
import assert from "node:assert/strict";
import { isCandidate, courtToCase } from "../src/lib/cases/ingest/court-harvest";
import { yukonAdapter, nbAdapter, mbAdapter } from "../src/lib/cases/ingest/court-adapters";

(async () => {
  // --- Yukon adapter: single-page, YKSC/YKCA, no sub-index (behavior-preserving) ---
  const ykHtml = `
    <a href="/sites/default/files/favicons/favicon.png">icon</a>
    <a href="/sites/default/files/2026-05/2026_yksc_36_FNNND%20v%20Yukon%20%28Government%20of%29.pdf">a</a>
    <a href="/sites/default/files/2024-02/2024_ykca_3_ABC%20v%20XYZ.pdf">b</a>`;
  const yk = yukonAdapter.parseListing(ykHtml, "https://www.yukoncourts.ca/en/supreme-court/judgments");
  assert.equal(yk.rows.length, 2, "yukon: 2 decision PDFs (favicon ignored)");
  assert.equal(yk.subIndexUrls.length, 0, "yukon: no sub-index pages");
  const fnnnd = yk.rows.find((r) => r.citation === "2026 YKSC 36")!;
  assert.equal(fnnnd.court, "YKSC");
  assert.equal(fnnnd.pdfUrl, "https://www.yukoncourts.ca/sites/default/files/2026-05/2026_yksc_36_FNNND%20v%20Yukon%20%28Government%20of%29.pdf");
  assert.equal(yk.rows.find((r) => r.citation === "2024 YKCA 3")!.court, "YKCA");
  assert.equal(isCandidate(fnnnd, yukonAdapter), true, "yukon: FNNND / Yukon(Government of) → candidate");
  assert.equal(isCandidate(yk.rows.find((r) => r.citation === "2024 YKCA 3")!, yukonAdapter), false, "yukon: ABC v XYZ → not");

  // --- NB adapter: landing → monthly sub-index; monthly → NBCA PDFs ---
  const nbLanding = `
    <a href="/content/cour/en/appeal/content/decisions/2025/june.html">June 2025</a>
    <a href="/content/cour/en/appeal/content/decisions/2024/may.html">May 2024</a>
    <a href="/content/dam/courts/pdf/appeal-appel/InterjurisdictionalChildAbduction.pdf">form</a>`;
  const nbL = nbAdapter.parseListing(nbLanding, "https://www.courtsnb-coursnb.ca/content/cour/en/appeal/content/decisions.html");
  assert.equal(nbL.rows.length, 0, "nb landing: no decision PDFs (form has no citation)");
  assert.deepEqual(nbL.subIndexUrls.sort(), [
    "https://www.courtsnb-coursnb.ca/content/cour/en/appeal/content/decisions/2024/may.html",
    "https://www.courtsnb-coursnb.ca/content/cour/en/appeal/content/decisions/2025/june.html",
  ].sort(), "nb landing: monthly index pages");
  const nbMonth = `
    <a href="/content/dam/courts/pdf/appeal-appel/decisions/2025/06/2025-06-26-farshad-gohari-v-r-2025-nbca-81.pdf">x</a>
    <a href="/content/dam/courts/pdf/appeal-appel/decisions/2024/05/2024-05-01-elsipogtog-first-nation-v-nb-2024-nbca-20.pdf">y</a>`;
  const nbM = nbAdapter.parseListing(nbMonth, "https://www.courtsnb-coursnb.ca/content/cour/en/appeal/content/decisions/2025/june.html");
  assert.equal(nbM.rows.length, 2, "nb monthly: 2 NBCA PDFs");
  const nbGohari = nbM.rows.find((r) => r.citation === "2025 NBCA 81")!;
  assert.equal(nbGohari.court, "NBCA");
  assert.equal(isCandidate(nbGohari, nbAdapter), false, "nb: criminal R appeal → not candidate");
  assert.equal(isCandidate(nbM.rows.find((r) => r.citation === "2024 NBCA 20")!, nbAdapter), true, "nb: Elsipogtog First Nation → candidate");

  // --- MB adapter: single recent page, MBCA PDFs ---
  const mbHtml = `
    <a href="/site/assets/files/1036/r_v_marjanovic_2026_mbca_61.pdf">x</a>
    <a href="/site/assets/files/1036/peguis_first_nation_v_manitoba_2024_mbca_10.pdf">y</a>`;
  const mb = mbAdapter.parseListing(mbHtml, "https://www.manitobacourts.mb.ca/court-of-appeal/recent-judgments/");
  assert.equal(mb.rows.length, 2, "mb: 2 MBCA PDFs");
  const mbMarj = mb.rows.find((r) => r.citation === "2026 MBCA 61")!;
  assert.equal(mbMarj.court, "MBCA");
  assert.equal(isCandidate(mbMarj, mbAdapter), false, "mb: criminal R appeal → not candidate");
  assert.equal(isCandidate(mb.rows.find((r) => r.citation === "2024 MBCA 10")!, mbAdapter), true, "mb: Peguis First Nation → candidate");

  // --- courtToCase: valid LegalCase, level from adapter, provenance official_court ---
  const c = courtToCase(nbGohari, "The Court of Appeal considered the sentence. ".repeat(12), nbAdapter);
  assert.equal(c.id, "2025-nbca-81", "slug id");
  assert.equal(c.court, "NBCA");
  assert.equal(c.level, "provincial_appeal");
  assert.equal(c.year, 2025);
  assert.equal(c.provenance.source, "official_court");
  assert.equal(c.corpusTier, "substrate");
  assert.ok((c.chunks?.length ?? 0) > 0, "chunks present");
  const cy = courtToCase(fnnnd, "text here ".repeat(30), yukonAdapter);
  assert.equal(cy.level, "provincial_superior", "yukon YKSC → provincial_superior");

  console.log("✅ test-cases-court-harvest passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-court-harvest.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/ingest/court-harvest'`.

- [ ] **Step 3: Implement `court-harvest.ts`**

Create `src/lib/cases/ingest/court-harvest.ts`:
```ts
// Generic direct-court harvest core. Pure: shortlist Indigenous/economic candidates and map a
// fetched decision PDF to a substrate LegalCase. Per-court parsing/keywords live in the adapters
// (court-adapters.ts); the runner (cases-harvest-court.ts) does the robots-compliant fetching.
import type { LegalCase, CourtLevel } from "../types";
import { slugCitation, chunkText } from "./a2aj";

export interface CourtListingRow { citation: string; court: string; pdfUrl: string; fileName: string; }

export interface CourtAdapter {
  id: string;                 // "yukon" | "nb" | "mb"
  baseUrl: string;            // e.g. "https://www.yukoncourts.ca"
  indexUrls: string[];        // absolute top listing pages to start crawling
  // Parse ONE listing/index page → decision PDF rows here + sub-index pages to also crawl.
  parseListing(html: string, pageUrl: string): { rows: CourtListingRow[]; subIndexUrls: string[] };
  level(court: string): CourtLevel;
  regionSignal: RegExp;       // region First-Nation names (+ any court-specific gov party)
}

// Shared Indigenous + economic keyword signal (generic across courts). The generic half of what
// the old Yukon signal matched; region-specific nation names are in each adapter's regionSignal.
export const SHARED_SIGNAL =
  /\b(first nations?|aboriginal|indigenous|m[ée]tis|treaty|land title|self-government|duty to consult|mineral|resource|royalt|expropriat|compensation)\b/i;

// List-level shortlist. Normalize `_`→space first: filenames use `_` separators and `_` is a regex
// word char, so `\b` would not fire between `_` and a party name.
export function isCandidate(row: CourtListingRow, adapter: CourtAdapter): boolean {
  const hay = `${row.citation} ${row.fileName}`.replace(/_/g, " ");
  return SHARED_SIGNAL.test(hay) || adapter.regionSignal.test(hay);
}

// Best-effort display name from filename (party names live there); feeds includeCandidate's text.
// Strips a leading citation-ish prefix (Yukon filenames start with the citation) — generalized to
// a 2–5-char court token so Yukon output is unchanged; cosmetic for date-prefixed courts.
export function styleFromFileName(fileName: string, citation: string): string {
  const s = fileName
    .replace(/\.pdf$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/^\s*\d{4}[-\s]\w{2,5}[-\s]?\d+\s*/i, "")
    .replace(/\s+corr\d*$/i, "")
    .trim();
  return s || citation;
}

// Map a fetched decision → substrate LegalCase (mirrors a2ajToCase's field set so the object is a
// valid LegalCase). Promotion/enrichment fill nations/themes/outcome later.
export function courtToCase(row: CourtListingRow, text: string, adapter: CourtAdapter): LegalCase {
  return {
    id: slugCitation(row.citation),
    citation: row.citation,
    styleOfCause: styleFromFileName(row.fileName, row.citation),
    court: row.court,
    level: adapter.level(row.court),
    year: Number(row.citation.slice(0, 4)),
    jurisdiction: "Canada",
    nations: [],
    themes: [],
    outcome: { outcomeType: "unclassified", winType: "unclassified", whoWon: "", holding: "" },
    chunks: text ? chunkText(text) : undefined,
    casesCited: [],
    casesCiting: [],
    citingCount: 0,
    enrichmentLevel: "index",
    corpusTier: "substrate",
    fullTextAvailable: !!text,
    provenance: {
      source: "official_court", sourceUrl: row.pdfUrl,
      upstreamLicense: "unknown", ingestedAt: new Date().toISOString(), unofficial: true,
    },
  };
}
```

- [ ] **Step 4: Implement `court-adapters.ts`**

Create `src/lib/cases/ingest/court-adapters.ts`:
```ts
// Per-court adapters for the generic harvest. Each provides where to look (indexUrls), how to
// parse a listing page (parseListing), the court→level map, and the region's First-Nation keywords.
import type { CourtLevel } from "../types";
import type { CourtAdapter, CourtListingRow } from "./court-harvest";

// Shared: scan a page for decision-PDF <a href>s; parseRow(fileName) yields {citation,court} or null
// (non-decision PDFs — forms/notices — have no citation and are dropped). De-dups by citation.
function extractPdfRows(
  html: string, pageUrl: string,
  parseRow: (fileName: string) => { citation: string; court: string } | null,
): CourtListingRow[] {
  const rows: CourtListingRow[] = [];
  const seen = new Set<string>();
  const re = /href="([^"]*\.pdf)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let pdfUrl: string;
    try { pdfUrl = new URL(m[1], pageUrl).toString(); } catch { continue; }
    const fileName = decodeURIComponent(pdfUrl.split("/").pop() ?? "");
    const parsed = parseRow(fileName);
    if (!parsed) continue;
    if (seen.has(parsed.citation)) continue;
    seen.add(parsed.citation);
    rows.push({ citation: parsed.citation, court: parsed.court, pdfUrl, fileName });
  }
  return rows;
}

// Extract sub-index page links matching a regex (absolutized), de-duped.
function extractSubIndex(html: string, pageUrl: string, hrefRe: RegExp): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(hrefRe.source, "gi");
  while ((m = re.exec(html))) {
    try { out.add(new URL(m[1], pageUrl).toString()); } catch { /* skip */ }
  }
  return [...out];
}

// ---- Yukon (YKCA + YKSC): single page per court; behavior-preserving refactor of yukon.ts ----
const YK_RE = /(\d{4})[-_]yk(sc|ca)[-_]?(\d+)/i;
export const yukonAdapter: CourtAdapter = {
  id: "yukon",
  baseUrl: "https://www.yukoncourts.ca",
  indexUrls: [
    "https://www.yukoncourts.ca/en/court-appeal/judgments",
    "https://www.yukoncourts.ca/en/supreme-court/judgments",
  ],
  parseListing(html, pageUrl) {
    const rows = extractPdfRows(html, pageUrl, (fn) => {
      const c = YK_RE.exec(fn);
      if (!c) return null;
      const court = c[2].toLowerCase() === "ca" ? "YKCA" : "YKSC";
      return { citation: `${c[1]} ${court} ${c[3]}`, court };
    });
    return { rows, subIndexUrls: [] };
  },
  level: (court) => (court === "YKCA" ? "provincial_appeal" : "provincial_superior") as CourtLevel,
  regionSignal:
    /\b(nacho nyak dun|fnnnd|kwanlin|champagne|aishihik|little salmon|carmacks|ross river|teslin|tlingit|vuntut|gwitchin|tr'?ond|carcross|tagish|selkirk|kluane|white river|liard|ta'?an)\b|yukon\s*\(government of\)/i,
};

// ---- New Brunswick CoA (NBCA): landing → monthly index pages → PDFs ----
const NB_RE = /(\d{4})-nbca-(\d+)/i;
const NB_MONTH_RE = /href="([^"]*\/appeal\/content\/decisions\/\d{4}\/[a-z]+\.html)"/i;
export const nbAdapter: CourtAdapter = {
  id: "nb",
  baseUrl: "https://www.courtsnb-coursnb.ca",
  indexUrls: ["https://www.courtsnb-coursnb.ca/content/cour/en/appeal/content/decisions.html"],
  parseListing(html, pageUrl) {
    const rows = extractPdfRows(html, pageUrl, (fn) => {
      const c = NB_RE.exec(fn);
      return c ? { citation: `${c[1]} NBCA ${c[2]}`, court: "NBCA" } : null;
    });
    return { rows, subIndexUrls: extractSubIndex(html, pageUrl, NB_MONTH_RE) };
  },
  level: () => "provincial_appeal" as CourtLevel,
  regionSignal:
    /\b(mi'?k?maq|mi'?gmaq|wolastoqiyik|wolastoqey|maliseet|passamaquoddy|peskotomuhkati|elsipogtog|madawaska|tobique|neqotkuk|esgeno[oô]petitj|woodstock|oromocto|kingsclear|saint mary'?s)\b/i,
};

// ---- Manitoba CoA (MBCA): single "recent judgments" page (recent-only) ----
const MB_RE = /(\d{4})[-_]mbca[-_](\d+)/i;
export const mbAdapter: CourtAdapter = {
  id: "mb",
  baseUrl: "https://www.manitobacourts.mb.ca",
  indexUrls: ["https://www.manitobacourts.mb.ca/court-of-appeal/recent-judgments/"],
  parseListing(html, pageUrl) {
    const rows = extractPdfRows(html, pageUrl, (fn) => {
      const c = MB_RE.exec(fn);
      return c ? { citation: `${c[1]} MBCA ${c[2]}`, court: "MBCA" } : null;
    });
    return { rows, subIndexUrls: [] };
  },
  level: () => "provincial_appeal" as CourtLevel,
  regionSignal:
    /\b(cree|ojibw|anishinaab?e|saulteaux|dakota|oji-cree|dene|peguis|sagkeeng|norway house|pimicikamak|cross lake|roseau river|long plain|swan lake|sioux valley|treaty land entitlement)\b/i,
};

export const ADAPTERS: Record<string, CourtAdapter> = {
  yukon: yukonAdapter, nb: nbAdapter, mb: mbAdapter,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-court-harvest.ts`
Expected: `✅ test-cases-court-harvest passed`

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean (0 errors). (Old `yukon.ts` still present; both compile.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/cases/ingest/court-harvest.ts src/lib/cases/ingest/court-adapters.ts scripts/test-cases-court-harvest.ts
git commit -m "feat(cases): generic court-harvest core + yukon/nb/mb adapters"
```

---

## Task 2: Additive runner + removals + OPEN_HOSTS + npm

**Files:**
- Create: `scripts/cases-harvest-court.ts`
- Create: `scripts/test-cases-harvest-court.ts`
- Modify: `src/lib/cases/ingest/official-source.ts` (OPEN_HOSTS)
- Modify: `package.json`
- Remove: `src/lib/cases/ingest/yukon.ts`, `scripts/cases-harvest-yukon.ts`, `scripts/test-cases-yukon.ts`, `scripts/test-cases-harvest-yukon.ts`

- [ ] **Step 1: Write the failing runner test**

Create `scripts/test-cases-harvest-court.ts`:
```ts
// cases-harvest-court runner test — injected deps, no network/LLM/Dynamo. Uses the NB adapter to
// exercise the 2-level BFS (landing → monthly) and additive-safety (existing case never written).
import assert from "node:assert/strict";
import { runCourtHarvest, type CourtHarvestDeps } from "./cases-harvest-court";
import { nbAdapter } from "../src/lib/cases/ingest/court-adapters";

(async () => {
  const landing = `<a href="/content/cour/en/appeal/content/decisions/2024/may.html">May 2024</a>`;
  const month = `
    <a href="/content/dam/courts/pdf/appeal-appel/decisions/2024/05/2024-05-01-elsipogtog-first-nation-v-nb-2024-nbca-20.pdf">a</a>
    <a href="/content/dam/courts/pdf/appeal-appel/decisions/2024/05/2024-05-02-mikmaq-nation-v-nb-2024-nbca-21.pdf">b</a>`;
  const written: string[] = [];
  const deps: CourtHarvestDeps = {
    fetchListing: async (url) => (url.endsWith("/decisions.html") ? landing : url.endsWith("/may.html") ? month : ""),
    fetchText: async () => "The First Nation appealed regarding treaty rights and resource compensation. ".repeat(12),
    exists: async (id) => id === "2024-nbca-20", // Elsipogtog already present → skip
    promote: async (c) => ({ ...c, corpusTier: "core" }),
    writeCase: async (c) => { written.push(c.id); },
  };

  const rep = await runCourtHarvest(nbAdapter, deps);
  assert.equal(rep.indexPages, 2, "BFS visited landing + monthly");
  assert.equal(rep.listed, 2, "2 NBCA decisions found on monthly page");
  assert.equal(rep.shortlisted, 2, "both First Nation → shortlisted");
  assert.equal(rep.alreadyPresent, 1, "Elsipogtog already present → skipped");
  assert.equal(rep.promoted, 1, "the new Mi'kmaq case promoted");
  assert.deepEqual(written, ["2024-nbca-21"], "only the new case written; existing never overwritten");

  console.log("✅ test-cases-harvest-court passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-harvest-court.ts`
Expected: FAIL — `Cannot find module './cases-harvest-court'`.

- [ ] **Step 3: Implement `cases-harvest-court.ts`**

Create `scripts/cases-harvest-court.ts`:
```ts
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
```

- [ ] **Step 4: Run the runner test to verify it passes**

Run: `npx tsx scripts/test-cases-harvest-court.ts`
Expected: `✅ test-cases-harvest-court passed`

- [ ] **Step 5: Add NB + MB to OPEN_HOSTS**

In `src/lib/cases/ingest/official-source.ts`, replace the `OPEN_HOSTS` line with:
```ts
export const OPEN_HOSTS = ["www.bccourts.ca", "decisions.scc-csc.ca", "coadecisions.ontariocourts.ca", "www.yukoncourts.ca", "www.courtsnb-coursnb.ca", "www.manitobacourts.mb.ca"];
```

- [ ] **Step 6: Update npm scripts**

In `package.json` `scripts`: **replace** the two existing `cases:harvest-yukon` / `cases:harvest-yukon:cloud` lines and **add** nb/mb, so the block reads:
```json
    "cases:harvest-yukon": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 HARVEST_COURT=yukon tsx scripts/cases-harvest-court.ts",
    "cases:harvest-yukon:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 HARVEST_COURT=yukon tsx scripts/cases-harvest-court.ts",
    "cases:harvest-nb": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 HARVEST_COURT=nb tsx scripts/cases-harvest-court.ts",
    "cases:harvest-nb:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 HARVEST_COURT=nb tsx scripts/cases-harvest-court.ts",
    "cases:harvest-mb": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 HARVEST_COURT=mb tsx scripts/cases-harvest-court.ts",
    "cases:harvest-mb:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 HARVEST_COURT=mb tsx scripts/cases-harvest-court.ts",
```
Ensure valid JSON (commas).

- [ ] **Step 7: Remove the superseded Yukon-specific files**

```bash
git rm src/lib/cases/ingest/yukon.ts scripts/cases-harvest-yukon.ts scripts/test-cases-yukon.ts scripts/test-cases-harvest-yukon.ts
```

- [ ] **Step 8: Verify nothing still imports the removed modules**

Run: `grep -rn "ingest/yukon\|cases-harvest-yukon" src scripts`
Expected: no matches.

- [ ] **Step 9: Typecheck + build + both new tests**

Run: `npm run typecheck`
Expected: clean (0 errors).

Run: `npx tsx scripts/test-cases-court-harvest.ts` → `✅ test-cases-court-harvest passed`
Run: `npx tsx scripts/test-cases-harvest-court.ts` → `✅ test-cases-harvest-court passed`

Run: `npm run build`
Expected: Next.js build succeeds (ops-only files not pulled into any route bundle).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(cases): additive generic harvest runner + NB/MB; retire yukon-specific files"
```

---

## Final verification (before finishing the branch)

- [ ] `npx tsx scripts/test-cases-court-harvest.ts` → passed
- [ ] `npx tsx scripts/test-cases-harvest-court.ts` → passed
- [ ] `npm run typecheck` → clean · `npm run build` → succeeds
- [ ] `grep -rn "ingest/yukon\|cases-harvest-yukon" src scripts` → no matches
- [ ] `OPEN_HOSTS` includes `www.courtsnb-coursnb.ca` and `www.manitobacourts.mb.ca`

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- Generic core (types/isCandidate/courtToCase/SHARED_SIGNAL) → Task 1 court-harvest.ts ✅
- Adapters (yukon behavior-preserving, nb 2-level, mb) → Task 1 court-adapters.ts + tests ✅
- BFS runner + additive exists-guard + inline promote → Task 2 runCourtHarvest + test asserting existing never written ✅
- OPEN_HOSTS += NB/MB → Task 2 Step 5 ✅
- Remove yukon-specific files → Task 2 Step 7 + grep guard Step 8 ✅
- npm yukon→court + nb/mb → Task 2 Step 6 ✅
- No Lambda impact → Task 2 `npm run build` ✅

**2. Placeholder scan:** No TBD/TODO; all code complete; fixtures are concrete real filename patterns from the site probes.

**3. Type consistency:** `CourtListingRow`/`CourtAdapter`/`CourtHarvestDeps`/`CourtReport`, `isCandidate(row,adapter)`, `courtToCase(row,text,adapter)`, `runCourtHarvest(adapter,deps)`, `ADAPTERS` used identically across `court-harvest.ts`, `court-adapters.ts`, the runner, and both test files. `parseListing` returns `{rows, subIndexUrls}` everywhere. Yukon's `level` returns `provincial_superior` for YKSC (matches the removed `YUKON_LEVEL`).
