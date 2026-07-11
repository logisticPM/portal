import { redirect } from "next/navigation";
import { repo } from "@/lib/repo";
import { getSession } from "@/lib/auth";
import { money } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CoveragePage() {
  // Identity comes solely from the verified session (?as= override was removed).
  // Middleware already gates /coverage to company sessions; this guards in depth.
  const session = getSession();
  if (!session || session.kind !== "company" || !session.partyId) redirect("/home");
  const companyId = session.partyId;

  const company = await repo.getParty(companyId);
  const coverage = await repo.getCoverage(companyId);
  const flows = Object.entries(coverage.byFlow);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-amber text-xs uppercase tracking-widest mb-1">
            {company?.name} · coverage
          </div>
          <h1 className="font-serif text-3xl">
            Reported vs confirmed{" "}
            <span className="text-ink3 text-base">— how much of what I reported is confirmed?</span>
          </h1>
        </div>
        <a className="ml-auto text-ink3 underline text-sm" href="/report">
          ← report
        </a>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-4xl text-amber">{coverage.confirmedPct}%</div>
          <div className="text-ink3 text-sm">of reported $ confirmed</div>
        </div>
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-2xl">{money(coverage.totalConfirmed)}</div>
          <div className="text-ink3 text-sm">
            confirmed · of {money(coverage.totalReported)} reported
          </div>
        </div>
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-2xl">{money(coverage.totalReported - coverage.totalConfirmed)}</div>
          <div className="text-ink3 text-sm">unconfirmed — pending, disputed, or withdrawn</div>
        </div>
      </div>

      <div>
        <div className="text-ink3 text-xs uppercase tracking-widest mb-3">
          Reported vs confirmed, by flow type
        </div>
        <div className="space-y-3">
          {flows.map(([flow, v]) => {
            // Clamp: a corrected-up line can push confirmed > reported → >100% bar overflow.
            const pct = v.reported ? Math.min(100, Math.max(0, Math.round((v.confirmed / v.reported) * 100))) : 0;
            return (
              <div key={flow}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="capitalize">{flow}</span>
                  <span className="text-ink3">
                    {money(v.confirmed)} / {money(v.reported)} · {pct}%
                  </span>
                </div>
                <div className="h-2 bg-ink/10 rounded overflow-hidden">
                  <div className="h-full bg-amber" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-ink3 text-sm">
        Confirmation coverage — a data view, not a rating. When a supplier confirms a pending line,
        this number rises; when one withdraws, it drops.
      </p>
    </div>
  );
}
