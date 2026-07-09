# Canonical Explore Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the sector and commitment-type vocabulary across the commitments domain and the RAP-extraction domain so both seeded commitments and BDA/Claude-extracted RAPs render consistently in Explore, and every page, the extraction pipeline, and the persisted DynamoDB data reflect the same taxonomy.

**Architecture:** A new `src/lib/taxonomy.ts` owns canonical `Sector` + `CommitmentType` enums and all display labels. Both domains adopt these two enums at the data level (types, fixtures, extraction schema, DB). Status, org-size, pillar, claim-basis, region, and jurisdiction stay each domain's native vocabulary and are crosswalked to canonical only at the Fact boundary (`commitmentsToFacts`, `buildFacts`). Explore consumes one label helper, hides degenerate dimensions data-drivenly, and fixes the treemap drill.

**Tech Stack:** Next.js App Router, TypeScript (strict), DynamoDB (`@aws-sdk/lib-dynamodb`), standalone `tsx` test scripts with `node:assert/strict`. Build: `npm run typecheck` (tsc --noEmit) + `npm run build` (next build).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-09-canonical-taxonomy-design.md`. Every task's requirements implicitly include it.
- Canonical `Sector` (16): `finance, mining, energy, consulting, retail, health, government, education, transport, telecom, forestry, construction, aerospace, agriculture, media, other`.
- Canonical `CommitmentType` (11): `employment, procurement, cultural_learning, governance, relationships, anti_racism, education_training, community_investment, environmental, partnership, other`.
- Canonical status (display) = commitments `CommitmentStatus`: `committed, in_progress, reported, confirmed, stalled`.
- Canonical org-size (display) = `small, medium, large, enterprise, unknown`.
- No test runner — tests are `tsx scripts/test-*.ts` using `node:assert/strict`, one `(async () => { … })()` or top-level block, `console.log("✅ <name> passed")` on success.
- Out of scope: suppliers `sector`/`sectorNorm`, CCAB↔CCIB (separate Q2/Q3 workstream). Do not touch `src/app/suppliers`, `src/lib/repo`.
- Branch: `feat/canonical-taxonomy` (already checked out).

---

### Task 1: Canonical taxonomy module

**Files:**
- Create: `src/lib/taxonomy.ts`
- Test: `scripts/test-taxonomy.ts`

**Interfaces:**
- Produces: `export type CanonicalSector` (16-member union), `export type CanonicalCommitmentType` (11-member union), `export const CANONICAL_SECTORS: CanonicalSector[]`, `export const CANONICAL_TYPES: CanonicalCommitmentType[]`, `export const SECTOR_LABELS: Record<CanonicalSector,string>`, `export const TYPE_LABELS: Record<CanonicalCommitmentType,string>`, `export const STATUS_LABELS: Record<string,string>`, `export const SIZE_LABELS: Record<string,string>`, `export function labelFor(dim: string, key: string): string`.

- [ ] **Step 1: Write the failing test** — `scripts/test-taxonomy.ts`

```ts
// Canonical taxonomy: label maps cover the full enums, labelFor humanizes any
// key, and the exported arrays match the union types.
import assert from "node:assert/strict";
import {
  CANONICAL_SECTORS, CANONICAL_TYPES, SECTOR_LABELS, TYPE_LABELS,
  STATUS_LABELS, SIZE_LABELS, labelFor,
} from "../src/lib/taxonomy";

// every sector/type has a non-raw label (no underscores, starts uppercase)
for (const s of CANONICAL_SECTORS) {
  const l = SECTOR_LABELS[s];
  assert.ok(l && !l.includes("_"), `sector ${s} label missing/raw: ${l}`);
}
for (const t of CANONICAL_TYPES) {
  const l = TYPE_LABELS[t];
  assert.ok(l && !l.includes("_"), `type ${t} label missing/raw: ${l}`);
}
// specific spellings
assert.equal(TYPE_LABELS["cultural_learning"], "Cultural learning");
assert.equal(TYPE_LABELS["anti_racism"], "Anti-racism");
assert.equal(TYPE_LABELS["education_training"], "Education & training");
assert.equal(SECTOR_LABELS["other"], "Other");
// labelFor routes by dim, falls back by humanizing unknown keys
assert.equal(labelFor("sector", "finance"), "Finance");
assert.equal(labelFor("commitmentType", "cultural_learning"), "Cultural learning");
assert.equal(labelFor("status", "in_progress"), "In progress");
assert.equal(labelFor("sizeBand", "enterprise"), "Enterprise");
assert.equal(labelFor("unknownDim", "some_raw_value"), "Some raw value"); // humanizing fallback
assert.equal(CANONICAL_SECTORS.length, 16);
assert.equal(CANONICAL_TYPES.length, 11);
console.log("✅ test-taxonomy passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-taxonomy.ts`
Expected: FAIL — `Cannot find module '../src/lib/taxonomy'`.

- [ ] **Step 3: Write the module** — `src/lib/taxonomy.ts`

```ts
// The single source of truth for how sector / commitment-type / status / org-size
// enum values are DISPLAYED across the app. Both the commitments domain and the
// RAP-extraction domain adopt CanonicalSector + CanonicalCommitmentType; status
// and org-size are display targets that the Fact boundary crosswalks into.
export type CanonicalSector =
  | "finance" | "mining" | "energy" | "consulting" | "retail" | "health"
  | "government" | "education" | "transport" | "telecom" | "forestry"
  | "construction" | "aerospace" | "agriculture" | "media" | "other";

export type CanonicalCommitmentType =
  | "employment" | "procurement" | "cultural_learning" | "governance"
  | "relationships" | "anti_racism" | "education_training"
  | "community_investment" | "environmental" | "partnership" | "other";

export const CANONICAL_SECTORS: CanonicalSector[] = [
  "finance", "mining", "energy", "consulting", "retail", "health", "government",
  "education", "transport", "telecom", "forestry", "construction", "aerospace",
  "agriculture", "media", "other",
];

export const CANONICAL_TYPES: CanonicalCommitmentType[] = [
  "employment", "procurement", "cultural_learning", "governance", "relationships",
  "anti_racism", "education_training", "community_investment", "environmental",
  "partnership", "other",
];

export const SECTOR_LABELS: Record<CanonicalSector, string> = {
  finance: "Finance", mining: "Mining", energy: "Energy", consulting: "Consulting",
  retail: "Retail", health: "Health", government: "Government", education: "Education",
  transport: "Transport", telecom: "Telecom", forestry: "Forestry",
  construction: "Construction", aerospace: "Aerospace", agriculture: "Agriculture",
  media: "Media", other: "Other",
};

export const TYPE_LABELS: Record<CanonicalCommitmentType, string> = {
  employment: "Employment", procurement: "Procurement",
  cultural_learning: "Cultural learning", governance: "Governance",
  relationships: "Relationships", anti_racism: "Anti-racism",
  education_training: "Education & training",
  community_investment: "Community investment", environmental: "Environmental",
  partnership: "Partnership", other: "Other",
};

export const STATUS_LABELS: Record<string, string> = {
  committed: "Committed", in_progress: "In progress", reported: "Reported",
  confirmed: "Confirmed", stalled: "Stalled",
};

export const SIZE_LABELS: Record<string, string> = {
  small: "Small", medium: "Medium", large: "Large", enterprise: "Enterprise",
  unknown: "Unknown",
};

// Humanize any snake_case/lower key: "some_raw_value" -> "Some raw value".
function humanize(key: string): string {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const DIM_LABELS: Record<string, Record<string, string>> = {
  sector: SECTOR_LABELS, commitmentType: TYPE_LABELS,
  status: STATUS_LABELS, sizeBand: SIZE_LABELS,
};

// The one label function every screen calls. Known dim+key -> curated label;
// anything else -> humanized fallback (never a raw snake_case leak).
export function labelFor(dim: string, key: string): string {
  return DIM_LABELS[dim]?.[key] ?? humanize(key);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-taxonomy.ts`
Expected: PASS — `✅ test-taxonomy passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/taxonomy.ts scripts/test-taxonomy.ts
git commit -m "feat(taxonomy): canonical sector/type enums + label helper"
```

---

### Task 2: Adopt canonical enums in the RAP + commitments type systems

**Files:**
- Modify: `src/lib/rap/types.ts` (the `Sector` and `CommitmentType` type definitions)
- Modify: `src/lib/commitments/types.ts` (the `Sector` and `CommitmentType` type definitions)

**Interfaces:**
- Consumes: `CanonicalSector`, `CanonicalCommitmentType` from `src/lib/taxonomy.ts` (Task 1).
- Produces: `rap/types.ts` `Sector` = `CanonicalSector`, `CommitmentType` = `CanonicalCommitmentType`; `commitments/types.ts` `Sector` = `CanonicalSector`, `CommitmentType` = `CanonicalCommitmentType`.

This task is compile-driven: retyping widens/renames the unions; `npm run typecheck` surfaces every now-invalid literal in fixtures/schema as the failing signal (fixed in Tasks 3–4).

- [ ] **Step 1: Retype the RAP domain** — in `src/lib/rap/types.ts`, replace the `export type Sector = …;` block (lines ~30-40) and the `export type CommitmentType = …;` block (lines ~54+) with:

```ts
import type { CanonicalSector, CanonicalCommitmentType } from "@/lib/taxonomy";
export type Sector = CanonicalSector;
export type CommitmentType = CanonicalCommitmentType;
```

(Place the `import type` with the other imports at the top of the file; delete the old inline unions.)

- [ ] **Step 2: Retype the commitments domain** — in `src/lib/commitments/types.ts`, replace `export type Sector = …;` and `export type CommitmentType = …;` with the same two aliases + import:

```ts
import type { CanonicalSector, CanonicalCommitmentType } from "@/lib/taxonomy";
export type Sector = CanonicalSector;
export type CommitmentType = CanonicalCommitmentType;
```

- [ ] **Step 3: Run typecheck to see the expected failures**

Run: `npm run typecheck`
Expected: FAIL — errors in `src/lib/rap/fixtures.ts` (`"finance_banking"`, `"mining_extractive"`, `"cultural_awareness"` no longer assignable) and `src/lib/rap/extraction-schema.ts` (`SECTORS`/`COMMITMENT_TYPES` arrays). These are fixed in Tasks 3–4. The commitments fixtures should NOT error (already canonical).

- [ ] **Step 4: Commit** (compiles-with-known-downstream-errors checkpoint)

```bash
git add src/lib/rap/types.ts src/lib/commitments/types.ts
git commit -m "refactor(types): point rap + commitments Sector/CommitmentType at canonical enum"
```

---

### Task 3: Migrate RAP fixtures + mock data to canonical values

**Files:**
- Modify: `src/lib/rap/fixtures.ts` (org `sector`, commitment `sector` + `commitmentType` literals)
- Modify: `src/lib/rap/real-fixtures.ts` (same legacy literals — real-data seeder source; ~15 occurrences)
- Modify: `src/lib/rap/pipeline.mock.ts` (2 `finance_banking` occurrences in the mock extraction job)

**Interfaces:**
- Consumes: canonical `Sector`/`CommitmentType` (Task 2).
- Produces: these three files use only canonical literals (no `finance_banking`/`mining_extractive`/`cultural_awareness`).

Scope note: Task 2's compile-driven retype surfaced that `real-fixtures.ts` and `pipeline.mock.ts` carry the same legacy literals as `fixtures.ts` (all are live code — `real-fixtures.ts` feeds `scripts/seed-rap-real.ts`; `pipeline.mock.ts` is on the extraction-job path). They take the identical remap.

- [ ] **Step 1: Rewrite the sector/type literals** — in `src/lib/rap/fixtures.ts`, `src/lib/rap/real-fixtures.ts`, and `src/lib/rap/pipeline.mock.ts`, apply these exact replacements everywhere they appear (org rows, commitment rows, mock classification/extraction fields):

```
"finance_banking"   -> "finance"
"mining_extractive" -> "mining"
"cultural_awareness"-> "cultural_learning"
```

All other RAP sector/type values (`telecom, energy, government, retail, transport, procurement, employment, education_training, community_investment, environmental, partnership, governance, other`) are already canonical — leave them.

- [ ] **Step 2: Verify no legacy literals remain**

Run: `grep -rnE "finance_banking|mining_extractive|cultural_awareness" src/lib/rap/fixtures.ts src/lib/rap/real-fixtures.ts src/lib/rap/pipeline.mock.ts`
Expected: no output.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: fixtures/real-fixtures/pipeline.mock errors gone; remaining errors only in `src/lib/rap/extraction-schema.ts` and `src/lib/rap-index/facts-source.ts` (Task 4).

- [ ] **Step 4: Commit**

```bash
git add src/lib/rap/fixtures.ts src/lib/rap/real-fixtures.ts src/lib/rap/pipeline.mock.ts
git commit -m "refactor(rap): migrate fixtures + mock data to canonical sector/type values"
```

---

### Task 4: Widen the extraction schema + BDA blueprint + facts-source (D3)

**Files:**
- Modify: `src/lib/rap/extraction-schema.ts` (`SECTORS`, `COMMITMENT_TYPES` arrays)
- Modify: `src/lib/rap/bda-blueprint.json` (sector + commitmentType `instruction` strings)
- Modify: `src/lib/rap-index/facts-source.ts` (`RAP_SECTORS` array — legacy literals; drives the `RAP_INDEX_SOURCE="rap"` read path)

**Interfaces:**
- Consumes: `CANONICAL_SECTORS`, `CANONICAL_TYPES` (Task 1).
- Produces: extraction enum = canonical; the Claude tool `enum` and BDA prompt offer the full 16 sectors / 11 types; `RAP_SECTORS` = canonical sector list.

- [ ] **Step 1: Replace the arrays** — in `src/lib/rap/extraction-schema.ts`, replace the `SECTORS` and `COMMITMENT_TYPES` declarations with re-exports of the canonical arrays:

```ts
import { CANONICAL_SECTORS, CANONICAL_TYPES } from "@/lib/taxonomy";
export const SECTORS: Sector[] = CANONICAL_SECTORS;
export const COMMITMENT_TYPES: CommitmentType[] = CANONICAL_TYPES;
```

(Keep the existing `import type { … Sector … CommitmentType … } from "./types"`; remove the old inline array literals. `PILLARS`, `FRAMEWORK_REFS`, `JURISDICTIONS`, `RAP_TYPES`, `PAIR_LEVELS` are unchanged.)

- [ ] **Step 1b: Point `RAP_SECTORS` at the canonical list** — in `src/lib/rap-index/facts-source.ts`, replace the hardcoded legacy `RAP_SECTORS` array (`["mining_extractive", "finance_banking", …]`) with the canonical list:

```ts
import { CANONICAL_SECTORS } from "@/lib/taxonomy";
const RAP_SECTORS: Sector[] = CANONICAL_SECTORS;
```

(Keep the existing `import type { Sector } from "@/lib/rap";`. This array is iterated to fetch commitments per sector under the `RAP_INDEX_SOURCE="rap"` path; canonical values keep it in sync with the widened enum.)

- [ ] **Step 2: Update the BDA blueprint instructions** — in `src/lib/rap/bda-blueprint.json`, set the two `instruction` strings:

sector:
```
"The organization's sector, one of: finance, mining, energy, consulting, retail, health, government, education, transport, telecom, forestry, construction, aerospace, agriculture, media, other."
```
commitmentType:
```
"Classify as one of: employment, procurement, cultural_learning, governance, relationships, anti_racism, education_training, community_investment, environmental, partnership, other."
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (0 errors) — all enum literals now canonical.

- [ ] **Step 4: Commit**

```bash
git add src/lib/rap/extraction-schema.ts src/lib/rap/bda-blueprint.json src/lib/rap-index/facts-source.ts
git commit -m "feat(extract): widen extraction sector/type enum to canonical + RAP_SECTORS (D3)"
```

---

### Task 5: Fact-boundary crosswalk — commitmentsToFacts

**Files:**
- Modify: `src/lib/rap-index/commitments-to-facts.ts`
- Test: `scripts/test-commitments-facts.ts` (create)

**Interfaces:**
- Consumes: commitments domain `Commitment` (native canonical sector/type + native `CommitmentStatus`/`OrgSize`); `Fact` shape from `@/lib/rap/analytics` (with `status: CommitmentStatus`, `sizeBand: canonical org-size` after Task 6).
- Produces: `commitmentsToFacts(commitments)` emitting canonical sector/type verbatim, native commitments `status` (NO collapse), and `sizeBand` = the native `OrgSize`.

NOTE: Task 6 retypes `Fact.status` to `CommitmentStatus` and `Fact.sizeBand` to the canonical org-size union. This task and Task 6 must both land before `npm run typecheck` is green; commit this one at its own checkpoint and run the combined typecheck at the end of Task 6.

- [ ] **Step 1: Write the failing test** — `scripts/test-commitments-facts.ts`

```ts
// commitmentsToFacts carries native commitments enums onto the Fact WITHOUT the
// old rap remap: sector/type verbatim, status un-collapsed (reported != confirmed),
// orgSize passed through as sizeBand.
import assert from "node:assert/strict";
import { commitmentsToFacts } from "../src/lib/rap-index/commitments-to-facts";
import type { Commitment } from "../src/lib/commitments/types";

const base: Commitment = {
  id: "c1", orgName: "Acme", sector: "consulting", orgSize: "enterprise",
  type: "cultural_learning", title: "t", targetYear: 2030, status: "reported",
  progressPct: 60, history: [], createdAt: "2025-01-01",
};
const conf: Commitment = { ...base, id: "c2", status: "confirmed" };

const facts = commitmentsToFacts([base, conf]);
assert.equal(facts[0].sector, "consulting");        // verbatim, not "other"
assert.equal(facts[0].commitmentType, "cultural_learning"); // verbatim
assert.equal(facts[0].status, "reported");          // NOT collapsed to "met"
assert.equal(facts[1].status, "confirmed");         // reported != confirmed
assert.equal(facts[0].sizeBand, "enterprise");      // native org size
console.log("✅ test-commitments-facts passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-commitments-facts.ts`
Expected: FAIL — asserts on `status`/`sizeBand` (current code maps to `met`/`1000_plus`).

- [ ] **Step 3: Rewrite the mapper** — replace the body of `src/lib/rap-index/commitments-to-facts.ts` with:

```ts
import type { Commitment } from "@/lib/commitments";
import type { Fact } from "@/lib/rap/analytics";

// Map a commitments-domain Commitment onto the Explore Fact shape. Sector/type
// are already canonical (verbatim). Status + org size stay the NATIVE commitments
// vocabulary (Fact.status is CommitmentStatus, Fact.sizeBand is the canonical
// org-size union). Pillar/claimBasis/region/jurisdiction the commitments domain
// doesn't carry take honest constants and are hidden as degenerate dimensions
// in Explore (Task 7).
export function commitmentsToFacts(commitments: Commitment[]): Fact[] {
  return commitments.map((c) => ({
    commitId: c.id,
    action: c.title,
    deliverable: c.detail ?? "",
    orgId: c.orgId ?? c.orgName,
    orgName: c.orgName,
    sector: c.sector,
    sizeBand: c.orgSize,
    region: "—",
    jurisdiction: "CA",
    rapId: c.id,
    rapTitle: c.title,
    pillar: "other",
    commitmentType: c.type,
    claimBasis: "self_reported",
    status: c.status,
    percentComplete: c.progressPct,
    targetText: c.targetText ?? null,
    targetValue: null,
    targetUnit: "none",
    dueDate: c.targetYear ? `${c.targetYear}-12-31` : null,
    confidence: 1,
  }));
}
```

- [ ] **Step 4: Run test — expect PASS after Task 6** (the `Fact` retype). For now:

Run: `npx tsx scripts/test-commitments-facts.ts`
Expected: PASS at runtime (values are correct); `npm run typecheck` will still flag `status`/`sizeBand` until Task 6 retypes `Fact`. Proceed to Task 6 before the green checkpoint.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rap-index/commitments-to-facts.ts scripts/test-commitments-facts.ts
git commit -m "feat(facts): commitmentsToFacts carries native status/size, no collapse"
```

---

### Task 6: Retype Fact.status/sizeBand + crosswalk buildFacts + re-key palette

**Files:**
- Modify: `src/lib/rap/analytics.ts` (`Fact.status`, `Fact.sizeBand` types; `buildFacts` status/size mapping; add crosswalk helpers)
- Modify: `src/lib/rap/palette.ts` (re-key `theme.status` to canonical status)
- Test: `scripts/test-buildfacts-crosswalk.ts` (create)

**Interfaces:**
- Consumes: rap `Commitment`/`CommitmentRollup` (native `ProgressStatus`, `SizeBand`); `CommitmentStatus` from commitments types.
- Produces: `Fact.status: CommitmentStatus`, `Fact.sizeBand: "small"|"medium"|"large"|"enterprise"|"unknown"`; `buildFacts` maps rap `ProgressStatus`→canonical status and `SizeBand`→canonical size.

- [ ] **Step 1: Write the failing test** — `scripts/test-buildfacts-crosswalk.ts`

```ts
// buildFacts crosswalks rap ProgressStatus -> canonical status and SizeBand ->
// canonical org-size. Uses the exported crosswalk helpers directly.
import assert from "node:assert/strict";
import { statusToCanonical, sizeToCanonical } from "../src/lib/rap/analytics";

assert.equal(statusToCanonical("not_started"), "committed");
assert.equal(statusToCanonical("on_track"), "in_progress");
assert.equal(statusToCanonical("delayed"), "in_progress");
assert.equal(statusToCanonical("met"), "reported");
assert.equal(statusToCanonical("missed"), "stalled");
assert.equal(sizeToCanonical("lt_50"), "small");
assert.equal(sizeToCanonical("50_249"), "medium");
assert.equal(sizeToCanonical("250_999"), "large");
assert.equal(sizeToCanonical("1000_plus"), "enterprise");
assert.equal(sizeToCanonical("unknown"), "unknown");
console.log("✅ test-buildfacts-crosswalk passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-buildfacts-crosswalk.ts`
Expected: FAIL — `statusToCanonical` not exported.

- [ ] **Step 3: Edit `src/lib/rap/analytics.ts`** — (a) add the import + crosswalk helpers near the top (after the existing imports):

```ts
import type { CommitmentStatus } from "@/lib/commitments/types";

export type CanonicalSize = "small" | "medium" | "large" | "enterprise" | "unknown";

export function statusToCanonical(s: ProgressStatus): CommitmentStatus {
  switch (s) {
    case "not_started": return "committed";
    case "on_track": return "in_progress";
    case "delayed": return "in_progress";
    case "met": return "reported";
    case "missed": return "stalled";
  }
}

export function sizeToCanonical(b: SizeBand): CanonicalSize {
  switch (b) {
    case "lt_50": return "small";
    case "50_249": return "medium";
    case "250_999": return "large";
    case "1000_plus": return "enterprise";
    case "unknown": return "unknown";
  }
}
```

(b) In the `Fact` interface, change two field types:

```ts
  status: CommitmentStatus;   // was: ProgressStatus
  sizeBand: CanonicalSize;    // was: SizeBand
```

(c) In `buildFacts`, change the two assignments:

```ts
      sizeBand: org ? sizeToCanonical(org.sizeBand) : "unknown",
      status: statusToCanonical(roll?.latestStatus ?? "not_started"),
```

- [ ] **Step 4: Re-key the palette** — in `src/lib/rap/palette.ts`, change the `status` type annotation and the three theme `status` maps from `ProgressStatus` keys to `CommitmentStatus` keys, preserving the ordinal ramp:

type (line ~20):
```ts
  status: Record<"committed" | "in_progress" | "reported" | "confirmed" | "stalled", string>;
```
Okabe–Ito (line ~33):
```ts
    status: { committed: "#999999", in_progress: "#56B4E9", reported: "#E69F00", confirmed: "#009E73", stalled: "#CC79A7" },
```
Tol Muted (line ~44):
```ts
    status: { committed: "#BBBBBB", in_progress: "#88CCEE", reported: "#DDCC77", confirmed: "#117733", stalled: "#882255" },
```
IBM (line ~55):
```ts
    status: { committed: "#8D8D8D", in_progress: "#648FFF", reported: "#FFB000", confirmed: "#009E73", stalled: "#DC267F" },
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx tsx scripts/test-buildfacts-crosswalk.ts && npx tsx scripts/test-commitments-facts.ts && npm run typecheck`
Expected: both tests PASS; typecheck reports only errors in `ExploreClient.tsx` (the `key as ProgressStatus` cast, fixed in Task 7).

- [ ] **Step 6: Commit**

```bash
git add src/lib/rap/analytics.ts src/lib/rap/palette.ts scripts/test-buildfacts-crosswalk.ts
git commit -m "feat(facts): canonical status/size on Fact + buildFacts crosswalk + palette re-key"
```

---

### Task 7: Explore — canonical labels + data-driven dimension gating

**Files:**
- Modify: `src/app/commitments/explore/ExploreClient.tsx`

**Interfaces:**
- Consumes: `labelFor` from `@/lib/taxonomy` (Task 1); `Fact` (Task 6).
- Produces: Explore renders canonical labels everywhere; the Group-by / Against dropdowns list only dimensions with ≥2 distinct values in the current facts.

- [ ] **Step 1: Replace the label source** — delete the `LABELS` constant (lines ~33-46) and the local `labelFor` (lines ~47-49). Add at the top:

```ts
import { labelFor } from "@/lib/taxonomy";
```

All existing `labelFor(dim, key)` call sites keep working (same signature).

- [ ] **Step 2: Fix the status color cast** — line ~82, change:

```ts
    if (dim === "status") return theme.status[key as ProgressStatus] ?? theme.categorical[0];
```
to:
```ts
    if (dim === "status") return theme.status[key as keyof typeof theme.status] ?? theme.categorical[0];
```
Remove the now-unused `import type { ProgressStatus } from "@/lib/rap/types";` if nothing else uses it.

- [ ] **Step 3: Gate dimensions data-drivenly** — replace the two `DIMENSIONS.map(...)` option lists (the Group-by and Against `Select`s, lines ~117-121) with a computed `activeDimensions`:

Add inside `ExploreClient`, after `const filtered = …`:
```ts
  // Hide dimensions that are a single constant across the data (e.g. pillar/
  // region/jurisdiction/claimBasis for the commitments source) — grouping by
  // them yields one meaningless tile. Data-driven so it self-adjusts per source.
  const activeDimensions = useMemo(
    () => DIMENSIONS.filter(
      (d) => new Set(facts.map((f) => dimValue(f, d.key))).size >= 2,
    ),
    [facts],
  );
```
Then in both `Select`s change `options={DIMENSIONS.map(...)}` to `options={activeDimensions.map((d) => ({ value: d.key, label: d.label }))}`.

- [ ] **Step 4: Run typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: typecheck 0 errors; build "Compiled successfully".

- [ ] **Step 5: Commit**

```bash
git add src/app/commitments/explore/ExploreClient.tsx
git commit -m "feat(explore): canonical labels + data-driven dimension gating"
```

---

### Task 8: Explore — treemap parent+leaf drill

**Files:**
- Modify: `src/app/commitments/explore/ExploreClient.tsx` (the `Treemap` component's `onDrill` wiring, ~line 212-213)

**Interfaces:**
- Consumes: `TreemapChart` `onDrill(level, key)` (unchanged); the leaf node carries both `pkey` (sector) and `tkey` (type).
- Produces: clicking a leaf filters BOTH the primary (sector) and secondary (type) dimensions.

The current `TreemapChart` `onClick` (in `TreemapChart.tsx`) only forwards ONE key. To filter both, the treemap needs the parent key on the leaf drill. `TreemapChart.tsx` already denormalizes `pname` onto leaves; add `pkey` too and forward it.

- [ ] **Step 1: Carry the parent key onto leaves** — in `src/app/commitments/explore/ExploreClient.tsx`, in the `Treemap` component where leaves are built (~line 199-205), add `ppkey` to each leaf:

```ts
        children: sub.map((s) => ({
          id: `${col.key}::${s.key}`,
          name: labelFor(secondary, s.key),
          tkey: s.key,
          ppkey: col.key,   // parent (primary) key, for parent+leaf drill
          pname: pLabel,
          value: s.value,
        })),
```

- [ ] **Step 2: Extend the TreeNode type + onDrill** — in `src/app/commitments/explore/TreemapChart.tsx`, add `ppkey?: string;` to the `TreeNode` type, and change the `onClick` handler to pass both keys on a leaf:

```ts
        onClick={((node: { data: TreeNode }) => {
          if (node.data.tkey) onDrill("leaf", node.data.tkey, node.data.ppkey);
          else if (node.data.pkey) onDrill("primary", node.data.pkey);
        }) as never}
```

Change the `onDrill` prop signature to:
```ts
  onDrill: (level: "primary" | "leaf", key: string, parentKey?: string) => void;
```

- [ ] **Step 3: Wire both filters in ExploreClient** — change the `<TreemapChart … onDrill=…>` (line ~213) to:

```ts
      <TreemapChart data={data} colorOf={(k) => color(secondary, k)}
        onDrill={(level, key, parentKey) => {
          if (level === "primary") { onPick(primary, key); return; }
          if (parentKey) onPick(primary, parentKey);   // the sector this leaf sits in
          onPick(secondary, key);                        // the type
        }} />
```

- [ ] **Step 4: Write a behavior test** — `scripts/test-treemap-drill.ts` (asserts the pure filter-composition, since the click handler itself is DOM):

```ts
// Drilling a treemap leaf must add BOTH the parent (sector) and leaf (type)
// filters, so two leaves of the same type under different sectors differ.
import assert from "node:assert/strict";

type Filter = { dim: string; key: string };
function drillLeaf(existing: Filter[], primary: string, secondary: string, leafKey: string, parentKey?: string): Filter[] {
  const add = (cur: Filter[], dim: string, key: string) =>
    cur.some((f) => f.dim === dim && f.key === key) ? cur : [...cur, { dim, key }];
  let next = existing;
  if (parentKey) next = add(next, primary, parentKey);
  next = add(next, secondary, leafKey);
  return next;
}

const a = drillLeaf([], "sector", "commitmentType", "relationships", "energy");
const b = drillLeaf([], "sector", "commitmentType", "relationships", "transport");
assert.deepEqual(a, [{ dim: "sector", key: "energy" }, { dim: "commitmentType", key: "relationships" }]);
assert.notDeepEqual(a, b); // same type, different sector -> different filters
console.log("✅ test-treemap-drill passed");
```

Run: `npx tsx scripts/test-treemap-drill.ts` → PASS.

- [ ] **Step 5: Typecheck, build, commit**

```bash
npm run typecheck && npm run build
git add src/app/commitments/explore/ExploreClient.tsx src/app/commitments/explore/TreemapChart.tsx scripts/test-treemap-drill.ts
git commit -m "fix(explore): treemap leaf drill filters parent sector + leaf type"
```

---

### Task 9: Replace per-page label helpers with the canonical helper

**Files:**
- Modify: `src/app/commitments/page.tsx`
- Modify: `src/app/my-commitments/page.tsx`
- Modify: `src/app/organizations/page.tsx`
- Modify: `src/app/organizations/[id]/page.tsx`
- Modify: `src/app/extract/ReviewPanel.tsx`
- Modify: `src/lib/commitments/insights.ts`

**Interfaces:**
- Consumes: `labelFor` from `@/lib/taxonomy`.
- Produces: every enum rendered via `labelFor(<dim>, value)`; local `const label = …` helpers removed; CSS `capitalize` on enum spans removed (labels are already correctly cased).

For each file: add `import { labelFor } from "@/lib/taxonomy";`, delete the local `const label = (s) => s.replace(/_/g," ")` (and `labelize`/`cap` in insights.ts), and replace each call. Pass the correct `dim` per call site: sector→`"sector"`, type→`"commitmentType"`, status→`"status"`, orgSize→`"sizeBand"`.

- [ ] **Step 1: `src/app/commitments/page.tsx`** — delete `const label = (s) => s.replace(/_/g, " ")` (line ~38). Replace call sites:
  - sector renders (`label(k)` under By-sector, `label(c.sector)`, `label(r.commitment.sector)`) → `labelFor("sector", …)`
  - type renders (By-type `label(t)`, `label(c.type)` in matrix titles) → `labelFor("commitmentType", …)`
  - status renders (`label(status)`, `label(s)` in status legend/pills) → `labelFor("status", …)`
  - orgSize (`label(c.orgSize)` / `{c.orgSize}` raw at ~line 750) → `labelFor("sizeBand", c.orgSize)`
  - `label(r.kind)` (risk kind — NOT an enum in taxonomy) → keep a tiny local `humanizeKind` or inline `r.kind.replace(/_/g," ")`; do not route through `labelFor`.
  - RapType `r` (line ~608) → keep as-is (capitalize is fine for reflect/innovate/stretch/elevate) OR add `RAPTYPE_LABELS`; leave as-is (out of taxonomy scope).
  Remove `capitalize` from the className of spans that now receive a pre-cased label (the sector/type/status/size spans). Leave `capitalize` on the RapType span.

- [ ] **Step 2: `src/app/my-commitments/page.tsx`** — delete local `label` (line ~27); replace sector/type/status via `labelFor` with the right dim; `c.orgSize` → `labelFor("sizeBand", c.orgSize)`. Remove `capitalize` on those spans.

- [ ] **Step 3: `src/app/organizations/page.tsx`** — delete local `label` (line ~14); `o.sectors` renders (lines ~124, 187) → `labelFor("sector", s)`. Remove `capitalize`.

- [ ] **Step 4: `src/app/organizations/[id]/page.tsx`** — delete local `label` (line ~19); type/status/sector renders (~275-299) → `labelFor` with correct dim; the lowercase sector-delta span (~line 159) → `labelFor("sector", sector)`. Remove `capitalize` on enum spans. Leave the page's own `STATUS_PILL`/`STATUS_BG` color maps.

- [ ] **Step 5: `src/app/extract/ReviewPanel.tsx`** — add the import; wrap the raw `job.classification?.sector` (~line 38), the "Sector" field `e.sector` (~line 81), and per-commitment `c.commitmentType` (~line 97) in `labelFor("sector", …)` / `labelFor("commitmentType", …)`.

- [ ] **Step 6: `src/lib/commitments/insights.ts`** — delete `labelize`/`cap` (lines 6-7); replace their uses (type/rapType in the narrative, lines ~101, 111) with `labelFor("commitmentType", …)` for types; keep rapType humanized inline (out of scope). Import `labelFor`.

- [ ] **Step 7: Typecheck, build, run the commitments/rap test suites**

Run: `npm run typecheck && npm run build && for t in test-commitments test-rap; do npx tsx scripts/$t.ts 2>/dev/null || echo "($t not present, skip)"; done`
Expected: typecheck 0, build compiled, any present suites pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/commitments/page.tsx src/app/my-commitments/page.tsx src/app/organizations/page.tsx "src/app/organizations/[id]/page.tsx" src/app/extract/ReviewPanel.tsx src/lib/commitments/insights.ts
git commit -m "refactor(pages): render enums via canonical labelFor; drop local label helpers"
```

---

### Task 10: DynamoDB migration script

**Files:**
- Create: `scripts/migrate-taxonomy.ts`
- Test: `scripts/test-migrate-taxonomy.ts`

**Interfaces:**
- Consumes: `ddbDoc` from `@/lib/dynamo/client`, `RAP_TABLE` from `@/lib/dynamo/rap-table`.
- Produces: an idempotent script that rewrites legacy sector/type values on RAP-domain items (org `sector`, commitment `sector` + `commitmentType`, and the `GSI2PK: SECTOR#<sector>` key) to canonical.

The mapping is exactly Task 3's: `finance_banking→finance`, `mining_extractive→mining`, `cultural_awareness→cultural_learning`. Idempotent because canonical values are not keys in the map (left unchanged).

- [ ] **Step 1: Write the failing test** — `scripts/test-migrate-taxonomy.ts` (tests the pure remap helper, no DynamoDB):

```ts
import assert from "node:assert/strict";
import { remapSector, remapType } from "../scripts/migrate-taxonomy";

assert.equal(remapSector("finance_banking"), "finance");
assert.equal(remapSector("mining_extractive"), "mining");
assert.equal(remapSector("telecom"), "telecom");          // canonical unchanged
assert.equal(remapSector("finance"), "finance");           // idempotent
assert.equal(remapType("cultural_awareness"), "cultural_learning");
assert.equal(remapType("procurement"), "procurement");     // unchanged
assert.equal(remapType("cultural_learning"), "cultural_learning"); // idempotent
console.log("✅ test-migrate-taxonomy passed");
```

Run: `npx tsx scripts/test-migrate-taxonomy.ts` → FAIL (module missing).

- [ ] **Step 2: Write the migration** — `scripts/migrate-taxonomy.ts`

```ts
// Idempotent taxonomy migration for RAP-domain items in the RapData table.
// Rewrites legacy sector/commitmentType values (and the SECTOR# GSI2 key) to the
// canonical enum. Commitments-domain items are already canonical and untouched.
//   Local: npx tsx scripts/migrate-taxonomy.ts
//   Cloud: (set AWS creds/region) npx tsx scripts/migrate-taxonomy.ts
import { ScanCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { RAP_TABLE } from "../src/lib/dynamo/rap-table";

const SECTOR_MAP: Record<string, string> = {
  finance_banking: "finance", mining_extractive: "mining",
};
const TYPE_MAP: Record<string, string> = {
  cultural_awareness: "cultural_learning",
};

export function remapSector(s: string): string { return SECTOR_MAP[s] ?? s; }
export function remapType(t: string): string { return TYPE_MAP[t] ?? t; }

async function main() {
  let scanned = 0, updated = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddbDoc.send(new ScanCommand({ TableName: RAP_TABLE, ExclusiveStartKey }));
    for (const item of page.Items ?? []) {
      scanned++;
      let changed = false;
      if (typeof item.sector === "string") {
        const ns = remapSector(item.sector);
        if (ns !== item.sector) { item.sector = ns; changed = true; }
      }
      if (typeof item.commitmentType === "string") {
        const nt = remapType(item.commitmentType);
        if (nt !== item.commitmentType) { item.commitmentType = nt; changed = true; }
      }
      if (typeof item.GSI2PK === "string" && item.GSI2PK.startsWith("SECTOR#")) {
        const raw = item.GSI2PK.slice("SECTOR#".length);
        const ng = `SECTOR#${remapSector(raw)}`;
        if (ng !== item.GSI2PK) { item.GSI2PK = ng; changed = true; }
      }
      if (changed) {
        await ddbDoc.send(new PutCommand({ TableName: RAP_TABLE, Item: item }));
        updated++;
      }
    }
    ExclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  console.log(`migrate-taxonomy: scanned ${scanned}, updated ${updated}`);
}

// Only run main() when invoked directly (not when imported by the test).
if (process.argv[1] && process.argv[1].endsWith("migrate-taxonomy.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

Run: `npx tsx scripts/test-migrate-taxonomy.ts` → PASS.

- [ ] **Step 3: Integration check against a locally-seeded table (best-effort)** — if a local DynamoDB is available (`docker-compose up -d` + `npm run rap:create && npm run rap:seed` already produce canonical values, so a fresh seed is a no-op run): 

Run: `npx tsx scripts/migrate-taxonomy.ts`
Expected: `migrate-taxonomy: scanned N, updated 0` on a freshly-seeded (already-canonical) table — proves idempotency. (Skip if no local DynamoDB; note it in the delivery.)

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-taxonomy.ts scripts/test-migrate-taxonomy.ts
git commit -m "feat(db): idempotent taxonomy migration for RAP-domain items"
```

---

### Task 11: Full-suite verification + delivery

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 0 type errors; "Compiled successfully"; `/commitments` and `/commitments/explore` in the route list.

- [ ] **Step 2: Run every taxonomy + facts test**

Run: `for t in taxonomy commitments-facts buildfacts-crosswalk treemap-drill migrate-taxonomy; do npx tsx scripts/test-$t.ts; done`
Expected: five `✅ … passed` lines.

- [ ] **Step 3: Run the pre-existing domain suites that touch these files**

Run: `for t in scripts/test-commitments*.ts scripts/test-rap*.ts; do [ -e "$t" ] && npx tsx "$t"; done`
Expected: all present suites pass (or fail only on pre-existing env gates like a missing local DynamoDB — note which).

- [ ] **Step 4: Grep guard — no raw enum leaks or stale label helpers remain**

Run: `grep -rnE "s\.replace\(/_/g|cultural_awareness|mining_extractive|finance_banking" src/app/commitments src/app/organizations src/app/my-commitments src/app/extract src/lib/rap-index src/lib/rap/fixtures.ts`
Expected: no output.

- [ ] **Step 5: Push the branch + open PR**

```bash
git push -u origin feat/canonical-taxonomy
gh pr create --title "Canonical Explore taxonomy + crosswalk" --body "Implements docs/superpowers/specs/2026-07-09-canonical-taxonomy-design.md. Unifies sector/commitment-type across the commitments + RAP-extraction domains; both sources render consistently in Explore. Includes fixtures + extraction-schema + BDA blueprint updates, a Fact-boundary crosswalk (status un-collapsed, org-size + degenerate dims handled), the treemap parent+leaf drill fix, canonical labels on all pages, and an idempotent DynamoDB migration (scripts/migrate-taxonomy.ts) to run against the deployed table."
```

Note in the PR: the deployed-DB migration run (`npx tsx scripts/migrate-taxonomy.ts` with cloud creds) is a manual post-merge step by the team; this environment has no DB credentials.

---

## Self-review

**Spec coverage:** §1 canonical module → Task 1. §2 data-level adoption → Tasks 2-3. §3 extraction pipeline → Task 4. §4 Fact boundary + Explore → Tasks 5-8. §5 database → Tasks 3 (fixtures) + 10 (migration). §6 page inventory → Task 9. §7 test gates → each task + Task 11. All spec sections mapped.

**Placeholder scan:** No TBD/TODO; every code step shows real code; every command has expected output.

**Type consistency:** `labelFor(dim, key)` signature identical in Task 1 and all consumers. `statusToCanonical`/`sizeToCanonical`/`CanonicalSize` defined in Task 6, consumed in Tasks 5-6. `Fact.status: CommitmentStatus` and `Fact.sizeBand: CanonicalSize` set in Task 6, matched by Task 5's mapper output. `onDrill(level, key, parentKey?)` defined in Task 8's TreemapChart and matched in ExploreClient. Migration `remapSector`/`remapType` defined + tested in Task 10.

**Cross-task ordering note:** Tasks 5 and 6 are green only together (Task 5's mapper output is typed by Task 6's Fact retype) — both must land before the Task 6 typecheck checkpoint; flagged inline.
