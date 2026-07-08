# Supplier Directory (institute side) — design spec

**Date:** 2026-07-08 · **Type:** Feature design (institute UI + real data) · **Status:** Design approved — pending implementation plan

> An institute-side **Supplier directory** that mirrors the existing `/organizations` directory: a searchable/sortable list of the 10 real Indigenous-owned suppliers, each row linking to a **supplier profile page** with a Wikipedia-style info box (headquarters, founded, industry, employees, website, about) plus the supplier's identity/verification/track-record. All profile facts are **real and source-cited**.

---

## 1. Goal & scope

Mirror `/organizations` (list) + `/organizations/[id]` (detail) for suppliers, so Indigenomics can browse the verified Indigenous-supplier pool the same way it browses committing companies.

**In scope:**
- `/suppliers` — institute-only list page (table: # · name · sector · region · identity tier · ownership% · confirmed revenue), sector filter, sortable, links to detail.
- `/suppliers/[id]` — institute-only detail page: an "About" info box (headquarters, founded, industry, employees, website, about, owner) + identity-tier badge + ownership% + verifications + track-record (confirmed revenue / buyer count / flow breakdown), reusing the existing `getSupplierShowcase` data.
- New `SupplierProfile` type + `src/lib/suppliers/supplier-profiles.ts` — curated **real** profile facts for the 10 suppliers (mirrors `org-profiles.ts`).
- Nav: add a **"Suppliers"** tab to `InstituteNav`; add `/suppliers` to `INDIGENOMICS_ONLY` in `middleware.ts`.

**Out of scope:** the public `/s/[supplierId]` showcase stays as-is (unchanged). No editing of profiles (curated data). No pagination (10 rows). Company/supplier auth unchanged.

---

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| Detail page | **new `/suppliers/[id]`** (institute view) | Symmetric with `/organizations/[id]`; keeps the public `/s/[id]` decoupled |
| Profile data | curated `SupplierProfile` lookup (like `OrgProfile`) | `Supplier` has only `region`, no HQ/employees/founded; a parallel curated table matches the org pattern and keeps real facts + sources in one place |
| List data | `repo.listParties("supplier")` + `getSupplierShowcase` | reuse existing repo; 10 rows → no pagination, simple table |
| Data realism | real, source-cited; `null` where unpublished | user requirement: real data only; never fabricate a headcount |

---

## 3. Data model

### `SupplierProfile` (new — `src/lib/suppliers/supplier-profiles.ts`, mirrors `OrgProfile`)
```ts
export interface SupplierProfile {
  headquarters: string;   // "Maskwacis, Alberta"
  founded: string;        // "1980"
  industry: string;       // readable label
  employees?: string;     // "~1,300" or "~51–200"; omit if unpublished
  website: string;
  owner: string;          // owning Nation / Tribal Council / "CCAB-certified private"
  about: string;          // one factual sentence
}
export function getSupplierProfile(supplierId: string): SupplierProfile | undefined;
```
Lookup keyed by supplier id (`s-peacehills`, …). A supplier without a profile simply renders the base card (name/sector/region/tier) with no info box — graceful, like companies without an `OrgProfile`.

### Curated real data (all 10 — verified, source-cited in code comments)
| id | HQ | Founded | Industry | Employees | Owner |
|---|---|---|---|---|---|
| s-peacehills | Maskwacis, AB | 1980 | Banking & financial services | ~100+ | Samson Cree Nation |
| s-fch | Toronto, ON | 1998 | Indigenous health benefits & claims | *(unpublished)* | Tribal Councils Investment Group of Manitoba |
| s-bouchier | Fort McKay, AB | 1998 | Logistics & industrial services | ~1,300 | Bouchier family (Fort McKay / Mikisew Cree) |
| s-desnedhe | Saskatoon, SK | 1991 | Indigenous economic development (diversified) | ~273 | English River First Nation |
| s-kitsaki | La Ronge, SK | 1981 | Diversified investment / economic development | ~1,800 (portfolio-wide) | Lac La Ronge Indian Band |
| s-norsask | Meadow Lake, SK | 1971 | Forestry / lumber manufacturing | ~100 | Meadow Lake Tribal Council |
| s-animikii | Victoria, BC | 2003 | Indigenous technology / software | ~30–50 | CCAB-certified (Jeff Ward, Ojibwe/Métis) |
| s-ntg | Ottawa, ON | 2019 (predecessor 1992) | Translation & language services | ~51–200 | CCAB-certified, First Nations-owned |
| s-3ne | Fort Chipewyan, AB | 2018 | Clean energy / solar | *(unpublished)* | ACFN, MCFN & Fort Chipewyan Métis (equal) |
| s-membertou | Sydney (Membertou), NS | 1989 | Economic & business development (diversified) | ~500–1,000 (portfolio-wide) | Membertou First Nation |

Honesty flags baked into the data/UI: employees for **s-fch** and **s-3ne** are omitted (unpublished); **s-kitsaki**/**s-membertou** headcounts are portfolio-wide (label as such); **s-fch** HQ is the Toronto operating office while the owner (TCIG) is Manitoba-based. Each entry carries its source URL(s) in a code comment.

---

## 4. Pages

### `/suppliers` (list) — mirror `src/app/organizations/page.tsx`
- Session-gated (`getSession().kind === "indigenomics"` → else redirect `/home`) + `InstituteNav active="/suppliers"`.
- Load: `const suppliers = await repo.listParties("supplier")` filtered to `role === "supplier"`; per supplier, `getSupplierShowcase(id)` for confirmed revenue / buyer count.
- Table columns: **#** · **Supplier** (link → `/suppliers/[id]`) · **Sector** (sectorNorm) · **Region** (regionNorm) · **Identity tier** (badge) · **Indigenous-owned %** · **Confirmed revenue**.
- Optional sector `FilterRow` (reuse the component). Sorted by confirmed revenue desc (like orgs sort by progress). 10 rows → no pagination.
- Reuse org-page table styling (`bg-panel`, `border-line`, `divide-y`, tier/sector badges).

### `/suppliers/[id]` (detail) — mirror `src/app/organizations/[id]/page.tsx`
- Session-gated + `InstituteNav`.
- Load: `repo.getParty(id)` (the `Supplier`) + `getSupplierProfile(id)` (curated) + `getSupplierShowcase(id)` (track record).
- Sections:
  1. **Header:** name + identity-tier badge + ownership%.
  2. **About info box** (only if `getSupplierProfile` returns): `InfoRow`s for Headquarters, Founded, Industry, Employees (omit row if absent), Owner, Website (link) + the `about` sentence — same layout as the org About box.
  3. **Verifications:** the supplier's `verifications` (source, reference, verifiedBy) — reuse the `/s/[id]` rendering.
  4. **Track record:** confirmed revenue (big number) · buyer count · procurement/capital flow breakdown (from showcase).
- A supplier with no profile still renders header + verifications + track record (graceful).

---

## 5. Components & files

| Unit | Responsibility |
|---|---|
| `src/lib/suppliers/supplier-profiles.ts` *(new)* | `SupplierProfile` type + curated real data + `getSupplierProfile(id)` |
| `src/app/suppliers/page.tsx` *(new)* | institute supplier list (table + sector filter) |
| `src/app/suppliers/[id]/page.tsx` *(new)* | institute supplier detail (About box + verifications + track record) |
| `src/components/InstituteNav.tsx` *(modify)* | add `{ href: "/suppliers", label: "Suppliers" }` tab |
| `src/middleware.ts` *(modify)* | add `/suppliers` to `INDIGENOMICS_ONLY` |

Reused as-is: `InstituteNav`, `FilterRow`, `getSupplierShowcase`, the tier/sector badge styles, `money()`.

---

## 6. Error handling
- Missing profile → render the base card without the About box (no crash), exactly like companies lacking an `OrgProfile`.
- Missing showcase (supplier with no confirmed lines) → track-record shows zeros.
- Unknown `/suppliers/[id]` (or an id whose party isn't a supplier) → `getParty` returns null / non-supplier → render a simple "Supplier not found" message with a link back to `/suppliers` (no crash).
- Non-indigenomics session → redirected by both the page gate and middleware.

## 7. Testing
- `npm run build` — both new routes compile.
- `npm run verify` — unaffected (no repo/marshaller changes; new files are read-only UI + a static data lookup).
- Manual smoke (institute session): `/suppliers` lists the 10 real suppliers with sector/region/tier; clicking one shows its real About box (HQ/founded/employees/website) + verifications + track record. `getSupplierProfile` returns the right facts per id (a tiny `tsx` assertion in `verify-alignment.ts` or a new check can pin the lookup, e.g. `getSupplierProfile("s-norsask").headquarters === "Meadow Lake, Saskatchewan"`).

## 8. Real-data provenance
Every profile fact is sourced (official site / CCAB-CCIB / LinkedIn / news), with source URLs in `supplier-profiles.ts` comments. Unpublished fields are omitted, not guessed. Portfolio-vs-corporate headcounts and the FCH HQ-vs-owner nuance are labeled in the data.
