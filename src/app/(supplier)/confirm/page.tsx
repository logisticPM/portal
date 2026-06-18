import { repo } from "@/lib/repo";
import { partyIdFrom } from "@/lib/auth";
import { respondToLine } from "@/lib/repo/actions";
import { money, TierBadge, FlowBadge, flowClaim, TagChip } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ConfirmPage() {
  const supplierId = partyIdFrom();
  const suppliers = await repo.listParties("supplier");

  if (!supplierId) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-2xl">Confirm — pick a supplier</h1>
        <div className="grid gap-2">
          {suppliers.map((s) => (
            <a
              key={s.id}
              className="bg-panel rounded border border-line px-4 py-3 hover:text-amber"
              href={`/confirm?as=${s.id}`}
            >
              {s.name}
            </a>
          ))}
        </div>
      </div>
    );
  }

  const supplier = await repo.getParty(supplierId);
  const pending = await repo.listPendingForSupplier(supplierId);
  const rows = await Promise.all(
    pending.map(async (line) => ({
      line,
      company: (await repo.getParty(line.companyId))?.name ?? line.companyId,
    })),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-2xl">{supplier?.name}</h1>
        <TierBadge party={supplier} />
        <a className="ml-auto text-ink3 underline text-sm" href={`/record?as=${supplierId}`}>
          my record →
        </a>
      </div>
      <p className="text-ink2">
        Claims naming you, awaiting your confirmation.{" "}
        <span className="text-ink3">Silence is never &ldquo;confirmed.&rdquo;</span>
      </p>

      {rows.length === 0 ? (
        <p className="text-ink3">Nothing pending here.</p>
      ) : (
        <div className="space-y-3">
          {rows.map(({ line, company }) => (
            <div key={line.id} className="bg-panel rounded border border-line shadow-card p-4">
              <div className="flex flex-wrap items-baseline gap-2 mb-3">
                <span className="font-serif text-lg">{company}</span>
                <span className="text-ink3">{flowClaim(line.flowType)}</span>
                <span className="font-serif text-amber text-lg">{money(line.amount)}</span>
                <FlowBadge flowType={line.flowType} />
                {line.tags?.map((t) => <TagChip key={t} tag={t} />)}
                <span className="text-ink3 text-sm">· {line.period}</span>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <form action={respondToLine}>
                  <input type="hidden" name="lineId" value={line.id} />
                  <input type="hidden" name="byPartyId" value={supplierId} />
                  <input type="hidden" name="status" value="confirmed" />
                  <button className="bg-cedar/20 text-cedar border border-cedar/40 rounded px-3 py-1 hover:bg-cedar/30">
                    Confirm
                  </button>
                </form>
                <form action={respondToLine}>
                  <input type="hidden" name="lineId" value={line.id} />
                  <input type="hidden" name="byPartyId" value={supplierId} />
                  <input type="hidden" name="status" value="disputed" />
                  <button className="bg-rust/20 text-rust border border-rust/40 rounded px-3 py-1 hover:bg-rust/30">
                    Dispute
                  </button>
                </form>
                <form action={respondToLine} className="flex items-center gap-1">
                  <input type="hidden" name="lineId" value={line.id} />
                  <input type="hidden" name="byPartyId" value={supplierId} />
                  <input type="hidden" name="status" value="corrected" />
                  <input
                    name="correctedAmount"
                    type="number"
                    placeholder="correct $"
                    className="w-28 bg-bg border border-ink/15 rounded px-2 py-1 text-sm"
                  />
                  <button className="bg-amber/20 text-amber border border-amber/40 rounded px-3 py-1 hover:bg-amber/30">
                    Correct
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
