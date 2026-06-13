# Indigenous Business Verification System (RAP-43, P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Make a supplier's tier verification-backed (not self-selected) by linking external certifications (CCIB CIB / ISC IBD / Nation / regional), and surface the **status × substance** integrity signal — without re-certifying or building a marketplace.

**Architecture:** Additive `Verification[]` on `Supplier` behind the `PortalRepo` seam (mock + dynamo). `identityTier` becomes a verification-derived cache (registration defaults to `self_declared`; tier only rises via a *verified* `Verification`). New surfaces: a supplier "My certifications" claim flow, a lean reviewer "verify" view, showcase provenance, and an Index mismatch flag.

**Tech Stack:** Next.js 14 App Router (server components + actions), TypeScript, the `PortalRepo` seam (`repo.mock` + `repo.dynamo` single-table), Tailwind.

**Verification gate:** no unit-test framework — verify with `npm run typecheck` + `npm run build` + mock render (`REPO_IMPL=mock npm run dev`). Spec: `docs/sprint2/06_Verification_System_Design.md`.

**Dynamo note:** for every `repo.mock` method/field added below, mirror it in `repo.dynamo` (`reads.ts` / `writes.ts`), wire it in `repo.dynamo/index.ts`, and marshal new persisted fields in `dynamo/single-table.ts` (`toPartyItem` + `itemToParty`) — following the exact patterns those files already use for `getSupplierShowcase` / `updateSupplierProfile` / supplier fields. `typecheck` fails until both repos implement the interface, so do both in the same task.

---

## Task 1: Data layer — Verification model + repo (mock + dynamo) + seed

**Files:** `src/lib/repo/types.ts`, `src/lib/repo/repo.mock.ts`, `src/lib/repo/repo.dynamo/reads.ts`, `src/lib/repo/repo.dynamo/writes.ts`, `src/lib/repo/repo.dynamo/index.ts`, `src/lib/dynamo/single-table.ts`, `src/lib/seed/fixtures.ts`

- [ ] **Step 1: types.ts — Verification model + interface methods**

After `IdentityTier`, add:

```ts
export type VerificationSource = "nation" | "ccib" | "isc_ibd" | "regional";
export type VerificationStatus = "verified" | "pending" | "expired" | "revoked";

// A LINKED external certification (Layer A). We reference it; we never issue it.
export interface Verification {
  source: VerificationSource;
  reference?: string;   // CIB member #, IBD listing id, band-council-resolution ref
  status: VerificationStatus;
  verifiedAt?: string;  // ISO
  expiresAt?: string;   // ISO; past → treated as expired
  verifiedBy?: string;
}
```

In `Supplier`, after `profilePublic?: boolean;` add:

```ts
  verifications?: Verification[]; // Layer A: linked external certifications (drive identityTier)
```

In the `SupplierShowcase` interface, after `ownershipPct?: number;` add:

```ts
  verifications: Verification[]; // active (verified, non-expired) certs, for provenance display
```

In `IndexSummary`, after `disputedCount: number;` add:

```ts
  integrity: { certifiedNoActivity: number; selfDeclaredWithActivity: number }; // status×substance mismatch counts
```

In `PortalRepo` (supplier-side group) add:

```ts
  claimVerification(supplierId: string, input: { source: VerificationSource; reference?: string }): Promise<Verification>;
  resolveVerification(supplierId: string, source: VerificationSource, input: { status: VerificationStatus; expiresAt?: string; verifiedBy?: string }): Promise<Supplier>;
  listPendingVerifications(): Promise<{ supplier: Supplier; verification: Verification }[]>;
```

And change `registerSupplier`'s input to drop the tier (suppliers start self-declared):

```ts
  registerSupplier(input: { name: string }): Promise<Supplier>;
```

- [ ] **Step 2: repo.mock.ts — tier helper, methods, registration, seed**

Add `Verification`, `VerificationSource`, `VerificationStatus` to the type import.

Add a tier-derivation helper near the other helpers (after `tierOf`):

```ts
// identityTier is DERIVED from active (verified, non-expired) verifications — never self-set.
function isActive(v: Verification): boolean {
  return v.status === "verified" && (!v.expiresAt || v.expiresAt >= now().slice(0, 10));
}
function tierFromVerifications(vs: Verification[] | undefined): IdentityTier {
  const active = (vs ?? []).filter(isActive);
  if (active.some((v) => v.source === "nation")) return "nation";
  if (active.length > 0) return "ccab"; // ccib / isc_ibd / regional all map to the "certified" tier
  return "self_declared";
}
```

Replace `registerSupplier` (new suppliers are self-declared, no tier input):

```ts
  async registerSupplier(input) {
    const party: Supplier = {
      id: `s-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
      role: "supplier",
      name: input.name,
      identityTier: "self_declared",
      verifications: [],
      registered: true,
      createdAt: now(),
    };
    parties.push(party);
    return party;
  },
```

Add the three verification methods (next to `updateSupplierProfile`):

```ts
  async claimVerification(supplierId, input) {
    const p = parties.find((x) => x.id === supplierId);
    if (!p || p.role !== "supplier") throw new Error(`supplier not found: ${supplierId}`);
    p.verifications = (p.verifications ?? []).filter((v) => v.source !== input.source); // one per source
    const v: Verification = { source: input.source, reference: input.reference, status: "pending" };
    p.verifications.push(v);
    return v;
  },

  async resolveVerification(supplierId, source, input) {
    const p = parties.find((x) => x.id === supplierId);
    if (!p || p.role !== "supplier") throw new Error(`supplier not found: ${supplierId}`);
    const v = (p.verifications ?? []).find((x) => x.source === source);
    if (!v) throw new Error(`no ${source} verification to resolve for ${supplierId}`);
    v.status = input.status;
    if (input.status === "verified") {
      v.verifiedAt = now();
      v.expiresAt = input.expiresAt;
      v.verifiedBy = input.verifiedBy;
    }
    p.identityTier = tierFromVerifications(p.verifications); // recompute the cache
    return p;
  },

  async listPendingVerifications() {
    const out: { supplier: Supplier; verification: Verification }[] = [];
    for (const p of parties) {
      if (p.role !== "supplier") continue;
      for (const v of p.verifications ?? []) {
        if (v.status === "pending") out.push({ supplier: p, verification: v });
      }
    }
    return out;
  },
```

In `getSupplierShowcase`, add active verifications to the returned object (before `confirmedRevenue` in the return):

```ts
      verifications: (p.verifications ?? []).filter(isActive),
```

In `getIndexSummary`, after computing `byTier`/`byTag`, compute the integrity mismatch and add it to the return. Insert before the `return {`:

```ts
    const integrity = { certifiedNoActivity: 0, selfDeclaredWithActivity: 0 };
    for (const p of parties) {
      if (p.role !== "supplier") continue;
      const confirmed = active
        .filter((l) => l.supplierId === p.id)
        .reduce((s, l) => s + confirmedAmount(l), 0);
      if (p.identityTier !== "self_declared" && confirmed === 0) integrity.certifiedNoActivity++;
      if (p.identityTier === "self_declared" && confirmed > 0) integrity.selfDeclaredWithActivity++;
    }
```

and add `integrity,` to the returned object.

- [ ] **Step 3: Seed verifications (repo.mock.ts `parties`)**

Give the seeded suppliers verification histories that demo the model. Replace the supplier seed lines so each carries `verifications` AND set `identityTier` to match `tierFromVerifications` (eagle/cedarsage = nation; raven/thunderbird = ccib verified; sweetgrass/salish = self_declared, one with a *pending* claim):

```ts
  { id: "s-eagle", role: "supplier", name: "Eagle River Construction", identityTier: "nation", ownershipPct: 100, sector: "Construction", region: "BC", blurb: "Heavy civil & site construction for energy and public works.", profilePublic: true, verifications: [{ source: "nation", reference: "BCR-2024-014", status: "verified", verifiedAt: "2025-01-10T00:00:00.000Z", expiresAt: "2027-01-10", verifiedBy: "Tsleil-Waututh Nation" }], registered: true, createdAt: now() },
  { id: "s-raven", role: "supplier", name: "Raven Logistics", identityTier: "ccab", ownershipPct: 80, sector: "Logistics", region: "AB", blurb: "Freight, warehousing and last-mile across the prairies.", profilePublic: true, verifications: [{ source: "ccib", reference: "CIB-08831", status: "verified", verifiedAt: "2025-02-01T00:00:00.000Z", expiresAt: "2026-02-01", verifiedBy: "CCIB" }], registered: true, createdAt: now() },
  { id: "s-thunderbird", role: "supplier", name: "Thunderbird IT Services", identityTier: "ccab", ownershipPct: 75, verifications: [{ source: "isc_ibd", reference: "IBD-44120", status: "verified", verifiedAt: "2025-03-01T00:00:00.000Z", verifiedBy: "ISC" }], registered: true, createdAt: now() },
  { id: "s-sweetgrass", role: "supplier", name: "Sweetgrass Catering", identityTier: "self_declared", ownershipPct: 35, sector: "Catering", region: "SK", blurb: "Event and corporate catering.", profilePublic: true, verifications: [{ source: "ccib", reference: "CIB-pending", status: "pending" }], registered: true, createdAt: now() },
  { id: "s-cedarsage", role: "supplier", name: "Cedar & Sage Consulting", identityTier: "nation", ownershipPct: 100, verifications: [{ source: "nation", reference: "MNBC-2023-77", status: "verified", verifiedAt: "2025-01-05T00:00:00.000Z", verifiedBy: "Métis Nation BC" }], registered: true, createdAt: now() },
  { id: "s-salish", role: "supplier", name: "Salish Office Supplies", identityTier: "self_declared", ownershipPct: 30, verifications: [], registered: true, createdAt: now() },
```

(Note: `s-salish` is self-declared *with* confirmed activity in the seed → it will trip `selfDeclaredWithActivity`. A certified supplier with no confirmed lines, if any, trips `certifiedNoActivity` — these drive the Index integrity demo.)

- [ ] **Step 4: dynamo mirror**

In `repo.dynamo/writes.ts`: implement `registerSupplier` (self_declared, `verifications: []`), `claimVerification`, `resolveVerification` (read party → mutate `verifications` → recompute `identityTier` via a local copy of `tierFromVerifications`/`isActive` → `PutCommand toPartyItem`). In `repo.dynamo/reads.ts`: implement `listPendingVerifications` (scan parties, filter pending) and add `verifications` (active) to `getSupplierShowcase` + the `integrity` rollup to `getIndexSummary` (mirror the mock logic exactly). Wire all in `repo.dynamo/index.ts`. In `dynamo/single-table.ts`: `toPartyItem` writes `verifications: p.role === "supplier" ? (p.verifications ?? []) : undefined`; `itemToParty` reads `verifications: it.verifications ?? []` in the supplier branch.

- [ ] **Step 5: typecheck + build + commit**

```bash
npm run typecheck && npm run build   # both PASS
git add src/lib && git commit -m "RAP-43 T1: Verification model + claim/resolve/list + derived tier + integrity rollup (mock+dynamo)"
```

---

## Task 2: Supplier certifications UI + registration no longer self-sets tier

**Files:** `src/lib/repo/actions.ts`, `src/app/(supplier)/profile/page.tsx`, `src/app/(supplier)/register/page.tsx`

- [ ] **Step 1: actions.ts — claim action + fix register action**

Append:

```ts
import type { VerificationSource } from "./types"; // add to the existing type import instead of a new line

export async function claimVerificationAction(formData: FormData) {
  const supplierId = String(formData.get("supplierId") ?? "").trim();
  const source = String(formData.get("source") ?? "") as VerificationSource;
  const reference = String(formData.get("reference") ?? "").trim() || undefined;
  if (!supplierId || !source) return;
  await repo.claimVerification(supplierId, { source, reference });
  revalidatePath("/profile");
}
```

In the existing `registerSupplierAction`, stop reading `identityTier`; call `repo.registerSupplier({ name })` only. Remove the now-unused `identityTier` parse.

- [ ] **Step 2: profile/page.tsx — "My certifications" section**

Add, above the existing profile `<form>` (after the OCAP `<p>`), a certifications block + claim form. `supplier.verifications` is now available:

```tsx
      <div className="bg-panel rounded border border-line shadow-card p-5 space-y-3">
        <div className="text-ink3 text-xs uppercase tracking-widest">My certifications (status layer)</div>
        {(supplier.verifications ?? []).length === 0 ? (
          <p className="text-ink3 text-sm">None yet. Link a certification below — we verify the link against the issuer; we don't re-certify you.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {(supplier.verifications ?? []).map((v) => (
              <li key={v.source} className="flex items-center gap-2">
                <span className="uppercase tracking-wider text-xs border border-line rounded px-1.5 py-0.5">{v.source.replace("_", " ")}</span>
                <span className="text-ink2">{v.reference}</span>
                <span className={`text-xs ${v.status === "verified" ? "text-cedar" : v.status === "pending" ? "text-ink3" : "text-rust"}`}>{v.status}</span>
                {v.expiresAt && <span className="text-ink3 text-xs">· exp {v.expiresAt}</span>}
              </li>
            ))}
          </ul>
        )}
        <form action={claimVerificationAction} className="flex flex-wrap items-end gap-2 pt-2">
          <input type="hidden" name="supplierId" value={supplierId} />
          <label className="space-y-1">
            <span className="block text-ink3 text-xs uppercase tracking-widest">Source</span>
            <select name="source" className="bg-bg border border-ink/15 rounded px-2 py-2">
              <option value="ccib">CCIB (CIB)</option>
              <option value="isc_ibd">ISC IBD</option>
              <option value="nation">Nation</option>
              <option value="regional">Regional</option>
            </select>
          </label>
          <label className="space-y-1 flex-1">
            <span className="block text-ink3 text-xs uppercase tracking-widest">Reference</span>
            <input name="reference" placeholder="cert # / IBD id / BCR ref" className="w-full bg-bg border border-ink/15 rounded px-2 py-2" />
          </label>
          <button className="bg-cedar/20 text-cedar border border-cedar/40 rounded px-4 py-2 hover:bg-cedar/30">Claim</button>
        </form>
      </div>
```

Add `claimVerificationAction` to the import from `@/lib/repo/actions`.

- [ ] **Step 3: register/page.tsx — drop the tier selector**

Remove the identity-tier `<select>` (and its label/explainer). The form keeps only the business-name input. Update copy to: "New suppliers start **self-declared**; you raise your tier by linking a verified certification in your profile." The form posts to `registerSupplierAction` (now name-only).

- [ ] **Step 4: build + render + commit**

```bash
npm run build   # PASS
# REPO_IMPL=mock PORT=3100 npm run dev → /profile?as=s-salish: claim a CCIB ref → shows "pending"; /register: no tier selector
git add src/lib/repo/actions.ts "src/app/(supplier)/profile/page.tsx" "src/app/(supplier)/register/page.tsx"
git commit -m "RAP-43 T2: supplier certifications claim UI + registration defaults to self-declared"
```

---

## Task 3: Reviewer verify view + resolve action

**Files:** `src/lib/repo/actions.ts`, `src/app/(indigenomics)/verify/page.tsx` (new; if no `(indigenomics)` group exists, create `src/app/verify/page.tsx`)

- [ ] **Step 1: actions.ts — resolve action**

```ts
export async function resolveVerificationAction(formData: FormData) {
  const supplierId = String(formData.get("supplierId") ?? "").trim();
  const source = String(formData.get("source") ?? "") as VerificationSource;
  const status = String(formData.get("status") ?? "") as "verified" | "revoked";
  if (!supplierId || !source) return;
  await repo.resolveVerification(supplierId, source, {
    status,
    verifiedBy: status === "verified" ? "Indigenomics (demo verifier)" : undefined,
    expiresAt: status === "verified" ? new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10) : undefined,
  });
  revalidatePath("/verify");
  revalidatePath("/profile");
}
```

- [ ] **Step 2: verify/page.tsx — the review queue**

```tsx
import { repo } from "@/lib/repo";
import { resolveVerificationAction } from "@/lib/repo/actions";

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const pending = await repo.listPendingVerifications();
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics · verification</div>
        <h1 className="font-serif text-2xl">Pending certification claims</h1>
        <p className="text-ink2 text-sm">Confirm each claim against the issuer (CCIB directory / ISC IBD / the Nation). We verify the link — we don&apos;t re-certify. Identity authority stays with Nations / CCIB.</p>
      </div>
      {pending.length === 0 ? (
        <p className="text-ink3">Nothing pending.</p>
      ) : (
        <div className="space-y-3">
          {pending.map(({ supplier, verification }) => (
            <div key={`${supplier.id}-${verification.source}`} className="bg-panel rounded border border-line shadow-card p-4 flex flex-wrap items-center gap-3">
              <span className="font-serif">{supplier.name}</span>
              <span className="uppercase tracking-wider text-xs border border-line rounded px-1.5 py-0.5">{verification.source.replace("_", " ")}</span>
              <span className="text-ink2 text-sm">{verification.reference}</span>
              <form action={resolveVerificationAction} className="ml-auto flex gap-2">
                <input type="hidden" name="supplierId" value={supplier.id} />
                <input type="hidden" name="source" value={verification.source} />
                <button name="status" value="verified" className="bg-cedar/20 text-cedar border border-cedar/40 rounded px-3 py-1 hover:bg-cedar/30">Verify</button>
                <button name="status" value="revoked" className="bg-rust/20 text-rust border border-rust/40 rounded px-3 py-1 hover:bg-rust/30">Reject</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: build + render + commit**

```bash
npm run build   # PASS
# mock dev: /verify lists s-sweetgrass's pending CCIB claim → Verify → its tier becomes ccab; /s/s-sweetgrass now shows the CIB cert + tier
git add src/lib/repo/actions.ts src/app/verify
git commit -m "RAP-43 T3: reviewer verify queue + resolveVerification (verify/reject)"
```

---

## Task 4: Showcase provenance + Index integrity flag + §2 positioning + E2E

**Files:** `src/app/s/[supplierId]/page.tsx`, `src/app/analytics/page.tsx`, `docs/specs/2026-06-05-data-portal-demo-design.md`

- [ ] **Step 1: showcase — show linked certifications (provenance)**

In `s/[supplierId]/page.tsx`, after the tier badge / ownership row, render `s.verifications`:

```tsx
        {s.verifications.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {s.verifications.map((v) => (
              <span key={v.source} className="text-[0.65rem] uppercase tracking-wider border border-cedar/40 text-cedar rounded px-1.5 py-0.5">
                {v.source.replace("_", " ")}{v.reference ? ` · ${v.reference}` : ""}{v.verifiedBy ? ` · ${v.verifiedBy}` : ""}
              </span>
            ))}
          </div>
        )}
```

- [ ] **Step 2: Index — integrity mismatch flag**

In `analytics/page.tsx`, after the by-tier section, add (uses `idx.integrity`):

```tsx
      {(idx.integrity.certifiedNoActivity > 0 || idx.integrity.selfDeclaredWithActivity > 0) && (
        <div>
          <div className="text-ink3 text-xs uppercase tracking-widest mb-3">Integrity signals (status × substance)</div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-panel rounded border border-line shadow-card p-4">
              <div className="font-serif text-xl text-rust">{idx.integrity.certifiedNoActivity}</div>
              <div className="text-ink3 text-sm">certified · but no confirmed activity</div>
            </div>
            <div className="bg-panel rounded border border-line shadow-card p-4">
              <div className="font-serif text-xl text-rust">{idx.integrity.selfDeclaredWithActivity}</div>
              <div className="text-ink3 text-sm">self-declared · with confirmed spend</div>
            </div>
          </div>
          <p className="text-ink3 text-sm mt-2">A certification (status) without confirmed activity (substance) — or large spend with no verification — is the shell-company signal. Counts only; routed to human/Nation/CCIB review, never auto-judged.</p>
        </div>
      )}
```

- [ ] **Step 3: product doc §2 positioning edit**

In `docs/specs/2026-06-05-data-portal-demo-design.md`, in the §2 "Scope evolution" area, add a dated line:

```
- **Positioning [2026-06-13]:** verify **substance, not status** — complement CCIB (CIB + Supply Change marketplace) / ISC / Nations, don't compete; **not a marketplace, not a re-certifier**. The differentiator is the confirmation/integrity layer (`06_Verification_System_Design`), consent-inverted.
```

- [ ] **Step 4: full build + E2E + commit**

```bash
npm run typecheck && npm run build   # PASS
# mock dev E2E: /s/s-raven shows CIB-08831 · CCIB provenance; /verify → verify s-sweetgrass → tier rises; /analytics shows integrity counts; /register has no tier selector
git add src/app docs/specs
git commit -m "RAP-43 T4: showcase cert provenance + Index integrity flag + §2 positioning"
```

---

## Self-review (author)
- **Spec coverage:** §1 data model → T1; §2 repo methods → T1; §3 flow → T2 (claim) + T3 (resolve); §4 surfaces → T2 (profile) / T3 (verify) / T4 (showcase + Index); §8 acceptance → T2/T3/T4; §9 positioning → T4 step 3. ✓
- **Type consistency:** `Verification`, `VerificationSource/Status`, `verifications`, `claimVerification`/`resolveVerification`/`listPendingVerifications`, `integrity` used identically across types/mock/dynamo/pages/actions. ✓
- **Locked tier:** registration → `self_declared`; tier only via `resolveVerification`→verified. ✓
- **Red lines:** no AI identity decision; no re-certification (link-only); counts-only on the Index. ✓
