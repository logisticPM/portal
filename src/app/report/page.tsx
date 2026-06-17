import { repo } from "@/lib/repo";
import { partyIdFrom } from "@/lib/auth";
import { money, TierBadge, StatusBadge, FlowBadge, TagChip } from "@/components/ui";
import type { Party } from "@/lib/repo/types";
import { ReportLineForm } from "./ReportLineForm";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: { as?: string };
}) {
  const companyId = partyIdFrom(searchParams);
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
        Report confirmable lines <strong>one per named counterparty</strong>.{" "}
        <span className="text-ink3">
          Australia collects only an aggregate total — itemizing by named counterparty is what
          lets each one confirm. Procurement names a supplier you bought from; capital names an
          Indigenous business you invested into.
        </span>
      </p>

      {/* --- add a reported line (client form: pillar relabels the amount field) --- */}
      <ReportLineForm companyId={companyId} suppliers={suppliers} />

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
                <FlowBadge flowType={line.flowType} />
                {line.tags?.map((t) => <TagChip key={t} tag={t} />)}
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
