# Legal Cases Activation Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Indigenous economic-justice legal-cases domain to the existing Indigenomics Data Portal as a third, contract-first domain (search, case detail with citation-anchored summaries, activation dashboard), seeded from the A2AJ open API.

**Architecture:** Mirrors the existing `survey/` domain. Frontend imports only `casesRepo` (the seam in `src/lib/cases/types.ts`); implementation is `mock` (in-memory fixtures) or `dynamo` (single-table `LegalCases`), selected by `REPO_IMPL`. All filter/search/aggregate logic lives in **one pure module `query.ts`** that both impls call over a `LegalCase[]` — so the `dynamo ≡ mock` regression holds by construction. Corpus is hundreds of cases → DynamoDB `getCase` by key, everything else `Scan` + in-memory `query.ts` (brute force is correct at this scale).

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, AWS DynamoDB (`@aws-sdk/lib-dynamodb`), DynamoDB Local (Docker), SST deploy. Tests = standalone `tsx` assertion scripts (`node:assert/strict`) mirroring `scripts/test-survey-*.ts`, plus `verify.ts` extension. No vitest/jest (matches existing repo).

**Spec:** `docs/specs/2026-06-27-legal-cases-hub-design.md`. **Source convention:** mirror `src/lib/survey/*` and `src/lib/dynamo/single-table.ts`.

---

## File structure (locked)

```
src/lib/cases/
  types.ts        # THE SEAM — domain types + CaseRepo            (Task 1)
  fixtures.ts     # curated sample/seed cases (mock data)          (Task 1)
  query.ts        # PURE filter/search/facets/activation/graph     (Task 2)
  repo.mock.ts    # in-memory impl over fixtures → query.ts        (Task 3)
  index.ts        # REPO_IMPL selector + re-exports                (Task 3, extended Task 6)
  ingest/
    a2aj.ts       # A2AJ fetch + field mapping + chunking          (Task 4)
  enrichment.ts   # citation → editorial deep fields (curated)     (Task 4)
  repo.dynamo.ts  # DynamoDB impl: getCase by key, rest Scan→query (Task 6)
src/lib/dynamo/
  cases-table.ts  # keys + marshalling (mirrors single-table.ts)   (Task 5)
scripts/
  test-cases-query.ts    # unit test for query.ts                  (Task 2)
  test-cases-mock.ts     # unit test for repo.mock                 (Task 3)
  test-cases-ingest.ts   # unit test for a2aj mapping              (Task 4)
  test-cases-table.ts    # marshalling round-trip                  (Task 5)
  seed-cases.ts          # seed LegalCases (mock fixtures → dynamo) (Task 6)
  verify.ts              # EXTEND: cases dynamo ≡ mock              (Task 6)
src/app/cases/
  page.tsx               # search + faceted browse                 (Task 7)
  [id]/page.tsx          # case detail (citation-anchored)         (Task 8)
  activation/page.tsx    # activation dashboard                    (Task 9)
package.json             # EXTEND scripts: cases:create/seed       (Task 6)
```

---

## Task 1: The seam — types + fixtures

**Files:**
- Create: `src/lib/cases/types.ts`
- Create: `src/lib/cases/fixtures.ts`

- [ ] **Step 1: Create `src/lib/cases/types.ts`**

```ts
// THE CASES SEAM — the ONLY file the frontend shares with the data layer.
// Frontend imports `casesRepo` + these types; never DynamoDB, never A2AJ.
export type Theme =
  | "land_rights" | "resource_revenue" | "duty_to_consult"
  | "treaty" | "fiduciary" | "self_determination";

export type CourtLevel =
  | "scc" | "fca" | "fc" | "provincial_appeal" | "provincial_superior" | "tribunal";

export type OutcomeType = "precedent" | "procedural" | "remand" | "regulatory" | "settlement";
export type WinType = "doctrine_win" | "party_win" | "mixed" | "loss";

export interface CaseOutcome {
  outcomeType: OutcomeType;
  winType: WinType;
  whoWon: string;
  holding: string; // 1–3 sentences, extractive
}

export interface EconomicDimension {
  valueType: "settlement" | "resource_revenue" | "equity" | "other";
  settlementAmount?: number; // CAD
  resourceRevenue?: number;
  equityStake?: number; // %
  economicSummary: string;
}

export type RealizationStatus = "declared" | "negotiating" | "realized" | "stalled" | "unknown";
export interface ValueRealization { status: RealizationStatus; note: string; asOf: string; }

export interface CitationAnchor { text: string; sourceParagraph: string; sourceUrl: string; }
export interface CitationAnchored { claims: CitationAnchor[]; }
export interface CaseChunk { paragraph: string; text: string; }

export type EnrichmentLevel = "index" | "deep";

export interface Provenance {
  source: "a2aj" | "official_court" | "summary_site" | "manual";
  sourceUrl: string;
  upstreamLicense: string;
  ingestedAt: string;
  unofficial: boolean;
}

export interface LegalCase {
  id: string;
  citation: string;
  citation2?: string;
  styleOfCause: string;
  court: string;
  level: CourtLevel;
  year: number;
  jurisdiction: string;
  nations: string[];
  themes: Theme[];
  outcome: CaseOutcome;
  economic?: EconomicDimension;
  valueRealization?: ValueRealization;
  summary?: CitationAnchored;
  chunks?: CaseChunk[];
  casesCited: string[];   // citation strings
  casesCiting: string[];  // citation strings
  citingCount: number;
  enrichmentLevel: EnrichmentLevel;
  fullTextAvailable: boolean;
  provenance: Provenance;
  sensitivity?: string;
}

export interface CaseFilter {
  themes?: Theme[]; level?: CourtLevel; winType?: WinType;
  nation?: string; yearFrom?: number; yearTo?: number;
}
export interface Facets {
  byTheme: Partial<Record<Theme, number>>;
  byLevel: Partial<Record<CourtLevel, number>>;
  byWinType: Partial<Record<WinType, number>>;
  byNation: Record<string, number>;
}
export interface ActivationSummary {
  totalCases: number;
  byTheme: Partial<Record<Theme, number>>;
  economicValue: { settlement: number; resourceRevenue: number; equity: number };
  valueRealization: Partial<Record<RealizationStatus, number>>;
  landmarkCases: { id: string; styleOfCause: string; citingCount: number }[];
}
export interface CitationGraph { cited: LegalCase[]; citing: LegalCase[]; }
export interface CaseExportBundle { cases: LegalCase[]; asOf: string; }

export interface CaseRepo {
  listCases(filter?: CaseFilter): Promise<LegalCase[]>;
  getCase(id: string): Promise<LegalCase | null>;
  searchCases(query: string, filter?: CaseFilter): Promise<LegalCase[]>;
  listFacets(filter?: CaseFilter): Promise<Facets>;
  getActivationSummary(): Promise<ActivationSummary>;
  getCitationGraph(id: string): Promise<CitationGraph>;
  exportCases(filter?: CaseFilter): Promise<CaseExportBundle>;
}
```

- [ ] **Step 2: Create `src/lib/cases/fixtures.ts`**

```ts
import type { LegalCase } from "./types";

const prov = (url: string): LegalCase["provenance"] => ({
  source: "a2aj", sourceUrl: url, upstreamLicense: "See upstream license (non-commercial).",
  ingestedAt: "2026-06-27T00:00:00.000Z", unofficial: true,
});

export const caseFixtures: LegalCase[] = [
  {
    id: "tsilhqotin-2014", citation: "2014 SCC 44", citation2: "[2014] 2 SCR 257",
    styleOfCause: "Tsilhqot'in Nation v. British Columbia",
    court: "Supreme Court of Canada", level: "scc", year: 2014, jurisdiction: "Canada",
    nations: ["Tsilhqot'in Nation"], themes: ["land_rights", "self_determination"],
    outcome: { outcomeType: "precedent", winType: "party_win",
      whoWon: "Tsilhqot'in Nation", holding: "First judicial declaration of Aboriginal title; title includes the right to the economic benefit of the land." },
    economic: { valueType: "other", economicSummary: "Title carries the right to use, manage, and reap the economic benefits of ~1,750 km² of land." },
    valueRealization: { status: "realized", note: "Declared title over the claim area.", asOf: "2014-06-26" },
    summary: { claims: [
      { text: "Aboriginal title confers the right to the economic benefit of the land.", sourceParagraph: "para-2", sourceUrl: "https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/14246/index.do" },
    ] },
    chunks: [
      { paragraph: "para-1", text: "This is the first case to address whether Aboriginal title has been established." },
      { paragraph: "para-2", text: "Aboriginal title confers the right to use and control the land and to reap its economic benefits." },
    ],
    casesCited: ["[1997] 3 SCR 1010"], casesCiting: [], citingCount: 0,
    enrichmentLevel: "deep", fullTextAvailable: true,
    provenance: prov("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/14246/index.do"),
  },
  {
    id: "haida-2004", citation: "2004 SCC 73",
    styleOfCause: "Haida Nation v. British Columbia (Minister of Forests)",
    court: "Supreme Court of Canada", level: "scc", year: 2004, jurisdiction: "Canada",
    nations: ["Haida Nation"], themes: ["duty_to_consult"],
    outcome: { outcomeType: "precedent", winType: "doctrine_win",
      whoWon: "Haida Nation (doctrine)", holding: "Established the Crown's duty to consult and accommodate, triggered even by unproven claims." },
    economic: { valueType: "other", economicSummary: "Resource licences now carry a constitutional consultation obligation before title is established." },
    valueRealization: { status: "realized", note: "Duty to consult now standard before resource approvals.", asOf: "2004-11-18" },
    summary: { claims: [
      { text: "The Crown has a duty to consult triggered by knowledge of a potential claim.", sourceParagraph: "para-1", sourceUrl: "https://canlii.org/en/ca/scc/doc/2004/2004scc73/2004scc73.html" },
    ] },
    chunks: [{ paragraph: "para-1", text: "The duty to consult arises when the Crown has knowledge of a potential Aboriginal claim and contemplates conduct that might adversely affect it." }],
    casesCited: [], casesCiting: ["2014 SCC 44"], citingCount: 1,
    enrichmentLevel: "deep", fullTextAvailable: true,
    provenance: prov("https://canlii.org/en/ca/scc/doc/2004/2004scc73/2004scc73.html"),
  },
  {
    id: "calder-1973", citation: "[1973] SCR 313",
    styleOfCause: "Calder et al. v. Attorney-General of British Columbia",
    court: "Supreme Court of Canada", level: "scc", year: 1973, jurisdiction: "Canada",
    nations: ["Nisga'a"], themes: ["land_rights"],
    outcome: { outcomeType: "precedent", winType: "mixed",
      whoWon: "Nisga'a (doctrine; lost on procedure)", holding: "First recognition that Aboriginal title exists at common law independent of statute." },
    casesCited: [], casesCiting: [], citingCount: 0,
    enrichmentLevel: "index", fullTextAvailable: true,
    provenance: prov("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/5113/index.do"),
  },
  {
    id: "fort-mckay-2020", citation: "2020 ABCA 163",
    styleOfCause: "Fort McKay First Nation v. Prosper Petroleum Ltd.",
    court: "Alberta Court of Appeal", level: "provincial_appeal", year: 2020, jurisdiction: "Alberta",
    nations: ["Fort McKay First Nation"], themes: ["duty_to_consult", "resource_revenue"],
    outcome: { outcomeType: "remand", winType: "party_win",
      whoWon: "Fort McKay First Nation", holding: "AER must consider the honour of the Crown; Rigel oil sands approval vacated and remitted." },
    casesCited: ["2004 SCC 73"], casesCiting: [], citingCount: 0,
    enrichmentLevel: "index", fullTextAvailable: false, // provincial gap — A2AJ has no ABCA
    provenance: { source: "summary_site", sourceUrl: "https://sites.usask.ca/nativelaw/2020/05/14/fort-mckay-first-nation-v-prosper-petroleum-ltd-2020-abca-163/",
      upstreamLicense: "Official text at albertacourts.ca; summary via USask Indigenous Law Centre.", ingestedAt: "2026-06-27T00:00:00.000Z", unofficial: true },
  },
];
```

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/lib/cases/types.ts src/lib/cases/fixtures.ts
git commit -m "feat(cases): add cases domain seam types + seed fixtures"
```

---

## Task 2: Pure query logic + test

**Files:**
- Create: `src/lib/cases/query.ts`
- Test: `scripts/test-cases-query.ts`

- [ ] **Step 1: Write the failing test `scripts/test-cases-query.ts`**

```ts
import assert from "node:assert/strict";
import { caseFixtures } from "../src/lib/cases/query"; // re-exported for convenience
import { filterCases, searchCases, buildFacets, buildActivation, buildGraph } from "../src/lib/cases/query";

const all = caseFixtures;

// filter by theme
assert.equal(filterCases(all, { themes: ["duty_to_consult"] }).length, 2, "two duty_to_consult cases");
// filter by level
assert.equal(filterCases(all, { level: "scc" }).length, 3, "three SCC cases");
// filter by winType
assert.equal(filterCases(all, { winType: "party_win" }).length, 2, "two party_win cases");

// search: exact citation outranks
const r = searchCases(all, "2014 SCC 44");
assert.equal(r[0].id, "tsilhqotin-2014", "citation match ranks first");
// search: case name
assert.equal(searchCases(all, "Haida")[0].id, "haida-2004", "name match");
// empty query returns all (filtered)
assert.equal(searchCases(all, "").length, all.length, "empty query → all");

// facets
const f = buildFacets(all);
assert.equal(f.byLevel.scc, 3, "facet scc=3");
assert.equal(f.byTheme.land_rights, 2, "facet land_rights=2");

// activation summary
const a = buildActivation(all);
assert.equal(a.totalCases, 4, "4 cases");
assert.equal(a.valueRealization.realized, 2, "2 realized");
assert.ok(a.landmarkCases.length > 0, "has landmark cases");

// citation graph: tsilhqotin cites haida indirectly? haida is cited BY tsilhqotin
const g = buildGraph(all, "haida-2004");
assert.equal(g.citing[0]?.id, "tsilhqotin-2014", "haida is cited by tsilhqotin");

console.log("✅ query tests passed");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/test-cases-query.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/query'`.

- [ ] **Step 3: Implement `src/lib/cases/query.ts`**

```ts
// PURE query logic over LegalCase[] — shared by repo.mock and repo.dynamo so the
// two impls are identical by construction (the verify.ts golden test).
import { caseFixtures } from "./fixtures";
import type {
  LegalCase, CaseFilter, Facets, ActivationSummary, CitationGraph,
  Theme, CourtLevel, WinType, RealizationStatus,
} from "./types";

export { caseFixtures }; // convenience re-export for tests

export function filterCases(cases: LegalCase[], f?: CaseFilter): LegalCase[] {
  if (!f) return cases;
  return cases.filter((c) =>
    (!f.themes?.length || f.themes.some((t) => c.themes.includes(t))) &&
    (!f.level || c.level === f.level) &&
    (!f.winType || c.outcome.winType === f.winType) &&
    (!f.nation || c.nations.includes(f.nation)) &&
    (f.yearFrom === undefined || c.year >= f.yearFrom) &&
    (f.yearTo === undefined || c.year <= f.yearTo));
}

// Hybrid-spirit scoring: exact tokens (citation, name, nation) weighted highest —
// the property real legal search depends on (see spec §10).
function score(c: LegalCase, q: string): number {
  let s = 0;
  if (c.citation.toLowerCase().includes(q)) s += 10;
  if (c.citation2?.toLowerCase().includes(q)) s += 10;
  if (c.styleOfCause.toLowerCase().includes(q)) s += 8;
  if (c.nations.some((n) => n.toLowerCase().includes(q))) s += 5;
  if (c.outcome.holding.toLowerCase().includes(q)) s += 3;
  if (c.chunks?.some((ch) => ch.text.toLowerCase().includes(q))) s += 2;
  return s;
}

export function searchCases(cases: LegalCase[], query: string, f?: CaseFilter): LegalCase[] {
  const base = filterCases(cases, f);
  const q = query.toLowerCase().trim();
  if (!q) return [...base].sort((a, b) => b.year - a.year);
  return base
    .map((c) => ({ c, s: score(c, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.c.citingCount - a.c.citingCount)
    .map((x) => x.c);
}

export function buildFacets(cases: LegalCase[]): Facets {
  const f: Facets = { byTheme: {}, byLevel: {}, byWinType: {}, byNation: {} };
  for (const c of cases) {
    for (const t of c.themes) f.byTheme[t] = (f.byTheme[t] ?? 0) + 1;
    f.byLevel[c.level] = (f.byLevel[c.level] ?? 0) + 1;
    f.byWinType[c.outcome.winType] = (f.byWinType[c.outcome.winType] ?? 0) + 1;
    for (const n of c.nations) f.byNation[n] = (f.byNation[n] ?? 0) + 1;
  }
  return f;
}

export function buildActivation(cases: LegalCase[]): ActivationSummary {
  const byTheme: Partial<Record<Theme, number>> = {};
  const valueRealization: Partial<Record<RealizationStatus, number>> = {};
  const economicValue = { settlement: 0, resourceRevenue: 0, equity: 0 };
  for (const c of cases) {
    for (const t of c.themes) byTheme[t] = (byTheme[t] ?? 0) + 1;
    const st = c.valueRealization?.status;
    if (st) valueRealization[st] = (valueRealization[st] ?? 0) + 1;
    economicValue.settlement += c.economic?.settlementAmount ?? 0;
    economicValue.resourceRevenue += c.economic?.resourceRevenue ?? 0;
    economicValue.equity += c.economic?.equityStake ?? 0;
  }
  const landmarkCases = [...cases]
    .sort((a, b) => b.citingCount - a.citingCount)
    .slice(0, 5)
    .map((c) => ({ id: c.id, styleOfCause: c.styleOfCause, citingCount: c.citingCount }));
  return { totalCases: cases.length, byTheme, economicValue, valueRealization, landmarkCases };
}

export function buildGraph(cases: LegalCase[], id: string): CitationGraph {
  const self = cases.find((c) => c.id === id);
  if (!self) return { cited: [], citing: [] };
  const byCitation = (cit: string) => cases.find((c) => c.citation === cit || c.citation2 === cit);
  const cited = self.casesCited.map(byCitation).filter((c): c is LegalCase => !!c);
  const citing = self.casesCiting.map(byCitation).filter((c): c is LegalCase => !!c);
  return { cited, citing };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-cases-query.ts`
Expected: PASS — prints `✅ query tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/query.ts scripts/test-cases-query.ts
git commit -m "feat(cases): pure query/search/facets/activation logic + tests"
```

---

## Task 3: Mock repo + selector

**Files:**
- Create: `src/lib/cases/repo.mock.ts`
- Create: `src/lib/cases/index.ts`
- Test: `scripts/test-cases-mock.ts`

- [ ] **Step 1: Write the failing test `scripts/test-cases-mock.ts`**

```ts
import assert from "node:assert/strict";
import { mockCaseRepo } from "../src/lib/cases/repo.mock";

const repo = mockCaseRepo;
assert.equal((await repo.listCases()).length, 4, "lists all");
assert.equal((await repo.getCase("haida-2004"))?.citation, "2004 SCC 73", "get by id");
assert.equal(await repo.getCase("nope"), null, "missing → null");
assert.equal((await repo.searchCases("Tsilhqot'in"))[0].id, "tsilhqotin-2014", "search by name");
assert.equal((await repo.listFacets()).byLevel.scc, 3, "facets");
assert.equal((await repo.getActivationSummary()).totalCases, 4, "activation");
assert.equal((await repo.getCitationGraph("haida-2004")).citing[0]?.id, "tsilhqotin-2014", "graph");
assert.ok((await repo.exportCases()).asOf, "export has asOf");
console.log("✅ mock repo tests passed");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/test-cases-mock.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/repo.mock'`.

- [ ] **Step 3: Implement `src/lib/cases/repo.mock.ts`**

```ts
import type { CaseRepo } from "./types";
import { caseFixtures } from "./fixtures";
import { filterCases, searchCases, buildFacets, buildActivation, buildGraph } from "./query";

export const mockCaseRepo: CaseRepo = {
  async listCases(filter) {
    return [...filterCases(caseFixtures, filter)].sort((a, b) => b.year - a.year);
  },
  async getCase(id) {
    return caseFixtures.find((c) => c.id === id) ?? null;
  },
  async searchCases(query, filter) {
    return searchCases(caseFixtures, query, filter);
  },
  async listFacets(filter) {
    return buildFacets(filterCases(caseFixtures, filter));
  },
  async getActivationSummary() {
    return buildActivation(caseFixtures);
  },
  async getCitationGraph(id) {
    return buildGraph(caseFixtures, id);
  },
  async exportCases(filter) {
    return { cases: filterCases(caseFixtures, filter), asOf: new Date().toISOString() };
  },
};
```

- [ ] **Step 4: Create `src/lib/cases/index.ts` (mock only for now)**

```ts
// THE CASES SEAM — what the frontend imports. Flip to DynamoDB with REPO_IMPL=dynamo
// (the dynamo branch is wired in Task 6; default = in-memory mock).
import type { CaseRepo } from "./types";
import { mockCaseRepo } from "./repo.mock";

export const casesRepo: CaseRepo = mockCaseRepo;

export type {
  LegalCase, CaseRepo, CaseFilter, Facets, ActivationSummary,
  CitationGraph, CaseExportBundle, Theme, CourtLevel, WinType, RealizationStatus,
} from "./types";
```

- [ ] **Step 5: Run the test + typecheck**

Run: `npx tsx scripts/test-cases-mock.ts && npm run typecheck`
Expected: PASS — prints `✅ mock repo tests passed`, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/repo.mock.ts src/lib/cases/index.ts scripts/test-cases-mock.ts
git commit -m "feat(cases): in-memory mock repo + REPO_IMPL seam (mock)"
```

---

## Task 4: A2AJ ingestion mapping + enrichment

**Files:**
- Create: `src/lib/cases/ingest/a2aj.ts`
- Create: `src/lib/cases/enrichment.ts`
- Test: `scripts/test-cases-ingest.ts`

- [ ] **Step 1: Write the failing test `scripts/test-cases-ingest.ts`**

```ts
import assert from "node:assert/strict";
import { a2ajToCase, chunkText, type A2ajRecord } from "../src/lib/cases/ingest/a2aj";

// a recorded A2AJ /fetch record (shape verified live against api.a2aj.ca)
const raw: A2ajRecord = {
  dataset: "SCC", citation_en: "2014 SCC 44", citation2_en: "[2014] 2 SCR 257",
  name_en: "Tsilhqot'in Nation v. British Columbia",
  document_date_en: "2014-06-26T00:00:00", url_en: "https://decisions.scc-csc.ca/x",
  unofficial_text_en: "Para one text here.\n\nPara two text here.",
  cases_cited_en: ["[1997] 3 SCR 1010"], cases_citing_en: [], citing_cases_count: 0,
  upstream_license: "non-commercial",
};

const c = a2ajToCase(raw);
assert.equal(c.id, "2014-scc-44", "id slugged from citation");
assert.equal(c.citation, "2014 SCC 44");
assert.equal(c.level, "scc", "SCC dataset → scc level");
assert.equal(c.year, 2014, "year parsed");
assert.equal(c.enrichmentLevel, "index", "raw A2AJ → index level");
assert.equal(c.fullTextAvailable, true);
assert.equal(c.casesCited[0], "[1997] 3 SCR 1010", "citation graph mapped");
assert.equal(c.provenance.source, "a2aj");
assert.equal(c.chunks?.length, 2, "two paragraph chunks");
assert.equal(c.chunks?.[0].paragraph, "para-1");

// dataset → level mapping
assert.equal(a2ajToCase({ ...raw, dataset: "FCA" }).level, "fca");
assert.equal(a2ajToCase({ ...raw, dataset: "ONCA" }).level, "provincial_appeal");
assert.equal(a2ajToCase({ ...raw, dataset: "CHRT" }).level, "tribunal");

// chunkText splits on blank lines
assert.equal(chunkText("a\n\nb\n\nc").length, 3);
console.log("✅ ingest tests passed");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/test-cases-ingest.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/ingest/a2aj'`.

- [ ] **Step 3: Implement `src/lib/cases/ingest/a2aj.ts`**

```ts
// A2AJ ingestion — maps the open api.a2aj.ca record shape to a LegalCase.
// Raw A2AJ gives the skeleton (citation/name/court/year + full text + citation
// graph); editorial deep fields (themes/outcome/economic/value-realization/
// summary) are layered separately via enrichment.ts. So a raw map = index level.
import type { LegalCase, CaseChunk, CourtLevel } from "../types";

export interface A2ajRecord {
  dataset: string;
  citation_en: string;
  citation2_en?: string;
  name_en: string;
  document_date_en: string;
  url_en: string;
  unofficial_text_en?: string;
  cases_cited_en?: string[];
  cases_citing_en?: string[];
  citing_cases_count?: number;
  upstream_license?: string;
}

const LEVEL: Record<string, CourtLevel> = {
  SCC: "scc", FCA: "fca", FC: "fc", TCC: "tribunal",
  BCCA: "provincial_appeal", ONCA: "provincial_appeal", NSCA: "provincial_appeal", YKCA: "provincial_appeal",
  BCSC: "provincial_superior", NSSC: "provincial_superior", NSFC: "provincial_superior",
  CHRT: "tribunal", CIRB: "tribunal", CITT: "tribunal", CMAC: "tribunal", CT: "tribunal",
  FPSLREB: "tribunal", OHSTC: "tribunal", RAD: "tribunal", RPD: "tribunal", SST: "tribunal",
};

export function slugCitation(citation: string): string {
  return citation.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function chunkText(text: string): CaseChunk[] {
  return text
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t, i) => ({ paragraph: `para-${i + 1}`, text: t }));
}

export function a2ajToCase(r: A2ajRecord): LegalCase {
  const text = r.unofficial_text_en ?? "";
  return {
    id: slugCitation(r.citation_en),
    citation: r.citation_en,
    citation2: r.citation2_en,
    styleOfCause: r.name_en,
    court: r.dataset,
    level: LEVEL[r.dataset] ?? "tribunal",
    year: new Date(r.document_date_en).getUTCFullYear(),
    jurisdiction: "Canada",
    nations: [], // enrichment fills this
    themes: [],  // enrichment fills this
    outcome: { outcomeType: "precedent", winType: "mixed", whoWon: "", holding: "" },
    chunks: text ? chunkText(text) : undefined,
    casesCited: r.cases_cited_en ?? [],
    casesCiting: r.cases_citing_en ?? [],
    citingCount: r.citing_cases_count ?? 0,
    enrichmentLevel: "index",
    fullTextAvailable: !!text,
    provenance: {
      source: "a2aj", sourceUrl: r.url_en,
      upstreamLicense: r.upstream_license ?? "unknown",
      ingestedAt: new Date().toISOString(), unofficial: true,
    },
  };
}

// thin live fetch — used by seed-cases.ts, NOT by tests (keeps tests offline).
export async function fetchA2aj(citation: string): Promise<A2ajRecord | null> {
  const url = `https://api.a2aj.ca/fetch?citation=${encodeURIComponent(citation)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: A2ajRecord[] };
  return data.results?.[0] ?? null;
}
```

- [ ] **Step 4: Implement `src/lib/cases/enrichment.ts`**

```ts
// Editorial deep enrichment, keyed by citation. A2AJ supplies the skeleton;
// these are the curated, citation-anchored economic-justice fields. This is
// SEED DATA the team curates over time (grows with the flagship corpus) — not
// code. Merge logic lives in seed-cases.ts.
import type { Theme, CaseOutcome, EconomicDimension, ValueRealization, CitationAnchored } from "./types";

export interface Enrichment {
  nations: string[];
  themes: Theme[];
  outcome: CaseOutcome;
  economic?: EconomicDimension;
  valueRealization?: ValueRealization;
  summary?: CitationAnchored;
}

export const enrichment: Record<string, Enrichment> = {
  "2014 SCC 44": {
    nations: ["Tsilhqot'in Nation"], themes: ["land_rights", "self_determination"],
    outcome: { outcomeType: "precedent", winType: "party_win", whoWon: "Tsilhqot'in Nation",
      holding: "First judicial declaration of Aboriginal title; title includes the right to the land's economic benefit." },
    economic: { valueType: "other", economicSummary: "Right to use, manage, and reap the economic benefits of ~1,750 km²." },
    valueRealization: { status: "realized", note: "Title declared over the claim area.", asOf: "2014-06-26" },
    summary: { claims: [{ text: "Aboriginal title confers the right to the economic benefit of the land.",
      sourceParagraph: "para-2", sourceUrl: "https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/14246/index.do" }] },
  },
  "2004 SCC 73": {
    nations: ["Haida Nation"], themes: ["duty_to_consult"],
    outcome: { outcomeType: "precedent", winType: "doctrine_win", whoWon: "Haida Nation (doctrine)",
      holding: "Established the Crown's duty to consult and accommodate, triggered even by unproven claims." },
    economic: { valueType: "other", economicSummary: "Resource licences now carry a constitutional consultation obligation." },
    valueRealization: { status: "realized", note: "Duty to consult standard before resource approvals.", asOf: "2004-11-18" },
  },
  // Curators add the remaining flagship citations here over time.
};
```

- [ ] **Step 5: Run the test + typecheck**

Run: `npx tsx scripts/test-cases-ingest.ts && npm run typecheck`
Expected: PASS — prints `✅ ingest tests passed`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/ingest/a2aj.ts src/lib/cases/enrichment.ts scripts/test-cases-ingest.ts
git commit -m "feat(cases): A2AJ ingest mapping + chunking + curated enrichment"
```

---

## Task 5: DynamoDB keys + marshalling

**Files:**
- Create: `src/lib/dynamo/cases-table.ts`
- Test: `scripts/test-cases-table.ts`

- [ ] **Step 1: Write the failing test `scripts/test-cases-table.ts`**

```ts
import assert from "node:assert/strict";
import { toCaseItem, itemToCase, caseKeys } from "../src/lib/dynamo/cases-table";
import { caseFixtures } from "../src/lib/cases/fixtures";

for (const c of caseFixtures) {
  const item = toCaseItem(c);
  assert.equal(item.PK, `CASE#${c.id}`, "PK shape");
  assert.equal(item.SK, "PROFILE", "SK shape");
  assert.equal(item.et, "Case", "entity type");
  assert.equal(item.GSI1PK, `THEME#${c.themes[0]}`, "GSI1 by primary theme");
  const round = itemToCase(item);
  assert.deepEqual(round, c, `round-trip preserves ${c.id}`);
}
assert.deepEqual(caseKeys.profile("x"), { PK: "CASE#x", SK: "PROFILE" });
console.log("✅ cases-table tests passed");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/test-cases-table.ts`
Expected: FAIL — `Cannot find module '../src/lib/dynamo/cases-table'`.

- [ ] **Step 3: Implement `src/lib/dynamo/cases-table.ts`**

```ts
// SINGLE-TABLE DESIGN for LegalCases (mirrors single-table.ts). Corpus is small,
// so list/search/facets Scan + filter in query.ts; GSI1/GSI2 exist for theme /
// win-type browse paths and future growth. getCase uses the main key.
import type { LegalCase, Theme, WinType } from "../cases/types";

export const GSI1 = "GSI1"; // theme browse
export const GSI2 = "GSI2"; // win-type browse
export type CaseEntityType = "Case";

export const caseKeys = {
  profile: (id: string) => ({ PK: `CASE#${id}`, SK: "PROFILE" }),
};
export const gsi1Theme = (t: Theme) => `THEME#${t}`;
export const gsi2WinType = (w: WinType) => `WINTYPE#${w}`;
export const gsiSk = (year: number, id: string) => `YEAR#${year}#CASE#${id}`;

export function toCaseItem(c: LegalCase) {
  return {
    ...caseKeys.profile(c.id),
    et: "Case" as CaseEntityType,
    GSI1PK: gsi1Theme(c.themes[0] ?? "land_rights"),
    GSI1SK: gsiSk(c.year, c.id),
    GSI2PK: gsi2WinType(c.outcome.winType),
    GSI2SK: gsiSk(c.year, c.id),
    data: c, // store the full domain object; small + read-whole access pattern
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function itemToCase(it: any): LegalCase {
  return it.data as LegalCase;
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx tsx scripts/test-cases-table.ts && npm run typecheck`
Expected: PASS — prints `✅ cases-table tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dynamo/cases-table.ts scripts/test-cases-table.ts
git commit -m "feat(cases): LegalCases single-table keys + marshalling"
```

---

## Task 6: DynamoDB repo + seed + verify + wire selector

**Files:**
- Create: `src/lib/cases/repo.dynamo.ts`
- Create: `scripts/seed-cases.ts`
- Modify: `src/lib/cases/index.ts` (add dynamo branch)
- Modify: `package.json` (add `cases:create` / `cases:seed` scripts)
- Modify: `scripts/verify.ts` (add cases golden checks)

- [ ] **Step 1: Implement `src/lib/cases/repo.dynamo.ts`**

```ts
// DynamoDB impl. getCase = GetCommand by key. Everything else Scans the table
// and delegates to the SAME query.ts the mock uses → dynamo ≡ mock by design.
import { GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../dynamo/client";
import { caseKeys, itemToCase } from "../dynamo/cases-table";
import { filterCases, searchCases, buildFacets, buildActivation, buildGraph } from "./query";
import type { CaseRepo, LegalCase } from "./types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

async function scanAll(): Promise<LegalCase[]> {
  const out: LegalCase[] = [];
  let start: Record<string, any> | undefined;
  do {
    const r = await ddbDoc.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: start }));
    for (const it of r.Items ?? []) if (it.et === "Case") out.push(itemToCase(it));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

export const dynamoCaseRepo: CaseRepo = {
  async listCases(filter) {
    return [...filterCases(await scanAll(), filter)].sort((a, b) => b.year - a.year);
  },
  async getCase(id) {
    const r = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: caseKeys.profile(id) }));
    return r.Item ? itemToCase(r.Item) : null;
  },
  async searchCases(query, filter) {
    return searchCases(await scanAll(), query, filter);
  },
  async listFacets(filter) {
    return buildFacets(filterCases(await scanAll(), filter));
  },
  async getActivationSummary() {
    return buildActivation(await scanAll());
  },
  async getCitationGraph(id) {
    return buildGraph(await scanAll(), id);
  },
  async exportCases(filter) {
    return { cases: filterCases(await scanAll(), filter), asOf: new Date().toISOString() };
  },
};
```

- [ ] **Step 2: Implement `scripts/seed-cases.ts`**

```ts
// Seed the LegalCases table. For the demo this writes the curated fixtures
// directly (deterministic, offline). The A2AJ live path (fetchA2aj + a2ajToCase
// + enrichment merge) is exercised by `npm run cases:ingest` in Phase 2; the
// fixtures already encode the merged result.
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { toCaseItem } from "../src/lib/dynamo/cases-table";
import { caseFixtures } from "../src/lib/cases/fixtures";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

export async function seedCases() {
  const items = caseFixtures.map((c) => ({ PutRequest: { Item: toCaseItem(c) } }));
  for (let i = 0; i < items.length; i += 25) {
    await ddbDoc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: items.slice(i, i + 25) } }));
  }
  console.log(`✅ seeded ${caseFixtures.length} cases into "${TABLE}"`);
}

if (require.main === module) {
  seedCases().catch((e) => { console.error("❌ seed-cases failed:", e); process.exit(1); });
}
```

- [ ] **Step 3: Wire the dynamo branch in `src/lib/cases/index.ts`**

Replace the body of `src/lib/cases/index.ts` (keep the type re-exports) with:

```ts
import type { CaseRepo } from "./types";
import { mockCaseRepo } from "./repo.mock";
import { dynamoCaseRepo } from "./repo.dynamo";

export const casesRepo: CaseRepo =
  process.env.REPO_IMPL === "dynamo" ? dynamoCaseRepo : mockCaseRepo;

export type {
  LegalCase, CaseRepo, CaseFilter, Facets, ActivationSummary,
  CitationGraph, CaseExportBundle, Theme, CourtLevel, WinType, RealizationStatus,
} from "./types";
```

- [ ] **Step 4: Add npm scripts to `package.json`**

In the `"scripts"` block add (mirrors the `survey:*` pattern; `create-table.ts` reads `DYNAMO_TABLE`):

```json
"cases:create": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 DYNAMO_TABLE=LegalCases CASES_TABLE=LegalCases tsx scripts/create-table.ts",
"cases:seed": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases tsx scripts/seed-cases.ts",
"cases:create:cloud": "cross-env AWS_REGION=us-east-1 DYNAMO_TABLE=LegalCases CASES_TABLE=LegalCases tsx scripts/create-table.ts",
"cases:seed:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases tsx scripts/seed-cases.ts"
```

- [ ] **Step 5: Extend `scripts/verify.ts` with cases golden checks**

Add these imports near the other repo imports (top of file):

```ts
import { mockCaseRepo } from "../src/lib/cases/repo.mock";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { seedCases } from "./seed-cases";
```

In `freshSeed()`, after the existing table creates/seeds, add:

```ts
  await createSingleTable("LegalCases");
  await resetTable("LegalCases");
  await (async () => { process.env.CASES_TABLE = "LegalCases"; await seedCases(); })();
```

In `main()`, after the survey checks, add the golden block:

```ts
  // ---- Cases: dynamo ≡ mock on the seeded reads ----
  const mList = await mockCaseRepo.listCases();
  const dList = await dynamoCaseRepo.listCases();
  check("cases: list count mock≡dynamo", mList.length === dList.length, `${mList.length}/${dList.length}`);
  check("cases: list ids mock≡dynamo", eq(sortIds(mList), sortIds(dList)));
  check("cases: getCase mock≡dynamo",
    eq(await mockCaseRepo.getCase("haida-2004"), await dynamoCaseRepo.getCase("haida-2004")));
  check("cases: activation mock≡dynamo",
    eq(await mockCaseRepo.getActivationSummary(), await dynamoCaseRepo.getActivationSummary()));
  check("cases: search mock≡dynamo",
    eq(sortIds(await mockCaseRepo.searchCases("Tsilhqot'in")), sortIds(await dynamoCaseRepo.searchCases("Tsilhqot'in"))));
```

- [ ] **Step 6: Run the full verify harness**

Run: `npm run ddb:up && npm run verify`
Expected: PASS — existing checks still green **plus** the 5 new `cases:` checks all `✅`, final summary shows 0 failures.

- [ ] **Step 7: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/lib/cases/repo.dynamo.ts scripts/seed-cases.ts src/lib/cases/index.ts package.json scripts/verify.ts
git commit -m "feat(cases): DynamoDB repo + seed + verify golden (dynamo≡mock) + wire selector"
```

---

## Task 7: `/cases` — search + faceted browse

**Files:**
- Create: `src/app/cases/page.tsx`

- [ ] **Step 1: Implement `src/app/cases/page.tsx`**

```tsx
// Server component. Reads casesRepo directly. Search + theme/level filters come
// in via searchParams (no client state needed for MVP). Reuses ui.tsx primitives.
import Link from "next/link";
import { casesRepo } from "@/lib/cases";
import type { Theme, CourtLevel } from "@/lib/cases";

const THEMES: Theme[] = ["land_rights", "resource_revenue", "duty_to_consult", "treaty", "fiduciary", "self_determination"];

export default async function CasesPage({
  searchParams,
}: {
  searchParams: { q?: string; theme?: Theme; level?: CourtLevel };
}) {
  const q = searchParams.q ?? "";
  const filter = {
    themes: searchParams.theme ? [searchParams.theme] : undefined,
    level: searchParams.level,
  };
  const cases = q ? await casesRepo.searchCases(q, filter) : await casesRepo.listCases(filter);
  const facets = await casesRepo.listFacets();

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold">Legal Cases — Economic Justice</h1>
      <p className="mt-1 text-sm text-gray-500">
        Indigenous economic-justice case law. Every claim links to its source.
      </p>

      <form className="mt-4 flex gap-2" action="/cases">
        <input
          name="q" defaultValue={q} placeholder="Search citation, case name, nation…"
          className="flex-1 rounded border px-3 py-2"
        />
        <button className="rounded bg-black px-4 py-2 text-white">Search</button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {THEMES.map((t) => (
          <Link key={t} href={`/cases?theme=${t}`} className="rounded-full border px-3 py-1 hover:bg-gray-50">
            {t.replace(/_/g, " ")} <span className="text-gray-400">{facets.byTheme[t] ?? 0}</span>
          </Link>
        ))}
        <Link href="/cases" className="rounded-full border px-3 py-1 hover:bg-gray-50">clear</Link>
      </div>

      <ul className="mt-6 divide-y">
        {cases.map((c) => (
          <li key={c.id} className="py-3">
            <Link href={`/cases/${c.id}`} className="font-medium hover:underline">{c.styleOfCause}</Link>
            <div className="text-sm text-gray-500">
              {c.citation} · {c.court} · {c.year}
              {!c.fullTextAvailable && <span className="ml-2 rounded bg-amber-100 px-1 text-amber-700">index only</span>}
            </div>
            <div className="text-sm">{c.outcome.holding}</div>
          </li>
        ))}
        {cases.length === 0 && <li className="py-3 text-gray-500">No cases match.</li>}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Verify it builds + renders**

Run: `npm run dev` then open `http://localhost:3000/cases` (and `/cases?q=Tsilhqot'in`, `/cases?theme=duty_to_consult`).
Expected: list renders from the mock; search and theme filter change the list; "index only" badge shows on the Fort McKay case.

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/app/cases/page.tsx
git commit -m "feat(cases): search + faceted browse page"
```

---

## Task 8: `/cases/[id]` — case detail (citation-anchored)

**Files:**
- Create: `src/app/cases/[id]/page.tsx`

- [ ] **Step 1: Implement `src/app/cases/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { casesRepo } from "@/lib/cases";

export default async function CaseDetail({ params }: { params: { id: string } }) {
  const c = await casesRepo.getCase(params.id);
  if (!c) notFound();
  const graph = await casesRepo.getCitationGraph(c.id);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/cases" className="text-sm text-gray-500 hover:underline">← all cases</Link>
      <h1 className="mt-2 text-2xl font-semibold">{c.styleOfCause}</h1>
      <div className="text-sm text-gray-500">{c.citation}{c.citation2 ? ` · ${c.citation2}` : ""} · {c.court} · {c.year}</div>
      <div className="mt-1 flex flex-wrap gap-1 text-xs">
        {c.themes.map((t) => <span key={t} className="rounded bg-gray-100 px-2 py-0.5">{t.replace(/_/g, " ")}</span>)}
        <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-700">{c.outcome.winType.replace(/_/g, " ")}</span>
      </div>

      <section className="mt-4">
        <h2 className="font-semibold">Holding</h2>
        <p className="text-sm">{c.outcome.holding}</p>
        <p className="text-xs text-gray-500">Who won: {c.outcome.whoWon}</p>
      </section>

      {c.economic && (
        <section className="mt-4">
          <h2 className="font-semibold">Economic dimension</h2>
          <p className="text-sm">{c.economic.economicSummary}</p>
          {c.economic.settlementAmount != null && <p className="text-sm">Settlement: ${c.economic.settlementAmount.toLocaleString()} CAD</p>}
        </section>
      )}

      {c.valueRealization && (
        <section className="mt-4">
          <h2 className="font-semibold">Value realization</h2>
          <p className="text-sm"><span className="rounded bg-green-100 px-2 py-0.5 text-green-700">{c.valueRealization.status}</span> {c.valueRealization.note}</p>
        </section>
      )}

      {c.summary && (
        <section className="mt-4">
          <h2 className="font-semibold">Summary <span className="text-xs font-normal text-gray-500">(citation-anchored)</span></h2>
          <ul className="mt-1 space-y-1 text-sm">
            {c.summary.claims.map((cl, i) => (
              <li key={i}>{cl.text} <a href={cl.sourceUrl} className="text-xs text-blue-600 hover:underline" target="_blank" rel="noreferrer">[{cl.sourceParagraph}]</a></li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-4">
        <h2 className="font-semibold">Citations</h2>
        <p className="text-sm">Cited by {c.citingCount} case(s).</p>
        <div className="mt-1 grid grid-cols-2 gap-3 text-sm">
          <div><div className="text-xs text-gray-500">Cites</div>{graph.cited.map((g) => <Link key={g.id} href={`/cases/${g.id}`} className="block hover:underline">{g.styleOfCause}</Link>)}</div>
          <div><div className="text-xs text-gray-500">Cited by</div>{graph.citing.map((g) => <Link key={g.id} href={`/cases/${g.id}`} className="block hover:underline">{g.styleOfCause}</Link>)}</div>
        </div>
      </section>

      <footer className="mt-6 border-t pt-3 text-xs text-gray-500">
        {c.provenance.unofficial && "Unofficial reproduction. "}
        Source: <a href={c.provenance.sourceUrl} className="text-blue-600 hover:underline" target="_blank" rel="noreferrer">official decision</a>. License: {c.provenance.upstreamLicense}
      </footer>
    </main>
  );
}
```

- [ ] **Step 2: Verify it renders**

Run: open `http://localhost:3000/cases/tsilhqotin-2014` and `/cases/calder-1973`.
Expected: deep case shows holding + economic + value-realization + citation-anchored summary with `[para-N]` source links; index-only case (calder) shows holding only; footer shows the unofficial-reproduction disclaimer + official-source link; citation graph links resolve.

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add "src/app/cases/[id]/page.tsx"
git commit -m "feat(cases): citation-anchored case detail page"
```

---

## Task 9: `/cases/activation` — activation dashboard

**Files:**
- Create: `src/app/cases/activation/page.tsx`

- [ ] **Step 1: Implement `src/app/cases/activation/page.tsx`**

```tsx
import Link from "next/link";
import { casesRepo } from "@/lib/cases";

function Bar({ label, n, max }: { label: string; n: number; max: number }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="w-40 shrink-0">{label}</div>
      <div className="h-4 flex-1 rounded bg-gray-100">
        <div className="h-4 rounded bg-blue-500" style={{ width: `${max ? (n / max) * 100 : 0}%` }} />
      </div>
      <div className="w-8 text-right text-gray-500">{n}</div>
    </div>
  );
}

export default async function ActivationPage() {
  const s = await casesRepo.getActivationSummary();
  const themes = Object.entries(s.byTheme);
  const maxTheme = Math.max(1, ...themes.map(([, n]) => n));
  const real = s.valueRealization;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Activation Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">Turning Indigenous legal wins into economic intelligence.</p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded border p-3"><div className="text-2xl font-semibold">{s.totalCases}</div><div className="text-xs text-gray-500">cases</div></div>
        <div className="rounded border p-3"><div className="text-2xl font-semibold">{(real.realized ?? 0)}</div><div className="text-xs text-gray-500">value realized</div></div>
        <div className="rounded border p-3"><div className="text-2xl font-semibold">{(real.negotiating ?? 0)}</div><div className="text-xs text-gray-500">negotiating</div></div>
      </div>

      <section className="mt-6">
        <h2 className="font-semibold">By theme</h2>
        <div className="mt-2 space-y-1">
          {themes.map(([t, n]) => <Bar key={t} label={t.replace(/_/g, " ")} n={n} max={maxTheme} />)}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">Value-realization funnel</h2>
        <div className="mt-2 flex gap-3 text-sm">
          {(["declared", "negotiating", "realized", "stalled"] as const).map((k) => (
            <div key={k} className="rounded border px-3 py-2">
              <div className="text-lg font-semibold">{real[k] ?? 0}</div><div className="text-xs text-gray-500">{k}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">Landmark cases <span className="text-xs font-normal text-gray-500">(by citation authority)</span></h2>
        <ul className="mt-1 text-sm">
          {s.landmarkCases.map((c) => (
            <li key={c.id}><Link href={`/cases/${c.id}`} className="hover:underline">{c.styleOfCause}</Link> <span className="text-gray-400">cited {c.citingCount}×</span></li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Verify it renders**

Run: open `http://localhost:3000/cases/activation`.
Expected: total/realized/negotiating cards, by-theme bars, value-realization funnel, landmark list sorted by citation count; landmark links navigate to detail.

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/app/cases/activation/page.tsx
git commit -m "feat(cases): activation dashboard page"
```

---

## Final verification

- [ ] **End-to-end (Definition of Done):**

```bash
npm run ddb:up
npm run cases:create && npm run cases:seed
REPO_IMPL=dynamo npm run dev
```
Then in the browser: `/cases` → search "Tsilhqot'in" → open the case → every summary claim links to a `[para-N]` source → `/cases/activation` reflects the seeded corpus. Switch off `REPO_IMPL` (mock) and confirm identical behavior.

- [ ] **Full regression:** `npm run verify` → all checks (portal + survey + 5 new cases checks) green, 0 failures.
- [ ] **Typecheck:** `npm run typecheck` clean.

---

## Notes for the implementer

- **Do not** import `repo.mock` / `repo.dynamo` / `dynamo/*` / `ingest/*` from React pages — only `@/lib/cases` and `@/lib/cases` types. (Same rule as the portal's `frontend-api.md`.)
- The `enrichment.ts` map and `fixtures.ts` are **seed data** — the team curates the flagship ~40–80 cases there over time. The fixtures already encode merged (A2AJ skeleton + enrichment) records for the demo, so the live A2AJ fetch is not on the critical path for the MVP.
- Live A2AJ ingestion (`fetchA2aj` + `a2ajToCase` + enrichment merge → write) is Phase 2; the mapping is unit-tested offline here so it's ready to wire.
- Provincial-gap cases (e.g. Fort McKay 2020 ABCA 163) are seeded as `enrichmentLevel: "index"`, `fullTextAvailable: false` with a `summary_site` provenance — they appear in search/analytics but carry no chunks until enriched from an official source.
```
