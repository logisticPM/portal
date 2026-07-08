# Supplier Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An institute-side supplier directory mirroring `/organizations`: a `/suppliers` list of the 10 real Indigenous suppliers, each linking to a `/suppliers/[id]` profile with a real, source-cited "About" box + identity/verification/track-record.

**Architecture:** A curated `SupplierProfile` lookup (mirrors `org-profiles.ts`) supplies HQ/founded/industry/employees/owner/about for the 10 real suppliers. Two new institute-gated pages read `repo.listParties("supplier")` + `repo.getSupplierShowcase()` + `getSupplierProfile()`. Nav + middleware gain a `/suppliers` entry.

**Tech Stack:** Next.js 14 App Router (server components) · existing `PortalRepo` (`listParties`, `getParty`, `getSupplierShowcase`) · reuse `InstituteNav`, `money()`, tier badge styles.

**Spec:** `docs/specs/2026-07-08-supplier-directory-design.md`

---

## File Structure
**Create:** `src/lib/suppliers/supplier-profiles.ts` · `src/app/suppliers/page.tsx` · `src/app/suppliers/[id]/page.tsx`
**Modify:** `src/components/InstituteNav.tsx` · `src/middleware.ts` · `scripts/verify-alignment.ts` (one lookup check)

---

## Task 1: SupplierProfile lookup (real data)

**Files:**
- Create: `src/lib/suppliers/supplier-profiles.ts`
- Modify: `scripts/verify-alignment.ts`

- [ ] **Step 1: Write the failing check.** In `scripts/verify-alignment.ts`, add near the top imports:
```ts
import { getSupplierProfile } from "../src/lib/suppliers/supplier-profiles";
```
And in `main()` before the summary:
```ts
  // --- supplier profiles (curated real data) ---
  check("profile: norsask HQ", getSupplierProfile("s-norsask")?.headquarters === "Meadow Lake, Saskatchewan");
  check("profile: 3ne has no employees (unpublished)", getSupplierProfile("s-3ne")?.employees === undefined);
  check("profile: unknown id -> undefined", getSupplierProfile("s-nope") === undefined);
```

- [ ] **Step 2: Run to verify it fails.** `npm run verify:alignment` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement.** Create `src/lib/suppliers/supplier-profiles.ts`:
```ts
// Curated public reference profiles for the 10 real Indigenous suppliers (Wikipedia-
// style info box: HQ, founded, industry, employees, owner, website). Keyed by supplier
// id. All facts are real + source-cited (see per-entry comments); unpublished figures
// (employees for FCH, 3NE) are omitted rather than guessed.
export interface SupplierProfile {
  headquarters: string;
  founded: string;
  industry: string;
  employees?: string; // omit if not published
  website: string;
  owner: string;
  about: string;
}

export const supplierProfiles: Record<string, SupplierProfile> = {
  // peacehills.com/index/about-us/corporate-profile
  "s-peacehills": {
    headquarters: "Maskwacis, Alberta (corporate office Edmonton)",
    founded: "1980",
    industry: "Banking & financial services",
    employees: "~100+",
    website: "https://www.peacehills.com/",
    owner: "Samson Cree Nation (wholly owned)",
    about: "Canada's largest First Nation-owned financial institution, providing trust, credit and banking services to individuals, businesses and Indigenous communities.",
  },
  // firstcanadianhealth.biz/about-us ; tcig.biz/first-canadian-health (owner TCIG is MB-based; office Toronto)
  "s-fch": {
    headquarters: "Toronto, Ontario (owner TCIG is Manitoba-based)",
    founded: "1998",
    industry: "Indigenous health benefits & claims processing",
    website: "https://firstcanadianhealth.biz/",
    owner: "Tribal Councils Investment Group of Manitoba",
    about: "Indigenous-owned health-services company supporting nationwide extended-health, dental and pharmaceutical claims processing for Canada's Non-Insured Health Benefits program.",
  },
  // bouchier.ca/who-we-are ; ccab.com (Indigenous Business of the Year)
  "s-bouchier": {
    headquarters: "Fort McKay, Alberta (Edmonton office)",
    founded: "1998",
    industry: "Logistics & industrial services",
    employees: "~1,300",
    website: "https://bouchier.ca/",
    owner: "Bouchier family — Fort McKay First Nation & Mikisew Cree First Nation (CCAB-certified)",
    about: "100% Indigenous-owned provider of civil contracting, facility maintenance and logistics to Alberta's oil sands and industrial sectors.",
  },
  // desnedhe.com/about ; linkedin.com/company/des-nedhe
  "s-desnedhe": {
    headquarters: "Saskatoon, Saskatchewan",
    founded: "1991",
    industry: "Indigenous economic development (diversified)",
    employees: "~273",
    website: "https://desnedhe.com/",
    owner: "English River First Nation",
    about: "The economic development arm of English River First Nation, operating an integrated portfolio spanning construction, mining services, real estate and technology.",
  },
  // kitsaki.com/about ; linkedin.com/company/kitsaki-management-limited-partnership
  "s-kitsaki": {
    headquarters: "La Ronge, Saskatchewan (office in Saskatoon)",
    founded: "1981",
    industry: "Diversified investment / economic development",
    employees: "~1,800 (across all subsidiaries)",
    website: "https://kitsaki.com/",
    owner: "Lac La Ronge Indian Band",
    about: "Conducts the economic-development activities of the Lac La Ronge Indian Band through a diversified portfolio of 14+ businesses (forestry, transport, mining, engineering).",
  },
  // norsask.ca/about-us
  "s-norsask": {
    headquarters: "Meadow Lake, Saskatchewan",
    founded: "1971 (Meadow Lake Tribal Council acquired 100% in 1998)",
    industry: "Forestry / lumber manufacturing",
    employees: "~100",
    website: "https://norsask.ca/",
    owner: "Meadow Lake Tribal Council",
    about: "The largest First Nations-owned sawmill in Canada, producing over 140 million board feet of lumber annually for the nine Meadow Lake Tribal Council communities.",
  },
  // animikii.com/about ; ccib.ca (member)
  "s-animikii": {
    headquarters: "Victoria, British Columbia",
    founded: "2003",
    industry: "Indigenous technology / software",
    employees: "~30–50",
    website: "https://animikii.com/",
    owner: "Indigenous-owned (Jeff Ward, Ojibwe/Métis) — CCAB-certified, Certified B Corp",
    about: "A 100% Indigenous-owned technology company building custom software and web applications guided by Indigenous data-sovereignty principles.",
  },
  // nationstranslation.com/about ; ccib.ca (member)
  "s-ntg": {
    headquarters: "Ottawa, Ontario",
    founded: "2019 (Indigenous-owned; predecessor est. 1992)",
    industry: "Translation & language services",
    employees: "~51–200",
    website: "https://www.nationstranslation.com/",
    owner: "CCAB-certified, 100% First Nations-owned",
    about: "A 100% Indigenous-owned language-services provider offering enterprise translation in 100+ languages, including 30+ Indigenous languages.",
  },
  // 3ne.ca/about-3ne ; 3ne.ca/founding
  "s-3ne": {
    headquarters: "Fort Chipewyan, Alberta",
    founded: "2018",
    industry: "Clean energy / solar power",
    website: "https://www.3ne.ca/",
    owner: "Athabasca Chipewyan First Nation, Mikisew Cree First Nation & Fort Chipewyan Métis Nation (equal partners)",
    about: "Created in 2018 to bring clean electricity to remote Fort Chipewyan; owns and operates a 2.2 MW solar farm — Canada's largest remote-community solar installation.",
  },
  // membertou.ca ; linkedin.com/company/membertou-development-corporation
  "s-membertou": {
    headquarters: "Membertou (Sydney), Nova Scotia",
    founded: "1989",
    industry: "Economic & business development (diversified)",
    employees: "~500–1,000 (across all Membertou entities)",
    website: "https://membertou.ca/",
    owner: "Membertou First Nation (Mi'kmaq)",
    about: "The economic development arm of Membertou First Nation, managing a diverse portfolio including geomatics, trade & convention, fisheries, insurance and a data centre.",
  },
};

export function getSupplierProfile(supplierId: string): SupplierProfile | undefined {
  return supplierProfiles[supplierId];
}
```

- [ ] **Step 4: Run to verify it passes.** `npm run verify:alignment` — Expected: PASS (+3 profile checks).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/suppliers/supplier-profiles.ts scripts/verify-alignment.ts
git commit -m "feat(suppliers): curated real SupplierProfile data (10 businesses)"
```

---

## Task 2: `/suppliers` list page

**Files:**
- Create: `src/app/suppliers/page.tsx`

- [ ] **Step 1: Implement.** Create `src/app/suppliers/page.tsx`:
```tsx
// Institute view: the verified Indigenous-supplier directory (mirrors /organizations).
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { repo } from "@/lib/repo";
import { money } from "@/components/ui";
import { InstituteNav } from "@/components/InstituteNav";
import type { IdentityTier, Supplier } from "@/lib/repo/types";

export const dynamic = "force-dynamic";

const tierLabels: Record<IdentityTier, string> = { nation: "Nation-verified", ccab: "CCAB-certified", self_declared: "Self-declared" };
const tierStyles: Record<IdentityTier, string> = {
  nation: "border-cedar/30 bg-cedar/10 text-cedar",
  ccab: "border-amber/30 bg-amber/10 text-amber",
  self_declared: "border-rust/30 bg-rust/10 text-rust",
};

export default async function SuppliersPage() {
  const session = getSession();
  if (!session || session.kind !== "indigenomics") redirect("/home");

  const suppliers = (await repo.listParties("supplier")).filter((p): p is Supplier => p.role === "supplier");
  const rows = await Promise.all(
    suppliers.map(async (s) => {
      const showcase = await repo.getSupplierShowcase(s.id);
      return { s, revenue: showcase?.confirmedRevenue ?? 0 };
    }),
  );
  rows.sort((a, b) => b.revenue - a.revenue || a.s.name.localeCompare(b.s.name));

  return (
    <div className="space-y-6">
      <InstituteNav active="/suppliers" />
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics · directory</div>
        <h1 className="font-serif text-2xl">Verified Indigenous suppliers</h1>
        <p className="text-ink2 text-sm">{rows.length} suppliers in the network — click a row for the full profile.</p>
      </div>
      <div className="bg-panel rounded border border-line shadow-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-ink3 text-xs uppercase tracking-widest border-b border-line">
              <th className="text-left font-normal px-4 py-3 w-10">#</th>
              <th className="text-left font-normal px-4 py-3">Supplier</th>
              <th className="text-left font-normal px-4 py-3">Sector</th>
              <th className="text-left font-normal px-4 py-3">Region</th>
              <th className="text-left font-normal px-4 py-3">Identity</th>
              <th className="text-right font-normal px-4 py-3">Indigenous-owned</th>
              <th className="text-right font-normal px-4 py-3">Confirmed revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {rows.map(({ s, revenue }, i) => (
              <tr key={s.id} className="hover:bg-amber/5">
                <td className="px-4 py-3 text-ink3">{i + 1}</td>
                <td className="px-4 py-3">
                  <a href={`/suppliers/${s.id}`} className="font-serif text-cedar hover:underline">{s.name}</a>
                </td>
                <td className="px-4 py-3 capitalize text-ink2">{s.sectorNorm ?? s.sector ?? "—"}</td>
                <td className="px-4 py-3 text-ink2">{s.regionNorm ?? s.region ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs uppercase tracking-wider border rounded-full px-2 py-0.5 ${tierStyles[s.identityTier]}`}>
                    {tierLabels[s.identityTier]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-ink2">{s.ownershipPct != null ? `${s.ownershipPct}%` : "—"}</td>
                <td className="px-4 py-3 text-right font-serif text-amber">{money(revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build.** `npm run build` — Expected: succeeds (`/suppliers` compiles).

- [ ] **Step 3: Commit.**
```bash
git add src/app/suppliers/page.tsx
git commit -m "feat(suppliers): institute supplier directory list page"
```

---

## Task 3: `/suppliers/[id]` detail page

**Files:**
- Create: `src/app/suppliers/[id]/page.tsx`

- [ ] **Step 1: Implement.** Create `src/app/suppliers/[id]/page.tsx`:
```tsx
// One supplier's institute profile (mirrors /organizations/[id]): real About box +
// identity/verifications + confirmed track record.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { repo } from "@/lib/repo";
import { money } from "@/components/ui";
import { InstituteNav } from "@/components/InstituteNav";
import { getSupplierProfile } from "@/lib/suppliers/supplier-profiles";
import type { IdentityTier } from "@/lib/repo/types";

export const dynamic = "force-dynamic";

const tierLabels: Record<IdentityTier, string> = { nation: "Nation-verified", ccab: "CCAB-certified", self_declared: "Self-declared" };
const tierStyles: Record<IdentityTier, string> = {
  nation: "border-cedar/30 bg-cedar/10 text-cedar",
  ccab: "border-amber/30 bg-amber/10 text-amber",
  self_declared: "border-rust/30 bg-rust/10 text-rust",
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="text-ink3 w-32 shrink-0">{label}</dt>
      <dd className="text-ink2">{value}</dd>
    </div>
  );
}

export default async function SupplierDetailPage({ params }: { params: { id: string } }) {
  const session = getSession();
  if (!session || session.kind !== "indigenomics") redirect("/home");

  const party = await repo.getParty(params.id);
  if (!party || party.role !== "supplier") {
    return (
      <div className="space-y-6">
        <InstituteNav active="/suppliers" />
        <p className="text-ink2">Supplier not found.</p>
        <a href="/suppliers" className="text-ink3 underline text-sm">← all suppliers</a>
      </div>
    );
  }

  const profile = getSupplierProfile(party.id);
  const showcase = await repo.getSupplierShowcase(party.id);
  const flows = showcase ? Object.entries(showcase.byFlow).filter(([, v]) => v.confirmed > 0) : [];

  return (
    <div className="space-y-8">
      <InstituteNav active="/suppliers" />

      <div>
        <a href="/suppliers" className="text-sm text-ink3 hover:text-amber hover:underline">← all suppliers</a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl">{party.name}</h1>
          <span className={`text-xs uppercase tracking-wider border rounded-full px-2 py-0.5 ${tierStyles[party.identityTier]}`}>
            {tierLabels[party.identityTier]}
          </span>
          {party.ownershipPct != null && (
            <span className="text-ink3 text-sm">{party.ownershipPct}% Indigenous-owned</span>
          )}
        </div>
        <p className="text-ink2 text-sm mt-1 capitalize">{party.sectorNorm ?? party.sector ?? ""}{party.regionNorm ? ` · ${party.regionNorm}` : ""}</p>
      </div>

      {/* about — real reference info (Wikipedia-style) */}
      {profile && (
        <section className="bg-panel rounded border border-line shadow-card p-5">
          <div className="text-ink3 text-xs uppercase tracking-widest mb-3">About</div>
          <p className="text-ink2 text-sm mb-4">{profile.about}</p>
          <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <InfoRow label="Headquarters" value={profile.headquarters} />
            <InfoRow label="Founded" value={profile.founded} />
            <InfoRow label="Industry" value={profile.industry} />
            {profile.employees && <InfoRow label="Employees" value={profile.employees} />}
            <InfoRow label="Ownership" value={profile.owner} />
          </dl>
          <a href={profile.website} target="_blank" rel="noreferrer" className="text-amber hover:underline text-sm mt-3 inline-block">
            {profile.website.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
          </a>
          <p className="text-ink3 text-[11px] mt-2">Public reference information.</p>
        </section>
      )}

      {/* verifications */}
      {(party.verifications ?? []).length > 0 && (
        <section className="bg-panel rounded border border-line shadow-card p-5">
          <div className="text-ink3 text-xs uppercase tracking-widest mb-3">Certifications</div>
          <div className="space-y-2 text-sm">
            {(party.verifications ?? []).map((v) => (
              <div key={`${v.source}-${v.reference ?? ""}`} className="flex flex-wrap items-center gap-2">
                <span className="uppercase tracking-wider text-xs border border-line rounded px-1.5 py-0.5">{v.source.replace(/_/g, " ")}</span>
                <span className="text-ink2">{v.reference}</span>
                {v.verifiedBy && <span className="text-ink3">· {v.verifiedBy}</span>}
                <span className="text-ink3">· {v.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* track record */}
      <section className="bg-panel rounded border border-line shadow-card p-5">
        <div className="text-ink3 text-xs uppercase tracking-widest mb-3">Confirmed track record</div>
        <div className="font-serif text-4xl text-amber">{money(showcase?.confirmedRevenue ?? 0)}</div>
        <p className="text-ink3 text-sm mt-1">confirmed across {showcase?.confirmedBuyerCount ?? 0} buyer(s)</p>
        {flows.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            {flows.map(([flow, v]) => (
              <span key={flow} className="text-ink2 capitalize">{flow}: <span className="font-serif">{money(v.confirmed)}</span></span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Build.** `npm run build` — Expected: succeeds.

- [ ] **Step 3: Commit.**
```bash
git add "src/app/suppliers/[id]/page.tsx"
git commit -m "feat(suppliers): institute supplier profile detail page"
```

---

## Task 4: Nav + route gate

**Files:**
- Modify: `src/components/InstituteNav.tsx`, `src/middleware.ts`

- [ ] **Step 1: Add the nav tab.** In `src/components/InstituteNav.tsx`, in the `TABS` array, add after the `/organizations` entry:
```ts
  { href: "/suppliers", label: "Suppliers" },
```

- [ ] **Step 2: Gate the routes.** In `src/middleware.ts`, add `"/suppliers"` to `INDIGENOMICS_ONLY`:
```ts
const INDIGENOMICS_ONLY = ["/verify", "/organizations", "/extract", "/alignment", "/suppliers"];
```

- [ ] **Step 3: Build + final verify.**
Run: `npm run build` — succeeds.
Run: `npm run verify:alignment` — the 3 profile checks pass.
Run: `npm run ddb:up && npm run verify` — all pass (no repo/marshaller change; new pages are read-only).

- [ ] **Step 4: Manual smoke (local dev, dynamo).** With `REPO_IMPL=dynamo DYNAMO_ENDPOINT=http://localhost:8000 npm run dev` (tables seeded): sign in `institute@demo` → `/suppliers` lists the 10 real suppliers → click e.g. Membertou → see the real About box (Headquarters "Membertou (Sydney), Nova Scotia", Founded 1989, Employees, Website) + certifications + track record. Confirm the "Suppliers" nav tab appears and a non-institute session is redirected.

- [ ] **Step 5: Commit.**
```bash
git add src/components/InstituteNav.tsx src/middleware.ts
git commit -m "feat(suppliers): add Suppliers tab + institute route gate"
```

---

## Self-Review Notes (plan author)
- **Spec coverage:** §3 SupplierProfile + real data → Task 1; §4 list → Task 2; §4 detail (About box + verifications + track record) → Task 3; §5 nav/middleware → Task 4; §6 not-found → Task 3 (party null/non-supplier branch); §7 testing → Task 1 checks + Task 4 smoke.
- **Type consistency:** `getSupplierProfile(id)`/`SupplierProfile` consistent Task 1↔3; `tierLabels`/`tierStyles` copied verbatim in Tasks 2+3 (same as `/s/[id]`); `repo.listParties("supplier")` / `getSupplierShowcase` / `getParty` are real `PortalRepo` methods; `Supplier.sectorNorm`/`regionNorm`/`ownershipPct`/`verifications` exist.
- **No placeholders:** full code in every task; real data embedded in Task 1.
- **Note:** tier styles duplicated across 3 files (list, detail, existing /s) — acceptable (small, matches existing pattern); a shared `<TierBadge>` is a possible later tidy-up.
