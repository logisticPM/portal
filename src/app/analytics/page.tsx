import { repo } from "@/lib/repo";
import { money } from "@/components/ui";
import type { IdentityTier } from "@/lib/repo/types";

export const dynamic = "force-dynamic";

const tierLabels: Record<IdentityTier, string> = {
  nation: "Nation-verified",
  ccab: "CCAB-certified",
  self_declared: "Self-declared",
};

export default async function AnalyticsPage() {
  const idx = await repo.getIndexSummary();
  const pillars = Object.entries(idx.byPillar);

  return (
    <div className="space-y-8">
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">
          Indigenomics · RAP analysis
        </div>
        <h1 className="font-serif text-3xl">
          The Index <span className="text-ink3 text-base">— a data view, not a rating</span>
        </h1>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="bg-panel rounded p-5">
          <div className="font-serif text-4xl text-amber">{idx.confirmedPct}%</div>
          <div className="text-ink3 text-sm">of reported $ confirmed</div>
        </div>
        <div className="bg-panel rounded p-5">
          <div className="font-serif text-2xl">{money(idx.totalConfirmed)}</div>
          <div className="text-ink3 text-sm">confirmed · of {money(idx.totalReported)} reported</div>
        </div>
        <div className="bg-panel rounded p-5">
          <div className="font-serif text-2xl">
            {idx.companyCount} · {idx.supplierCount}
          </div>
          <div className="text-ink3 text-sm">
            companies · suppliers · {idx.disputedCount} disputed
          </div>
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

      <div>
        <div className="text-ink3 text-xs uppercase tracking-widest mb-3">
          Confirmed $ by supplier identity tier (the integrity lens)
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {(["nation", "ccab", "self_declared"] as const).map((t) => (
            <div key={t} className="bg-panel rounded p-4">
              <div className="font-serif text-xl">{money(idx.byTier[t].confirmed)}</div>
              <div className="text-ink3 text-sm">{tierLabels[t]}</div>
            </div>
          ))}
        </div>
        <p className="text-ink3 text-sm mt-2">
          How much confirmed spend sits at each verification tier — self-declared is where fraud
          risk concentrates.
        </p>
      </div>
    </div>
  );
}
