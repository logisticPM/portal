# Suppliers Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the supplier `sectorNorm` (lossy/wrong + inconsistent display) and standardize CCAB→CCIB across the suppliers domain.

**Architecture:** Q2 — add `technology`/`professional_services` to the shared `CanonicalSector`, re-normalize the two wrong seed suppliers, and display the corrected `sectorNorm` via `labelFor` consistently (key still drives facet/filter). Q3 — rename `IdentityTier` `ccab→ccib`, consolidate the duplicated tier-label maps into one shared module, and update seed + alignment + prose.

**Tech Stack:** Next.js App Router, TypeScript (strict), standalone `tsx` test scripts with `node:assert/strict`. Gates: `npm run typecheck`, `npm run build`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-09-suppliers-normalization-design.md`.
- Canonical sector additions: `technology` → "Technology", `professional_services` → "Professional services".
- Re-normalize ONLY: Animikii `telecom → technology`; Nations Translation Group `consulting → professional_services`. Leave all other `sectorNorm` values unchanged.
- CCAB→CCIB: `IdentityTier` member `ccab → ccib`; label "CCIB-certified"; reference strings "CCIB Certified Indigenous Business" / "CCIB Certified (PAR Gold)".
- The supplier seed is DUPLICATED in `src/lib/seed/fixtures.ts` AND `src/lib/repo/repo.mock.ts` — every seed edit must be applied to BOTH, identically.
- Tests are `tsx scripts/test-*.ts` with `node:assert/strict`, printing `✅ <name> passed`.
- Out of scope: do NOT touch `src/lib/commitments/fixtures.ts` CCAB references (factual Loblaw-partnership commitment content, not the identity-tier vocabulary); the commitments/Explore taxonomy; the empty `self_declared` tier; alignment-scoring honesty.
- Branch: `feat/suppliers-normalization` (already checked out).

---

### Task 1: Add technology + professional_services to the canonical sector taxonomy

**Files:**
- Modify: `src/lib/taxonomy.ts`
- Test: `scripts/test-supplier-labels.ts` (create)

**Interfaces:**
- Produces: `CanonicalSector` gains `"technology" | "professional_services"`; `SECTOR_LABELS` gains `technology: "Technology"`, `professional_services: "Professional services"`; `labelFor("sector", "technology") === "Technology"`.

- [ ] **Step 1: Write the failing test** — `scripts/test-supplier-labels.ts`

```ts
// Suppliers-domain labels: the two new sectors resolve to human labels, and the
// canonical helper covers them (no raw snake_case leak).
import assert from "node:assert/strict";
import { labelFor, SECTOR_LABELS, CANONICAL_SECTORS } from "../src/lib/taxonomy";

assert.equal(labelFor("sector", "technology"), "Technology");
assert.equal(labelFor("sector", "professional_services"), "Professional services");
assert.equal(SECTOR_LABELS["technology"], "Technology");
assert.equal(SECTOR_LABELS["professional_services"], "Professional services");
assert.ok(CANONICAL_SECTORS.includes("technology"));
assert.ok(CANONICAL_SECTORS.includes("professional_services"));
console.log("✅ test-supplier-labels passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-supplier-labels.ts`
Expected: FAIL — `labelFor("sector","technology")` returns "Technology"? No — currently `labelFor` humanizes the unknown key `"technology"` to "Technology" (coincidentally passes) but `"professional_services"` humanizes to "Professional services" (also coincidental). The REAL failures are the `SECTOR_LABELS[...]` and `CANONICAL_SECTORS.includes(...)` assertions (undefined / false). Confirm it fails on those.

- [ ] **Step 3: Add the sectors** — in `src/lib/taxonomy.ts`:

Union (line 5-8), append before `| "other"`:
```ts
export type CanonicalSector =
  | "finance" | "mining" | "energy" | "consulting" | "retail" | "health"
  | "government" | "education" | "transport" | "telecom" | "forestry"
  | "construction" | "aerospace" | "agriculture" | "media"
  | "technology" | "professional_services" | "other";
```
Array (line 15-19), add before `"other"`:
```ts
export const CANONICAL_SECTORS: CanonicalSector[] = [
  "finance", "mining", "energy", "consulting", "retail", "health", "government",
  "education", "transport", "telecom", "forestry", "construction", "aerospace",
  "agriculture", "media", "technology", "professional_services", "other",
];
```
Labels (line 27-33), add the two entries before `other`:
```ts
  media: "Media", technology: "Technology", professional_services: "Professional services", other: "Other",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-supplier-labels.ts && npm run typecheck`
Expected: `✅ test-supplier-labels passed`; typecheck 0 errors (the `Record<CanonicalSector, string>` label map is now exhaustive).

- [ ] **Step 5: Commit**

```bash
git add src/lib/taxonomy.ts scripts/test-supplier-labels.ts
git commit -m "feat(taxonomy): add technology + professional_services sectors"
```

---

### Task 2: Re-normalize the two mis-mapped suppliers (both seed files)

**Files:**
- Modify: `src/lib/seed/fixtures.ts`
- Modify: `src/lib/repo/repo.mock.ts`
- Test: `scripts/test-supplier-labels.ts` (extend)

**Interfaces:**
- Consumes: `technology`/`professional_services` (Task 1).
- Produces: seeded Animikii `sectorNorm === "technology"`; Nations Translation Group `sectorNorm === "professional_services"`.

- [ ] **Step 1: Extend the test** — append to `scripts/test-supplier-labels.ts` (before the final `console.log`). Suppliers are the `parties` array filtered to `role === "supplier"` (synchronous — no repo/await needed):

```ts
import { parties } from "../src/lib/seed/fixtures";
const suppliers = parties.filter((p) => p.role === "supplier");
const animikii = suppliers.find((s) => s.name === "Animikii");
const ntg = suppliers.find((s) => s.name === "Nations Translation Group");
assert.equal(animikii?.sectorNorm, "technology", "Animikii re-normalized to technology");
assert.equal(ntg?.sectorNorm, "professional_services", "NTG re-normalized to professional_services");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-supplier-labels.ts`
Expected: FAIL — Animikii `sectorNorm` is still `"telecom"`.

- [ ] **Step 3: Re-normalize in BOTH files** — in `src/lib/seed/fixtures.ts` AND `src/lib/repo/repo.mock.ts`, on the Animikii row change `sectorNorm: "telecom"` → `sectorNorm: "technology"`, and on the Nations Translation Group row change `sectorNorm: "consulting"` → `sectorNorm: "professional_services"`. Change nothing else (leave each supplier's free-text `sector`, and all other suppliers' `sectorNorm`, untouched).

- [ ] **Step 4: Run test + typecheck**

Run: `npx tsx scripts/test-supplier-labels.ts && npm run typecheck`
Expected: `✅ test-supplier-labels passed`; typecheck 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seed/fixtures.ts src/lib/repo/repo.mock.ts scripts/test-supplier-labels.ts
git commit -m "fix(suppliers): re-normalize Animikii->technology, NTG->professional_services"
```

---

### Task 3: Display sectorNorm via labelFor consistently on the supplier pages

**Files:**
- Modify: `src/app/suppliers/page.tsx`
- Modify: `src/app/suppliers/[id]/page.tsx`
- Modify: `src/app/s/[supplierId]/page.tsx`

**Interfaces:**
- Consumes: `labelFor` from `@/lib/taxonomy`.
- Produces: all three surfaces render the sector via `labelFor("sector", <key>)`; the underlying facet/filter key is unchanged.

No unit test (UI render change); `typecheck` + `build` are the gates.

- [ ] **Step 1: `src/app/suppliers/page.tsx`** — add `import { labelFor } from "@/lib/taxonomy";`. Two display edits (the row `sector` key at line 39 and the `COLS` `val` at line 66 stay as-is — they drive facet/filter/sort):
  - Facet chip (line 135, 139): remove `capitalize` from the className, and change `{s}` to `{labelFor("sector", s)}`.
  - Sector cell (line 185): change `<td className="px-4 py-3 capitalize text-ink2">{sector || "—"}</td>` to `<td className="px-4 py-3 text-ink2">{sector ? labelFor("sector", sector) : "—"}</td>`.

- [ ] **Step 2: `src/app/suppliers/[id]/page.tsx`** — add `import { labelFor } from "@/lib/taxonomy";`. Change line 63 from:
```tsx
        <p className="text-ink2 text-sm mt-1 capitalize">{party.sectorNorm ?? party.sector ?? ""}{party.regionNorm ? ` · ${party.regionNorm}` : ""}</p>
```
to:
```tsx
        <p className="text-ink2 text-sm mt-1">{labelFor("sector", party.sectorNorm ?? party.sector ?? "")}{party.regionNorm ? ` · ${party.regionNorm}` : ""}</p>
```

- [ ] **Step 3: `src/app/s/[supplierId]/page.tsx`** — add `import { labelFor } from "@/lib/taxonomy";`. Change line 55 from `{[s.sector, s.region].filter(Boolean).join(" · ")}` to:
```tsx
          {[labelFor("sector", s.sectorNorm ?? s.sector ?? ""), s.region].filter(Boolean).join(" · ")}
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: typecheck 0; "Compiled successfully".

- [ ] **Step 5: Commit**

```bash
git add src/app/suppliers/page.tsx "src/app/suppliers/[id]/page.tsx" "src/app/s/[supplierId]/page.tsx"
git commit -m "fix(suppliers): render sector via canonical labelFor on all supplier surfaces"
```

---

### Task 4: Consolidate tier labels + rename IdentityTier ccab→ccib

**Files:**
- Create: `src/lib/repo/labels.ts`
- Modify: `src/lib/repo/types.ts` (line 10)
- Modify: `src/app/suppliers/page.tsx`, `src/app/suppliers/[id]/page.tsx`, `src/app/s/[supplierId]/page.tsx`, `src/components/ui.tsx`, `src/app/analytics/page.tsx`, `src/app/report/ReportLineForm.tsx`
- Modify: `src/lib/alignment/engine.ts` (line 23), `src/lib/alignment/score.ts` (line 18)

**Interfaces:**
- Produces: `src/lib/repo/labels.ts` exports `TIER_LABELS: Record<IdentityTier,string>`, `TIER_STYLES: Record<IdentityTier,string>`, `TIER_RANK: Record<IdentityTier,number>`, all keyed `nation`/`ccib`/`self_declared`.

- [ ] **Step 1: Create the shared module** — `src/lib/repo/labels.ts`

```ts
// Single source of truth for the ownership-certification tier's display labels,
// badge styles, and sort rank. Replaces the copies that were duplicated across
// the supplier pages, the analytics/report pages, and the ui TierBadge.
import type { IdentityTier } from "./types";

export const TIER_LABELS: Record<IdentityTier, string> = {
  nation: "Nation-verified",
  ccib: "CCIB-certified",
  self_declared: "Self-declared",
};

export const TIER_STYLES: Record<IdentityTier, string> = {
  nation: "border-cedar/30 bg-cedar/10 text-cedar",
  ccib: "border-amber/30 bg-amber/10 text-amber",
  self_declared: "border-rust/30 bg-rust/10 text-rust",
};

export const TIER_RANK: Record<IdentityTier, number> = { nation: 0, ccib: 1, self_declared: 2 };
```

- [ ] **Step 2: Rename the enum** — `src/lib/repo/types.ts` line 10:
```ts
export type IdentityTier = "nation" | "ccib" | "self_declared";
```

- [ ] **Step 3: Run typecheck to see the expected breakage**

Run: `npm run typecheck`
Expected: FAIL — every `Record<IdentityTier, …>` with a `ccab:` key and every `"ccab"` literal now errors (`src/app/suppliers/page.tsx`, `suppliers/[id]/page.tsx`, `s/[supplierId]/page.tsx`, `components/ui.tsx`, `analytics/page.tsx`, `report/ReportLineForm.tsx`, `alignment/engine.ts`, `alignment/score.ts`, and both seed files). The seed files are fixed in Task 5; the rest here.

- [ ] **Step 4: Replace the local tier maps with the shared import** — in each of `src/app/suppliers/page.tsx`, `src/app/suppliers/[id]/page.tsx`, `src/app/s/[supplierId]/page.tsx`, `src/components/ui.tsx`, `src/app/analytics/page.tsx`, `src/app/report/ReportLineForm.tsx`: delete the local `const tierLabels = …`, `const tierStyles = …`, and `const identityRank = …` (only those present in each file), add `import { TIER_LABELS, TIER_STYLES, TIER_RANK } from "@/lib/repo/labels";`, and rename the usages: `tierLabels[…]` → `TIER_LABELS[…]`, `tierStyles[…]` → `TIER_STYLES[…]`, `identityRank[…]` → `TIER_RANK[…]`. (In `suppliers/page.tsx` the identity column at line 68 uses `identityRank[r.s.identityTier]` → `TIER_RANK[...]`.)

- [ ] **Step 5: Fix the non-map ccab usages** —
  - `src/app/analytics/page.tsx` line ~90: `(["nation", "ccab", "self_declared"] as const)` → `(["nation", "ccib", "self_declared"] as const)`.
  - `src/lib/alignment/engine.ts` line 23: `s.identityTier === "ccab"` → `s.identityTier === "ccib"`.
  - `src/lib/alignment/score.ts` line 18: `ccab: 0.9,` → `ccib: 0.9,`.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: errors remain ONLY in `src/lib/seed/fixtures.ts` and `src/lib/repo/repo.mock.ts` (the seed `identityTier: "ccab"` values — Task 5).

- [ ] **Step 7: Commit**

```bash
git add src/lib/repo/labels.ts src/lib/repo/types.ts src/app/suppliers "src/app/s/[supplierId]/page.tsx" src/components/ui.tsx src/app/analytics/page.tsx src/app/report/ReportLineForm.tsx src/lib/alignment/engine.ts src/lib/alignment/score.ts
git commit -m "refactor(suppliers): rename IdentityTier ccab->ccib + consolidate tier maps"
```

---

### Task 5: Rename ccab→ccib in the seed + reference strings + profile prose

**Files:**
- Modify: `src/lib/seed/fixtures.ts`, `src/lib/repo/repo.mock.ts`
- Modify: `src/lib/suppliers/supplier-profiles.ts`
- Test: `scripts/test-supplier-labels.ts` (extend)

**Interfaces:**
- Consumes: `TIER_LABELS` (Task 4).
- Produces: no seeded `identityTier: "ccab"` remains; reference strings say "CCIB"; typecheck green.

- [ ] **Step 1: Extend the test** — append to `scripts/test-supplier-labels.ts` (inside the async block):

```ts
import { TIER_LABELS } from "../src/lib/repo/labels";
assert.equal(TIER_LABELS["ccib"], "CCIB-certified");
const ccibSuppliers = suppliers.filter((s) => s.identityTier === "ccib");
assert.ok(ccibSuppliers.length >= 1, "at least one CCIB-tier supplier seeded");
```

(`suppliers` is the `parties`-filtered array already defined in Task 2's test extension.)

- [ ] **Step 2: Run test to verify it fails** (or typecheck still red)

Run: `npm run typecheck`
Expected: FAIL — seed `identityTier: "ccab"` not assignable to `IdentityTier`.

- [ ] **Step 3: Fix the seed in BOTH files** — in `src/lib/seed/fixtures.ts` AND `src/lib/repo/repo.mock.ts` (apply the SAME edits to each; use replace-all on each string):
  - `identityTier: "ccab"` → `identityTier: "ccib"` (3 occurrences each).
  - `reference: "CCAB Certified Indigenous Business"` → `reference: "CCIB Certified Indigenous Business"` (2 each).
  - `reference: "CCAB Certified (PAR Gold)"` → `reference: "CCIB Certified (PAR Gold)"`.
  - `verifiedBy: "CCAB"` → `verifiedBy: "CCIB"` (3 each).

- [ ] **Step 4: Update profile prose** — in `src/lib/suppliers/supplier-profiles.ts`, change the two user-facing "CCAB-certified" strings (in the `owner` fields, ~lines 42, 82) to "CCIB-certified". Leave the `ccab.com` URL/comment (line ~35) as provenance.

- [ ] **Step 5: Run test + typecheck**

Run: `npx tsx scripts/test-supplier-labels.ts && npm run typecheck`
Expected: `✅ test-supplier-labels passed`; typecheck 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/seed/fixtures.ts src/lib/repo/repo.mock.ts src/lib/suppliers/supplier-profiles.ts scripts/test-supplier-labels.ts
git commit -m "fix(suppliers): CCAB->CCIB in seed identity tiers, references, and profile prose"
```

---

### Task 6: Verification + delivery

**Files:** none (verification).

- [ ] **Step 1: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 0 type errors; "Compiled successfully".

- [ ] **Step 2: Run the supplier-labels test + the taxonomy/facts suites (regression)**

Run: `for t in test-supplier-labels test-taxonomy test-commitments-facts test-buildfacts-crosswalk test-treemap-drill; do npx tsx scripts/$t.ts; done`
Expected: each prints its `✅ … passed`.

- [ ] **Step 3: Grep guard — no residual identity-tier CCAB**

Run: `grep -rnE "\"ccab\"|CCAB|ccab:" src/app src/lib src/components | grep -viE "ccab.com|commitments/fixtures"`
Expected: no output. (Permitted, excluded by the filter: the `ccab.com` provenance comment/URL in `supplier-profiles.ts`, and the out-of-scope factual "CCAB partnership" references in `src/lib/commitments/fixtures.ts`.) If any other hit remains, it's an identity-tier miss — fix it.

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin feat/suppliers-normalization
gh pr create --repo logisticPM/portal --base main --head feat/suppliers-normalization --title "Suppliers normalization: sector enum + CCAB→CCIB" --body "Implements docs/superpowers/specs/2026-07-09-suppliers-normalization-design.md. Q2: adds technology + professional_services to the canonical sector enum, re-normalizes Animikii->technology and NTG->professional_services, and renders sectorNorm via canonical labelFor consistently on all three supplier surfaces. Q3: renames IdentityTier ccab->ccib, consolidates the duplicated tier-label maps into src/lib/repo/labels.ts, and updates seed identity tiers + reference strings + profile prose + alignment tier weights. typecheck 0, build green, tests pass."
```

---

## Self-review

**Spec coverage:** Q2 enum → Task 1; Q2 re-normalize → Task 2; Q2 display → Task 3; Q3 rename + consolidate + alignment → Task 4; Q3 seed + references + prose → Task 5; tests/gates/grep → each task + Task 6. All spec sections mapped.

**Placeholder scan:** No TBD/TODO; every step has concrete code/edits. Task 2 Step 1 carries a conditional (verify the exact mock supplier accessor) — this is a real instruction with a concrete fallback, not a placeholder.

**Type consistency:** `TIER_LABELS`/`TIER_STYLES`/`TIER_RANK` defined in Task 4, consumed in Tasks 4-5. `IdentityTier` keys `nation`/`ccib`/`self_declared` consistent across labels.ts, seed, and alignment. `labelFor("sector", key)` signature matches the merged taxonomy module. `CanonicalSector` additions in Task 1 are consumed by the seed norms in Task 2.

**Cross-task note:** Task 4 leaves typecheck red (seed still `ccab`); Task 5 makes it green. Flagged in Task 4 Step 6.
