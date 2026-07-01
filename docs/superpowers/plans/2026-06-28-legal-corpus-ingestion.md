# Legal Corpus Ingestion (Phase 2-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 4-fixture `cases` demo into a real two-tier corpus ingested from A2AJ — a broad full-text **substrate** (RAG/discovery) plus a curated, dual-LLM-labeled, human-validated **core** (browse/analytics) — with a generated datasheet.

**Architecture:** Pure additive to the existing `cases` domain (Phase 1). All correctness-critical logic is pure functions (dedup, inclusion filter, label-merge, metrics) unit-tested offline with the repo's `tsx` assertion-script idiom. Live A2AJ fetches and LLM calls are isolated behind thin, disk-cached clients exercised only by the live `cases:ingest` script. The `CaseRepo` seam and pages are unchanged; `listCases`/facets/activation default to **core-only** so the dashboard stays honest.

**Tech Stack:** Next.js 14, TypeScript, AWS DynamoDB (`@aws-sdk/lib-dynamodb`), DynamoDB Local (Docker, on :8000), Node 24 global `fetch`, tsx assertion scripts (no vitest). LLM labeling via a provider-agnostic client (two model families; keys server-side).

**Spec:** `docs/specs/2026-06-28-corpus-ingestion-design.md`. **Conventions:** mirror `src/lib/cases/*` and `src/lib/dynamo/cases-table.ts` from Phase 1.

---

## File structure (locked)

```
src/lib/cases/
  types.ts          # MODIFY: + CorpusTier, "unclassified", ThemeLabelMeta, CaseFilter.tier   (Task 1)
  query.ts          # MODIFY: filterCases defaults to core-only; tier honored                  (Task 1)
  fixtures.ts       # MODIFY: 4 fixtures get corpusTier:"core"                                  (Task 1)
  ingest/
    sources.ts      # CREATE: theme queries + seed citations + gap citations                   (Task 2)
    dedup.ts        # CREATE (pure): dedupeByCitation                                           (Task 3)
    harvest.ts      # CREATE (live client): date-windowed search + fetch + snowball             (Task 4)
    include.ts      # CREATE (pure): inclusion filter + PRISMA counts                           (Task 6)
    rubric.ts       # CREATE: theme rubric text (the methodology, versioned)                    (Task 7)
    llm.ts          # CREATE (client): provider-agnostic, content-hash disk cache               (Task 7)
    labeler.ts      # CREATE: mergeLabels (pure) + label orchestration                          (Task 8)
  validate/
    metrics.ts      # CREATE (pure): prf1, cohenKappa, pabak, wilsonInterval                    (Task 10)
src/lib/dynamo/
  cases-table.ts    # MODIFY: itemToCase reconstructs corpusTier + labelMeta                    (Task 1)
scripts/
  test-cases-dedup.ts      # Task 3   test-cases-include.ts    # Task 6
  test-cases-labelmerge.ts # Task 8   test-cases-metrics.ts    # Task 10
  cases-ingest.ts          # CREATE: orchestrates harvest→substrate→include→label→core (Tasks 5, 9)
  cases-validate.ts        # CREATE: gold file → metrics                                        (Task 11)
  cases-datasheet.ts       # CREATE: emit datasheet                                             (Task 12)
  verify.ts                # MODIFY: tier/unclassified flow + ingest round-trip                 (Task 13)
package.json               # MODIFY: cases:ingest / cases:validate / cases:datasheet            (Tasks 5,11,12)
```

---

# PHASE A.1 — Substrate (real searchable corpus lands first)

## Task 1: Schema additions + core-only defaults

**Files:**
- Modify: `src/lib/cases/types.ts`
- Modify: `src/lib/cases/fixtures.ts`
- Modify: `src/lib/cases/query.ts`
- Modify: `src/lib/dynamo/cases-table.ts`
- Test: `scripts/test-cases-query.ts` (extend)

- [ ] **Step 1: Extend the failing test** — append to `scripts/test-cases-query.ts` before the final `console.log`:

```ts
// --- Phase 2-A: corpusTier ---
import { filterCases as fc2 } from "../src/lib/cases/query";
const withSub = [
  ...caseFixtures,
  { ...caseFixtures[0], id: "sub-1", citation: "9999 SCC 1", corpusTier: "substrate" as const,
    themes: [] as never[], outcome: { outcomeType: "unclassified" as const, winType: "unclassified" as const, whoWon: "", holding: "" } },
];
assert.equal(fc2(withSub).length, 4, "default filter is core-only (excludes substrate)");
assert.equal(fc2(withSub, { tier: "substrate" }).length, 1, "tier:substrate returns substrate only");
assert.equal(fc2(withSub, { tier: "core" }).length, 4, "tier:core returns core only");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/test-cases-query.ts`
Expected: FAIL (TS/assertion — `corpusTier` not on type, or default not core-only).

- [ ] **Step 3: Edit `src/lib/cases/types.ts`** — change the two unions, add types, extend `LegalCase` and `CaseFilter`:

```ts
export type OutcomeType = "precedent" | "procedural" | "remand" | "regulatory" | "settlement" | "unclassified";
export type WinType = "doctrine_win" | "party_win" | "mixed" | "loss" | "unclassified";
export type CorpusTier = "substrate" | "core";

export interface ThemeLabelMeta {
  method: "curated" | "dual_llm";
  models?: string[];
  agreement?: "full" | "partial" | "none";
  confidence: "high" | "low";
  needsReview: boolean;
}
```
In `interface LegalCase` add (after `enrichmentLevel`):
```ts
  corpusTier: CorpusTier;
  labelMeta?: ThemeLabelMeta;
```
In `interface CaseFilter` add:
```ts
  tier?: CorpusTier;
```

- [ ] **Step 4: Edit `src/lib/cases/fixtures.ts`** — add `corpusTier: "core",` to each of the 4 case objects (e.g. right after each `enrichmentLevel: ...,` line).

- [ ] **Step 5: Edit `src/lib/cases/query.ts`** — in `filterCases`, add a tier predicate. Replace the `return cases.filter((c) =>` block's first line so the predicate starts with the tier rule:

```ts
export function filterCases(cases: LegalCase[], f?: CaseFilter): LegalCase[] {
  return cases.filter((c) =>
    (f?.tier ? c.corpusTier === f.tier : c.corpusTier === "core") &&  // default: core-only
    (!f?.themes?.length || f.themes.some((t) => c.themes.includes(t))) &&
    (!f?.level || c.level === f.level) &&
    (!f?.winType || c.outcome.winType === f.winType) &&
    (!f?.nation || c.nations.includes(f.nation)) &&
    (f?.yearFrom === undefined || c.year >= f.yearFrom) &&
    (f?.yearTo === undefined || c.year <= f.yearTo));
}
```
(Note: this removes the old `if (!f) return cases` fast-path — core-only must apply even when `f` is undefined.)

- [ ] **Step 6: Edit `src/lib/dynamo/cases-table.ts`** — in `itemToCase`, add the two new fields to the reconstruction (after `enrichmentLevel: d.enrichmentLevel,`):

```ts
    corpusTier: d.corpusTier,
    ...(d.labelMeta !== undefined ? { labelMeta: d.labelMeta } : {}),
```

- [ ] **Step 6b: Make `getActivationSummary` core-only in BOTH repos** (it currently passes the unfiltered set to `buildActivation`, so without this the dashboard would count substrate). `listFacets`/`listCases`/`exportCases` already go through `filterCases` (core-only default), so only `getActivationSummary` needs the fix.

In `src/lib/cases/repo.mock.ts`:
```ts
  async getActivationSummary() {
    return buildActivation(filterCases(caseFixtures, { tier: "core" }));
  },
```
In `src/lib/cases/repo.dynamo.ts`:
```ts
  async getActivationSummary() {
    return buildActivation(filterCases(await scanAll(), { tier: "core" }));
  },
```
(Both already import `filterCases` from `./query`; if `repo.mock.ts` does not, add it to its import.)

- [ ] **Step 7: Run tests + typecheck**

Run: `npx tsx scripts/test-cases-query.ts && npx tsx scripts/test-cases-mock.ts && npx tsx scripts/test-cases-table.ts && npm run typecheck`
Expected: all `✅` (existing count assertions still hold — all 4 fixtures are core), typecheck exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/cases/types.ts src/lib/cases/fixtures.ts src/lib/cases/query.ts src/lib/cases/repo.mock.ts src/lib/cases/repo.dynamo.ts src/lib/dynamo/cases-table.ts scripts/test-cases-query.ts
git commit -m "feat(cases): two-tier schema (corpusTier) + core-only query/activation default"
```

---

## Task 2: Ingestion sources config

**Files:**
- Create: `src/lib/cases/ingest/sources.ts`

- [ ] **Step 1: Create `src/lib/cases/ingest/sources.ts`**

```ts
// The methodology surface: which queries/seeds define the corpus (spec §3).
// Versioned on purpose — changing these changes the corpus boundary.
import type { Theme } from "../types";

export const THEME_QUERIES: Record<Theme, string[]> = {
  land_rights: ["aboriginal title", "land claim"],
  resource_revenue: ["revenue sharing", "resource revenue"],
  duty_to_consult: ["duty to consult", "honour of the crown"],
  treaty: ["treaty rights", "treaty annuity"],
  fiduciary: ["fiduciary duty"],
  self_determination: ["self-government", "self-determination"],
};

// Flagship landmark seeds (fetched directly; promoted to core via enrichment).
export const SEED_CITATIONS: string[] = [
  "2014 SCC 44", "2004 SCC 73", "2004 SCC 74", "2005 SCC 69", "2017 SCC 40",
  "2017 SCC 58", "2014 SCC 48", "2016 SCC 12", "2018 FCA 153",
  "[1973] SCR 313", "[1984] 2 SCR 335", "[1990] 1 SCR 1075", "[1997] 3 SCR 1010",
  "2024 SCC 27",
];

// Known provincial-gap cases to attempt (may be absent from A2AJ → index-level stub).
export const GAP_CITATIONS: string[] = ["2020 ABCA 163"];

// Harvest bounds.
export const DATE_FROM = "1970-01-01";
export const DATE_TO = "2026-12-31";
export const WINDOW_YEARS = 5; // date-window width for paging around the size<=50 cap
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/lib/cases/ingest/sources.ts
git commit -m "feat(cases): ingestion sources (theme queries + seed/gap citations)"
```

---

## Task 3: Deduplication (pure) + test

**Files:**
- Create: `src/lib/cases/ingest/dedup.ts`
- Test: `scripts/test-cases-dedup.ts`

- [ ] **Step 1: Write the failing test `scripts/test-cases-dedup.ts`**

```ts
import assert from "node:assert/strict";
import { normalizeCitation, dedupeByCitation } from "../src/lib/cases/ingest/dedup";
import type { A2ajRecord } from "../src/lib/cases/ingest/a2aj";

const r = (c: string): A2ajRecord => ({ dataset: "SCC", citation_en: c, name_en: "X", document_date_en: "2014-01-01T00:00:00", url_en: "u" });

assert.equal(normalizeCitation(" 2014 SCC 44 "), "2014 scc 44", "normalize trims+lowercases");
// duplicate citation collapses; distinct citations (incl. multi-level) preserved
const out = dedupeByCitation([r("2014 SCC 44"), r("2014 SCC 44"), r("2014 BCCA 1"), r("2013 BCSC 9")]);
assert.equal(out.length, 3, "dup citation collapsed, 3 distinct kept");
assert.deepEqual(out.map((x) => x.citation_en).sort(), ["2013 BCSC 9", "2014 BCCA 1", "2014 SCC 44"]);
console.log("✅ dedup tests passed");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/test-cases-dedup.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/cases/ingest/dedup.ts`**

```ts
// Dedup by neutral citation. Multi-level judgments (trial/appeal/SCC) have DISTINCT
// citations, so they survive — we only collapse exact-citation repeats (spec §QC).
import type { A2ajRecord } from "./a2aj";

export function normalizeCitation(c: string): string {
  return c.trim().replace(/\s+/g, " ").toLowerCase();
}

export function dedupeByCitation(records: A2ajRecord[]): A2ajRecord[] {
  const seen = new Set<string>();
  const out: A2ajRecord[] = [];
  for (const rec of records) {
    const key = normalizeCitation(rec.citation_en);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx tsx scripts/test-cases-dedup.ts && npm run typecheck`
Expected: PASS — `✅ dedup tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/ingest/dedup.ts scripts/test-cases-dedup.ts
git commit -m "feat(cases): citation dedup (pure) + tests"
```

---

## Task 4: A2AJ harvest client (live, cached)

**Files:**
- Create: `src/lib/cases/ingest/harvest.ts`
- Test: `scripts/test-cases-dedup.ts` (extend with the pure window helper)

- [ ] **Step 1: Add a failing test for the pure date-window helper** — append to `scripts/test-cases-dedup.ts` before its `console.log`:

```ts
import { dateWindows } from "../src/lib/cases/ingest/harvest";
const w = dateWindows("2010-01-01", "2019-12-31", 5);
assert.equal(w.length, 2, "10 years / 5-year windows = 2");
assert.deepEqual(w[0], ["2010-01-01", "2014-12-31"]);
assert.deepEqual(w[1], ["2015-01-01", "2019-12-31"]);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-cases-dedup.ts`
Expected: FAIL — `dateWindows` not found.

- [ ] **Step 3: Implement `src/lib/cases/ingest/harvest.ts`**

```ts
// Live A2AJ harvest. /search has size<=50 and no offset, so we page by date windows.
// Raw responses are cached to disk so re-runs are free and offline. NOT unit-tested
// beyond the pure `dateWindows` helper (network is exercised by cases:ingest).
import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchA2aj, type A2ajRecord } from "./a2aj";

const CACHE_DIR = path.join(process.cwd(), "scripts", ".cache", "a2aj");
const SLEEP_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function dateWindows(from: string, to: string, years: number): [string, string][] {
  const out: [string, string][] = [];
  let y = new Date(from).getUTCFullYear();
  const endY = new Date(to).getUTCFullYear();
  while (y <= endY) {
    const wEnd = Math.min(y + years - 1, endY);
    out.push([`${y}-01-01`, `${wEnd}-12-31`]);
    y = wEnd + 1;
  }
  return out;
}

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, key.replace(/[^a-z0-9]+/gi, "_") + ".json");
  try { return JSON.parse(await fs.readFile(file, "utf8")) as T; } catch { /* miss */ }
  const val = await fn();
  await fs.writeFile(file, JSON.stringify(val));
  return val;
}

async function searchWindow(query: string, start: string, end: string): Promise<A2ajRecord[]> {
  return cached(`search_${query}_${start}_${end}`, async () => {
    const url = `https://api.a2aj.ca/search?query=${encodeURIComponent(query)}&search_type=full_text&size=50&start_date=${start}&end_date=${end}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: A2ajRecord[] };
    await sleep(SLEEP_MS);
    return data.results ?? [];
  });
}

export async function harvestQuery(query: string, from: string, to: string, years: number): Promise<A2ajRecord[]> {
  const out: A2ajRecord[] = [];
  for (const [s, e] of dateWindows(from, to, years)) out.push(...(await searchWindow(query, s, e)));
  return out;
}

export async function fetchCitation(citation: string): Promise<A2ajRecord | null> {
  return cached(`fetch_${citation}`, () => fetchA2aj(citation));
}

// Depth-1 forward snowball: pull the cases that cite each kept case.
export async function snowball(records: A2ajRecord[]): Promise<A2ajRecord[]> {
  const cites = new Set<string>();
  for (const r of records) for (const c of r.cases_citing_en ?? []) cites.add(c);
  const out: A2ajRecord[] = [];
  for (const c of cites) { const rec = await fetchCitation(c); if (rec) out.push(rec); }
  return out;
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx tsx scripts/test-cases-dedup.ts && npm run typecheck`
Expected: PASS — `✅ dedup tests passed` (now includes the window assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/ingest/harvest.ts scripts/test-cases-dedup.ts
git commit -m "feat(cases): A2AJ harvest client (date-windowed, cached) + snowball"
```

---

## Task 5: Ingest substrate (script + npm script)

**Files:**
- Create: `scripts/cases-ingest.ts`
- Modify: `package.json`

- [ ] **Step 1: Implement `scripts/cases-ingest.ts` (substrate path only for now)**

```ts
// Live ingestion. PHASE A.1: harvest → dedup → map → upsert as substrate.
// (Inclusion filter + labeling promotion added in Task 9.) Idempotent by CASE#id.
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { toCaseItem } from "../src/lib/dynamo/cases-table";
import { a2ajToCase, type A2ajRecord } from "../src/lib/cases/ingest/a2aj";
import { dedupeByCitation } from "../src/lib/cases/ingest/dedup";
import { harvestQuery, fetchCitation, snowball } from "../src/lib/cases/ingest/harvest";
import { THEME_QUERIES, SEED_CITATIONS, GAP_CITATIONS, DATE_FROM, DATE_TO, WINDOW_YEARS } from "../src/lib/cases/ingest/sources";
import type { LegalCase } from "../src/lib/cases/types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

async function gatherRaw(): Promise<A2ajRecord[]> {
  const all: A2ajRecord[] = [];
  for (const queries of Object.values(THEME_QUERIES))
    for (const q of queries) all.push(...(await harvestQuery(q, DATE_FROM, DATE_TO, WINDOW_YEARS)));
  for (const c of [...SEED_CITATIONS, ...GAP_CITATIONS]) { const r = await fetchCitation(c); if (r) all.push(r); }
  const deduped = dedupeByCitation(all);
  return [...deduped, ...dedupeByCitation(await snowball(deduped))].filter(
    (r, i, a) => a.findIndex((x) => x.citation_en === r.citation_en) === i,
  );
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
```

- [ ] **Step 2: Add npm scripts to `package.json`** (in `"scripts"`, mirroring `cases:seed`):

```json
"cases:ingest": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases tsx scripts/cases-ingest.ts",
"cases:ingest:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases tsx scripts/cases-ingest.ts"
```

- [ ] **Step 3: Live smoke (DynamoDB Local must be up)**

Run: `npm run ddb:up && npm run cases:create && npm run cases:ingest`
Expected: prints `✅ ingested <N> substrate cases` with N in the hundreds–low thousands. (Re-run → same N, no duplicates: idempotent.) `npm run typecheck` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/cases-ingest.ts package.json
git commit -m "feat(cases): ingest A2AJ substrate (harvest+dedup+map+upsert)"
```

---

# PHASE A.2 — Core promotion (inclusion filter + dual-LLM labeling)

## Task 6: Inclusion filter (pure) + PRISMA counts + test

**Files:**
- Create: `src/lib/cases/ingest/include.ts`
- Test: `scripts/test-cases-include.ts`

- [ ] **Step 1: Write the failing test `scripts/test-cases-include.ts`**

```ts
import assert from "node:assert/strict";
import { includeCandidate, emptyPrisma, tallyExclude } from "../src/lib/cases/ingest/include";
import { caseFixtures } from "../src/lib/cases/fixtures";

// a flagship case (has Indigenous nation + economic theme text) is included
const ok = includeCandidate({ ...caseFixtures[0] });
assert.equal(ok.include, true, "Tsilhqot'in included");

// a noise case (no Indigenous + no economic signal) is excluded with a reason
const noise = { ...caseFixtures[0], nations: [] as string[],
  chunks: [{ paragraph: "para-1", text: "A routine tax appeal about GST input credits." }],
  summary: undefined, outcome: { ...caseFixtures[0].outcome, holding: "tax appeal" } };
const ex = includeCandidate(noise);
assert.equal(ex.include, false, "noise excluded");
assert.ok(ex.reason && ex.reason.length > 0, "exclusion has a reason");

// PRISMA tally
const p = emptyPrisma();
tallyExclude(p, "no_indigenous_signal");
assert.equal(p.excluded.no_indigenous_signal, 1);
console.log("✅ include tests passed");
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-cases-include.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/cases/ingest/include.ts`**

```ts
// Transparent inclusion filter (spec §3). A candidate is CORE-eligible only if it
// shows BOTH an Indigenous-party signal AND an economic-justice theme signal in its
// text. Every exclusion carries a documented reason → PRISMA counts. Pure + testable.
import type { LegalCase } from "../types";

const INDIGENOUS = /\b(aboriginal|indigenous|first nation|m[ée]tis|inuit|treaty|band council)\b/i;
const ECONOMIC = /\b(title|duty to consult|resource|royalt|revenue|fiduciary|compensation|annuit|self-government|economic)\b/i;

export interface IncludeResult { include: boolean; reason?: string; }

function caseText(c: LegalCase): string {
  return [c.styleOfCause, c.outcome.holding, ...(c.chunks?.map((x) => x.text) ?? []),
    ...(c.summary?.claims.map((x) => x.text) ?? [])].join(" ");
}

export function includeCandidate(c: LegalCase): IncludeResult {
  const hasNation = c.nations.length > 0;
  const text = caseText(c);
  const indig = hasNation || INDIGENOUS.test(text);
  const econ = c.themes.length > 0 || ECONOMIC.test(text);
  if (!indig) return { include: false, reason: "no_indigenous_signal" };
  if (!econ) return { include: false, reason: "no_economic_theme" };
  return { include: true };
}

export interface PrismaCounts {
  identified: number; deduped: number; screened: number;
  excluded: Record<string, number>; included: number;
}
export const emptyPrisma = (): PrismaCounts => ({ identified: 0, deduped: 0, screened: 0, excluded: {}, included: 0 });
export const tallyExclude = (p: PrismaCounts, reason: string) => { p.excluded[reason] = (p.excluded[reason] ?? 0) + 1; };
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx tsx scripts/test-cases-include.ts && npm run typecheck`
Expected: PASS — `✅ include tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/ingest/include.ts scripts/test-cases-include.ts
git commit -m "feat(cases): transparent inclusion filter + PRISMA counts (pure) + tests"
```

---

## Task 7: Theme rubric + LLM client

**Files:**
- Create: `src/lib/cases/ingest/rubric.ts`
- Create: `src/lib/cases/ingest/llm.ts`

- [ ] **Step 1: Create `src/lib/cases/ingest/rubric.ts`**

```ts
// The labeling rubric IS the methodology — versioned and committed (spec §5).
// Each theme: a one-line inclusion test the LLM applies to the case text.
import type { Theme } from "../types";

export const RUBRIC_VERSION = "2026-06-28.1";

export const THEME_RUBRIC: Record<Theme, string> = {
  land_rights: "The case turns on Aboriginal title or land rights (ownership/possession/use of land).",
  resource_revenue: "The case concerns resource revenue, royalties, or revenue-sharing from resources.",
  duty_to_consult: "The case turns on the Crown's duty to consult/accommodate or the honour of the Crown.",
  treaty: "The case concerns treaty rights, treaty interpretation, or treaty implementation.",
  fiduciary: "The case turns on the Crown's fiduciary duty to Indigenous peoples.",
  self_determination: "The case concerns self-government or the economic dimensions of self-determination.",
};

export const ALL_THEMES = Object.keys(THEME_RUBRIC) as Theme[];

export function labelPrompt(text: string): string {
  const lines = ALL_THEMES.map((t) => `- ${t}: ${THEME_RUBRIC[t]}`).join("\n");
  return `You label Canadian legal cases by economic-justice theme. Apply each test to the case text. ` +
    `Return ONLY a JSON array of the matching theme keys (zero or more), no prose.\n\nThemes:\n${lines}\n\n` +
    `Case text:\n"""${text.slice(0, 6000)}"""`;
}
```

- [ ] **Step 2: Create `src/lib/cases/ingest/llm.ts`**

```ts
// Provider-agnostic LLM client for theme labeling. Two model families are configured
// via env (server-side only). Responses cached by content hash so re-runs are free and
// the labeler is offline-replayable. Never used in unit tests (live calls only).
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Theme } from "../types";
import { ALL_THEMES } from "./rubric";

const CACHE = path.join(process.cwd(), "scripts", ".cache", "llm");

export interface LlmModel { id: string; call: (prompt: string) => Promise<string>; }

// Configure the two families from env. Implement `call` against your provider
// (e.g. Bedrock Claude + a non-Anthropic family). Throw if keys are missing.
export function configuredModels(): LlmModel[] {
  const ids = (process.env.LABEL_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length < 2) throw new Error("Set LABEL_MODELS to two comma-separated model ids (different families).");
  return ids.map((id) => ({ id, call: (p) => callProvider(id, p) }));
}

async function callProvider(modelId: string, prompt: string): Promise<string> {
  // Provider wiring lives here (Bedrock InvokeModel / OpenAI / etc.), keyed by modelId
  // prefix. Kept thin and out of tests. Implementers fill the HTTP/SDK call.
  throw new Error(`callProvider not configured for ${modelId}`);
}

async function cachedCall(m: LlmModel, prompt: string): Promise<string> {
  await fs.mkdir(CACHE, { recursive: true });
  const key = createHash("sha256").update(m.id + "\n" + prompt).digest("hex").slice(0, 32);
  const file = path.join(CACHE, key + ".txt");
  try { return await fs.readFile(file, "utf8"); } catch { /* miss */ }
  const out = await m.call(prompt);
  await fs.writeFile(file, out);
  return out;
}

export function parseThemes(raw: string): Theme[] {
  try {
    const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
    return (Array.isArray(arr) ? arr : []).filter((t): t is Theme => ALL_THEMES.includes(t));
  } catch { return []; }
}

export async function labelWithModel(m: LlmModel, prompt: string): Promise<Theme[]> {
  return parseThemes(await cachedCall(m, prompt));
}
```

- [ ] **Step 3: Document env in `.env.local.example`** — append:

```
# Phase 2-A dual-LLM theme labeling (server-side only; two DIFFERENT model families)
LABEL_MODELS=anthropic.claude-3-5-sonnet,<second-family-model-id>
```

- [ ] **Step 4: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/lib/cases/ingest/rubric.ts src/lib/cases/ingest/llm.ts .env.local.example
git commit -m "feat(cases): theme rubric + provider-agnostic dual-LLM client (cached)"
```

---

## Task 8: Dual-LLM label merge (pure) + test

**Files:**
- Create: `src/lib/cases/ingest/labeler.ts`
- Test: `scripts/test-cases-labelmerge.ts`

- [ ] **Step 1: Write the failing test `scripts/test-cases-labelmerge.ts`**

```ts
import assert from "node:assert/strict";
import { mergeLabels } from "../src/lib/cases/ingest/labeler";
import type { Theme } from "../src/lib/cases/types";

const M: [string, string] = ["m1", "m2"];
const full = mergeLabels(["land_rights", "treaty"] as Theme[], ["treaty", "land_rights"] as Theme[], M);
assert.deepEqual(full.themes.sort(), ["land_rights", "treaty"]);
assert.equal(full.labelMeta.agreement, "full");
assert.equal(full.labelMeta.confidence, "high");
assert.equal(full.labelMeta.needsReview, false);

const partial = mergeLabels(["land_rights", "treaty"] as Theme[], ["land_rights"] as Theme[], M);
assert.deepEqual(partial.themes, ["land_rights"], "only agreed labels become themes");
assert.equal(partial.labelMeta.agreement, "partial");
assert.equal(partial.labelMeta.confidence, "low");
assert.equal(partial.labelMeta.needsReview, true);

const none = mergeLabels([] as Theme[], ["treaty"] as Theme[], M);
assert.deepEqual(none.themes, []);
assert.equal(none.labelMeta.agreement, "none");
assert.equal(none.labelMeta.needsReview, true);
console.log("✅ labelmerge tests passed");
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-cases-labelmerge.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/cases/ingest/labeler.ts`**

```ts
// Dual-LLM merge (spec §5): only labels BOTH models agree on become themes.
// Inter-model agreement is a CONSISTENCY signal, not accuracy (§6 validates accuracy).
import type { Theme, ThemeLabelMeta } from "../types";
import { configuredModels, labelWithModel } from "./llm";
import { labelPrompt } from "./rubric";

export function mergeLabels(a: Theme[], b: Theme[], models: [string, string]): { themes: Theme[]; labelMeta: ThemeLabelMeta } {
  const sa = new Set(a), sb = new Set(b);
  const inter = [...sa].filter((t) => sb.has(t));
  const union = new Set([...a, ...b]);
  const agreement: ThemeLabelMeta["agreement"] =
    union.size === 0 ? "none" : inter.length === union.size ? "full" : inter.length > 0 ? "partial" : "none";
  const confidence = agreement === "full" ? "high" : "low";
  return {
    themes: inter,
    labelMeta: { method: "dual_llm", models, agreement, confidence, needsReview: agreement !== "full" },
  };
}

// Orchestration (live): label one case's text with both models, then merge.
export async function labelCase(text: string): Promise<{ themes: Theme[]; labelMeta: ThemeLabelMeta }> {
  const [m1, m2] = configuredModels();
  const prompt = labelPrompt(text);
  const [a, b] = await Promise.all([labelWithModel(m1, prompt), labelWithModel(m2, prompt)]);
  return mergeLabels(a, b, [m1.id, m2.id]);
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx tsx scripts/test-cases-labelmerge.ts && npm run typecheck`
Expected: PASS — `✅ labelmerge tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/ingest/labeler.ts scripts/test-cases-labelmerge.ts
git commit -m "feat(cases): dual-LLM label merge (pure) + orchestration + tests"
```

---

## Task 9: Wire core promotion into cases-ingest

**Files:**
- Modify: `scripts/cases-ingest.ts`

- [ ] **Step 1: Edit `scripts/cases-ingest.ts`** — add imports at top:

```ts
import { includeCandidate, emptyPrisma, tallyExclude } from "../src/lib/cases/ingest/include";
import { labelCase } from "../src/lib/cases/ingest/labeler";
import { enrichment } from "../src/lib/cases/enrichment";
import type { Theme } from "../src/lib/cases/types";
import { promises as fs } from "node:fs";
```

- [ ] **Step 2: Replace the body of `ingest()`** with the substrate→core promotion flow:

```ts
export async function ingest() {
  const raw = await gatherRaw();
  const prisma = emptyPrisma();
  prisma.identified = raw.length;
  prisma.deduped = raw.length; // gatherRaw already dedupes

  const substrate: LegalCase[] = raw.map((r) => ({ ...a2ajToCase(r), corpusTier: "substrate" }));
  await upsert(substrate);

  const core: LegalCase[] = [];
  for (const c of substrate) {
    prisma.screened++;
    const verdict = includeCandidate(c);
    if (!verdict.include) { tallyExclude(prisma, verdict.reason ?? "unknown"); continue; }
    const enr = enrichment[c.citation];
    if (enr) {
      core.push({ ...c, ...enr, corpusTier: "core", enrichmentLevel: "deep",
        labelMeta: { method: "curated", confidence: "high", needsReview: false } });
    } else {
      const text = [c.styleOfCause, ...(c.chunks?.map((x) => x.text) ?? [])].join(" ");
      const { themes, labelMeta } = await labelCase(text);
      core.push({ ...c, themes: themes as Theme[], corpusTier: "core", labelMeta });
    }
    prisma.included++;
  }
  await upsert(core);
  await fs.writeFile("scripts/.cache/prisma.json", JSON.stringify(prisma, null, 2));
  console.log(`✅ substrate ${substrate.length} · core ${core.length} · excluded ${substrate.length - core.length}`);
  console.log("PRISMA:", JSON.stringify(prisma.excluded));
}
```

- [ ] **Step 3: Live smoke** (DynamoDB Local up; `LABEL_MODELS` set, or expect the curated/flagship subset to still promote and non-flagship to error on missing models — for a keys-free smoke, temporarily set `SEED_CITATIONS` only by running with an empty `THEME_QUERIES`… simplest: run with `LABEL_MODELS` configured).

Run: `npm run cases:ingest`
Expected: prints `✅ substrate <N> · core <M> · excluded <N-M>` and a PRISMA breakdown; `scripts/.cache/prisma.json` written. Re-run is idempotent.

- [ ] **Step 4: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add scripts/cases-ingest.ts
git commit -m "feat(cases): promote substrate→core via inclusion filter + dual-LLM labeling + PRISMA"
```

---

# PHASE A.3 — Validation + datasheet

## Task 10: Metric functions (pure) + test

**Files:**
- Create: `src/lib/cases/validate/metrics.ts`
- Test: `scripts/test-cases-metrics.ts`

- [ ] **Step 1: Write the failing test `scripts/test-cases-metrics.ts`**

```ts
import assert from "node:assert/strict";
import { prf1, cohenKappa, pabak, wilsonInterval } from "../src/lib/cases/validate/metrics";

const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

const m = prf1(2, 1, 1); close(m.precision, 2 / 3); close(m.recall, 2 / 3); close(m.f1, 2 / 3);

// textbook: a=[y,y,n,n] b=[y,n,n,n] → po=.75, pe=.5, kappa=.5
const k = cohenKappa(["y", "y", "n", "n"], ["y", "n", "n", "n"]); close(k, 0.5);

close(pabak(0.75), 0.5); // 2*po-1

const w = wilsonInterval(192, 384); close(w.p, 0.5); close(w.lower, 0.4502, 2e-3); close(w.upper, 0.5498, 2e-3);
console.log("✅ metrics tests passed");
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-cases-metrics.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/cases/validate/metrics.ts`**

```ts
// Pure metric functions (spec §6). All deterministic; unit-tested against textbook values.
export function prf1(tp: number, fp: number, fn: number) {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

// Cohen's kappa for two raters over paired categorical labels.
export function cohenKappa(a: string[], b: string[]): number {
  const n = a.length;
  if (n === 0 || n !== b.length) return 0;
  let agree = 0;
  const ca: Record<string, number> = {}, cb: Record<string, number> = {};
  for (let i = 0; i < n; i++) { if (a[i] === b[i]) agree++; ca[a[i]] = (ca[a[i]] ?? 0) + 1; cb[b[i]] = (cb[b[i]] ?? 0) + 1; }
  const po = agree / n;
  let pe = 0;
  for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) pe += ((ca[k] ?? 0) / n) * ((cb[k] ?? 0) / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

export const pabak = (po: number): number => 2 * po - 1;

export function wilsonInterval(successes: number, n: number, z = 1.96) {
  const p = n === 0 ? 0 : successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
  return { p, lower: center - margin, upper: center + margin };
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx tsx scripts/test-cases-metrics.ts && npm run typecheck`
Expected: PASS — `✅ metrics tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/validate/metrics.ts scripts/test-cases-metrics.ts
git commit -m "feat(cases): validation metrics (prf1/kappa/pabak/Wilson, pure) + tests"
```

---

## Task 11: Validation harness (script + npm script)

**Files:**
- Create: `scripts/cases-validate.ts`
- Modify: `package.json`

- [ ] **Step 1: Implement `scripts/cases-validate.ts`**

```ts
// Consumes a human double-coded gold file and reports accuracy (spec §6). Honest
// degradation: if the gold file is absent, prints "unvalidated" and exits 0.
import { promises as fs } from "node:fs";
import { prf1, cohenKappa, pabak, wilsonInterval } from "../src/lib/cases/validate/metrics";
import { ALL_THEMES } from "../src/lib/cases/ingest/rubric";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import type { Theme } from "../src/lib/cases/types";

const GOLD = "docs/research/gold/cases-gold.jsonl";
interface Gold { citation: string; includedTrue: boolean; themesCoderA: Theme[]; themesCoderB: Theme[]; }

async function main() {
  let lines: string[];
  try { lines = (await fs.readFile(GOLD, "utf8")).trim().split(/\n+/).filter(Boolean); }
  catch { console.log("ℹ️  no gold sample — accuracy UNVALIDATED (exploratory corpus)."); return; }
  const gold = lines.map((l) => JSON.parse(l) as Gold);

  // inter-coder reliability per theme (binary present/absent), averaged
  let kSum = 0, poSum = 0;
  for (const t of ALL_THEMES) {
    const a = gold.map((g) => (g.themesCoderA.includes(t) ? "1" : "0"));
    const b = gold.map((g) => (g.themesCoderB.includes(t) ? "1" : "0"));
    kSum += cohenKappa(a, b);
    poSum += a.filter((x, i) => x === b[i]).length / a.length;
  }
  console.log(`inter-coder mean kappa=${(kSum / ALL_THEMES.length).toFixed(3)} PABAK=${pabak(poSum / ALL_THEMES.length).toFixed(3)}`);

  // labeling accuracy: machine themes vs human consensus (both coders agree)
  let TP = 0, FP = 0, FN = 0, offTopic = 0;
  for (const g of gold) {
    const consensus = new Set(g.themesCoderA.filter((t) => g.themesCoderB.includes(t)));
    const machine = (await dynamoCaseRepo.getCase(g.citation.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")))?.themes ?? [];
    for (const t of machine) (consensus.has(t) ? TP++ : FP++);
    for (const t of consensus) if (!machine.includes(t)) FN++;
    if (!g.includedTrue) offTopic++;
  }
  const m = prf1(TP, FP, FN);
  console.log(`theme labels: P=${m.precision.toFixed(2)} R=${m.recall.toFixed(2)} F1=${m.f1.toFixed(2)}`);
  const w = wilsonInterval(offTopic, gold.length);
  console.log(`corpus off-topic rate=${(w.p * 100).toFixed(1)}% (Wilson 95% CI [${(w.lower * 100).toFixed(1)}%, ${(w.upper * 100).toFixed(1)}%], n=${gold.length})`);
}
main().catch((e) => { console.error("❌ cases-validate failed:", e); process.exit(1); });
```

- [ ] **Step 2: Add npm script** to `package.json`:

```json
"cases:validate": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-validate.ts"
```

- [ ] **Step 3: Smoke (no gold file yet → honest degradation)**

Run: `npm run cases:validate`
Expected: prints `ℹ️  no gold sample — accuracy UNVALIDATED (exploratory corpus).` and exits 0. (When the team adds `docs/research/gold/cases-gold.jsonl`, it prints kappa/PABAK, per-theme P/R/F1, and the Wilson CI.)

- [ ] **Step 4: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add scripts/cases-validate.ts package.json
git commit -m "feat(cases): gold-sample validation harness (kappa/F1/Wilson) with honest degradation"
```

---

## Task 12: Datasheet generator (script + npm script)

**Files:**
- Create: `scripts/cases-datasheet.ts`
- Modify: `package.json`

- [ ] **Step 1: Implement `scripts/cases-datasheet.ts`**

```ts
// Emits a Datasheets-for-Datasets datasheet from the current corpus + PRISMA log (spec §7).
import { promises as fs } from "node:fs";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { RUBRIC_VERSION } from "../src/lib/cases/ingest/rubric";
import { THEME_QUERIES, SEED_CITATIONS, DATE_FROM, DATE_TO } from "../src/lib/cases/ingest/sources";

async function main() {
  const core = await dynamoCaseRepo.listCases();                       // core-only
  const sub = await dynamoCaseRepo.listCases({ tier: "substrate" });
  let prisma = "{}"; try { prisma = await fs.readFile("scripts/.cache/prisma.json", "utf8"); } catch {}
  const byTheme: Record<string, number> = {};
  for (const c of core) for (const t of c.themes) byTheme[t] = (byTheme[t] ?? 0) + 1;
  const needsReview = core.filter((c) => c.labelMeta?.needsReview).length;

  const md = `# Datasheet — Indigenomics Economic Justice Legal Cases Corpus

_Generated ${new Date().toISOString().slice(0, 10)} · rubric ${RUBRIC_VERSION}_

## Motivation
Indigenous economic-justice case law made searchable + analytically actionable (Focus Area 2).

## Composition
- Core (curated, labeled): **${core.length}** · Substrate (full-text, RAG): **${sub.length}**
- By theme (core): ${JSON.stringify(byTheme)}
- Core cases flagged needs-review (LLM disagreement): **${needsReview}**

## Collection process
- Frame: **A2AJ** (api.a2aj.ca). Theme queries: ${JSON.stringify(THEME_QUERIES)}. Seeds: ${SEED_CITATIONS.length}. Window: ${DATE_FROM}–${DATE_TO}. Depth-1 forward snowball.
- PRISMA counts: ${prisma}

## ⚠️ Coverage ceiling (limitations)
A2AJ **does not scrape CanLII** and is **federal-court-skewed**; this corpus is an A2AJ-bounded slice, **not** all Canadian Indigenous economic-justice case law. Much provincial-court litigation is absent. Texts are unofficial automated copies.

## Labeling
- Themes: dual-LLM cross-labeling (only agreed labels kept; disagreements → needs-review). Inter-LLM agreement = consistency, not accuracy.
- Outcomes: only curated/flagship cases carry a real winType; others are "unclassified" (never auto-faked).

## Validation
Run \`npm run cases:validate\` against a human gold sample for per-theme P/R/F1, inter-coder kappa/PABAK, and corpus-purity Wilson CI. Absent a gold file, the corpus is **exploratory / unvalidated**.

## Uses / Distribution / Maintenance
Internal demo + analytics. Respect each record's \`upstreamLicense\` (many non-commercial). Re-run \`cases:ingest\` to refresh (idempotent).
`;
  await fs.mkdir("docs/research", { recursive: true });
  await fs.writeFile("docs/research/cases-datasheet.md", md);
  console.log("✅ wrote docs/research/cases-datasheet.md");
}
main().catch((e) => { console.error("❌ cases-datasheet failed:", e); process.exit(1); });
```

- [ ] **Step 2: Add npm script** to `package.json`:

```json
"cases:datasheet": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-datasheet.ts"
```

- [ ] **Step 3: Smoke + commit**

Run: `npm run cases:datasheet` → expect `✅ wrote docs/research/cases-datasheet.md`; open it to confirm it renders. `npm run typecheck` → exit 0.
```bash
git add scripts/cases-datasheet.ts package.json docs/research/cases-datasheet.md
git commit -m "feat(cases): datasheet generator (Datasheets-for-Datasets + PRISMA + coverage ceiling)"
```

---

## Task 13: Verify harness — tier + unclassified flow

**Files:**
- Modify: `scripts/verify.ts`

- [ ] **Step 1: Add cases-tier checks to `scripts/verify.ts`** — in `main()`, after the existing `# 4. cases` block, add:

```ts
  // ---- Cases Phase 2-A: tier + unclassified flow ----
  const { toCaseItem } = await import("../src/lib/dynamo/cases-table");
  const subItem = toCaseItem({
    ...(await mockCaseRepo.getCase("haida-2004"))!,
    id: "verify-substrate", citation: "9999 SCC 9", corpusTier: "substrate",
    themes: [], outcome: { outcomeType: "unclassified", winType: "unclassified", whoWon: "", holding: "" },
  });
  await ddbDoc.send(new (await import("@aws-sdk/lib-dynamodb")).PutCommand({ TableName: "LegalCases", Item: subItem }));
  const coreList = await dynamoCaseRepo.listCases();                    // default core-only
  const subList = await dynamoCaseRepo.listCases({ tier: "substrate" });
  check("cases: listCases excludes substrate", coreList.every((c) => c.corpusTier === "core"));
  check("cases: tier:substrate returns substrate", subList.some((c) => c.id === "verify-substrate"));
  check("cases: substrate round-trips unclassified",
    (await dynamoCaseRepo.getCase("verify-substrate"))?.outcome.winType === "unclassified");
```

- [ ] **Step 2: Run the full verify**

Run: `npm run ddb:up && npm run verify`
Expected: all prior checks still green PLUS the 3 new `cases:` tier checks; final summary 0 failures.

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add scripts/verify.ts
git commit -m "test(cases): verify tier filtering + unclassified round-trip"
```

---

## Final verification

- [ ] **Unit suite (offline):** `npx tsx scripts/test-cases-query.ts && npx tsx scripts/test-cases-dedup.ts && npx tsx scripts/test-cases-include.ts && npx tsx scripts/test-cases-labelmerge.ts && npx tsx scripts/test-cases-metrics.ts` → all `✅`.
- [ ] **Regression:** `npm run verify` → all green (Phase 1 + survey + portal + new tier checks), 0 failures.
- [ ] **Typecheck:** `npm run typecheck` → exit 0.
- [ ] **Live pipeline (DynamoDB Local up, `LABEL_MODELS` set):** `npm run cases:create && npm run cases:ingest && npm run cases:datasheet` → substrate in the hundreds–low-thousands, a core subset, a generated datasheet. `npm run cases:validate` → "unvalidated" until a gold file is added.
- [ ] **Dashboard sanity:** `REPO_IMPL=dynamo npm run dev` → `/cases` and `/cases/activation` now show the real **core** corpus (substrate excluded from counts).

## Notes for the implementer
- The provider wiring in `ingest/llm.ts` `callProvider` is the one place needing real API code (Bedrock/OpenAI per `LABEL_MODELS`); everything else is testable offline. Without `LABEL_MODELS`, the flagship/curated cases still promote to core (they use `enrichment.ts`, not the LLM); only non-flagship labeling needs the keys.
- Never import `repo.dynamo`/`ingest/*` from React pages — pages stay on `@/lib/cases`.
- `corpusTier` is now a required `LegalCase` field — the `itemToCase` maintainer note (Task 1, Step 6) keeps round-trip honest.
- Human gold labeling (`docs/research/gold/cases-gold.jsonl`) is the one manual input; the harness is ready for it.
