# 05 · Verified Supplier Showcase — design (RAP-42)

**Sprint:** 2 (carry / Horizon) · **Type:** Feature design (brainstormed) · **Owner:** Jack (Tong Wu) — supplier-facing
**Status:** Design approved 2026-06-12 → spec for review → implementation plan
**Branch:** `rap-42-supplier-showcase`

---

## Goal (one line)

Turn the supplier's **OCAP-owned, buyer-confirmed record** into a **public, shareable "verified Indigenous business" page** — a credential no self-listed directory (CCAB/CCIB, Supply Nation, ISC) has, because it's backed by **confirmed transactions**, not self-claims.

## Why — the supplier's need this serves

Indigenous suppliers need to (a) be found, (b) prove Indigenous status once, (c) **show a verifiable track record**, (d) keep data sovereignty. (a)/(b) are partly covered by existing directories; **(c) is the gap only this system can fill** — the confirmation engine already produces a verified track record, and OCAP already gives the supplier ownership of it. The showcase exposes that, supplier-controlled.

## Scope decisions (locked 2026-06-12)

- **Wedge = A (showcase)** only. Discovery/directory (B) and procurement marketplace (C) are out (separate, larger).
- **Visibility = public credential, counts-only.** Aggregates are public; named buyers + per-deal amounts are withheld.
- **Content = verified block + light self-description.**
- **Approach = 1** (public route + additive fields on `Supplier`), not a separate `SupplierProfile` entity (YAGNI).

---

## 1. Data model — `types.ts` (additive, non-breaking)

Add optional fields to `Supplier`:

```ts
export interface Supplier extends BaseParty {
  role: "supplier";
  identityTier: IdentityTier;
  ownershipPct?: number;
  // --- showcase (self-described, supplier-editable) ---
  sector?: string;          // e.g. "Construction"
  blurb?: string;           // one-line description
  region?: string;          // territory / region
  website?: string;
  profilePublic?: boolean;  // OCAP toggle; default false (not public)
}
```

New **public-safe aggregate** type (never carries named buyers or per-deal lines):

```ts
export interface SupplierShowcase {
  supplierId: string;
  name: string;
  identityTier: IdentityTier;
  ownershipPct?: number;
  sector?: string;
  blurb?: string;
  region?: string;
  website?: string;
  confirmedRevenue: number;                       // aggregate, supplier-owned
  byFlow: Record<FlowType, { confirmed: number }>;
  confirmedBuyerCount: number;                    // distinct buyers among confirmed lines — COUNT only
  tags: string[];                                 // distinct tags across confirmed lines
  asOf: string;                                   // latest period covered, e.g. "2025"
}
```

All fields optional/additive → existing repo + pages still compile. (Seam change → announce to the Data group; non-breaking.)

## 2. Repo (the seam) — two methods

```ts
// public showcase aggregate; null when the supplier hasn't made their profile public
getSupplierShowcase(supplierId: string): Promise<SupplierShowcase | null>;

// supplier edits self-described fields + the public toggle
updateSupplierProfile(supplierId: string, input: {
  sector?: string; blurb?: string; region?: string; website?: string; profilePublic?: boolean;
}): Promise<Supplier>;
```

**Counts-only rule (the wall):** `getSupplierShowcase` derives from `getSupplierRecord` then **strips** named buyers and per-line amounts. Public output is limited to supplier-owned aggregates: `confirmedRevenue`, `byFlow` (confirmed only), `confirmedBuyerCount` (distinct `companyId` among confirmed lines), `tags`. Returns `null` if `profilePublic !== true`.

## 3. Public route `/s/[supplierId]`

- **Standalone public page** — NOT in the `(supplier)` route group (no supplier nav; clean + shareable). Lives at `app/s/[supplierId]/page.tsx`, root layout only.
- Server-only, read-only. Calls `getSupplierShowcase`.
- `null` → renders "This profile isn't public." (not an error).
- The portal-hosted URL itself is the proof (the portal vouches).

## 4. Supplier portal — `/profile` editor (Jack)

- `app/(supplier)/profile/page.tsx`: form to edit `sector / blurb / region / website` + the **public toggle**, plus a "View public page →" link to `/s/[id]`.
- `SupplierNav` gains a **My Profile** item.
- Server action `updateSupplierProfileAction` (revalidates `/profile` + `/s/[id]`).
- OCAP framing: "you own it; public is your choice; switch it off any time."

## 5. Page content + trust stamp

```
[Business name]      〔Nation-verified〕   100% Indigenous-owned
[blurb] · Construction · BC · website ↗

VERIFIED TRACK RECORD   — verified by the Indigenomics Data Portal · as of 2025
  $3,385,000 confirmed      ·      across 4 confirmed buyers
  by flow:  Procurement ▓▓▓▓   Capital ▓
  tags:  Innovation
```

- The "verified" block is entirely **confirmation-engine output**, not self-report.
- A `self_declared`-tier supplier is shown **honestly as self-declared** (the showcase never fakes verification — that integrity is the whole point).
- Self-described fields are clearly the supplier's own words (visually distinct from the verified block).

## 6. Seed / demo

Set `profilePublic: true` + `sector / blurb / region` on a few seeded suppliers (mock + dynamo fixtures), e.g. Eagle River (nation), Raven (ccab), and one self-declared (e.g. Sweetgrass) — so `/s/s-eagle` renders immediately and the self-declared one demonstrates the honest low-verification contrast.

## 7. Out of scope (YAGNI)

- ❌ Named-buyer references (counts-only).
- ❌ Logo / gallery / document upload.
- ❌ Discovery / search (wedge B).
- ❌ Buyer-consent flow.
- ❌ Real auth (the demo's `?as=` / role model stands).

## 8. Acceptance criteria

1. `/s/s-eagle` (public) shows the verified block + self-described fields + the "verified by … as of …" stamp; **no named buyers, no per-deal amounts**.
2. A supplier with `profilePublic !== true` → `/s/[id]` shows the not-public state.
3. In `/profile`, a supplier edits self-described fields + toggles public; the public page reflects it.
4. A `self_declared` supplier's showcase reads "self-declared" (no fake verification).
5. `next build` green (typecheck + routes); renders on mock.

## 9. Ownership + coordination

- **Jack (Tong Wu)** builds it — supplier-facing, extends the supplier portal + adds the public route.
- **Seam note:** the `types.ts` additions are optional/non-breaking, but `types.ts` is co-owned → announce to the Data group; they mirror `getSupplierShowcase` / `updateSupplierProfile` + the seed fields in `repo.dynamo` for parity.

**Refs:** spec `§9 OCAP` + `§15 gap 7` (counts-only wall) · `04_Pillar_Model_Proposal` (FlowType, tier-as-equity) · `02_Questionnaire_Expansion_Design` (confirmable-vs-context).
