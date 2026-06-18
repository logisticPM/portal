import { repo } from "@/lib/repo";
import { partyIdFrom } from "@/lib/auth";
import { withdrawConfirmations } from "@/lib/repo/actions";
import { money, TierBadge, StatusBadge, FlowBadge, TagChip } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RecordPage({
  searchParams,
}: {
  searchParams: { as?: string };
}) {
  const supplierId = partyIdFrom();
  const suppliers = await repo.listParties("supplier");

  if (!supplierId) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-2xl">My Record — pick a supplier</h1>
        <div className="grid gap-2">
          {suppliers.map((s) => (
            <a
              key={s.id}
              className="bg-panel rounded border border-line px-4 py-3 hover:text-amber"
              href={`/record?as=${s.id}`}
            >
              {s.name}
            </a>
          ))}
        </div>
      </div>
    );
  }

  const supplier = await repo.getParty(supplierId);
  const record = await repo.getSupplierRecord(supplierId);
  const rows = await Promise.all(
    record.lines.map(async (line) => ({
      line,
      company: (await repo.getParty(line.companyId))?.name ?? line.companyId,
    })),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-2xl">{supplier?.name}</h1>
        <TierBadge party={supplier} />
        {supplier?.role === "supplier" && supplier.ownershipPct != null && (
          <span className="text-ink3 text-xs">{supplier.ownershipPct}% Indigenous-owned</span>
        )}
        <a className="ml-auto text-ink3 underline text-sm" href={`/confirm?as=${supplierId}`}>
          confirm inbox →
        </a>
      </div>

      <div className="bg-panel rounded border border-line shadow-card p-5">
        <div className="text-ink3 text-xs uppercase tracking-widest">Your confirmed revenue</div>
        <div className="font-serif text-4xl text-amber my-1">{money(record.confirmedRevenue)}</div>
        <div className="text-ink3 text-sm">
          {record.pendingCount} pending · {record.disputedCount} disputed · a record you own
          (OCAP) — exportable &amp; revocable
        </div>
      </div>

      <div>
        <div className="text-ink3 text-xs uppercase tracking-widest mb-2">
          Every claim naming you
        </div>
        <div className="divide-y divide-ink/10">
          {rows.map(({ line, company }) => (
            <div key={line.id} className="flex items-center gap-3 py-2">
              <span className="flex-1">{company}</span>
              <FlowBadge flowType={line.flowType} />
              {line.tags?.map((t) => <TagChip key={t} tag={t} />)}
              <span className="text-ink2 text-sm">{line.period}</span>
              <span className="font-serif w-32 text-right">{money(line.amount)}</span>
              <span className="w-24 text-right">
                <StatusBadge status={line.status} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 pt-2">
        <a
          href={`/api/export?party=${supplierId}`}
          className="border border-ink/15 rounded px-4 py-2 text-ink2 hover:text-ink"
        >
          Export my records (JSON)
        </a>
        <form action={withdrawConfirmations}>
          <input type="hidden" name="supplierId" value={supplierId} />
          <button className="border border-rust/40 text-rust rounded px-4 py-2 hover:bg-rust/10">
            Withdraw my confirmations
          </button>
        </form>
      </div>
      <p className="text-ink3 text-sm">
        Withdrawing pulls your confirmations — those lines revert to <em>pending</em>, your
        confirmed revenue drops, and the company&apos;s claim remains (it&apos;s their data). Watch
        the Index move.
      </p>
    </div>
  );
}
