import { repo } from "@/lib/repo";
import { money } from "@/components/ui";
import { InstituteNav } from "@/components/InstituteNav";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TIER_LABELS } from "@/lib/repo/labels";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const session = getSession();
  if (!session) redirect("/login");

  const idx = await repo.getIndexSummary();
  const flows = Object.entries(idx.byFlow);

  return (
    <div className="space-y-8">
      <InstituteNav active="/analytics" />
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">
          Indigenomics · verification coverage
        </div>
        <h1 className="font-serif text-3xl">
          Spend Coverage{" "}
          <span className="text-ink3 text-base">· how much reported spend is confirmed</span>
        </h1>
        <p className="text-ink2 text-sm mt-1">
          Companies report dollars spent with Indigenous suppliers; the supplier confirms each entry.
          This is the coverage of confirmed vs reported <em>spend</em>. Distinct from the{" "}
          <a href="/commitments" className="text-amber hover:underline">RAP Index</a>, which tracks RAP{" "}
          <em>commitments</em>.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-4xl text-amber">{idx.confirmedPct}%</div>
          <div className="text-ink3 text-sm">of reported $ confirmed</div>
        </div>
        <div className="bg-panel rounded border border-line shadow-card p-5">
          <div className="font-serif text-2xl">{money(idx.totalConfirmed)}</div>
          <div className="text-ink3 text-sm">confirmed · of {money(idx.totalReported)} reported</div>
        </div>
        <div className="bg-panel rounded border border-line shadow-card p-5">
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
          Reported vs confirmed, by flow type
        </div>
        <div className="space-y-3">
          {flows.map(([flow, v]) => {
            const pct = v.reported ? Math.round((v.confirmed / v.reported) * 100) : 0;
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

      <div>
        <div className="text-ink3 text-xs uppercase tracking-widest mb-3">
          Confirmed $ by ownership-certification tier · the equity / integrity lens
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {(["nation", "ccib", "self_declared"] as const).map((t) => (
            <div key={t} className="bg-panel rounded border border-line shadow-card p-4">
              <div className="font-serif text-xl">{money(idx.byTier[t].confirmed)}</div>
              <div className="text-ink3 text-sm">{TIER_LABELS[t]}</div>
            </div>
          ))}
        </div>
        <p className="text-ink3 text-sm mt-2">
          How much confirmed spend sits at each ownership-certification tier: self-declared is
          where phantom-JV fraud risk concentrates. (Equity isn&apos;t a separate flow; it&apos;s
          this verification layer.)
        </p>
      </div>

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
          <p className="text-ink3 text-sm mt-2">A certification (status) without confirmed activity (substance), or large spend with no verification, is the shell-company signal. Counts only; routed to human/Nation/CCIB review, never auto-judged.</p>
        </div>
      )}

      {Object.keys(idx.byTag).length > 0 && (
        <div>
          <div className="text-ink3 text-xs uppercase tracking-widest mb-3">
            Confirmed $ by tag
          </div>
          <div className="flex flex-wrap gap-4">
            {Object.entries(idx.byTag).map(([tag, v]) => (
              <div key={tag} className="bg-panel rounded border border-line shadow-card p-4">
                <div className="font-serif text-xl">{money(v.confirmed)}</div>
                <div className="text-ink3 text-sm capitalize">{tag}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
