import { registerSupplierAction } from "@/lib/repo/actions";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl">Register as a supplier</h1>
        <p className="text-ink2">
          Join the registry so companies can name you, and so you can confirm claims about your
          business. New suppliers start <strong>self-declared</strong>; you raise your tier by
          linking a verified certification in your profile.
        </p>
      </div>

      <form action={registerSupplierAction} className="space-y-5 bg-panel rounded border border-line shadow-card p-5">
        <div>
          <label className="block text-ink3 text-xs uppercase tracking-widest mb-1">
            Business name
          </label>
          <input
            name="name"
            required
            placeholder="e.g. Eagle River Construction"
            className="w-full bg-bg border border-ink/15 rounded px-3 py-2"
          />
        </div>

        <button className="bg-amber/20 text-amber border border-amber/40 rounded px-4 py-2 hover:bg-amber/30">
          Register
        </button>
      </form>

      <a href="/" className="text-ink3 underline text-sm">
        ← back
      </a>
    </div>
  );
}
