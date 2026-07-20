# Yukon Direct-Court Harvest (pilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harvest Indigenous economic-justice decisions directly from `www.yukoncourts.ca` (Court of Appeal + Supreme Court) — which A2AJ does not index — to measure real on-topic yield before deciding on NB/MB.

**Architecture:** A pure module (`yukon.ts`) parses each court's single-page judgment index into decision rows, shortlists Indigenous/economic candidates by keyword, and maps a fetched PDF to a substrate `LegalCase`. An additive ops script (`cases-harvest-yukon.ts`) fetches only shortlisted PDFs via the robots-compliant `fetchOfficialText`, applies the PRISMA include gate, writes only NEW cases (never overwriting core), and inline-promotes with the double-LLM gate to report yield.

**Tech Stack:** TypeScript, `tsx` test scripts (async-IIFE + `node:assert/strict`), DynamoDB (`@aws-sdk/lib-dynamodb`), reused `fetchOfficialText`/`makeRobotsGate`/`promoteOne`/`includeCandidate`/`slugCitation`/`chunkText`.

**Spec:** `docs/superpowers/specs/2026-07-20-yukon-harvest-design.md`

**Deviation from spec (intentional, cleaner):** court→level mapping lives in a local `YUKON_LEVEL` map inside `yukon.ts` instead of adding `YKSC` to `a2aj.ts`'s `LEVEL` (Yukon-only concern → keep it cohesive; `a2aj.ts` is untouched, and A2AJ never returns YKSC anyway).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/cases/ingest/yukon.ts` | **New, pure.** `parseYukonListing`, `isIndigenousEconomicCandidate`, `yukonToCase`, `YUKON_COURTS`, local `YUKON_LEVEL`. No network. |
| `scripts/test-cases-yukon.ts` | **New.** Offline unit tests for the pure module. |
| `scripts/cases-harvest-yukon.ts` | **New.** Additive harvest orchestration (`runYukonHarvest(deps)` + `main`); network/promote via injectable deps. |
| `package.json` | Add `cases:harvest-yukon` + `:cloud`. |

DRY: reuses `slugCitation`/`chunkText` (a2aj.ts), `fetchOfficialText`/`makeRobotsGate` (official-source/robots), `includeCandidate` (include.ts), `promoteOne` (cases-ingest.ts), `caseToItems` (cases-table.ts). YAGNI: no NB/MB, no lower courts, no generic framework.

---

## Task 1: `yukon.ts` pure module + unit tests

**Files:**
- Create: `src/lib/cases/ingest/yukon.ts`
- Create: `scripts/test-cases-yukon.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-yukon.ts`:
```ts
// yukon.ts unit tests. Async IIFE — this repo is NOT ESM (top-level await is illegal).
import assert from "node:assert/strict";
import { parseYukonListing, isIndigenousEconomicCandidate, yukonToCase } from "../src/lib/cases/ingest/yukon";

(async () => {
  const html = `
    <a href="/sites/default/files/favicons/favicon.png">icon</a>
    <div class="field-content">2026 YKSC 36</div>
    <a href="/sites/default/files/2026-05/2026_yksc_36_FNNND%20v%20Yukon%20%28Government%20of%29.pdf">FNNND v Yukon</a>
    <div class="field-content">2024 YKCA 3</div>
    <a href="/sites/default/files/2024-02/2024_ykca_3_ABC%20v%20XYZ.pdf">ABC v XYZ</a>
    <a href="/sites/default/files/2026-02/2026_yksc_7_CDG_v_Family%20and%20Children%20Services.pdf">CDG</a>
  `;
  const rows = parseYukonListing(html, "https://www.yukoncourts.ca/en/supreme-court/judgments");
  assert.equal(rows.length, 3, "3 decision PDFs (favicon ignored)");

  const fnnnd = rows.find((r) => r.citation === "2026 YKSC 36");
  assert.ok(fnnnd, "FNNND row parsed");
  assert.equal(fnnnd!.court, "YKSC");
  assert.equal(fnnnd!.pdfUrl, "https://www.yukoncourts.ca/sites/default/files/2026-05/2026_yksc_36_FNNND%20v%20Yukon%20%28Government%20of%29.pdf");
  assert.ok(fnnnd!.fileName.includes("FNNND v Yukon (Government of)"), "filename decoded");
  assert.equal(rows.find((r) => r.citation === "2024 YKCA 3")!.court, "YKCA", "YKCA court parsed");

  // shortlist
  assert.equal(isIndigenousEconomicCandidate(fnnnd!), true, "FNNND + Yukon(Government of) → candidate");
  assert.equal(isIndigenousEconomicCandidate(rows.find((r) => r.citation === "2024 YKCA 3")!), false, "ABC v XYZ → not candidate");
  assert.equal(isIndigenousEconomicCandidate(rows.find((r) => r.citation === "2026 YKSC 7")!), false, "family services → not candidate");

  // yukonToCase
  const c = yukonToCase(fnnnd!, "The First Nation sought judicial review of the land use plan. ".repeat(10));
  assert.equal(c.id, "2026-yksc-36", "slug id");
  assert.equal(c.court, "YKSC");
  assert.equal(c.level, "provincial_superior");
  assert.equal(c.year, 2026);
  assert.equal(c.provenance.source, "official_court");
  assert.equal(c.provenance.sourceUrl, fnnnd!.pdfUrl);
  assert.equal(c.corpusTier, "substrate");
  assert.ok((c.chunks?.length ?? 0) > 0, "chunks present");
  assert.ok(/FNNND v Yukon/.test(c.styleOfCause), "styleOfCause derived from filename");

  console.log("✅ test-cases-yukon passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-yukon.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/ingest/yukon'`.

- [ ] **Step 3: Implement `yukon.ts`**

Create `src/lib/cases/ingest/yukon.ts`:
```ts
// Direct-court harvest for www.yukoncourts.ca (pilot). Pure: parse a court's judgment
// index page into decision rows, shortlist Indigenous/economic candidates by keyword,
// and map a fetched PDF to a substrate LegalCase. No network here — the runner does the
// robots-compliant fetching. A2AJ does not index the Yukon Supreme Court, so this is how
// those decisions enter the corpus.
import type { LegalCase, CourtLevel } from "../types";
import { slugCitation, chunkText } from "./a2aj";

// Court index slug → citation court code. Pilot = these two only.
export const YUKON_COURTS = { "court-appeal": "YKCA", "supreme-court": "YKSC" } as const;
export type YukonCourtCode = "YKCA" | "YKSC";

const YUKON_LEVEL: Record<YukonCourtCode, CourtLevel> = {
  YKCA: "provincial_appeal",
  YKSC: "provincial_superior",
};

export interface YukonListingRow { citation: string; court: YukonCourtCode; pdfUrl: string; fileName: string; }

// Any href to a /sites/default/files/…​.pdf whose filename encodes a YK citation.
const PDF_HREF_RE = /href="([^"]*\/sites\/default\/files\/[^"]*\.pdf)"/gi;
const CITATION_RE = /(\d{4})[-_]yk(sc|ca)[-_]?(\d+)/i;

// Parse a Yukon judgment index page → one row per decision PDF. Deterministic: absolutize
// the URL against baseUrl, decode the filename, derive the canonical citation + court from
// the filename (robust to the visible-text variations), de-dup correction re-uploads.
export function parseYukonListing(html: string, baseUrl: string): YukonListingRow[] {
  const rows: YukonListingRow[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = PDF_HREF_RE.exec(html))) {
    let pdfUrl: string;
    try { pdfUrl = new URL(m[1], baseUrl).toString(); } catch { continue; }
    const fileName = decodeURIComponent(pdfUrl.split("/").pop() ?? "");
    const c = CITATION_RE.exec(fileName);
    if (!c) continue; // not a decision PDF (form, notice, …)
    const court: YukonCourtCode = c[2].toLowerCase() === "ca" ? "YKCA" : "YKSC";
    const citation = `${c[1]} ${court} ${c[3]}`;
    if (seen.has(citation)) continue;
    seen.add(citation);
    rows.push({ citation, court, pdfUrl, fileName });
  }
  return rows;
}

// List-level shortlist (recall-conservative, documented). An Indigenous-party OR
// economic/land signal in citation+filename; party names live in the filename. Anonymized
// captions ("ABC v XYZ") and criminal/family files are correctly excluded.
const YUKON_SIGNAL = /\b(first nations?|nacho nyak dun|fnnnd|kwanlin|champagne|aishihik|little salmon|carmacks|ross river|teslin|tlingit|vuntut|gwitchin|tr'?ond|carcross|tagish|selkirk|kluane|white river|liard|ta'?an|aboriginal|indigenous|m[ée]tis|treaty|land title|self-government|mineral|resource|royalt|expropriat|compensation)\b/i;
const GOV_PARTY = /yukon\s*\(government of\)/i;

export function isIndigenousEconomicCandidate(row: YukonListingRow): boolean {
  const hay = `${row.citation} ${row.fileName}`;
  return YUKON_SIGNAL.test(hay) || GOV_PARTY.test(hay);
}

// Best-effort display name from the filename (party names live there); feeds includeCandidate's
// text. Retrieval/labelling use the chunks, so exactness here is not critical.
function styleFromFileName(fileName: string, citation: string): string {
  const s = fileName
    .replace(/\.pdf$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/^\s*\d{4}[-\s]yk(sc|ca)[-\s]?\d+\s*/i, "")
    .replace(/\s+corr\d*$/i, "")
    .trim();
  return s || citation;
}

// Map a fetched decision → substrate LegalCase (mirrors a2ajToCase's field set so the object
// is a valid LegalCase). Promotion/enrichment fill nations/themes/outcome later.
export function yukonToCase(row: YukonListingRow, text: string): LegalCase {
  return {
    id: slugCitation(row.citation),
    citation: row.citation,
    styleOfCause: styleFromFileName(row.fileName, row.citation),
    court: row.court,
    level: YUKON_LEVEL[row.court],
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-yukon.ts`
Expected: `✅ test-cases-yukon passed`

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean (0 errors). If `CaseOutcome` requires different keys than `{ outcomeType, winType, whoWon, holding }`, copy the exact shape used by `a2ajToCase` in `src/lib/cases/ingest/a2aj.ts` (this plan mirrors it) — do not invent fields.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/ingest/yukon.ts scripts/test-cases-yukon.ts
git commit -m "feat(cases): yukon.ts — parse/shortlist/map Yukon court judgments"
```

---

## Task 2: `cases-harvest-yukon.ts` additive runner + test + npm scripts

**Files:**
- Create: `scripts/cases-harvest-yukon.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Append a second test file section is not needed — create a dedicated test `scripts/test-cases-harvest-yukon.ts`:
```ts
// cases-harvest-yukon runner tests — injected deps, no network/LLM/Dynamo.
import assert from "node:assert/strict";
import { runYukonHarvest, type YukonHarvestDeps } from "./cases-harvest-yukon";
import type { LegalCase } from "../src/lib/cases/types";

(async () => {
  // Two candidate PDFs on the SC page; one already in the corpus (must be skipped, never written).
  const html = `
    <a href="/sites/default/files/2026-05/2026_yksc_36_FNNND%20v%20Yukon%20%28Government%20of%29.pdf">a</a>
    <a href="/sites/default/files/2020-01/2020_yksc_1_Ross%20River%20Dena%20v%20Yukon.pdf">b</a>
  `;
  const written: string[] = [];
  const deps: YukonHarvestDeps = {
    fetchListing: async () => html,
    fetchText: async () => "The First Nation sought relief regarding treaty land and resource royalties. ".repeat(12),
    exists: async (id) => id === "2020-yksc-1", // Ross River already present → skip
    promote: async (c) => ({ ...c, corpusTier: "core" }), // consensus → core
    writeCase: async (c) => { written.push(c.id); },
  };

  const rep = await runYukonHarvest(["supreme-court"], deps);
  assert.equal(rep.listed, 2, "2 decisions listed");
  assert.equal(rep.shortlisted, 2, "both shortlisted (First Nation / Yukon(Government of))");
  assert.equal(rep.alreadyPresent, 1, "Ross River already present → skipped");
  assert.equal(rep.promoted, 1, "the new FNNND case promoted to core");
  assert.deepEqual(written, ["2026-yksc-36"], "only the new case written; existing never overwritten");

  console.log("✅ test-cases-harvest-yukon passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-harvest-yukon.ts`
Expected: FAIL — `Cannot find module './cases-harvest-yukon'` (or `runYukonHarvest` undefined).

- [ ] **Step 3: Implement `cases-harvest-yukon.ts`**

Create `scripts/cases-harvest-yukon.ts`:
```ts
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
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { fetchOfficialText } from "../src/lib/cases/ingest/official-source";
import { makeRobotsGate } from "../src/lib/cases/ingest/robots";
import { includeCandidate } from "../src/lib/cases/ingest/include";
import { promoteOne } from "./cases-ingest";
import { YUKON_COURTS, parseYukonListing, isIndigenousEconomicCandidate, yukonToCase, type YukonCourtCode } from "../src/lib/cases/ingest/yukon";
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-harvest-yukon.ts`
Expected: `✅ test-cases-harvest-yukon passed`

- [ ] **Step 5: Add npm scripts**

In `package.json` `scripts`, add after the `cases:harvest-economic:cloud` line:
```json
    "cases:harvest-yukon": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-harvest-yukon.ts",
    "cases:harvest-yukon:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-harvest-yukon.ts",
```
Ensure valid JSON (commas).

- [ ] **Step 6: Typecheck + build**

Run: `npm run typecheck`
Expected: clean (0 errors).

Run: `npm run build`
Expected: Next.js build succeeds (proves `yukon.ts`/`cases-harvest-yukon.ts` were not pulled into any app route bundle — ops-only).

- [ ] **Step 7: Commit**

```bash
git add scripts/cases-harvest-yukon.ts scripts/test-cases-harvest-yukon.ts package.json
git commit -m "feat(cases): additive Yukon harvest runner + npm scripts"
```

---

## Final verification (before finishing the branch)

- [ ] `npx tsx scripts/test-cases-yukon.ts` → `✅ test-cases-yukon passed`
- [ ] `npx tsx scripts/test-cases-harvest-yukon.ts` → `✅ test-cases-harvest-yukon passed`
- [ ] `npm run typecheck` → clean
- [ ] `npm run build` → succeeds
- [ ] Confirm additive safety in code: `runYukonHarvest` calls `deps.exists(c.id)` and `continue`s before any write when true (no path writes an existing case).

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- Pure module parse/shortlist/map → Task 1 ✅
- Additive harvest (never overwrite) → Task 2 `exists` guard + test asserting existing case never written ✅
- List-level shortlist then fetch candidates only → Task 2 `candidates = rows.filter(isIndigenousEconomicCandidate)` before any `fetchText` ✅
- Robots compliance (shared gate for listing + PDFs) → Task 2 `liveDeps` single `makeRobotsGate` ✅
- PRISMA gate → Task 2 `includeCandidate` ✅
- Inline double-LLM promote + yield report → Task 2 `promote`/`promoted` + report line ✅
- CA+SC scope only → `YUKON_COURTS` has exactly the two ✅
- No Lambda impact → Task 2 `npm run build` ✅

**2. Placeholder scan:** No TBD/TODO; all code complete; Step 5 of Task 1 gives a concrete fallback (copy a2ajToCase's outcome shape) rather than a vague instruction.

**3. Type consistency:** `YukonListingRow{citation,court,pdfUrl,fileName}`, `YukonCourtCode`, `YUKON_COURTS`, `runYukonHarvest(slugs, deps)`, `YukonHarvestDeps`, `YukonReport` are used identically across the module, runner, and both test files. `yukonToCase(row, text)` (2-arg — court is on the row) is consistent everywhere (refines the spec's `(row, court, text)`).
