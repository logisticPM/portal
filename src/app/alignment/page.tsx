import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { alignmentRepo } from "@/lib/alignment";
import { InstituteNav } from "@/components/InstituteNav";

export const dynamic = "force-dynamic";

export default async function AlignmentPage() {
  const session = getSession();
  if (!session || session.kind !== "indigenomics") redirect("/home");

  const all = await alignmentRepo.listAll();
  const opportunities = all.slice(0, 100);

  return (
    <div className="space-y-6">
      <InstituteNav active="/alignment" />
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics · alignment radar</div>
        <h1 className="font-serif text-2xl">Matchmaking opportunities</h1>
        <p className="text-ink2 text-sm">
          Company RAP procurement commitments matched to verified Indigenous suppliers — ranked by fit. Broker the strongest.
          {all.length > 100 && <span className="text-ink3"> Showing the top 100 of {all.length}.</span>}
        </p>
      </div>
      {opportunities.length === 0 ? (
        <p className="text-ink3">No opportunities yet. Run the backfill or wait for the engine.</p>
      ) : (
        <div className="space-y-3">
          {opportunities.map((o) => (
            <div key={o.id} className="bg-panel rounded border border-line shadow-card p-4 flex flex-wrap items-center gap-3">
              <span className="bg-cedar/20 text-cedar border border-cedar/40 rounded px-1.5 py-0.5 text-xs">
                {Math.round(o.score * 100)}% fit
              </span>
              <span className="font-serif">{o.supplierName}</span>
              <span className="text-ink3 text-sm">↔ {o.commitmentTitle}</span>
              {o.rationale && <span className="text-ink3 text-sm w-full">{o.rationale}</span>}
              <a href={`/s/${o.supplierId}`} className="ml-auto text-cedar underline text-sm">supplier →</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
