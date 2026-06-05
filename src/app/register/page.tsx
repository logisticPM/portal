import { registerSupplierAction } from "@/lib/repo/actions";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl">Register as a supplier</h1>
        <p className="text-ink2">
          Join the registry so companies can name you, and so you can confirm claims about your
          business.
        </p>
      </div>

      <form action={registerSupplierAction} className="space-y-5 bg-panel rounded p-5">
        <div>
          <label className="block text-ink3 text-xs uppercase tracking-widest mb-1">
            Business name
          </label>
          <input
            name="name"
            required
            placeholder="e.g. Eagle River Construction"
            className="w-full bg-bg border border-white/15 rounded px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-ink3 text-xs uppercase tracking-widest mb-1">
            Identity tier
          </label>
          <select
            name="identityTier"
            defaultValue="self_declared"
            className="w-full bg-bg border border-white/15 rounded px-3 py-2"
          >
            <option value="nation">Nation-verified</option>
            <option value="ccab">CCAB-certified</option>
            <option value="self_declared">Self-declared</option>
          </select>
          <p className="text-rust/80 text-xs mt-2">
            Demo: this tier is <strong>self-declared and not verified</strong>. Real verification
            (nation endorsement / CCAB) is Horizon-2 work — which is exactly why the Index flags
            self-declared spend as the fraud-risk tier.
          </p>
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
