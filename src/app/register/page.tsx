import { registerAction } from "@/lib/repo/actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  weak: "Enter a valid email and a password of at least 8 characters.",
  name: "A company or supplier needs a name.",
  exists: "An account with that email already exists.",
  role: "Pick a role.",
};

// Public, top-level registration for any role (company / supplier / Indigenomics).
export default function RegisterPage({ searchParams }: { searchParams?: { error?: string } }) {
  const error = searchParams?.error ? ERRORS[searchParams.error] ?? "Registration failed." : null;
  return (
    <div className="max-w-md mx-auto space-y-6">
      <div>
        <h1 className="font-serif text-3xl mb-1">Create an account</h1>
        <p className="text-ink3 text-sm">
          Pick your role and set a password; we&apos;ll take you to your portal.
        </p>
      </div>

      {error && (
        <p role="alert" className="bg-rose-50 text-rose-800 border border-rose-200 rounded px-3 py-2 text-sm">
          {error}
        </p>
      )}

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
            Required for a company or supplier. Indigenomics is a single institute — no name needed.
          </span>
        </label>

        <label className="block">
          <span className="block text-ink3 text-xs uppercase tracking-widest mb-1">Email</span>
          <input name="email" type="email" autoComplete="email" required
            className="w-full bg-bg border border-ink/15 rounded px-3 py-2" />
        </label>
        <label className="block">
          <span className="block text-ink3 text-xs uppercase tracking-widest mb-1">Password</span>
          <input name="password" type="password" autoComplete="new-password" minLength={8} required
            className="w-full bg-bg border border-ink/15 rounded px-3 py-2" />
          <span className="block text-ink3 text-xs mt-1">At least 8 characters.</span>
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
