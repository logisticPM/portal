import { repo } from "@/lib/repo";
import { resolveVerificationAction } from "@/lib/repo/actions";
import { InstituteNav } from "@/components/InstituteNav";

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const pending = await repo.listPendingVerifications();
  return (
    <div className="max-w-2xl space-y-6">
      <InstituteNav active="/verify" />
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics · verification</div>
        <h1 className="font-serif text-2xl">Pending certification claims</h1>
        <p className="text-ink2 text-sm">Confirm each claim against the issuer (CCIB directory / ISC IBD / the Nation). We verify the link; we don&apos;t re-certify. Identity authority stays with Nations / CCIB.</p>
      </div>
      {pending.length === 0 ? (
        <p className="text-ink3">Nothing pending.</p>
      ) : (
        <div className="space-y-3">
          {pending.map(({ supplier, verification }) => (
            <div key={`${supplier.id}-${verification.source}`} className="bg-panel rounded border border-line shadow-card p-4 flex flex-wrap items-center gap-3">
              <span className="font-serif">{supplier.name}</span>
              <span className="uppercase tracking-wider text-xs border border-line rounded px-1.5 py-0.5">{verification.source.replace("_", " ")}</span>
              <span className="text-ink2 text-sm">{verification.reference}</span>
              <form action={resolveVerificationAction} className="ml-auto flex gap-2">
                <input type="hidden" name="supplierId" value={supplier.id} />
                <input type="hidden" name="source" value={verification.source} />
                <button name="status" value="verified" className="bg-cedar/20 text-cedar border border-cedar/40 rounded px-3 py-1 hover:bg-cedar/30">Verify</button>
                <button name="status" value="revoked" className="bg-rust/20 text-rust border border-rust/40 rounded px-3 py-1 hover:bg-rust/30">Reject</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
