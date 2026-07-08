import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { alignmentRepo } from "@/lib/alignment";
import { commitmentsRepo, slugifyOrg } from "@/lib/commitments";
import { InstituteNav } from "@/components/InstituteNav";

export const dynamic = "force-dynamic";

export default async function AlignmentPage() {
  const session = getSession();
  if (!session || session.kind !== "indigenomics") redirect("/home");

  const all = await alignmentRepo.listAll();
  const opportunities = all.slice(0, 100);

  // The Opportunity denormalizes the commitment title + supplier, but not the
  // committing company's display name — resolve it from the commitment it points to.
  const commitments = await commitmentsRepo.listCommitments();
  const orgNameByCommitment = new Map(commitments.map((c) => [c.id, c.orgName]));

  return (
    <div className="space-y-6">
      <InstituteNav active="/alignment" />
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics · alignment radar</div>
        <h1 className="font-serif text-2xl">Matchmaking opportunities</h1>
        <p className="text-ink2 text-sm">
          Each row pairs one company&apos;s RAP procurement commitment with a verified Indigenous supplier that
          fits it — ranked by a combined sector/tier/ownership + semantic score. Broker the strongest.
          {all.length > 100 && <span className="text-ink3"> Showing the top 100 of {all.length}.</span>}
        </p>
      </div>
      {opportunities.length === 0 ? (
        <p className="text-ink3">No opportunities yet. Run the backfill or wait for the engine.</p>
      ) : (
        <div className="space-y-3">
          {opportunities.map((o) => {
            const companyName = orgNameByCommitment.get(o.commitmentId) ?? o.orgId;
            // /organizations/[id] keys by slugifyOrg(orgName), which is not always
            // the same as Opportunity.orgId (fixture companies use a `c-…` party id).
            const companyKey = slugifyOrg(companyName);
            return (
              <div key={o.id} className="bg-panel rounded border border-line shadow-card p-4 space-y-2">
                {/* company + its commitment */}
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="bg-cedar/20 text-cedar border border-cedar/40 rounded px-1.5 py-0.5 text-xs shrink-0 self-center">
                    {Math.round(o.score * 100)}% fit
                  </span>
                  <a href={`/organizations/${companyKey}`} className="font-serif text-amber hover:underline">
                    {companyName}
                  </a>
                  <span className="text-ink3 text-sm">committed to</span>
                  <span className="text-ink2 text-sm">{o.commitmentTitle}</span>
                </div>
                {/* matched supplier */}
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                  <span className="text-ink3">→ matched supplier:</span>
                  <a href={`/suppliers/${o.supplierId}`} className="font-serif text-cedar hover:underline">
                    {o.supplierName}
                  </a>
                </div>
                {o.rationale && <p className="text-ink3 text-sm">{o.rationale}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
