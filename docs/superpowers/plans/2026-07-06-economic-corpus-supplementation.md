# Economic Corpus Supplementation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the thin economic dimension of the legal-cases corpus (`resource_revenue` only 14/~373 core) by broadening the economic harvest surface and widening the label rubric, then re-running the existing pipeline — with zero dollar-figure fabrication.

**Architecture:** Two versioned-methodology edits (`sources.ts` queries + candidate seeds; `rubric.ts` widened `resource_revenue` definition) plus one new **additive-safe** harvest script that writes only *new* substrate PROFILEs via a conditional `PutItem`, never overwriting existing full-texted/promoted cases. New substrate is promoted by the unchanged pipeline (`cases:fetch-fulltext → cases:embed → cases:index-build`) in a post-merge credentialed run.

**Tech Stack:** TypeScript, `tsx`, AWS SDK v3 (`@aws-sdk/lib-dynamodb`), DynamoDB single-table (`LegalCases`), `node:assert/strict` tests run via `npx tsx`.

---

### Task 1: Expand the economic harvest surface (`sources.ts`)

**Files:**
- Modify: `src/lib/cases/ingest/sources.ts`
- Test: `scripts/test-cases-economic-supplement.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-economic-supplement.ts`:

```ts
// Economic corpus supplementation (spec 2026-07-06): sources + rubric + additive-safe upsert.
import assert from "node:assert/strict";

(async () => {
  // --- Task 1: expanded economic harvest surface ---
  const { THEME_QUERIES, ECON_CANDIDATE_SEEDS } = await import("../src/lib/cases/ingest/sources");
  const rr = THEME_QUERIES.resource_revenue;
  const expectedTerms = [
    "revenue sharing", "resource revenue", "impact benefit agreement",
    "resource royalties", "equity stake", "equitable compensation",
    "expropriation compensation", "economic loss",
  ];
  assert.equal(rr.length, expectedTerms.length, "resource_revenue should have 8 query terms");
  for (const term of expectedTerms) assert.ok(rr.includes(term), `missing query term: ${term}`);
  assert.ok(Array.isArray(ECON_CANDIDATE_SEEDS) && ECON_CANDIDATE_SEEDS.length >= 4, "need >=4 candidate seeds");
  for (const c of ECON_CANDIDATE_SEEDS) assert.match(c, /\d{4}\s+[A-Z]/, `malformed citation: ${c}`);

  console.log("✅ test-cases-economic-supplement passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/chntw/Documents/7980/demo && npx tsx scripts/test-cases-economic-supplement.ts`
Expected: FAIL — `resource_revenue should have 8 query terms` (currently 2) and/or `ECON_CANDIDATE_SEEDS` is not exported.

- [ ] **Step 3: Expand queries and add candidate seeds**

In `src/lib/cases/ingest/sources.ts`, replace the `resource_revenue` line inside `THEME_QUERIES`:

```ts
  resource_revenue: [
    "revenue sharing", "resource revenue", "impact benefit agreement",
    "resource royalties", "equity stake", "equitable compensation",
    "expropriation compensation", "economic loss",
  ],
```

Then add this new export immediately after the `SEED_CITATIONS` block (before `GAP_CITATIONS`):

```ts
// CANDIDATE economic seeds — pending Kay/expert validation. Fetched like any
// harvested case (deliberately NOT added to enrichment.ts, so they carry no
// curated authority); subject to the inclusion filter + dual-LLM consensus gate
// like everything else. A candidate that does not earn cross-model consensus
// stays substrate. Neutral citations verified against public court records
// (CanLII / SCC) on 2026-07-06.
export const ECON_CANDIDATE_SEEDS: string[] = [
  "2009 SCC 9",     // Ermineskin Indian Band and Nation v. Canada — oil/gas royalties
  "2021 SCC 28",    // Southwind v. Canada — equitable compensation for taken/flooded reserve land
  "2001 SCC 85",    // Osoyoos Indian Band v. Oliver (Town) — reserve land taken for canal; expropriation/tax
  "2007 ONCA 744",  // Whitefish Lake Band of Indians v. Canada (AG) — equitable compensation, undervalued timber lease
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/chntw/Documents/7980/demo && npx tsx scripts/test-cases-economic-supplement.ts`
Expected: PASS — `✅ test-cases-economic-supplement passed`

- [ ] **Step 5: Commit**

```bash
cd /c/Users/chntw/Documents/7980/demo
git add src/lib/cases/ingest/sources.ts scripts/test-cases-economic-supplement.ts
git commit -m "feat(cases): expand economic harvest queries + candidate seeds"
```

---

### Task 2: Widen the `resource_revenue` label rubric (`rubric.ts`)

**Files:**
- Modify: `src/lib/cases/ingest/rubric.ts`
- Test: `scripts/test-cases-economic-supplement.ts` (extend)

- [ ] **Step 1: Write the failing test**

In `scripts/test-cases-economic-supplement.ts`, add these lines immediately before the final `console.log("✅ ...")`:

```ts
  // --- Task 2: widened resource_revenue rubric ---
  const { RUBRIC_VERSION, THEME_RUBRIC, labelPrompt } = await import("../src/lib/cases/ingest/rubric");
  assert.equal(RUBRIC_VERSION, "2026-07-06.1", "RUBRIC_VERSION must be bumped");
  assert.match(THEME_RUBRIC.resource_revenue, /impact-benefit/, "rubric must mention impact-benefit agreements");
  assert.match(THEME_RUBRIC.resource_revenue, /expropriation|taking/, "rubric must mention taking/expropriation");
  assert.match(labelPrompt("hello"), /impact-benefit/, "widened rubric must reach the label prompt");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/chntw/Documents/7980/demo && npx tsx scripts/test-cases-economic-supplement.ts`
Expected: FAIL — `RUBRIC_VERSION must be bumped` (currently `2026-06-28.1`).

- [ ] **Step 3: Widen the rubric and bump the version**

In `src/lib/cases/ingest/rubric.ts`, change `RUBRIC_VERSION`:

```ts
export const RUBRIC_VERSION = "2026-07-06.1";
```

And replace the `resource_revenue` entry in `THEME_RUBRIC`:

```ts
  resource_revenue:
    "The case concerns the economic dimension of Indigenous land or resource " +
    "interests — resource revenue, royalties, or revenue-sharing; impact-benefit " +
    "agreements or equity participation; or compensation, damages, or valuation " +
    "for the taking, expropriation, flooding, or infringement of reserve land or " +
    "resource rights.",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/chntw/Documents/7980/demo && npx tsx scripts/test-cases-economic-supplement.ts`
Expected: PASS — `✅ test-cases-economic-supplement passed`

- [ ] **Step 5: Commit**

```bash
cd /c/Users/chntw/Documents/7980/demo
git add src/lib/cases/ingest/rubric.ts scripts/test-cases-economic-supplement.ts
git commit -m "feat(cases): widen resource_revenue rubric to include IBAs, equity, compensation-for-taking"
```

---

### Task 3: Additive-safe economic harvest script (`cases-harvest-economic.ts`)

**Files:**
- Create: `scripts/cases-harvest-economic.ts`
- Modify: `package.json` (add two npm scripts)
- Test: `scripts/test-cases-economic-supplement.ts` (extend)

- [ ] **Step 1: Write the failing test**

In `scripts/test-cases-economic-supplement.ts`, add these lines immediately before the final `console.log("✅ ...")`:

```ts
  // --- Task 3: additive-safe upsert ---
  const { upsertIfAbsent } = await import("./cases-harvest-economic");
  type LC = import("../src/lib/cases/types").LegalCase;
  const mkCase = (id: string): LC => ({
    id, citation: id, styleOfCause: id, court: "SCC", level: "scc", year: 2010,
    jurisdiction: "CA", nations: [], themes: [],
    outcome: { outcomeType: "precedent", winType: "doctrine_win", whoWon: "", holding: "" },
    casesCited: [], casesCiting: [], citingCount: 0, enrichmentLevel: "index", corpusTier: "substrate",
    fullTextAvailable: false,
    provenance: { source: "a2aj", sourceUrl: "u", upstreamLicense: "open", ingestedAt: "2026", unofficial: true },
  });

  const calls: any[] = [];
  const stub = async (cmd: any) => {
    calls.push(cmd);
    if (cmd.input.Item.PK === "CASE#present") {
      const e: any = new Error("exists"); e.name = "ConditionalCheckFailedException"; throw e;
    }
    return {};
  };
  const res = await upsertIfAbsent([mkCase("present"), mkCase("absent")], stub);
  assert.deepEqual(res, { added: 1, skipped: 1 }, "existing PROFILE is skipped, absent one is written");
  assert.equal(calls[0].input.ConditionExpression, "attribute_not_exists(PK)", "write must be conditional");
  assert.equal(calls[0].input.Item.SK, "PROFILE", "writes the PROFILE item");

  let threw = false;
  try {
    await upsertIfAbsent([mkCase("absent")], async () => {
      const e: any = new Error("throughput"); e.name = "ProvisionedThroughputExceededException"; throw e;
    });
  } catch { threw = true; }
  assert.ok(threw, "a non-conditional error must propagate, not be swallowed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/chntw/Documents/7980/demo && npx tsx scripts/test-cases-economic-supplement.ts`
Expected: FAIL — cannot resolve module `./cases-harvest-economic` (not created yet).

- [ ] **Step 3: Create the harvest script**

Create `scripts/cases-harvest-economic.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/chntw/Documents/7980/demo && npx tsx scripts/test-cases-economic-supplement.ts`
Expected: PASS — `✅ test-cases-economic-supplement passed`

- [ ] **Step 5: Add npm scripts**

In `package.json`, add these two lines to `"scripts"` immediately after the `"cases:ingest:cloud"` line:

```json
    "cases:harvest-economic": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases tsx scripts/cases-harvest-economic.ts",
    "cases:harvest-economic:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases tsx scripts/cases-harvest-economic.ts",
```

- [ ] **Step 6: Verify types compile**

Run: `cd /c/Users/chntw/Documents/7980/demo && npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/chntw/Documents/7980/demo
git add scripts/cases-harvest-economic.ts scripts/test-cases-economic-supplement.ts package.json
git commit -m "feat(cases): additive-safe economic harvest script (conditional upsert)"
```

---

### Task 4: Methodology note + final offline gate

**Files:**
- Modify: `docs/research/2026-06-28-legal-corpus-construction-methodology.md`

- [ ] **Step 1: Append the candidate-methodology note**

Append this section to the end of `docs/research/2026-06-28-legal-corpus-construction-methodology.md`:

```markdown

## Economic supplementation (2026-07-06) — candidate methodology, pending expert (Kay) validation

To raise the thin economic dimension (`resource_revenue` was 14/~373 core), the
economic harvest surface and label rubric were broadened. **These additions are
candidate methodology awaiting expert validation; they carry no curated
authority.**

- **`THEME_QUERIES.resource_revenue`** expanded from 2 to 8 terms: `revenue sharing`,
  `resource revenue`, `impact benefit agreement`, `resource royalties`,
  `equity stake`, `equitable compensation`, `expropriation compensation`,
  `economic loss`.
- **`ECON_CANDIDATE_SEEDS`** (new, separate from curated `SEED_CITATIONS`):
  `2009 SCC 9` (Ermineskin — oil/gas royalties), `2021 SCC 28` (Southwind —
  equitable compensation for taken land), `2001 SCC 85` (Osoyoos — expropriation/
  tax), `2007 ONCA 744` (Whitefish — undervalued timber lease). Neutral citations
  verified against public court records on 2026-07-06. Not added to `enrichment.ts`;
  they pass through the inclusion filter + dual-LLM consensus gate like any
  harvested case.
- **`THEME_RUBRIC.resource_revenue`** widened (`RUBRIC_VERSION` → `2026-07-06.1`)
  to recognize impact-benefit agreements, equity participation, and compensation/
  valuation for the taking, expropriation, flooding, or infringement of land and
  resource rights. The dual-LLM consensus gate is unchanged, so the wider rubric
  only proposes more matches — both models must still agree.
- **No dollar figures were fabricated.** Monetary `EconomicDimension` values remain
  curated-only; figure estimation is deferred to client idea #3.
```

- [ ] **Step 2: Run the full offline gate**

Run: `cd /c/Users/chntw/Documents/7980/demo && npx tsx scripts/test-cases-economic-supplement.ts && npx tsc --noEmit && npm run build`
Expected: test prints `✅ test-cases-economic-supplement passed`; `tsc` exit 0; `next build` completes successfully.

> Do NOT run `npm run verify` — it factory-resets the local corpus.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/chntw/Documents/7980/demo
git add docs/research/2026-06-28-legal-corpus-construction-methodology.md
git commit -m "docs(cases): record economic supplementation as candidate methodology (pending validation)"
```

---

## Post-merge operational run (credentialed — NOT part of code tasks)

After the branch is merged, run against the cloud table with temporary SSO creds
(`AWS_REGION=us-east-1 CASES_TABLE=LegalCases INDEX_BUCKET=indigenomics-portal-production-casesindexbucket-bbdveozx`),
from `/c/Users/chntw/Documents/7980/demo`:

1. `npm run cases:harvest-economic:cloud` — additive substrate (reports new-substrate / already-present).
2. `npm run cases:fetch-fulltext` (cloud env) — fetch + inline promote against the widened rubric.
3. `npm run cases:embed:bedrock:cloud` — embed the new chunks.
4. `INDEX_BUCKET=… npm run cases:index-build:cloud` — rebuild + upload the artifact (pass `INDEX_BUCKET` explicitly; the npm script does not set it).
5. `npm run cases:datasheet` (cloud env) — refresh counts.

**Measure and record in a Result section of the spec:** `resource_revenue` core
count (from 14), net new economic core cases, how many candidates passed the
consensus gate vs. stayed substrate, and confirmation that no monetary figure was
fabricated (activation economic aggregate unchanged).
```
