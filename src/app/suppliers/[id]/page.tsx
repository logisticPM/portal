// One supplier's institute profile (mirrors /organizations/[id]): real About box +
// identity/verifications + confirmed track record.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { repo } from "@/lib/repo";
import { money } from "@/components/ui";
import { InstituteNav } from "@/components/InstituteNav";
import { getSupplierProfile } from "@/lib/suppliers/supplier-profiles";
import { labelFor } from "@/lib/taxonomy";
import type { IdentityTier } from "@/lib/repo/types";

export const dynamic = "force-dynamic";

const tierLabels: Record<IdentityTier, string> = { nation: "Nation-verified", ccab: "CCAB-certified", self_declared: "Self-declared" };
const tierStyles: Record<IdentityTier, string> = {
  nation: "border-cedar/30 bg-cedar/10 text-cedar",
  ccab: "border-amber/30 bg-amber/10 text-amber",
  self_declared: "border-rust/30 bg-rust/10 text-rust",
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="text-ink3 w-32 shrink-0">{label}</dt>
      <dd className="text-ink2">{value}</dd>
    </div>
  );
}

export default async function SupplierDetailPage({ params }: { params: { id: string } }) {
  const session = getSession();
  if (!session || session.kind !== "indigenomics") redirect("/home");

  const party = await repo.getParty(params.id);
  if (!party || party.role !== "supplier") {
    return (
      <div className="space-y-6">
        <InstituteNav active="/suppliers" />
        <p className="text-ink2">Supplier not found.</p>
        <a href="/suppliers" className="text-ink3 underline text-sm">← all suppliers</a>
      </div>
    );
  }

  const profile = getSupplierProfile(party.id);
  const showcase = await repo.getSupplierShowcase(party.id);
  const flows = showcase ? Object.entries(showcase.byFlow).filter(([, v]) => v.confirmed > 0) : [];

  return (
    <div className="space-y-8">
      <InstituteNav active="/suppliers" />

      <div>
        <a href="/suppliers" className="text-sm text-ink3 hover:text-amber hover:underline">← all suppliers</a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-3xl">{party.name}</h1>
          <span className={`text-xs uppercase tracking-wider border rounded-full px-2 py-0.5 ${tierStyles[party.identityTier]}`}>
            {tierLabels[party.identityTier]}
          </span>
          {party.ownershipPct != null && (
            <span className="text-ink3 text-sm">{party.ownershipPct}% Indigenous-owned</span>
          )}
        </div>
        <p className="text-ink2 text-sm mt-1">{labelFor("sector", party.sectorNorm ?? party.sector ?? "")}{party.regionNorm ? ` · ${party.regionNorm}` : ""}</p>
      </div>

      {/* about — real reference info (Wikipedia-style) */}
      {profile && (
        <section className="bg-panel rounded border border-line shadow-card p-5">
          <div className="text-ink3 text-xs uppercase tracking-widest mb-3">About</div>
          <p className="text-ink2 text-sm mb-4">{profile.about}</p>
          <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <InfoRow label="Headquarters" value={profile.headquarters} />
            <InfoRow label="Founded" value={profile.founded} />
            <InfoRow label="Industry" value={profile.industry} />
            {profile.employees && <InfoRow label="Employees" value={profile.employees} />}
            <InfoRow label="Ownership" value={profile.owner} />
          </dl>
          <a href={profile.website} target="_blank" rel="noreferrer" className="text-amber hover:underline text-sm mt-3 inline-block">
            {profile.website.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗
          </a>
          <p className="text-ink3 text-[11px] mt-2">Public reference information.</p>
        </section>
      )}

      {/* verifications */}
      {(party.verifications ?? []).length > 0 && (
        <section className="bg-panel rounded border border-line shadow-card p-5">
          <div className="text-ink3 text-xs uppercase tracking-widest mb-3">Certifications</div>
          <div className="space-y-2 text-sm">
            {(party.verifications ?? []).map((v, i) => (
              <div key={`${v.source}-${v.reference ?? ""}-${i}`} className="flex flex-wrap items-center gap-2">
                <span className="uppercase tracking-wider text-xs border border-line rounded px-1.5 py-0.5">{v.source.replace(/_/g, " ")}</span>
                <span className="text-ink2">{v.reference}</span>
                {v.verifiedBy && <span className="text-ink3">· {v.verifiedBy}</span>}
                <span className="text-ink3">· {v.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* track record */}
      <section className="bg-panel rounded border border-line shadow-card p-5">
        <div className="text-ink3 text-xs uppercase tracking-widest mb-3">Confirmed track record</div>
        <div className="font-serif text-4xl text-amber">{money(showcase?.confirmedRevenue ?? 0)}</div>
        <p className="text-ink3 text-sm mt-1">confirmed across {showcase?.confirmedBuyerCount ?? 0} buyer(s)</p>
        {flows.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            {flows.map(([flow, v]) => (
              <span key={flow} className="text-ink2 capitalize">{flow}: <span className="font-serif">{money(v.confirmed)}</span></span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
