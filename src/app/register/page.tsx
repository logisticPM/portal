import { registerAction } from "@/lib/repo/actions";

export const dynamic = "force-dynamic";

// Public, top-level registration for any role (company / supplier / Indigenomics).
export default function RegisterPage() {
  return (
    <div className="max-w-md mx-auto space-y-6">
      <div>
        <h1 className="font-serif text-3xl mb-1">Create an account</h1>
        <p className="text-ink3 text-sm">
          demo · no password. Pick your role; we&apos;ll set you up and take you to your portal.
        </p>
      </div>

      <form action={registerAction} className="space-y-4 bg-panel rounded border border-line shadow-card p-5">
        <label className="block">
          <span className="block text-ink3 text-xs uppercase tracking-widest mb-1">I am a…</span>
          <select
            name="role"
            defaultValue="supplier"
            className="w-full bg-bg border border-ink/15 rounded px-3 py-2"
          >
            <option value="company">Company (a buyer reporting spend)</option>
            <option value="supplier">Indigenous supplier</option>
            <option value="indigenomics">Indigenomics (the institute)</option>
          </select>
        </label>

        <label className="block">
          <span className="block text-ink3 text-xs uppercase tracking-widest mb-1">Name</span>
          <input
            name="name"
            placeholder="e.g. Eagle River Construction"
            className="w-full bg-bg border border-ink/15 rounded px-3 py-2"
          />
          <span className="block text-ink3 text-xs mt-1">
            Required for a company or supplier. Indigenomics is a single institute; no name needed.
          </span>
        </label>

        <button className="w-full bg-cedar/20 text-cedar border border-cedar/40 rounded px-4 py-2 hover:bg-cedar/30">
          Create account &amp; continue
        </button>
      </form>

      <p className="text-ink3 text-sm">
        Already have an account?{" "}
        <a href="/login" className="text-cedar underline">
          sign in
        </a>
        .
      </p>
    </div>
  );
}
