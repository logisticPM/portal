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
