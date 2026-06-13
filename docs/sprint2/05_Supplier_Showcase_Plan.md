# Verified Supplier Showcase (RAP-42) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, counts-only "verified Indigenous business" showcase page from each supplier's OCAP-owned confirmed record, plus a supplier-side profile editor with a public toggle.

**Architecture:** Additive `Supplier` fields + a public-safe `SupplierShowcase` aggregate behind the `PortalRepo` seam (mock + dynamo). A standalone public route `/s/[supplierId]` renders it (counts-only — no named buyers, no per-deal amounts); a `/profile` editor in the supplier portal edits self-described fields + the public toggle.

**Tech Stack:** Next.js 14 App Router (server components + server actions), TypeScript, the `PortalRepo` seam (`repo.mock` + `repo.dynamo` single-table), Tailwind.

**Verification note:** this project has **no unit-test framework**. Verification = `npm run typecheck`, `npm run build`, and rendering on the mock backend (`REPO_IMPL=mock npm run dev`). Dynamo parity is via `npm run verify` (needs Docker) — optional. Spec: `docs/sprint2/05_Supplier_Showcase_Design.md`.

---

## Task 1: Data layer — seam + mock + dynamo + seed

The interface methods + both implementors must land together so `typecheck` stays green.

**Files:**
- Modify: `src/lib/repo/types.ts`
- Modify: `src/lib/repo/repo.mock.ts`
- Modify: `src/lib/repo/repo.dynamo/reads.ts`
- Modify: `src/lib/repo/repo.dynamo/writes.ts`
- Modify: `src/lib/repo/repo.dynamo/index.ts`
- Modify: `src/lib/dynamo/single-table.ts`
- Modify: `src/lib/seed/fixtures.ts`

- [ ] **Step 1: Add Supplier fields + `SupplierShowcase` + 2 interface methods (`types.ts`)**

In `Supplier`, after `ownershipPct?: number;` add:

```ts
  // --- showcase (self-described, supplier-editable) ---
  sector?: string;
  blurb?: string;
  region?: string;
  website?: string;
  profilePublic?: boolean; // OCAP toggle; default false
```

After the `SupplierRecord` interface, add:

```ts
// Public-safe showcase aggregate. NEVER carries named buyers or per-deal lines.
export interface SupplierShowcase {
  supplierId: string;
  name: string;
  identityTier: IdentityTier;
  ownershipPct?: number;
  sector?: string;
  blurb?: string;
  region?: string;
  website?: string;
  confirmedRevenue: number;
  byFlow: Record<FlowType, { confirmed: number }>;
  confirmedBuyerCount: number;
  tags: string[];
  asOf: string;
}
```

In the `PortalRepo` interface, in the supplier-side group, add:

```ts
  getSupplierShowcase(supplierId: string): Promise<SupplierShowcase | null>;
  updateSupplierProfile(supplierId: string, input: {
    sector?: string; blurb?: string; region?: string; website?: string; profilePublic?: boolean;
  }): Promise<Supplier>;
```

- [ ] **Step 2: Implement both methods + seed profile fields in `repo.mock.ts`**

Add `SupplierShowcase` to the type import. In the seed `parties`, set profile fields on three suppliers (replace those three lines):

```ts
  { id: "s-eagle", role: "supplier", name: "Eagle River Construction", identityTier: "nation", ownershipPct: 100, sector: "Construction", region: "BC", blurb: "Heavy civil & site construction for energy and public works.", profilePublic: true, registered: true, createdAt: now() },
  { id: "s-raven", role: "supplier", name: "Raven Logistics", identityTier: "ccab", ownershipPct: 80, sector: "Logistics", region: "AB", blurb: "Freight, warehousing and last-mile across the prairies.", profilePublic: true, registered: true, createdAt: now() },
  { id: "s-sweetgrass", role: "supplier", name: "Sweetgrass Catering", identityTier: "self_declared", ownershipPct: 35, sector: "Catering", region: "SK", blurb: "Event and corporate catering.", profilePublic: true, registered: true, createdAt: now() },
```

Add the two methods to `mockRepo` (next to `getSupplierRecord`):

```ts
  async getSupplierShowcase(supplierId) {
    const p = parties.find((x) => x.id === supplierId);
    if (!p || p.role !== "supplier" || p.profilePublic !== true) return null;
    const mine = lines.filter((l) => l.supplierId === supplierId && !l.withdrawn);
    const byFlow = FLOWS.reduce(
      (acc, f) => { acc[f] = { confirmed: 0 }; return acc; },
      {} as Record<FlowType, { confirmed: number }>,
    );
    const buyers = new Set<string>();
    const tagSet = new Set<string>();
    let confirmedRevenue = 0;
    let asOf = "";
    for (const l of mine) {
      const c = confirmedAmount(l);
      if (c > 0) {
        byFlow[l.flowType].confirmed += c;
        confirmedRevenue += c;
        buyers.add(l.companyId);
        for (const t of l.tags ?? []) tagSet.add(t);
      }
      if (l.period > asOf) asOf = l.period;
    }
    return {
      supplierId, name: p.name, identityTier: p.identityTier, ownershipPct: p.ownershipPct,
      sector: p.sector, blurb: p.blurb, region: p.region, website: p.website,
      confirmedRevenue, byFlow, confirmedBuyerCount: buyers.size, tags: [...tagSet], asOf,
    };
  },

  async updateSupplierProfile(supplierId, input) {
    const p = parties.find((x) => x.id === supplierId);
    if (!p || p.role !== "supplier") throw new Error(`supplier not found: ${supplierId}`);
    if (input.sector !== undefined) p.sector = input.sector;
    if (input.blurb !== undefined) p.blurb = input.blurb;
    if (input.region !== undefined) p.region = input.region;
    if (input.website !== undefined) p.website = input.website;
    if (input.profilePublic !== undefined) p.profilePublic = input.profilePublic;
    return p;
  },
```

- [ ] **Step 3: Marshal the new fields in `single-table.ts`**

In `toPartyItem`, after the `ownershipPct: ...` line add:

```ts
    sector: p.role === "supplier" ? p.sector : undefined,
    blurb: p.role === "supplier" ? p.blurb : undefined,
    region: p.role === "supplier" ? p.region : undefined,
    website: p.role === "supplier" ? p.website : undefined,
    profilePublic: p.role === "supplier" ? p.profilePublic : undefined,
```

In `itemToParty`, in the supplier branch after `ownershipPct: it.ownershipPct,` add:

```ts
      sector: it.sector,
      blurb: it.blurb,
      region: it.region,
      website: it.website,
      profilePublic: it.profilePublic,
```

- [ ] **Step 4: Implement `getSupplierShowcase` in `repo.dynamo/reads.ts`**

Add `GetCommand` to the `@aws-sdk/lib-dynamodb` import; add `keys`, `itemToParty` to the `single-table` import; add `SupplierShowcase` to the `../types` import. Then add:

```ts
export async function getSupplierShowcase(supplierId: string): Promise<SupplierShowcase | null> {
  const partyRes = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: keys.party(supplierId) }));
  const p = partyRes.Item ? itemToParty(partyRes.Item as Item) : null;
  if (!p || p.role !== "supplier" || p.profilePublic !== true) return null;

  const res = await ddbDoc.send(new QueryCommand({
    TableName: TABLE, IndexName: GSI1,
    KeyConditionExpression: "GSI1PK = :pk",
    ExpressionAttributeValues: { ":pk": gsi1Supplier(supplierId) },
  }));
  const items = (res.Items ?? []) as Item[];
  const lines = items.filter((it) => it.et === "Line" && !it.withdrawn).map(itemToLine);
  const active = indexActiveConfs(items.filter((it) => it.et === "Conf").map(itemToConf));

  const byFlow = FLOWS.reduce(
    (acc, f) => { acc[f] = { confirmed: 0 }; return acc; },
    {} as Record<FlowType, { confirmed: number }>,
  );
  const buyers = new Set<string>();
  const tagSet = new Set<string>();
  let confirmedRevenue = 0;
  let asOf = "";
  for (const l of lines) {
    const c = confirmedAmount(l, active);
    if (c > 0) {
      byFlow[l.flowType].confirmed += c;
      confirmedRevenue += c;
      buyers.add(l.companyId);
      for (const t of l.tags ?? []) tagSet.add(t);
    }
    if (l.period > asOf) asOf = l.period;
  }
  return {
    supplierId, name: p.name, identityTier: p.identityTier, ownershipPct: p.ownershipPct,
    sector: p.sector, blurb: p.blurb, region: p.region, website: p.website,
    confirmedRevenue, byFlow, confirmedBuyerCount: buyers.size, tags: [...tagSet], asOf,
  };
}
```

- [ ] **Step 5: Implement `updateSupplierProfile` in `repo.dynamo/writes.ts`**

Add `GetCommand` to the `@aws-sdk/lib-dynamodb` import; add `itemToParty`, `keys` to the `single-table` import. Then add:

```ts
export async function updateSupplierProfile(supplierId: string, input: {
  sector?: string; blurb?: string; region?: string; website?: string; profilePublic?: boolean;
}): Promise<Supplier> {
  const res = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: keys.party(supplierId) }));
  const p = res.Item ? itemToParty(res.Item as Item) : null;
  if (!p || p.role !== "supplier") throw new Error(`supplier not found: ${supplierId}`);
  const updated: Supplier = {
    ...p,
    sector: input.sector ?? p.sector,
    blurb: input.blurb ?? p.blurb,
    region: input.region ?? p.region,
    website: input.website ?? p.website,
    profilePublic: input.profilePublic ?? p.profilePublic,
  };
  await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: toPartyItem(updated) }));
  return updated;
}
```

- [ ] **Step 6: Wire the two methods into the assembled dynamo repo (`repo.dynamo/index.ts`)**

Import `getSupplierShowcase` (from `./reads`) and `updateSupplierProfile` (from `./writes`) and add both to the exported `dynamoRepo` object, next to `getSupplierRecord` / `registerSupplier` (follow the existing one-line-per-method mapping in that file).

- [ ] **Step 7: Seed profile fields in `seed/fixtures.ts`**

Replace the three matching supplier lines with (mirrors the mock seed):

```ts
  { id: "s-eagle", role: "supplier", name: "Eagle River Construction", identityTier: "nation", ownershipPct: 100, sector: "Construction", region: "BC", blurb: "Heavy civil & site construction for energy and public works.", profilePublic: true, registered: true, createdAt: T },
  { id: "s-raven", role: "supplier", name: "Raven Logistics", identityTier: "ccab", ownershipPct: 80, sector: "Logistics", region: "AB", blurb: "Freight, warehousing and last-mile across the prairies.", profilePublic: true, registered: true, createdAt: T },
  { id: "s-sweetgrass", role: "supplier", name: "Sweetgrass Catering", identityTier: "self_declared", ownershipPct: 35, sector: "Catering", region: "SK", blurb: "Event and corporate catering.", profilePublic: true, registered: true, createdAt: T },
```

- [ ] **Step 8: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both PASS (no missing-method errors on `mockRepo`/`dynamoRepo`).

- [ ] **Step 9: Commit**

```bash
git add src/lib/repo/types.ts src/lib/repo/repo.mock.ts src/lib/repo/repo.dynamo src/lib/dynamo/single-table.ts src/lib/seed/fixtures.ts
git commit -m "RAP-42 data layer: Supplier profile fields + getSupplierShowcase/updateSupplierProfile (mock + dynamo)"
```

---

## Task 2: Public showcase route `/s/[supplierId]`

**Files:**
- Create: `src/app/s/[supplierId]/page.tsx`

- [ ] **Step 1: Create the public page**

```tsx
import { repo } from "@/lib/repo";
import { money } from "@/components/ui";
import type { IdentityTier } from "@/lib/repo/types";

export const dynamic = "force-dynamic";

const tierLabels: Record<IdentityTier, string> = {
  nation: "Nation-verified",
  ccab: "CCAB-certified",
  self_declared: "Self-declared",
};
const tierStyles: Record<IdentityTier, string> = {
  nation: "border-cedar/30 bg-cedar/10 text-cedar",
  ccab: "border-amber/30 bg-amber/10 text-amber",
  self_declared: "border-rust/30 bg-rust/10 text-rust",
};

export default async function ShowcasePage({ params }: { params: { supplierId: string } }) {
  const s = await repo.getSupplierShowcase(params.supplierId);

  if (!s) {
    return (
      <div className="max-w-2xl space-y-3">
        <p className="text-ink2">This profile isn&apos;t public.</p>
        <a href="/" className="text-ink3 underline text-sm">← Indigenomics Data Portal</a>
      </div>
    );
  }

  const flows = Object.entries(s.byFlow).filter(([, v]) => v.confirmed > 0);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl">{s.name}</h1>
          <span className={`text-xs uppercase tracking-wider border rounded-full px-2 py-0.5 ${tierStyles[s.identityTier]}`}>
            {tierLabels[s.identityTier]}
          </span>
          {s.ownershipPct != null && (
            <span className="text-ink3 text-sm">{s.ownershipPct}% Indigenous-owned</span>
          )}
        </div>
        {s.blurb && <p className="text-ink2 mt-2">{s.blurb}</p>}
        <div className="text-ink3 text-sm mt-1">
          {[s.sector, s.region].filter(Boolean).join(" · ")}
          {s.website && (
            <>
              {" · "}
              <a href={s.website} target="_blank" rel="noreferrer" className="underline">website ↗</a>
            </>
          )}
        </div>
      </div>

      <div className="bg-panel rounded border border-line shadow-card p-5 space-y-3">
        <div className="text-ink3 text-xs uppercase tracking-widest">
          Verified track record — verified by the Indigenomics Data Portal · as of {s.asOf || "—"}
        </div>
        <div className="font-serif text-4xl text-amber">{money(s.confirmedRevenue)}</div>
        <div className="text-ink3 text-sm">
          confirmed · across {s.confirmedBuyerCount} confirmed {s.confirmedBuyerCount === 1 ? "buyer" : "buyers"}
        </div>
        {flows.length > 0 && (
          <div className="space-y-1 pt-2">
            {flows.map(([flow, v]) => (
              <div key={flow} className="flex justify-between text-sm">
                <span className="capitalize">{flow}</span>
                <span className="text-ink3">{money(v.confirmed)}</span>
              </div>
            ))}
          </div>
        )}
        {s.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {s.tags.map((t) => (
              <span key={t} className="text-[0.6rem] uppercase tracking-wider border border-ink3/40 text-ink3 rounded px-1.5 py-0.5">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="text-ink3 text-xs">
        Confirmed by the named Indigenous business against buyer-reported transactions. Per-buyer
        detail is private (counts only).
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Build + render check**

Run: `npm run build` (expect PASS), then `REPO_IMPL=mock PORT=3100 npm run dev` and open `http://localhost:3100/s/s-eagle`.
Expected: verified block ($ confirmed, by-flow, buyer count, tags) + tier badge + 100% + blurb/sector/region; **no buyer names, no per-deal amounts**. Open `http://localhost:3100/s/s-thunderbird` (profilePublic unset) → "This profile isn't public."

- [ ] **Step 3: Commit**

```bash
git add src/app/s
git commit -m "RAP-42: public verified-supplier showcase route /s/[supplierId]"
```

---

## Task 3: Supplier profile editor + action + nav

**Files:**
- Modify: `src/lib/repo/actions.ts`
- Create: `src/app/(supplier)/profile/page.tsx`
- Modify: `src/components/SupplierNav.tsx`

- [ ] **Step 1: Add the server action (`actions.ts`)**

Append:

```ts
// Supplier edits their showcase profile (self-described fields + the public toggle).
export async function updateSupplierProfileAction(formData: FormData) {
  const supplierId = String(formData.get("supplierId") ?? "").trim();
  if (!supplierId) return;
  await repo.updateSupplierProfile(supplierId, {
    sector: String(formData.get("sector") ?? "").trim() || undefined,
    region: String(formData.get("region") ?? "").trim() || undefined,
    website: String(formData.get("website") ?? "").trim() || undefined,
    blurb: String(formData.get("blurb") ?? "").trim() || undefined,
    profilePublic: formData.get("profilePublic") === "true",
  });
  revalidatePath("/profile");
  revalidatePath(`/s/${supplierId}`);
}
```

- [ ] **Step 2: Create the editor page (`src/app/(supplier)/profile/page.tsx`)**

```tsx
import { repo } from "@/lib/repo";
import { updateSupplierProfileAction } from "@/lib/repo/actions";

export const dynamic = "force-dynamic";

function Field({ name, label, defaultValue, placeholder }: {
  name: string; label: string; defaultValue?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-ink3 text-xs uppercase tracking-widest mb-1">{label}</label>
      <input
        name={name}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        className="w-full bg-bg border border-ink/15 rounded px-3 py-2"
      />
    </div>
  );
}

export default async function ProfilePage({ searchParams }: { searchParams: { as?: string } }) {
  const supplierId = searchParams.as;
  const suppliers = await repo.listParties("supplier");

  if (!supplierId) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-2xl">My Profile — pick a supplier</h1>
        <div className="grid gap-2">
          {suppliers.map((s) => (
            <a key={s.id} className="bg-panel rounded border border-line px-4 py-3 hover:text-amber" href={`/profile?as=${s.id}`}>
              {s.name}
            </a>
          ))}
        </div>
      </div>
    );
  }

  const supplier = await repo.getParty(supplierId);
  if (!supplier || supplier.role !== "supplier") {
    return <p className="text-ink2">Not a supplier.</p>;
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-2xl">{supplier.name} — profile</h1>
        <a className="ml-auto text-ink3 underline text-sm" href={`/s/${supplierId}`}>view public page →</a>
      </div>
      <p className="text-ink2 text-sm">
        Your showcase is built from your confirmed record — you own it (OCAP). These fields are your
        own words; the verified numbers come from the confirmation engine. Public is your choice.
      </p>
      <form action={updateSupplierProfileAction} className="space-y-4 bg-panel rounded border border-line shadow-card p-5">
        <input type="hidden" name="supplierId" value={supplierId} />
        <Field name="sector" label="Sector" defaultValue={supplier.sector} placeholder="e.g. Construction" />
        <Field name="region" label="Region / territory" defaultValue={supplier.region} placeholder="e.g. BC" />
        <Field name="website" label="Website" defaultValue={supplier.website} placeholder="https://…" />
        <div>
          <label className="block text-ink3 text-xs uppercase tracking-widest mb-1">One-line description</label>
          <input
            name="blurb"
            defaultValue={supplier.blurb ?? ""}
            placeholder="What you do, in one line"
            className="w-full bg-bg border border-ink/15 rounded px-3 py-2"
          />
        </div>
        <label className="flex items-center gap-2 text-ink2">
          <input type="checkbox" name="profilePublic" value="true" defaultChecked={supplier.profilePublic === true} />
          Make my profile public (shareable link)
        </label>
        <button className="bg-amber/20 text-amber border border-amber/40 rounded px-4 py-2 hover:bg-amber/30">
          Save profile
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Add "My Profile" to the supplier nav (`SupplierNav.tsx`)**

In the `LINKS` array, after the `/record` entry add:

```ts
  { href: "/profile", label: "My Profile", keepAs: true },
```

- [ ] **Step 4: Build + render roundtrip**

Run: `npm run build` (expect PASS). On `REPO_IMPL=mock PORT=3100 npm run dev`: open `/profile?as=s-thunderbird`, fill sector/region/blurb, check "Make my profile public", Save. Then open `/s/s-thunderbird` → it now renders (was not-public). Confirm `/profile?as=s-eagle` shows the pre-seeded values + the "view public page →" link.

- [ ] **Step 5: Commit**

```bash
git add src/lib/repo/actions.ts "src/app/(supplier)/profile" src/components/SupplierNav.tsx
git commit -m "RAP-42: supplier profile editor (/profile) + public toggle + My Profile nav"
```

---

## Task 4: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run typecheck && npm run build`. Expected: PASS, routes include `/s/[supplierId]` and `/profile`.

- [ ] **Step 2: Acceptance checks on mock** (per spec §8)

On `REPO_IMPL=mock PORT=3100 npm run dev`:
1. `/s/s-eagle` shows verified block + self-described + stamp; no buyer names / per-deal amounts.
2. `/s/s-thunderbird` (left unset, before any edit) shows the not-public state.
3. `/profile?as=...` edit + public toggle reflects on `/s/[id]`.
4. `/s/s-sweetgrass` reads **Self-declared** (no fake verification).

- [ ] **Step 3 (optional): dynamo parity**

If Docker is up: `npm run ddb:up && npm run ddb:create && npm run ddb:seed`, then `REPO_IMPL=dynamo PORT=3100 npm run dev` and confirm `/s/s-eagle` renders the same numbers. (`npm run verify` is unaffected — it doesn't touch showcase.)

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "RAP-42: showcase end-to-end verification fixups" || echo "nothing to commit"
```

---

## Self-review (author)

- **Spec coverage:** §1 data model → Task 1 (steps 1–3, 7); §2 repo → Task 1 (steps 2, 4–6); §3 public route → Task 2; §4 editor → Task 3; §5 page content → Task 2 step 1; §6 seed → Task 1 steps 2, 7; §8 acceptance → Task 4. ✓
- **Counts-only:** `getSupplierShowcase` returns only aggregates + `confirmedBuyerCount` (no names/per-deal). ✓
- **Type consistency:** `SupplierShowcase`, `getSupplierShowcase`, `updateSupplierProfile`, `profilePublic` used identically across types/mock/dynamo/pages/action. ✓
- **No placeholders:** every code step shows full code. ✓
