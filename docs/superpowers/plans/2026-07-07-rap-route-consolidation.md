# RAP Route Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the redundant, unseeded `/rap` dashboard and relocate its two unique surfaces by audience — Explore becomes a tab of `/commitments` (analyst-facing), and the extraction pipeline (Upload + Review) becomes its own `/extract` route with tabs (steward-facing).

**Architecture:** `/rap/page.tsx` duplicates the live `/commitments` RAP Index and reads the unseeded `rap` domain, so it is deleted. Explore (`/rap/explore`) is analytics over the index, so it moves under `/commitments` and reads through a `RAP_INDEX_SOURCE` data seam (default `commitments`, flippable to `rap` at the corpus-plan cutover) via a `commitmentsToFacts` adapter, so it works on today's seeded 106 rows and flips domains later with the index. Extraction (`/rap/upload` + `/rap/review`) moves to `/extract` with an `?tab=` toggle. All old `/rap*` paths 308-redirect to their new homes.

**Tech Stack:** Next.js (App Router, RSC), TypeScript, Tailwind, SST v4 (OpenNext on Lambda). No unit-test framework — the repo convention is standalone `tsx scripts/test-*.ts` scripts using `node:assert/strict`, plus `npm run typecheck` and `next build`.

## Global Constraints

- **No new test framework.** Logic tests are `scripts/test-*.ts` run with `npx tsx scripts/test-<name>.ts`; assert via `node:assert/strict`. Verification also = `npm run typecheck` and `npm run build`.
- **Do not touch the `commitments` or `rap` domain data models** (`src/lib/commitments/*`, `src/lib/rap/types.ts`). This is a routing/IA refactor plus one pure adapter.
- **Preserve existing Tailwind class idioms** (`bg-panel`, `text-ink2`, `border-line`, `text-amber`, etc.) — copy from the components being moved; do not restyle.
- **No behavior change to `ExploreClient` or the chart components** — they keep consuming `Fact[]` / `Dimension`; only their data source and file location change.
- **Every deleted route must redirect**, never 404 — externally-shared `/rap*` links must keep working.

---

### Task 1: `RAP_INDEX_SOURCE` seam + `commitmentsToFacts` adapter

The one logic-bearing task. Explore consumes `Fact[]` (`src/lib/rap/analytics.ts`). To feed it the seeded `commitments` domain today (and swap to `rap` later), add a pure adapter that maps a commitments-domain `Commitment` to the `Fact` shape, plus a seam that picks the source from an env flag.

**Files:**
- Create: `src/lib/rap-index/facts-source.ts`
- Create: `src/lib/rap-index/commitments-to-facts.ts`
- Test: `scripts/test-explore-facts.ts`

**Interfaces:**
- Consumes: `Commitment` from `@/lib/commitments`; `Fact`, `TargetUnit` from `@/lib/rap/analytics`; `buildFacts` from `@/lib/rap/analytics`; `rapRepo` from `@/lib/rap`; `commitmentsRepo` from `@/lib/commitments`.
- Produces:
  - `commitmentsToFacts(commitments: Commitment[]): Fact[]`
  - `getIndexFacts(): Promise<Fact[]>` — reads `process.env.RAP_INDEX_SOURCE` (`"rap" | "commitments"`, default `"commitments"`); for `commitments` returns `commitmentsToFacts(await commitmentsRepo.listCommitments())`; for `rap` builds facts from `rapRepo` (same gather logic currently in `src/app/rap/explore/page.tsx`).

**Mapping rules (commitments → Fact), with rationale for lossy fields:**
- `commitId` ← `c.id`; `action` ← `c.title`; `deliverable` ← `c.detail ?? ""`
- `orgId` ← `c.orgId ?? c.orgName`; `orgName` ← `c.orgName`
- `sector` ← `c.sector` (cast to `Fact["sector"]`; Explore groups categoricals as strings)
- `sizeBand` ← map `OrgSize`: `small→"lt_50"`, `medium→"50_249"`, `large→"250_999"`, `enterprise→"1000_plus"` (fallback `"unknown"`)
- `region` ← `""`, `jurisdiction` ← `"CA"` (commitments domain carries neither — degenerate dimension until `rap` source)
- `rapId` ← `c.id`; `rapTitle` ← `c.title`
- `pillar` ← `"other"` (commitments domain has no pillar — degenerate until `rap` source)
- `commitmentType` ← `c.type` (cast)
- `claimBasis` ← `"self_reported"` (all illustrative rows are self-reported)
- `status` ← map `CommitmentStatus`: `committed→"not_started"`, `in_progress→"on_track"`, `reported→"met"`, `confirmed→"met"`, `stalled→"delayed"`
- `percentComplete` ← `c.progressPct`
- `targetText` ← `c.targetText ?? null`; `targetValue` ← `null`; `targetUnit` ← `"none"`
- `dueDate` ← `c.targetYear ? \`${c.targetYear}-12-31\` : null`
- `confidence` ← `1`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/test-explore-facts.ts
import assert from "node:assert/strict";
import { commitmentsToFacts } from "../src/lib/rap-index/commitments-to-facts";
import type { Commitment } from "../src/lib/commitments";

const sample: Commitment = {
  id: "c1", orgName: "RBC", orgId: "org-rbc", sector: "finance", orgSize: "enterprise",
  type: "procurement", title: "Grow Indigenous procurement", targetYear: 2027,
  status: "reported", progressPct: 35, history: [], createdAt: "2025-01-01T00:00:00.000Z",
  source: { label: "RBC RAP", url: "https://example.com" }, detail: "five ambition areas",
  targetText: "5% of spend",
};

const [f] = commitmentsToFacts([sample]);
assert.equal(f.commitId, "c1");
assert.equal(f.orgName, "RBC");
assert.equal(f.sector, "finance");
assert.equal(f.sizeBand, "1000_plus", "enterprise → 1000_plus");
assert.equal(f.status, "met", "reported → met");
assert.equal(f.percentComplete, 35);
assert.equal(f.claimBasis, "self_reported");
assert.equal(f.pillar, "other", "commitments domain has no pillar");
assert.equal(f.dueDate, "2027-12-31");
assert.equal(f.targetUnit, "none");
assert.equal(f.confidence, 1);
assert.equal(commitmentsToFacts([]).length, 0, "empty in → empty out");
console.log("OK test-explore-facts");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-explore-facts.ts`
Expected: FAIL — `Cannot find module '../src/lib/rap-index/commitments-to-facts'`.

- [ ] **Step 3: Write the adapter**

```ts
// src/lib/rap-index/commitments-to-facts.ts
import type { Commitment, CommitmentStatus, OrgSize } from "@/lib/commitments";
import type { Fact } from "@/lib/rap/analytics";

const SIZE_BAND: Record<OrgSize, Fact["sizeBand"]> = {
  small: "lt_50", medium: "50_249", large: "250_999", enterprise: "1000_plus",
};
const STATUS: Record<CommitmentStatus, Fact["status"]> = {
  committed: "not_started", in_progress: "on_track", reported: "met", confirmed: "met", stalled: "delayed",
};

// Map a commitments-domain Commitment onto the Explore Fact shape. Fields the
// commitments domain doesn't carry (pillar, claimBasis, region, jurisdiction)
// take honest defaults and read as degenerate dimensions in Explore until the
// RAP_INDEX_SOURCE flag flips to the (grounded) rap domain.
export function commitmentsToFacts(commitments: Commitment[]): Fact[] {
  return commitments.map((c) => ({
    commitId: c.id,
    action: c.title,
    deliverable: c.detail ?? "",
    orgId: c.orgId ?? c.orgName,
    orgName: c.orgName,
    sector: c.sector as Fact["sector"],
    sizeBand: SIZE_BAND[c.orgSize] ?? "unknown",
    region: "",
    jurisdiction: "CA" as Fact["jurisdiction"],
    rapId: c.id,
    rapTitle: c.title,
    pillar: "other" as Fact["pillar"],
    commitmentType: c.type as Fact["commitmentType"],
    claimBasis: "self_reported",
    status: STATUS[c.status] ?? "not_started",
    percentComplete: c.progressPct,
    targetText: c.targetText ?? null,
    targetValue: null,
    targetUnit: "none",
    dueDate: c.targetYear ? `${c.targetYear}-12-31` : null,
    confidence: 1,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-explore-facts.ts`
Expected: `OK test-explore-facts`.

- [ ] **Step 5: Write the source seam**

```ts
// src/lib/rap-index/facts-source.ts
import type { Fact } from "@/lib/rap/analytics";
import { buildFacts } from "@/lib/rap/analytics";
import { commitmentsToFacts } from "./commitments-to-facts";
import { commitmentsRepo } from "@/lib/commitments";
import { rapRepo } from "@/lib/rap";
import type { Sector } from "@/lib/rap";

const RAP_SECTORS: Sector[] = [
  "mining_extractive", "finance_banking", "telecom", "energy", "government", "retail", "transport", "other",
];

// Single seam both the RAP Index and Explore read through. Flag default keeps
// us on the seeded commitments domain; flip RAP_INDEX_SOURCE=rap at the
// corpus-plan cutover (docs/rap-index-grounded-corpus-plan.md).
export async function getIndexFacts(): Promise<Fact[]> {
  if (process.env.RAP_INDEX_SOURCE === "rap") {
    const perSector = await Promise.all(RAP_SECTORS.map((s) => rapRepo.listCommitmentsBySector(s)));
    const commitments = perSector.flat();
    const orgIds = [...new Set(commitments.map((c) => c.orgId))];
    const rapIds = [...new Set(commitments.map((c) => c.rapId))];
    const [orgs, raps, rollups] = await Promise.all([
      Promise.all(orgIds.map((id) => rapRepo.getOrganization(id))),
      Promise.all(rapIds.map((id) => rapRepo.getRap(id))),
      Promise.all(commitments.map((c) => rapRepo.getRollup(c.id))),
    ]);
    const orgById = new Map(orgs.filter(Boolean).map((o) => [o!.id, o!]));
    const rapById = new Map(raps.filter(Boolean).map((r) => [r!.id, r!]));
    const rollupById = new Map(rollups.filter(Boolean).map((r) => [r!.commitId, r!]));
    return buildFacts(commitments, orgById, rapById, rollupById);
  }
  return commitmentsToFacts(await commitmentsRepo.listCommitments());
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/lib/rap-index scripts/test-explore-facts.ts
git commit -m "feat(rap-index): RAP_INDEX_SOURCE seam + commitments→Fact adapter"
```

---

### Task 2: Explore as a tab of `/commitments`

Move the Explore UI under `/commitments/explore`, read from `getIndexFacts()`, and add a `Table | Explore` tab header shared by both.

**Files:**
- Create: `src/app/commitments/explore/page.tsx`
- Create: `src/components/RapIndexTabs.tsx`
- Move: `src/app/rap/explore/ExploreClient.tsx` → `src/app/commitments/explore/ExploreClient.tsx` (and `BarChart.tsx`, `NetworkChart.tsx`, `TreemapChart.tsx`, `HeatmapChart.tsx` alongside it)
- Modify: `src/app/commitments/page.tsx` (add `<RapIndexTabs active="table" />` under `<InstituteNav>`)

**Interfaces:**
- Consumes: `getIndexFacts` from `@/lib/rap-index/facts-source`; the moved `ExploreClient` (unchanged props: `{ facts: Fact[] }`).
- Produces: `RapIndexTabs({ active }: { active: "table" | "explore" })`.

- [ ] **Step 1: Move the Explore client + chart components**

```bash
git mv src/app/rap/explore/ExploreClient.tsx src/app/commitments/explore/ExploreClient.tsx
git mv src/app/rap/explore/BarChart.tsx src/app/commitments/explore/BarChart.tsx
git mv src/app/rap/explore/NetworkChart.tsx src/app/commitments/explore/NetworkChart.tsx
git mv src/app/rap/explore/TreemapChart.tsx src/app/commitments/explore/TreemapChart.tsx
git mv src/app/rap/explore/HeatmapChart.tsx src/app/commitments/explore/HeatmapChart.tsx
```

Relative imports inside these files (`./BarChart`, etc.) are unchanged because they moved together. Fix any `@/lib/rap` imports only if they break typecheck in Step 5.

- [ ] **Step 2: Create the tab header**

```tsx
// src/components/RapIndexTabs.tsx
import Link from "next/link";

const TABS = [
  { key: "table", href: "/commitments", label: "Table" },
  { key: "explore", href: "/commitments/explore", label: "Explore" },
] as const;

export function RapIndexTabs({ active }: { active: "table" | "explore" }) {
  return (
    <div className="flex items-center gap-1 -mt-2">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`text-sm rounded px-3 py-1 ${
            t.key === active ? "bg-cedar/10 text-cedar" : "text-ink2 hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create the Explore page reading the seam**

```tsx
// src/app/commitments/explore/page.tsx
import { InstituteNav } from "@/components/InstituteNav";
import { RapIndexTabs } from "@/components/RapIndexTabs";
import { getIndexFacts } from "@/lib/rap-index/facts-source";
import { ExploreClient } from "./ExploreClient";

export const dynamic = "force-dynamic";

export default async function CommitmentsExplorePage() {
  const facts = await getIndexFacts();
  return (
    <div className="space-y-6">
      <InstituteNav active="/commitments" />
      <RapIndexTabs active="explore" />
      <ExploreClient facts={facts} />
    </div>
  );
}
```

If `ExploreClient` currently renders its own full-bleed wrapper/heading (from the old `/rap/explore/page.tsx`), keep that markup inside `ExploreClient`; this page only supplies nav + tabs + data.

- [ ] **Step 4: Add the tab to the Table page**

In `src/app/commitments/page.tsx`, immediately after the `<InstituteNav active="/commitments" />` line, add:

```tsx
      <RapIndexTabs active="table" />
```

and add the import at the top:

```tsx
import { RapIndexTabs } from "@/components/RapIndexTabs";
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed. Fix any dangling `@/lib/rap` type imports in the moved files (Explore only needs `Fact`/`Dimension`/`Measure` from `@/lib/rap/analytics`, which is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/app/commitments/explore src/components/RapIndexTabs.tsx src/app/commitments/page.tsx
git commit -m "feat(commitments): Explore as a Table|Explore tab, reading the index seam"
```

---

### Task 3: Extraction pipeline at `/extract` with Upload | Review tabs

Move the steward-facing extraction UI off `/rap/*` into its own route with a tab toggle. Data source is unchanged (`extractionRepo` / the upload API).

**Files:**
- Create: `src/app/extract/page.tsx` (tabbed shell, `?tab=upload|review`, default `upload`)
- Move: `src/app/rap/upload/UploadForm.tsx` → `src/app/extract/UploadForm.tsx`
- Port: the body of `src/app/rap/review/page.tsx` → an async `ReviewPanel` server component `src/app/extract/ReviewPanel.tsx` (keep its `extractionRepo.listByStatus("PENDING_REVIEW")` fetch and the `confirmExtractionAction`/`rejectExtractionAction` wiring)
- Create: `src/components/ExtractTabs.tsx`

**Interfaces:**
- Consumes: `extractionRepo`, `confirmExtractionAction`, `rejectExtractionAction` from `@/lib/rap`; the moved `UploadForm`.
- Produces: `ExtractTabs({ active }: { active: "upload" | "review" })`; `ReviewPanel()` (async RSC).

- [ ] **Step 1: Move the upload form**

```bash
git mv src/app/rap/upload/UploadForm.tsx src/app/extract/UploadForm.tsx
```

- [ ] **Step 2: Create the tab header**

```tsx
// src/components/ExtractTabs.tsx
import Link from "next/link";

const TABS = [
  { key: "upload", label: "Upload" },
  { key: "review", label: "Review queue" },
] as const;

export function ExtractTabs({ active }: { active: "upload" | "review" }) {
  return (
    <div className="flex items-center gap-1 border-b border-line pb-3">
      <span className="text-amber text-xs uppercase tracking-widest mr-3">Extraction</span>
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/extract?tab=${t.key}`}
          className={`text-sm rounded px-3 py-1 ${
            t.key === active ? "bg-amber/10 text-amber" : "text-ink2 hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Extract the review body into `ReviewPanel`**

Copy the JSX + data fetch from the old `src/app/rap/review/page.tsx` `export default` into:

```tsx
// src/app/extract/ReviewPanel.tsx
import { extractionRepo } from "@/lib/rap";
import { confirmExtractionAction, rejectExtractionAction } from "@/lib/rap/actions";
import type { ExtractedRap, Grounded } from "@/lib/rap";

export async function ReviewPanel() {
  const jobs = await extractionRepo.listByStatus("PENDING_REVIEW");
  // <-- paste the exact list/markup from the old review page body here,
  //     minus its <Link href="/rap"> back-link and page <h1> chrome.
  return (/* moved markup */ null);
}
```

(The implementer copies the concrete markup verbatim from the old file; it is not reproduced here to avoid drift. Remove only the old page's outer nav/back-link and heading, which the shell now owns.)

- [ ] **Step 4: Create the tabbed shell**

```tsx
// src/app/extract/page.tsx
import { InstituteNav } from "@/components/InstituteNav";
import { ExtractTabs } from "@/components/ExtractTabs";
import { UploadForm } from "./UploadForm";
import { ReviewPanel } from "./ReviewPanel";

export const dynamic = "force-dynamic";

export default async function ExtractPage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = searchParams.tab === "review" ? "review" : "upload";
  return (
    <div className="space-y-6">
      <InstituteNav active="/commitments" />
      <ExtractTabs active={tab} />
      {tab === "upload" ? (
        <div>
          <h1 className="font-serif text-2xl mb-1">Submit a RAP for extraction</h1>
          <p className="text-ink2 text-sm mb-4">Upload a published RAP PDF; AI extracts commitments for review before they publish.</p>
          <UploadForm />
        </div>
      ) : (
        <ReviewPanel />
      )}
    </div>
  );
}
```

Adjust the `UploadForm` import (default vs named) to match how it is exported in the moved file.

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/app/extract src/components/ExtractTabs.tsx
git commit -m "feat(extract): /extract route with Upload|Review tabs (moved off /rap)"
```

---

### Task 4: Delete `/rap` and redirect all old paths

Remove the redundant dashboard and the now-empty `/rap` tree, and make every old URL 308-redirect so shared links never 404.

**Files:**
- Delete: `src/app/rap/page.tsx`, `src/app/rap/RapCharts.tsx`, `src/app/rap/explore/page.tsx`, `src/app/rap/upload/page.tsx`, `src/app/rap/review/page.tsx` (and any now-orphaned files left in `src/app/rap/`)
- Modify: `next.config.*` (add `redirects()`)
- Modify: `src/app/layout.tsx:54-56` (header link `/rap` → `/commitments`)
- Modify: `src/app/page.tsx` (landing links `/rap` → `/commitments`)
- Modify: `src/app/home/page.tsx:93-94` (cards → `/commitments` and `/extract?tab=review`)

**Interfaces:** none produced; consumes the routes from Tasks 2–3.

- [ ] **Step 1: Add redirects**

In `next.config.*`, add (merge into existing config object):

```js
async redirects() {
  return [
    { source: "/rap", destination: "/commitments", permanent: true },
    { source: "/rap/explore", destination: "/commitments/explore", permanent: true },
    { source: "/rap/upload", destination: "/extract?tab=upload", permanent: true },
    { source: "/rap/review", destination: "/extract?tab=review", permanent: true },
  ];
}
```

- [ ] **Step 2: Repoint inbound links**

- `src/app/layout.tsx:54` — change `href="/rap"` to `href="/commitments"`.
- `src/app/page.tsx` — change both `/rap` links (lines ~20, ~24) to `/commitments`.
- `src/app/home/page.tsx:93` — card `href="/rap"` → `href="/commitments"`.
- `src/app/home/page.tsx:94` — card `href="/rap/review"` → `href="/extract?tab=review"`.

Verify none remain:

Run: `grep -rn '"/rap' src/app src/components | grep -v '/api/rap'`
Expected: no matches (all rewritten or deleted).

- [ ] **Step 3: Delete the old route tree**

```bash
git rm src/app/rap/page.tsx src/app/rap/RapCharts.tsx \
       src/app/rap/explore/page.tsx src/app/rap/upload/page.tsx src/app/rap/review/page.tsx
```

Then confirm nothing else remains under `src/app/rap/`:

Run: `find src/app/rap -type f`
Expected: empty (all files moved in Tasks 2–3 or deleted here). Remove any stragglers.

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both succeed; no unresolved imports to deleted files.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(rap): delete redundant /rap dashboard + 308-redirect old paths"
```

---

### Task 5: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Local run**

Run: `npm run dev`, then in the browser (or the claude-in-chrome tab) sign in and check:
- `/commitments` — RAP Index table renders 106 rows; a `Table | Explore` tab strip shows under the Indigenomics sub-nav.
- `/commitments/explore` — Explore renders with data (charts populate from the 106 rows). Confirm the degenerate dimensions (`pillar`, `claim basis`, `region`, `jurisdiction`) are present but single-valued — expected under `RAP_INDEX_SOURCE=commitments`.
- `/extract` — Upload tab shows the form; `/extract?tab=review` shows the review queue.
- `/rap`, `/rap/explore`, `/rap/upload`, `/rap/review` — each redirects to its new home.

- [ ] **Step 2: Flag smoke test**

Run: `RAP_INDEX_SOURCE=rap npm run dev` and load `/commitments/explore`.
Expected: it reads the `rap` domain path in `getIndexFacts()` (empty until that domain is seeded — no crash). Reset to default afterward.

- [ ] **Step 3: Final commit / PR**

Open a PR to `main` summarizing the IA change and the `RAP_INDEX_SOURCE` seam; note the Explore degenerate-dimensions caveat and that flipping the flag is owned by the corpus-plan cutover.

---

## Notes for the reviewer / open caveats

- **Explore degenerate dimensions:** on the seeded `commitments` domain, `pillar`, `claimBasis`, `region`, and `jurisdiction` collapse to a single value (the commitments domain doesn't carry them). This is expected and self-heals when `RAP_INDEX_SOURCE` flips to `rap` at the corpus-plan cutover. If it looks bad in the UI now, an optional follow-up is to hide those four dimensions from the Explore dimension picker while the flag is `commitments`.
- **Why a seam, not a throwaway adapter:** binding Explore to `getIndexFacts()` means the Table and Explore tabs always share one data source and flip together — no second cutover to remember.
- **`/extract` access:** this is a steward tool. A follow-up may gate it behind a role in `src/middleware.ts`; out of scope here.
