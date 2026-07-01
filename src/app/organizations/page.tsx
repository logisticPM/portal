// Institute-only leaderboard of all organizations' RAP commitments. Indigenomics
// (the oversight/analyst persona) sees every org's scorecard; companies/suppliers
// only ever see their own data via /report and /confirm. Guarded in middleware.
import { commitmentsRepo, rollupOrgs } from "@/lib/commitments";
import { InstituteNav } from "@/components/InstituteNav";

export const dynamic = "force-dynamic";

const label = (s: string) => s.replace(/_/g, " ");

export default async function OrganizationsPage() {
  const items = await commitmentsRepo.listCommitments();
  const currentYear = new Date().getFullYear();
  const orgs = rollupOrgs(items, currentYear);

  return (
    <div className="space-y-8">
      <InstituteNav active="/organizations" />

      <div>
        <h1 className="font-serif text-3xl">
          Organizations{" "}
          <span className="text-ink3 text-base">— RAP scorecards across the network</span>
        </h1>
        <p className="text-ink2 text-sm mt-1">
          Every participating organization, ranked by average commitment progress. Institute view.
        </p>
      </div>

      <section className="bg-panel rounded border border-line shadow-card p-5">
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
              {orgs.map((o, i) => (
                <tr key={o.key} className="hover:bg-ink/[0.03]">
                  <td className="py-2 pr-3 text-ink3 tabular-nums">{i + 1}</td>
                  <td className="py-2 px-3">
                    <a href={`/organizations/${o.key}`} className="hover:text-amber hover:underline">
                      {o.orgName}
                    </a>
                  </td>
                  <td className="py-2 px-3 capitalize text-ink2">
                    {o.sectors.map(label).join(", ")}
                  </td>
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
              {orgs.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-3 text-ink3">No organizations.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
