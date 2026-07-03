// Institute-only leaderboard of all organizations' RAP commitments. Searchable,
// filterable by sector, paginated (20/page + go-to). Companies/suppliers only
// ever see their own data via /report and /confirm; guarded in middleware.
import Link from "next/link";
import { commitmentsRepo, rollupOrgs } from "@/lib/commitments";
import type { Sector } from "@/lib/commitments";
import { InstituteNav } from "@/components/InstituteNav";
import { CommitmentSearch } from "@/app/commitments/CommitmentSearch";
import { PageJump } from "@/app/commitments/PageJump";
import { FilterRow } from "@/components/FilterRow";

export const dynamic = "force-dynamic";

const label = (s: string) => s.replace(/_/g, " ");
const PAGE_SIZE = 20;

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: { sector?: Sector; q?: string; page?: string };
}) {
  const items = await commitmentsRepo.listCommitments();
  const currentYear = new Date().getFullYear();
  const orgs = rollupOrgs(items, currentYear);

  const sectorFacets = [...new Set(orgs.flatMap((o) => o.sectors))].sort();
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const filtered = orgs.filter(
    (o) =>
      (!searchParams.sector || o.sectors.includes(searchParams.sector)) &&
      (!q ||
        o.orgName.toLowerCase().includes(q) ||
        o.sectors.some((s) => s.toLowerCase().includes(q))),
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, Number(searchParams.page) || 1));
  const pageOrgs = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hasFilter = !!(searchParams.sector || searchParams.q);
  const qs = (next: { sector?: string; page?: string }) => {
    const p = new URLSearchParams();
    const sector = "sector" in next ? next.sector : searchParams.sector;
    const pg = "page" in next ? next.page : undefined;
    if (sector) p.set("sector", sector);
    if (searchParams.q) p.set("q", searchParams.q);
    if (pg && pg !== "1") p.set("page", pg);
    const s = p.toString();
    return s ? `/organizations?${s}` : "/organizations";
  };

  return (
    <div className="space-y-8">
      <InstituteNav active="/organizations" />

      <div>
        <h1 className="font-serif text-3xl">
          Organizations{" "}
          <span className="text-ink3 text-base">· RAP scorecards across the network</span>
        </h1>
        <p className="text-ink2 text-sm mt-1">
          Every participating organization, ranked by average commitment progress. Institute view.
        </p>
      </div>

      <section className="bg-panel rounded border border-line shadow-card p-5 space-y-4">
        {/* search + sector filter */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <CommitmentSearch basePath="/organizations" />
            {hasFilter && (
              <Link href="/organizations" scroll={false} className="text-ink3 underline text-xs">clear all</Link>
            )}
          </div>
          <FilterRow label="Sector">
            {sectorFacets.map((s) => (
              <Link
                key={s}
                scroll={false}
                href={qs({ sector: searchParams.sector === s ? undefined : s, page: undefined })}
                className={`rounded-full border px-2.5 py-0.5 capitalize hover:border-amber/50 ${
                  searchParams.sector === s ? "border-amber/60 text-amber bg-amber/10" : "border-line text-ink2"
                }`}
              >
                {label(s)}
              </Link>
            ))}
          </FilterRow>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink3 text-xs uppercase tracking-widest text-left border-b border-line">
                <th className="py-2 pr-3 font-medium w-8">#</th>
                <th className="py-2 px-3 font-medium">Organization</th>
                <th className="py-2 px-3 font-medium">Sector</th>
                <th className="py-2 px-3 font-medium text-right">Commitments</th>
                <th className="py-2 px-3 font-medium">Avg progress</th>
                <th className="py-2 px-3 font-medium text-right">Confirmed</th>
                <th className="py-2 pl-3 font-medium text-right">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {pageOrgs.map((o, i) => (
                <tr key={o.key} className="hover:bg-ink/[0.03]">
                  <td className="py-2 pr-3 text-ink3 tabular-nums">{(page - 1) * PAGE_SIZE + i + 1}</td>
                  <td className="py-2 px-3">
                    <a href={`/organizations/${o.key}`} className="hover:text-amber hover:underline">
                      {o.orgName}
                    </a>
                  </td>
                  <td className="py-2 px-3 capitalize text-ink2">{o.sectors.map(label).join(", ")}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-ink2">{o.total}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded bg-ink/10 overflow-hidden">
                        <div className="h-full bg-amber" style={{ width: `${o.avgProgress}%` }} />
                      </div>
                      <span className="tabular-nums text-ink2 w-9 text-right">{o.avgProgress}%</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-cedar">{o.confirmedPct}%</td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap text-xs">
                    {o.overdueCount > 0 && <span className="text-rust">{o.overdueCount} overdue</span>}
                    {o.overdueCount > 0 && o.atRiskCount > 0 && <span className="text-ink3"> · </span>}
                    {o.atRiskCount > 0 && <span className="text-amber">{o.atRiskCount} at risk</span>}
                    {o.overdueCount === 0 && o.atRiskCount === 0 && <span className="text-cedar">clear</span>}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-3 text-ink3">No organizations match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        {filtered.length > PAGE_SIZE && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="text-ink3">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-1 ml-auto">
              {page > 1 ? (
                <Link href={qs({ page: String(page - 1) })} scroll={false} className="rounded border border-line px-2 py-1 text-ink2 hover:text-ink hover:border-ink/30">‹ Prev</Link>
              ) : (
                <span className="rounded border border-line px-2 py-1 text-ink3 opacity-40">‹ Prev</span>
              )}
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <Link
                  key={n}
                  href={qs({ page: String(n) })}
                  scroll={false}
                  className={`rounded border px-2.5 py-1 tabular-nums ${
                    n === page ? "border-amber/60 text-amber bg-amber/10" : "border-line text-ink2 hover:text-ink hover:border-ink/30"
                  }`}
                >
                  {n}
                </Link>
              ))}
              {page < totalPages ? (
                <Link href={qs({ page: String(page + 1) })} scroll={false} className="rounded border border-line px-2 py-1 text-ink2 hover:text-ink hover:border-ink/30">Next ›</Link>
              ) : (
                <span className="rounded border border-line px-2 py-1 text-ink3 opacity-40">Next ›</span>
              )}
              <PageJump totalPages={totalPages} basePath="/organizations" />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
