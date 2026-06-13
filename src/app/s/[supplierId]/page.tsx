import { repo } from "@/lib/repo";
import { money } from "@/components/ui";
import type { IdentityTier } from "@/lib/repo/types";

export const dynamic = "force-dynamic";

const tierLabels: Record<IdentityTier, string> = {
  nation: "Nation-verified",
  ccab: "CCAB-certified",
  self_declared: "Self-declared",
};
const tierStyles: Record<IdentityTier, string> = {
  nation: "border-cedar/30 bg-cedar/10 text-cedar",
  ccab: "border-amber/30 bg-amber/10 text-amber",
  self_declared: "border-rust/30 bg-rust/10 text-rust",
};

export default async function ShowcasePage({ params }: { params: { supplierId: string } }) {
  const s = await repo.getSupplierShowcase(params.supplierId);

  if (!s) {
    return (
      <div className="max-w-2xl space-y-3">
        <p className="text-ink2">This profile isn&apos;t public.</p>
        <a href="/" className="text-ink3 underline text-sm">← Indigenomics Data Portal</a>
      </div>
    );
  }

  const flows = Object.entries(s.byFlow).filter(([, v]) => v.confirmed > 0);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl">{s.name}</h1>
          <span className={`text-xs uppercase tracking-wider border rounded-full px-2 py-0.5 ${tierStyles[s.identityTier]}`}>
            {tierLabels[s.identityTier]}
          </span>
          {s.ownershipPct != null && (
            <span className="text-ink3 text-sm">{s.ownershipPct}% Indigenous-owned</span>
          )}
        </div>
        {s.verifications.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {s.verifications.map((v) => (
              <span key={v.source} className="text-[0.65rem] uppercase tracking-wider border border-cedar/40 text-cedar rounded px-1.5 py-0.5">
                {v.source.replace("_", " ")}{v.reference ? ` · ${v.reference}` : ""}{v.verifiedBy ? ` · ${v.verifiedBy}` : ""}
              </span>
            ))}
          </div>
        )}
        {s.blurb && <p className="text-ink2 mt-2">{s.blurb}</p>}
        <div className="text-ink3 text-sm mt-1">
          {[s.sector, s.region].filter(Boolean).join(" · ")}
          {s.website && (
            <>
              {" · "}
              <a href={s.website} target="_blank" rel="noreferrer" className="underline">website ↗</a>
            </>
          )}
        </div>
      </div>

      <div className="bg-panel rounded border border-line shadow-card p-5 space-y-3">
        <div className="text-ink3 text-xs uppercase tracking-widest">
          Verified track record — verified by the Indigenomics Data Portal · as of {s.asOf || "—"}
        </div>
        <div className="font-serif text-4xl text-amber">{money(s.confirmedRevenue)}</div>
        <div className="text-ink3 text-sm">
          confirmed · across {s.confirmedBuyerCount} confirmed {s.confirmedBuyerCount === 1 ? "buyer" : "buyers"}
        </div>
        {flows.length > 0 && (
          <div className="space-y-1 pt-2">
            {flows.map(([flow, v]) => (
              <div key={flow} className="flex justify-between text-sm">
                <span className="capitalize">{flow}</span>
                <span className="text-ink3">{money(v.confirmed)}</span>
              </div>
            ))}
          </div>
        )}
        {s.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {s.tags.map((t) => (
              <span key={t} className="text-[0.6rem] uppercase tracking-wider border border-ink3/40 text-ink3 rounded px-1.5 py-0.5">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="text-ink3 text-xs">
        Confirmed by the named Indigenous business against buyer-reported transactions. Per-buyer
        detail is private (counts only).
      </p>
    </div>
  );
}
