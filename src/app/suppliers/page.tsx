// Institute view: the verified Indigenous-supplier directory (mirrors /organizations).
// Searchable + filterable by sector and by leading letter, in the same filter card
// as the org leaderboard.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { repo } from "@/lib/repo";
import { money } from "@/components/ui";
import { InstituteNav } from "@/components/InstituteNav";
import { FilterRow } from "@/components/FilterRow";
import { ScrollLink } from "@/components/ScrollLink";
import { CommitmentSearch } from "@/app/commitments/CommitmentSearch";
import type { IdentityTier, Supplier } from "@/lib/repo/types";

export const dynamic = "force-dynamic";

const tierLabels: Record<IdentityTier, string> = { nation: "Nation-verified", ccab: "CCAB-certified", self_declared: "Self-declared" };
const tierStyles: Record<IdentityTier, string> = {
  nation: "border-cedar/30 bg-cedar/10 text-cedar",
  ccab: "border-amber/30 bg-amber/10 text-amber",
  self_declared: "border-rust/30 bg-rust/10 text-rust",
};

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: { sector?: string; q?: string; letter?: string };
}) {
  const session = getSession();
  if (!session || session.kind !== "indigenomics") redirect("/home");

  const suppliers = (await repo.listParties("supplier")).filter((p): p is Supplier => p.role === "supplier");
  const rows = await Promise.all(
    suppliers.map(async (s) => {
      const showcase = await repo.getSupplierShowcase(s.id);
      return {
        s,
        sector: s.sectorNorm ?? s.sector ?? "",
        region: s.regionNorm ?? s.region ?? "",
        revenue: showcase?.confirmedRevenue ?? 0,
      };
    }),
  );
  rows.sort((a, b) => b.revenue - a.revenue || a.s.name.localeCompare(b.s.name));

  // facets + active filters
  const sectorFacets = [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort();
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const letter = searchParams.letter?.toUpperCase();
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (!searchParams.sector || r.sector === searchParams.sector) &&
      (!letter || r.s.name.trim().charAt(0).toUpperCase() === letter) &&
      (!q ||
        r.s.name.toLowerCase().includes(q) ||
        r.sector.toLowerCase().includes(q) ||
        r.region.toLowerCase().includes(q)),
  );

  const hasFilter = !!(searchParams.sector || searchParams.q || searchParams.letter);
  const qs = (next: { sector?: string; letter?: string }) => {
    const p = new URLSearchParams();
    const sector = "sector" in next ? next.sector : searchParams.sector;
    const lt = "letter" in next ? next.letter : searchParams.letter;
    if (sector) p.set("sector", sector);
    if (searchParams.q) p.set("q", searchParams.q);
    if (lt) p.set("letter", lt);
    const s = p.toString();
    return s ? `/suppliers?${s}` : "/suppliers";
  };

  return (
    <div className="space-y-8">
      <InstituteNav active="/suppliers" />
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics · directory</div>
        <h1 className="font-serif text-2xl">Verified Indigenous suppliers</h1>
        <p className="text-ink2 text-sm">{rows.length} suppliers in the network — click a row for the full profile.</p>
      </div>

      <section className="bg-panel rounded border border-line shadow-card p-5 space-y-4">
        {/* search + sector + letter filters */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <CommitmentSearch basePath="/suppliers" placeholder="Search suppliers, sectors, regions…" />
            {hasFilter && (
              <ScrollLink href="/suppliers" className="text-ink3 underline text-xs">clear all</ScrollLink>
            )}
          </div>
          <FilterRow label="Sector">
            {sectorFacets.map((s) => (
              <ScrollLink
                key={s}
                href={qs({ sector: searchParams.sector === s ? undefined : s })}
                className={`rounded-full border px-2.5 py-0.5 capitalize hover:border-amber/50 ${
                  searchParams.sector === s ? "border-amber/60 text-amber bg-amber/10" : "border-line text-ink2"
                }`}
              >
                {s}
              </ScrollLink>
            ))}
          </FilterRow>
          <FilterRow label="Name">
            {LETTERS.map((L) => (
              <ScrollLink
                key={L}
                href={qs({ letter: letter === L ? undefined : L })}
                className={`rounded border w-6 text-center py-0.5 tabular-nums hover:border-amber/50 ${
                  letter === L ? "border-amber/60 text-amber bg-amber/10" : "border-line text-ink2"
                }`}
              >
                {L}
              </ScrollLink>
            ))}
          </FilterRow>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink3 text-xs uppercase tracking-widest border-b border-line">
                <th className="text-left font-normal px-4 py-3 w-10">#</th>
                <th className="text-left font-normal px-4 py-3">Supplier</th>
                <th className="text-left font-normal px-4 py-3">Sector</th>
                <th className="text-center font-normal px-4 py-3">Region</th>
                <th className="text-left font-normal px-4 py-3">Identity</th>
                <th className="text-right font-normal px-4 py-3">Indigenous-owned</th>
                <th className="text-right font-normal px-4 py-3">Confirmed revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {filtered.map(({ s, sector, region, revenue }, i) => (
                <tr key={s.id} className="hover:bg-amber/5">
                  <td className="px-4 py-3 text-ink3">{i + 1}</td>
                  <td className="px-4 py-3">
                    <a href={`/suppliers/${s.id}`} className="font-serif text-cedar hover:underline">{s.name}</a>
                  </td>
                  <td className="px-4 py-3 capitalize text-ink2">{sector || "—"}</td>
                  <td className="px-4 py-3 text-center text-ink2">{region || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block whitespace-nowrap text-xs uppercase tracking-wider border rounded-full px-2 py-0.5 ${tierStyles[s.identityTier]}`}>
                      {tierLabels[s.identityTier]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-ink2">{s.ownershipPct != null ? `${s.ownershipPct}%` : "—"}</td>
                  <td className="px-4 py-3 text-right font-serif text-amber">{money(revenue)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-3 text-ink3">No suppliers match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
