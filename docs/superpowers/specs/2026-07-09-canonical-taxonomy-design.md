# Canonical Explore taxonomy + crosswalk — design

**Date:** 2026-07-09
**Status:** approved (design), pending implementation plan
**Scope:** Unify the sector / commitment-type vocabulary across the commitments domain and the RAP-extraction domain so that **both** the seeded commitments and BDA/Claude-extracted RAPs render consistently in the Explore surface — and every page, the extraction pipeline, and the persisted database reflect the same taxonomy.

## Problem

The Explore surface (`/commitments/explore`) is built on the generic `@/lib/rap/analytics` Fact model, whose display layer (`LABELS` map, colors, dimension list) speaks the **RAP-extraction vocabulary** (`mining_extractive`, `finance_banking`, `cultural_awareness`, statuses `not_started/met/…`). But the default data source feeds it the **commitments vocabulary** (`finance`, `mining`, `cultural_learning`, statuses `committed/reported/confirmed/…`) via `commitmentsToFacts`, which force-casts one enum onto the other (`c.sector as Fact["sector"]`) **without translating**. `labelFor()` then falls back to the raw key on every miss.

Observed consequences (confirmed live + in code):
- Sector labels split casing within one chart: `energy/telecom/government/retail/transport` render Title Case (they happen to be in the map), `finance/mining/consulting/health/…` render raw lowercase.
- Commitment-type labels leak snake_case: `cultural_learning`, `relationships`, `anti_racism`.
- 4 of 9 "Group by" dimensions are degenerate for the commitments source (`pillar/region/jurisdiction/claimBasis` are hardcoded constants).
- Status is collapsed: `reported` and `confirmed` both map to `met`, destroying the confirmation distinction that is the portal's headline metric.
- Treemap drill-in filters only the leaf's type, discarding the parent sector, so every same-type tile yields the identical view.

The two vocabularies are also not 1:1 (commitments has finer sectors and `anti_racism`; RAP has `education_training/community_investment/environmental/partnership` and coarser sectors), so this is a taxonomy-reconciliation problem, not a casing fix.

## Locked decisions

- **D1 — merge** RAP `cultural_awareness` into canonical `cultural_learning`.
- **D2 — keep** `partnership` separate from `relationships`.
- **D3 — widen** the extractor's sector list to the granular canonical 15 (so extraction can populate `consulting/health/…` instead of dumping to `other`).
- **D4 — canonical status = the commitments lifecycle** (`committed/in_progress/reported/confirmed/stalled`); extraction tops out at `reported` (never `confirmed` — confirmation is the portal's own layer).
- **DB strategy = both** — an idempotent migration script for existing/deployed data AND updated fixtures for fresh environments.

## Approach — shared canonical module + hybrid normalization

A new `src/lib/taxonomy.ts` owns the canonical **sector** and **commitment-type** enums + labels. Both domains adopt those two at the **data level** (DB, seed, extraction reflect them). The remaining dimensions (status, org-size, pillar, claim-basis, region, jurisdiction) stay each domain's own and are normalized **at the Fact boundary** for display only — no DB change.

Rationale: D1/D3 only touch sector + type, so those are the only dimensions worth unifying at the data layer. Rewriting RAP's `ProgressStatus`/`sizeBand` internals to the commitments lifecycle would be semantically wrong (RAP observations genuinely track met/missed against targets) and invasive — a boundary crosswalk is cleaner.

Rejected alternatives:
- **Full unification** of every dimension (incl. status/size at the DB level): invasive, semantically lossy.
- **Pure display-time crosswalk, no enum/DB change**: contradicts D1/D3 and the "DB reflects this" requirement — the extractor would keep writing `cultural_awareness`.

## Canonical taxonomy

### Sector — 15 granular + `other`
`finance, mining, energy, consulting, retail, health, government, education, transport, telecom, forestry, construction, aerospace, agriculture, media, other`

Labels: Title Case of the key (`finance` → "Finance", `aerospace` → "Aerospace", `other` → "Other").

### Commitment type — 11
`employment, procurement, cultural_learning, governance, relationships, anti_racism, education_training, community_investment, environmental, partnership, other`

Labels: `cultural_learning` → "Cultural learning", `anti_racism` → "Anti-racism", `education_training` → "Education & training", `community_investment` → "Community investment", others Title Case.

### Status (display crosswalk target) — commitments lifecycle
`committed, in_progress, reported, confirmed, stalled`

### Org size (display crosswalk target)
`small (<50), medium (50–249), large (250–999), enterprise (1000+), unknown`

## Crosswalk tables

### Sector
| RAP value | → canonical | Commitments value | → canonical |
|---|---|---|---|
| mining_extractive | mining | *(all 15)* | identity |
| finance_banking | finance | | |
| telecom / energy / government / retail / transport | *(same)* | | |
| other | other | | |

Note: the 8 finer canonical sectors are unreachable from *legacy* extraction rows (they map to `other`); D3 widening lets *new* extractions populate them directly.

### Commitment type
| RAP value | → canonical | Commitments value | → canonical |
|---|---|---|---|
| procurement / employment / governance | *(same)* | *(all 6)* | identity |
| cultural_awareness | cultural_learning *(merge, D1)* | | |
| education_training / community_investment / environmental / partnership | *(same)* | | |
| other | other | | |

### Status
| RAP `ProgressStatus` | → canonical | Commitments | → canonical |
|---|---|---|---|
| not_started | committed | *(all 5)* | identity |
| on_track | in_progress | | |
| delayed | in_progress | | |
| met | reported | | |
| missed | stalled | | |

`confirmed` is unreachable from extraction (correct — it is the portal's own layer).

### Org size
| RAP `SizeBand` | → canonical | Commitments `OrgSize` | → canonical |
|---|---|---|---|
| lt_50 → small · 50_249 → medium · 250_999 → large · 1000_plus → enterprise · unknown → unknown | | *(4 values)* | identity |

## Source-capability matrix (drives the Group-by dropdown)

| Dimension | Commitments source | Extraction/RAP source |
|---|---|---|
| Sector | yes (granular) | yes (coarse until D3 populates finer) |
| Commitment type | yes | yes |
| Status | yes (incl. `confirmed`) | yes (no `confirmed`) |
| Org size | yes | yes |
| Pillar | **hide** (constant) | yes |
| Claim basis | **hide** (constant) | yes |
| Region | **hide** (constant) | yes |
| Jurisdiction | **hide** (constant) | yes |

Explore's `DIMENSIONS` becomes a function of the active source, so no degenerate single-tile charts.

## Change inventory

### New files
- `src/lib/taxonomy.ts` — canonical `Sector` + `CommitmentType` enums, `SECTOR_LABELS`, `TYPE_LABELS`, `STATUS_LABELS`, `SIZE_LABELS`, and `labelFor(dim, key)` with a humanizing fallback.
- `scripts/migrate-taxonomy.ts` — idempotent migration (see Database).
- `scripts/test-taxonomy.ts` — asserts both crosswalks are total and the migration is idempotent.

### Data-level adoption (sector + type)
- `src/lib/commitments/types.ts` — re-point `Sector`/`CommitmentType` at the shared canonical enum; add `other`. (Values already canonical — no seed change on this side.)
- `src/lib/rap/types.ts` — `Sector` → canonical 15+other; `CommitmentType` → canonical 11.
- `src/lib/rap/fixtures.ts` — rewrite values (`finance_banking`→`finance`, `mining_extractive`→`mining`, `cultural_awareness`→`cultural_learning`, …).

### Extraction pipeline (D3)
- `src/lib/rap/extraction-schema.ts` — widen `SECTORS` + `COMMITMENT_TYPES` to canonical (auto-flows into the Claude tool `enum`).
- `src/lib/rap/bda-blueprint.json` — update the hand-written sector/type `instruction` strings to match (two sources of truth; keep in lockstep — a future task may generate the blueprint from the schema).
- `src/lib/rap/publish.ts` — `oneOf(…, "other")` guard retained; now validates against the wider canonical list.

### Fact boundary + Explore
- `src/lib/rap-index/commitments-to-facts.ts` — emit canonical sector/type (real crosswalk, not a cast); crosswalk status (un-collapse `reported`/`confirmed`) + org-size to canonical.
- `src/lib/rap/analytics.ts` `buildFacts` — emit canonical sector/type; crosswalk status/size to canonical.
- `src/app/commitments/explore/ExploreClient.tsx` — delete the drifted `LABELS`/`labelFor`; import `taxonomy.labelFor`; make `DIMENSIONS` source-dependent (hide the 4 constant dims for the commitments source).
- `src/app/commitments/explore/TreemapChart.tsx` (+ its `onDrill` wiring in `ExploreClient`) — leaf click filters **parent + leaf** (both dims), mirroring the heatmap.

### Page inventory (all screens rendering these enums)
Replace each local `label` helper with `taxonomy.labelFor`:
- `src/app/commitments/page.tsx` (drop the CSS-`capitalize` crutch)
- `src/app/my-commitments/page.tsx`
- `src/app/organizations/page.tsx` and `src/app/organizations/[id]/page.tsx`
- `src/app/extract/ReviewPanel.tsx`
- `src/lib/commitments/insights.ts` (narrative)

Out of scope (separate Q2/Q3 workstream): suppliers `sector`/`sectorNorm` display, CCAB↔CCIB rename.

## Database

- **Migration script** `scripts/migrate-taxonomy.ts` — idempotent; targets **RAP-domain items only** (commitments items are already canonical). Scans stored items and rewrites `sector`/`commitmentType` old→canonical via the crosswalk. Idempotent: re-running maps canonical→canonical (no-op). Local-verified against a freshly-seeded table. The deployed-DB run is performed by the team (outside this environment; no credentials here).
- **Fixtures updated** so a fresh `seed-*` run produces canonical values directly.
- Status / org-size are NOT migrated — they remain each domain's native stored vocabulary and are crosswalked only at the Fact boundary for display.

## Test gates

1. `npm run typecheck` — the enum changes surface every unmapped call site as a compile error (primary safety net).
2. `npm run build`.
3. Existing `tsx scripts/test-*.ts` suites (commitments, rap, alignment) stay green.
4. New `scripts/test-taxonomy.ts` — every source enum value has a crosswalk target (totality); migration is idempotent; `labelFor` returns non-raw output for all canonical keys.

## Risks / notes

- `bda-blueprint.json` duplicates the enum from `extraction-schema.ts` by hand — they must be edited together; drift is a latent risk (candidate for later codegen).
- Widening extraction sectors means the Claude/BDA prompt now offers 15 sector choices; classification quality on the finer buckets is unverified until a real extraction runs — acceptable (guarded by `oneOf(…, "other")`).
- Legacy extracted rows that were `other` stay `other` after migration (coarse→fine is unrecoverable); only new extractions get the finer resolution.
