# Suppliers-domain normalization (Q2 + Q3) — design

**Date:** 2026-07-09
**Status:** approved (design), pending implementation plan
**Scope:** Fix two data-normalization issues in the suppliers domain surfaced by the live-site audit. Q2: the supplier `sectorNorm` enum is lossy/wrong and different screens show different sector fields. Q3: CCAB vs CCIB (the same accreditor, renamed) is used inconsistently.

**Out of scope:** the commitments/Explore taxonomy (already merged, PR #145); the separate `$0` currency KPI fix (PR #146); the empty `self_declared` tier and alignment-scoring-honesty items (separate audit findings).

## Q2 — supplier sector

### Problem
Supplier records carry both a free-text `sector` (`"Technology & software"`) and a normalized `sectorNorm` (the canonical `Sector` enum, used for alignment matching: `engine.ts:41` `sectorMatch = s.sectorNorm === commitment.sector`). Two issues:
1. **Lossy/wrong norms** — the canonical `Sector` enum has no technology/professional bucket, so `Animikii "Technology & software" → telecom` and `Nations Translation Group "Language & professional services" → consulting`. A software agency displays and matches as "Telecom".
2. **Cross-screen inconsistency** — the directory (`suppliers/page.tsx:39`) and institute detail (`suppliers/[id]/page.tsx:63`) render `sectorNorm ?? sector` (the norm → "Telecom"); the public page (`s/[supplierId]/page.tsx:55`) renders raw `sector` ("Technology & software"). Same supplier, two strings.

### Decision (approved)
**Display the canonical `sectorNorm` label consistently on all three surfaces** (via `labelFor`/`SECTOR_LABELS`), after correcting the norm values. One field drives display + facet-filter + alignment matching. The public page switches from raw `sector` → the canonical norm label.

### Changes
- **`src/lib/taxonomy.ts`** — add `technology` and `professional_services` to `CanonicalSector` (16 → 18) and `CANONICAL_SECTORS`; add `SECTOR_LABELS` entries `technology: "Technology"`, `professional_services: "Professional services"`. These are valid-but-unused in the commitments/rap domains (like `other`); the extraction schema (`SECTORS = CANONICAL_SECTORS`) gains them automatically, which is acceptable/positive.
- **Seed — both `src/lib/repo/repo.mock.ts` and `src/lib/seed/fixtures.ts`** (the supplier seed is duplicated across them; keep in lockstep): `Animikii` `sectorNorm` `telecom → technology`; `Nations Translation Group` `sectorNorm` `consulting → professional_services`. Leave the defensible norms unchanged (`Bouchier → transport`, the "& diversified" firms).
- **Display** — render the sector via `labelFor("sector", <sectorNorm>)` on:
  - `src/app/suppliers/page.tsx` — the row's underlying `sector` **key** stays as `s.sectorNorm ?? s.sector` (so the facet chips, `?sector=` querystring, filter, and search continue to work on the stable key), but the **rendered** column text and facet-chip text use `labelFor("sector", key)`. Drop the `capitalize` crutch on those spans.
  - `src/app/suppliers/[id]/page.tsx:63` — render `labelFor("sector", party.sectorNorm ?? party.sector ?? "")`; drop `capitalize`.
  - `src/app/s/[supplierId]/page.tsx:55` — switch from raw `s.sector` to `labelFor("sector", s.sectorNorm ?? s.sector ?? "")`.
  - Fallback: when `sectorNorm` is absent, `labelFor` humanizes whatever key is passed (never a raw snake_case leak).

### Consequence
Corrected-norm suppliers now match the right commitment sectors (or, for `technology`/`professional_services`, correctly match no commitment sector since the commitments corpus has none — the honest outcome, bridged only by the semantic path). Alignment `engine.ts` needs no change (still `sectorNorm === commitment.sector`).

## Q3 — CCAB → CCIB

### Problem
The Canadian Council for Aboriginal Business (CCAB) rebranded to the Canadian Council for Indigenous Business (CCIB). The code uses both: `IdentityTier` member `ccab` (label "CCAB-certified") vs `VerificationSource` member `ccib`, and seed reference strings mix "CCAB" with the new program name. A single supplier shows "CCAB-certified", "CCIB", and "CCAB Certified Indigenous Business".

### Decision (approved)
Standardize on **CCIB** everywhere.

### Changes
- **`src/lib/repo/types.ts`** — `IdentityTier` member `"ccab" → "ccib"`. (`VerificationSource` already has `ccib` — now consistent.)
- **Consolidate tier labels** — the `tierLabels` / `tierStyles` / `identityRank` maps are duplicated across `suppliers/page.tsx`, `suppliers/[id]/page.tsx`, `s/[supplierId]/page.tsx`. Extract one shared module `src/lib/repo/labels.ts` (`TIER_LABELS`, `TIER_STYLES`, `TIER_RANK`), imported by all three; set `ccib: "CCIB-certified"`.
- **Seed — both `repo.mock.ts` and `seed/fixtures.ts`**: `identityTier: "ccab" → "ccib"` (×3 suppliers); reference strings `"CCAB Certified Indigenous Business" → "CCIB Certified Indigenous Business"`, `"CCAB Certified (PAR Gold)" → "CCIB Certified (PAR Gold)"`.
- **Alignment** — `engine.ts:23` `isVerifiedSupplier` (`… || s.identityTier === "ccab"`) → `"ccib"`; `score.ts:18` `TIER_WEIGHT` key `ccab: 0.9 → ccib: 0.9`.
- **Sweep remaining sites** — `analytics/page.tsx`, `report/ReportLineForm.tsx`, `supplier-profiles.ts`, and both fixtures: update any `ccab`/CCAB references. The `IdentityTier` rename makes every stale usage a **compile error** (typecheck is the completeness net).

## Testing / gates
- `npm run typecheck` — the two enum edits (add 2 sectors, rename `ccab→ccib`) surface every affected site; a `Record<IdentityTier, …>` with a stale `ccab` key errors. Primary completeness net.
- `npm run build` — "Compiled successfully".
- New `scripts/test-supplier-labels.ts` — asserts: `labelFor("sector", "technology") === "Technology"` and `"professional_services" === "Professional services"`; the corrected seed suppliers (Animikii, NTG) carry the new norms; `TIER_LABELS.ccib === "CCIB-certified"`.
- Grep guard — no residual `"ccab"` / `CCAB-certified` / lowercase `ccab` identity-tier usages remain (allow historical prose if any).

## Risks / notes
- The supplier seed exists in two files (`repo.mock.ts` inline seed + `seed/fixtures.ts`) — they must be edited together or the mock and dynamo backends diverge. (Pre-existing duplication; flagged in the earlier audit.)
- Adding two sectors to the shared canonical enum grows the extractor's sector choices and the (data-driven-gated) Explore dimension domain; no degenerate display results because aggregation drops zero-count categories.
- `ccab`/`ccib` now both exist across `IdentityTier` and `VerificationSource` as the same `ccib` spelling — intentional (one accreditor), not a collision.
