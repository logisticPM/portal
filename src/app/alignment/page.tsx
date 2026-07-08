import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { alignmentRepo } from "@/lib/alignment";
import { commitmentsRepo, slugifyOrg } from "@/lib/commitments";
import { InstituteNav } from "@/components/InstituteNav";

export const dynamic = "force-dynamic";

const MAX_COMMITMENTS = 100;

export default async function AlignmentPage() {
  const session = getSession();
  if (!session || session.kind !== "indigenomics") redirect("/home");

  const all = await alignmentRepo.listAll();

  // The Opportunity denormalizes the commitment title + supplier, but not the
  // committing company's display name — resolve it from the commitment it points to.
  const commitments = await commitmentsRepo.listCommitments();
  const orgNameByCommitment = new Map(commitments.map((c) => [c.id, c.orgName]));

  // Group opportunities by commitment (like the company's My Commitments view):
  // one card per commitment, its matched suppliers nested inside. `listAll` is
  // score-desc, so groups keep best-fit-first order; order the cards by their top fit.
  const groups = new Map<string, typeof all>();
  for (const o of all) {
    const arr = groups.get(o.commitmentId) ?? [];
    arr.push(o);
    groups.set(o.commitmentId, arr);
  }
  const cards = [...groups.values()]
    .sort((a, b) => b[0].score - a[0].score)
    .slice(0, MAX_COMMITMENTS);

  return (
    <div className="space-y-6">
      <InstituteNav active="/alignment" />
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics · alignment radar</div>
        <h1 className="font-serif text-2xl">Matchmaking opportunities</h1>
        <p className="text-ink2 text-sm">
          Each card is one company&apos;s RAP procurement commitment and the verified Indigenous suppliers that
          fit it — ranked by a combined sector/tier/ownership + semantic score. Broker the strongest.
          {groups.size > MAX_COMMITMENTS && (
            <span className="text-ink3"> Showing the top {MAX_COMMITMENTS} of {groups.size} commitments.</span>
          )}
        </p>
      </div>
      {cards.length === 0 ? (
        <p className="text-ink3">No opportunities yet. Run the backfill or wait for the engine.</p>
      ) : (
        <div className="space-y-3">
          {cards.map((group) => {
            const first = group[0];
            const companyName = orgNameByCommitment.get(first.commitmentId) ?? first.orgId;
            // /organizations/[id] keys by slugifyOrg(orgName), which is not always
            // the same as Opportunity.orgId (fixture companies use a `c-…` party id).
            const companyKey = slugifyOrg(companyName);
            return (
              <div key={first.commitmentId} className="rounded border border-line bg-bg/30 p-4 space-y-3">
                {/* company + its commitment */}
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <a href={`/organizations/${companyKey}`} className="font-serif text-amber hover:underline">
                    {companyName}
                  </a>
                  <span className="text-ink3 text-sm">committed to</span>
                  <span className="text-ink2 text-sm font-medium">{first.commitmentTitle}</span>
                </div>

                {/* AI-matched suppliers, nested + scoped to THIS commitment */}
                <div className="rounded border border-cedar/30 bg-cedar/5 p-3">
                  <div className="text-cedar text-xs uppercase tracking-widest mb-2">
                    ✦ AI-matched suppliers for “{first.commitmentTitle}”
                  </div>
                  <div className="space-y-1.5">
                    {group.map((o) => (
                      <div key={o.id} className="flex items-baseline gap-3 text-sm flex-wrap">
                        <span className="bg-cedar/20 text-cedar border border-cedar/40 rounded px-1.5 py-0.5 text-xs shrink-0">
                          {Math.round(o.score * 100)}% fit
                        </span>
                        <a href={`/suppliers/${o.supplierId}`} className="font-serif text-cedar hover:underline">
                          {o.supplierName}
                        </a>
                        {o.rationale && <span className="text-ink3">— {o.rationale}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
