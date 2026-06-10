import { repo } from "@/lib/repo";
import { createLineAction } from "@/lib/repo/actions";
import { money, TierBadge, StatusBadge } from "@/components/ui";
import type { IdentityTier, Party } from "@/lib/repo/types";

export const dynamic = "force-dynamic";

const tierLabels: Record<IdentityTier, string> = {
  nation: "Nation-verified",
  ccab: "CCAB-certified",
  self_declared: "Self-declared",
};

export default async function ReportPage({
  searchParams,
}: {
  searchParams: { as?: string };
}) {
  const companyId = searchParams.as;
  const companies = await repo.listParties("company");

  // No company chosen yet → pick one (mirrors confirm/record).
  if (!companyId) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-2xl">Report — pick a company</h1>
        <div className="grid gap-2">
          {companies.map((c) => (
            <a
              key={c.id}
              className="bg-panel rounded border border-line px-4 py-3 hover:text-amber"
              href={`/report?as=${c.id}`}
            >
              {c.name}
            </a>
          ))}
        </div>
      </div>
    );
  }

  const company = await repo.getParty(companyId);
  const suppliers = await repo.listParties("supplier");
  const lines = await repo.listLinesForCompany(companyId);
  const supplierName = (id: string) =>
    suppliers.find((s) => s.id === id)?.name ?? id;
  const supplierParty = (id: string): Party | undefined =>
    suppliers.find((s) => s.id === id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-2xl">{company?.name}</h1>
        <span className="text-ink3 text-sm">— questionnaire</span>
        <a className="ml-auto text-ink3 underline text-sm" href={`/coverage?as=${companyId}`}>
          coverage →
        </a>
      </div>
      <p className="text-ink2">
        Report procurement <strong>one line per named supplier</strong>.{" "}
        <span className="text-ink3">
          Australia collects only an aggregate total — itemizing by named supplier is what lets
          each one confirm.
        </span>
      </p>

      {/* --- add a reported line --- */}
      <form action={createLineAction} className="bg-panel rounded border border-line shadow-card p-5 space-y-4">
        <input type="hidden" name="companyId" value={companyId} />
        {/* MVP flagship pillar is procurement (equity is the high-value second). */}
        <input type="hidden" name="pillar" value="procurement" />

        <div className="grid sm:grid-cols-[1fr_10rem_8rem] gap-3">
          <label className="space-y-1">
            <span className="text-ink3 text-xs uppercase tracking-widest">Supplier</span>
            <select
              name="supplierId"
              required
              defaultValue=""
              className="w-full bg-bg border border-ink/15 rounded px-2 py-2"
            >
              <option value="" disabled>
                Select a supplier…
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.role === "supplier" ? ` — ${tierLabels[s.identityTier]}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-ink3 text-xs uppercase tracking-widest">Amount (CAD)</span>
            <input
              name="amount"
              type="number"
              min="1"
              step="1"
              required
              placeholder="e.g. 250000"
              className="w-full bg-bg border border-ink/15 rounded px-2 py-2"
            />
          </label>

          <label className="space-y-1">
            <span className="text-ink3 text-xs uppercase tracking-widest">Period</span>
            <input
              name="period"
              type="text"
              required
              defaultValue="2025"
              className="w-full bg-bg border border-ink/15 rounded px-2 py-2"
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button className="bg-amber/20 text-amber border border-amber/40 rounded px-4 py-2 hover:bg-amber/30">
            Report line
          </button>
          <span className="text-ink3 text-sm">
            Pillar: <span className="text-ink2">procurement</span> (MVP)
          </span>
        </div>
      </form>

      {/* --- lines already reported --- */}
      <div>
        <div className="text-ink3 text-xs uppercase tracking-widest mb-2">
          Reported lines{" "}
          <span className="text-ink3">— each awaits its supplier&apos;s confirmation</span>
        </div>
        {lines.length === 0 ? (
          <p className="text-ink3">No lines reported yet. Add one above.</p>
        ) : (
          <div className="divide-y divide-ink/10">
            {lines.map((line) => (
              <div key={line.id} className="flex items-center gap-3 py-2">
                <span className="flex-1">{supplierName(line.supplierId)}</span>
                <TierBadge party={supplierParty(line.supplierId)} />
                <span className="text-ink2 text-sm">{line.period}</span>
                <span className="font-serif w-32 text-right">{money(line.amount)}</span>
                <span className="w-24 text-right">
                  <StatusBadge status={line.status} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
