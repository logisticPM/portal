import { repo } from "@/lib/repo";
import { signIn } from "@/lib/repo/actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const [companies, suppliers] = await Promise.all([
    repo.listParties("company"),
    repo.listParties("supplier"),
  ]);

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div>
        <h1 className="font-serif text-3xl mb-1">Sign in</h1>
        <p className="text-ink3 text-sm">
          demo · no password — pick an account and we&apos;ll take you to the right portal.
        </p>
      </div>

      <form action={signIn} className="space-y-4 bg-panel rounded border border-line shadow-card p-5">
        <label className="block">
          <span className="block text-ink3 text-xs uppercase tracking-widest mb-1">Account</span>
          <select
            name="account"
            defaultValue="indigenomics"
            className="w-full bg-bg border border-ink/15 rounded px-3 py-2"
          >
            <optgroup label="Company (buyer)">
              {companies.map((c) => (
                <option key={c.id} value={`company:${c.id}`}>
                  {c.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Indigenous supplier">
              {suppliers.map((s) => (
                <option key={s.id} value={`supplier:${s.id}`}>
                  {s.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Institute">
              <option value="indigenomics">Indigenomics — the Index + verification</option>
            </optgroup>
          </select>
        </label>

        <button className="w-full bg-cedar/20 text-cedar border border-cedar/40 rounded px-4 py-2 hover:bg-cedar/30">
          Sign in
        </button>
      </form>

      <p className="text-ink3 text-sm">
        New here?{" "}
        <a href="/register" className="text-cedar underline">
          create an account
        </a>{" "}
        — company, supplier, or Indigenomics.
      </p>
    </div>
  );
}
