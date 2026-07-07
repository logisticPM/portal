# Economic Corpus Supplementation (client idea #1 lever) — Design

**Date:** 2026-07-06 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases/ingest` + `scripts`

## Motivation

The client thesis is Indigenous **economic** justice, yet the economic dimension is
the thinnest part of the corpus: `resource_revenue` carries only **14 of ~373**
core cases, and curated `EconomicDimension`/`ValueRealization` fields exist on
only ~4 flagship cases. The hub is broad but shallow exactly where it most needs
depth.

Two root causes, both in the versioned methodology surface:

1. **Harvest is too narrow.** `THEME_QUERIES.resource_revenue` has only two terms
   (`"revenue sharing"`, `"resource revenue"`), so few genuinely economic cases
   ever enter the substrate to be labeled.
2. **The label rubric is too narrow.** `THEME_RUBRIC.resource_revenue` reads
   "resource revenue, royalties, or revenue-sharing from resources" — so the
   dual-LLM labeler does not recognize impact-benefit agreements, equity
   participation, or compensation/valuation for the taking of land and resources
   as economic. Even economic cases that *are* in the substrate get labeled under
   other themes (or not at all).

**Hard governance constraint (settled):** this round raises breadth — bring in
**more real economic cases and label them correctly**. It does **not** extract or
populate dollar figures. Fabricating economic figures is the Gallagher
credibility trap; monetary `EconomicDimension` values stay curated-only and are
out of scope here. Dollar estimation is deferred to client idea #3.

## Decisions (from brainstorm)

- **Breadth-first** (Q1): expand the economic harvest and re-run the existing
  pipeline so more genuine economic cases enter the substrate and earn labels.
- **My legal-term expansion + candidate seeds, marked pending validation** (Q2):
  I expand `resource_revenue` queries with real Indigenous-economic-law terms and
  add a small set of verified landmark economic citations as candidate seeds. All
  additions are **versioned in `sources.ts` (auditable, not a black box)** and
  recorded as **candidate methodology pending Kay/expert validation**. Candidate
  seeds are deliberately **not** given curated authority.
- **Out of scope:** dollar-figure extraction, `EconomicDimension` population from
  figures, adding economic terms to non-`resource_revenue` themes (deferred).

## Architecture

### 1. Expanded economic harvest surface — `src/lib/cases/ingest/sources.ts`

Expand `THEME_QUERIES.resource_revenue` from 2 to 8 terms:

```ts
resource_revenue: [
  "revenue sharing", "resource revenue", "impact benefit agreement",
  "resource royalties", "equity stake", "equitable compensation",
  "expropriation compensation", "economic loss",
],
```

Add a new, clearly-fenced candidate-seed array (kept **separate** from the
curated flagship `SEED_CITATIONS` to mark the governance boundary):

```ts
// CANDIDATE economic seeds — pending Kay/expert validation. Fetched like any
// harvested case (NOT added to enrichment.ts, so no curated authority); they are
// subject to the inclusion filter + dual-LLM consensus gate like everything else.
// A candidate that does not earn cross-model consensus stays substrate.
export const ECON_CANDIDATE_SEEDS: string[] = [
  "2009 SCC 9",     // Ermineskin Indian Band and Nation v. Canada — oil/gas royalties
  "2021 SCC 28",    // Southwind v. Canada — equitable compensation for taken/flooded reserve land
  "2001 SCC 85",    // Osoyoos Indian Band v. Oliver (Town) — reserve land taken for canal; expropriation/tax
  "2007 ONCA 744",  // Whitefish Lake Band of Indians v. Canada (AG) — equitable compensation, undervalued timber lease
];
```

(All four neutral citations verified against public court records / CanLII on
2026-07-06. `2007 ONCA 744` may be absent from A2AJ; `fetchCitation` returns null
and it is harmlessly skipped, exactly as `GAP_CITATIONS` behave.)

**Governance rationale:** candidate seeds are not added to `enrichment.ts`. The
curated map confers `method:"curated", confidence:"high", needsReview:false` —
authority we reserve for expert-validated flagships. Candidate seeds instead flow
through `includeCandidate` → `labelCase` → the consensus gate, so a candidate that
does not earn cross-model agreement stays substrate ("宁缺毋滥"), and any that
promotes on partial agreement already carries `labelMeta.needsReview = true`.

### 2. Widened `resource_revenue` rubric — `src/lib/cases/ingest/rubric.ts`

```ts
resource_revenue:
  "The case concerns the economic dimension of Indigenous land or resource " +
  "interests — resource revenue, royalties, or revenue-sharing; impact-benefit " +
  "agreements or equity participation; or compensation, damages, or valuation " +
  "for the taking, expropriation, flooding, or infringement of reserve land or " +
  "resource rights.",
```

Bump `RUBRIC_VERSION` from `"2026-06-28.1"` to `"2026-07-06.1"`.

**Why this is safe (does not reintroduce the 106-case noise):** `labelPrompt`
embeds the rubric text verbatim, so changing the text changes the LLM cache key →
cases are re-labeled against the new rubric rather than served a stale verdict.
The widened rubric only **proposes** more matches; disposal is unchanged — the
`includeCandidate` Indigenous-context filter and the dual-LLM **consensus gate**
still require both models to agree before any theme sticks. That is the same guard
that caught the earlier 106 zero-consensus cases. The `RUBRIC_VERSION` bump is the
methodology-provenance record of the change.

### 3. Additive-safe economic harvest — `scripts/cases-harvest-economic.ts` (new)

**Why not just re-run `cases:ingest`:** the blanket `ingest()` maps *every*
harvested record to a bare substrate profile and `upsert`s it; the in-memory
objects have no chunks, so `promoteOne` returns null for them and previously
full-texted **core** cases would be overwritten back to bare substrate and
**demoted**, destroying existing enrichment, summaries, and labels. `ingest()`
must not be run for supplementation.

The new script harvests **only** the economic surface and writes **only new**
cases:

```ts
async function gatherEconomic(): Promise<A2ajRecord[]> {
  const all: A2ajRecord[] = [];
  for (const q of THEME_QUERIES.resource_revenue)
    all.push(...(await harvestQuery(q, DATE_FROM, DATE_TO, WINDOW_YEARS)));
  for (const c of ECON_CANDIDATE_SEEDS) { const r = await fetchCitation(c); if (r) all.push(r); }
  return dedupeByCitation(all);
}

// Additive-safe: write the PROFILE only if it does not already exist. Never
// overwrites an existing PROFILE or its CHUNK items, so full-texted/promoted
// cases are left untouched.
async function upsertIfAbsent(cases: LegalCase[]): Promise<{ added: number; skipped: number }> {
  let added = 0, skipped = 0;
  for (const c of cases) {
    const [profile] = caseToItems(c); // bare substrate → PROFILE only, no chunks
    try {
      await ddbDoc.send(new PutCommand({
        TableName: TABLE, Item: profile, ConditionExpression: "attribute_not_exists(PK)",
      }));
      added++;
    } catch (e: any) {
      if (e.name === "ConditionalCheckFailedException") { skipped++; continue; }
      throw e;
    }
  }
  return { added, skipped };
}

export async function harvestEconomic() {
  const raw = await gatherEconomic();
  const substrate = raw.map((r) => ({ ...a2ajToCase(r), corpusTier: "substrate" as const }));
  const { added, skipped } = await upsertIfAbsent(substrate);
  console.log(`✅ economic harvest: candidates ${substrate.length} · new-substrate ${added} · already-present ${skipped}`);
}
```

New candidates land as substrate; **the existing pipeline promotes them** with no
new promotion code: `cases:fetch-fulltext` reads new substrate, fetches text,
chunks, and calls `promoteOne` inline (now against the widened rubric) →
`cases:embed` embeds the new chunks → `cases:index-build:cloud` rebuilds the
artifact. Existing cases are untouched at every step.

Add an npm script `"cases:harvest-economic": "tsx scripts/cases-harvest-economic.ts"`.

### 4. Methodology transparency — `docs/research/2026-06-28-legal-corpus-construction-methodology.md`

Record the expanded `resource_revenue` queries, the `ECON_CANDIDATE_SEEDS` list,
and the widened rubric (`RUBRIC_VERSION 2026-07-06.1`) under a dated
"Economic supplementation (2026-07-06)" note, explicitly labeled **candidate
methodology, pending expert (Kay) validation**. The PRISMA/corpus boundary stays
auditable; the datasheet counts refresh from the post-merge operational run.

## Governance

- **No figures fabricated.** Harvest returns only real A2AJ records; rubric
  widening changes *labels*, not numbers; monetary `EconomicDimension` values
  remain curated-only (`enrichment.ts`) and out of scope. The activation
  economic aggregate does not move unless a human curates a figure.
- **Consensus gate unchanged.** A broader rubric cannot inject a theme
  unilaterally — both models must still agree.
- **Candidate additions carry no curated authority** and are recorded as
  pending-validation in code and in the methodology doc.

## Testing (offline, TDD)

`scripts/test-cases-harvest-economic.ts` (node:assert/strict, async IIFE — mirrors
`test-cases-lenses.ts`), with a stub `ddbDoc.send`:

- **`upsertIfAbsent` skips existing:** stub throws `ConditionalCheckFailedException`
  for a present id and resolves for an absent id; assert `{ added, skipped }`
  tallies correctly and that a `ConditionalCheckFailed` is counted as `skipped`,
  **not** rethrown.
- **`upsertIfAbsent` rethrows real errors:** a non-conditional error (e.g.
  `ProvisionedThroughputExceededException`) propagates.
- **`sources.ts` structure:** `THEME_QUERIES.resource_revenue` contains the eight
  expected terms; `ECON_CANDIDATE_SEEDS` is non-empty and every entry is a
  well-formed citation string.
- **`rubric.ts`:** `RUBRIC_VERSION === "2026-07-06.1"`; `labelPrompt("x")` output
  contains the widened `resource_revenue` language (e.g. "impact-benefit").
- `npm run typecheck` clean; `npm run build` compiles. **`npm run verify` is NOT
  run** (it factory-resets the local corpus). No new figure fields → no
  `EconomicDimension` round-trip changes.

## Operational run (post-merge, credentialed — measured, not code)

Run against the cloud table (temporary SSO creds; `AWS_REGION=us-east-1`
`CASES_TABLE=LegalCases` `INDEX_BUCKET=indigenomics-portal-production-casesindexbucket-bbdveozx`):

1. `cases:harvest-economic` — additive substrate.
2. `cases:fetch-fulltext` — fetch + inline promote (widened rubric).
3. `cases:embed` — embed new chunks.
4. `cases:index-build:cloud` (with `INDEX_BUCKET` passed explicitly) — rebuild + upload artifact.
5. `cases:datasheet` — refresh counts.

Record before/after in a Result section of this spec: `resource_revenue` core
count (from 14), net new economic core cases, how many new labels passed the
consensus gate vs. stayed substrate, and confirmation that no monetary figure was
fabricated (activation economic aggregate unchanged).

## Success criteria

- **Offline:** harvest/sources/rubric tests green; typecheck + build clean; the
  additive-safe write provably does not overwrite an existing PROFILE (test).
- **Ops (post-merge):** `resource_revenue` core count rises materially from 14,
  with every new label having passed the dual-LLM consensus gate; existing
  full-texted cases are demonstrably untouched; no fabricated figures anywhere.
