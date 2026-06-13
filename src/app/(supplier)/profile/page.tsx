import { repo } from "@/lib/repo";
import { updateSupplierProfileAction } from "@/lib/repo/actions";

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
