import { repo } from "@/lib/repo";
import { updateSupplierProfileAction, claimVerificationAction } from "@/lib/repo/actions";

export const dynamic = "force-dynamic";

function Field({ name, label, defaultValue, placeholder }: {
  name: string; label: string; defaultValue?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-ink3 text-xs uppercase tracking-widest mb-1">{label}</label>
      <input
        name={name}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        className="w-full bg-bg border border-ink/15 rounded px-3 py-2"
      />
    </div>
  );
}

export default async function ProfilePage({ searchParams }: { searchParams: { as?: string } }) {
  const supplierId = searchParams.as;
  const suppliers = await repo.listParties("supplier");

  if (!supplierId) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-2xl">My Profile — pick a supplier</h1>
        <div className="grid gap-2">
          {suppliers.map((s) => (
            <a key={s.id} className="bg-panel rounded border border-line px-4 py-3 hover:text-amber" href={`/profile?as=${s.id}`}>
              {s.name}
            </a>
          ))}
        </div>
      </div>
    );
  }

  const supplier = await repo.getParty(supplierId);
  if (!supplier || supplier.role !== "supplier") {
    return <p className="text-ink2">Not a supplier.</p>;
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-2xl">{supplier.name} — profile</h1>
        <a className="ml-auto text-ink3 underline text-sm" href={`/s/${supplierId}`}>view public page →</a>
      </div>
      <p className="text-ink2 text-sm">
        Your showcase is built from your confirmed record — you own it (OCAP). These fields are your
        own words; the verified numbers come from the confirmation engine. Public is your choice.
      </p>
      <div className="bg-panel rounded border border-line shadow-card p-5 space-y-3">
        <div className="text-ink3 text-xs uppercase tracking-widest">My certifications (status layer)</div>
        {(supplier.verifications ?? []).length === 0 ? (
          <p className="text-ink3 text-sm">None yet. Link a certification below — we verify the link against the issuer; we don&apos;t re-certify you.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {(supplier.verifications ?? []).map((v) => (
              <li key={v.source} className="flex items-center gap-2">
                <span className="uppercase tracking-wider text-xs border border-line rounded px-1.5 py-0.5">{v.source.replace("_", " ")}</span>
                <span className="text-ink2">{v.reference}</span>
                <span className={`text-xs ${v.status === "verified" ? "text-cedar" : v.status === "pending" ? "text-ink3" : "text-rust"}`}>{v.status}</span>
                {v.expiresAt && <span className="text-ink3 text-xs">· exp {v.expiresAt}</span>}
              </li>
            ))}
          </ul>
        )}
        <form action={claimVerificationAction} className="flex flex-wrap items-end gap-2 pt-2">
          <input type="hidden" name="supplierId" value={supplierId} />
          <label className="space-y-1">
            <span className="block text-ink3 text-xs uppercase tracking-widest">Source</span>
            <select name="source" className="bg-bg border border-ink/15 rounded px-2 py-2">
              <option value="ccib">CCIB (CIB)</option>
              <option value="isc_ibd">ISC IBD</option>
              <option value="nation">Nation</option>
              <option value="regional">Regional</option>
            </select>
          </label>
          <label className="space-y-1 flex-1">
            <span className="block text-ink3 text-xs uppercase tracking-widest">Reference</span>
            <input name="reference" placeholder="cert # / IBD id / BCR ref" className="w-full bg-bg border border-ink/15 rounded px-2 py-2" />
          </label>
          <button className="bg-cedar/20 text-cedar border border-cedar/40 rounded px-4 py-2 hover:bg-cedar/30">Claim</button>
        </form>
      </div>
      <form action={updateSupplierProfileAction} className="space-y-4 bg-panel rounded border border-line shadow-card p-5">
        <input type="hidden" name="supplierId" value={supplierId} />
        <Field name="sector" label="Sector" defaultValue={supplier.sector} placeholder="e.g. Construction" />
        <Field name="region" label="Region / territory" defaultValue={supplier.region} placeholder="e.g. BC" />
        <Field name="website" label="Website" defaultValue={supplier.website} placeholder="https://…" />
        <div>
          <label className="block text-ink3 text-xs uppercase tracking-widest mb-1">One-line description</label>
          <input
            name="blurb"
            defaultValue={supplier.blurb ?? ""}
            placeholder="What you do, in one line"
            className="w-full bg-bg border border-ink/15 rounded px-3 py-2"
          />
        </div>
        <label className="flex items-center gap-2 text-ink2">
          <input type="checkbox" name="profilePublic" value="true" defaultChecked={supplier.profilePublic === true} />
          Make my profile public (shareable link)
        </label>
        <button className="bg-amber/20 text-amber border border-amber/40 rounded px-4 py-2 hover:bg-amber/30">
          Save profile
        </button>
      </form>
    </div>
  );
}
