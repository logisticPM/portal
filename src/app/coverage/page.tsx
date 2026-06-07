import { repo } from "@/lib/repo";
import { money } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CoveragePage({
  searchParams,
}: {
  searchParams: { as?: string };
}) {
  const companyId = searchParams.as;
  const companies = await repo.listParties("company");

  // No company chosen yet → pick one (mirrors report/confirm/record).
  if (!companyId) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-2xl">Coverage — pick a company</h1>
        <div className="grid gap-2">
          {companies.map((c) => (
            <a
              key={c.id}
              className="bg-panel rounded px-4 py-3 hover:text-amber"
              href={`/coverage?as=${c.id}`}
            >
              {c.name}
            </a>
          ))}
        </div>
      </div>
    );
  }

  const company = await repo.getParty(companyId);
  const coverage = await repo.getCoverage(companyId);
  const pillars = Object.entries(coverage.byPillar);

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
        <a className="ml-auto text-ink3 underline text-sm" href={`/report?as=${companyId}`}>
          ← report
        </a>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="bg-panel rounded p-5">
          <div className="font-serif text-4xl text-amber">{coverage.confirmedPct}%</div>
          <div className="text-ink3 text-sm">of reported $ confirmed</div>
        </div>
        <div className="bg-panel rounded p-5">
          <div className="font-serif text-2xl">{money(coverage.totalConfirmed)}</div>
          <div className="text-ink3 text-sm">
            confirmed · of {money(coverage.totalReported)} reported
          </div>
        </div>
        <div className="bg-panel rounded p-5">
          <div className="font-serif text-2xl">{money(coverage.totalReported - coverage.totalConfirmed)}</div>
          <div className="text-ink3 text-sm">unconfirmed — pending, disputed, or withdrawn</div>
        </div>
      </div>

      <div>
        <div className="text-ink3 text-xs uppercase tracking-widest mb-3">
          Reported vs confirmed, by pillar
        </div>
        <div className="space-y-3">
          {pillars.map(([pillar, v]) => {
            const pct = v.reported ? Math.round((v.confirmed / v.reported) * 100) : 0;
            return (
              <div key={pillar}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="capitalize">{pillar}</span>
                  <span className="text-ink3">
                    {money(v.confirmed)} / {money(v.reported)} · {pct}%
                  </span>
                </div>
                <div className="h-2 bg-white/10 rounded overflow-hidden">
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
