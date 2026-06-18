import { signIn } from "@/lib/repo/actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "Incorrect email or password.",
  throttled: "Too many attempts. Try again in a few minutes.",
};

export default function LoginPage({ searchParams }: { searchParams?: { error?: string } }) {
  const error = searchParams?.error ? ERRORS[searchParams.error] ?? "Sign-in failed." : null;
  return (
    <div className="max-w-md mx-auto space-y-6">
      <div>
        <h1 className="font-serif text-3xl mb-1">Sign in</h1>
        <p className="text-ink3 text-sm">Enter your email and password.</p>
      </div>

      {error && (
        <p role="alert" className="bg-rose-50 text-rose-800 border border-rose-200 rounded px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <form action={signIn} className="space-y-4 bg-panel rounded border border-line shadow-card p-5">
        <label className="block">
          <span className="block text-ink3 text-xs uppercase tracking-widest mb-1">Email</span>
          <input name="email" type="email" autoComplete="email" required
            className="w-full bg-bg border border-ink/15 rounded px-3 py-2" />
        </label>
        <label className="block">
          <span className="block text-ink3 text-xs uppercase tracking-widest mb-1">Password</span>
          <input name="password" type="password" autoComplete="current-password" required
            className="w-full bg-bg border border-ink/15 rounded px-3 py-2" />
        </label>
        <button className="w-full bg-cedar/20 text-cedar border border-cedar/40 rounded px-4 py-2 hover:bg-cedar/30">
          Sign in
        </button>
      </form>

      <p className="text-ink3 text-sm">
        New here?{" "}
        <a href="/register" className="text-cedar underline">create an account</a>{" "}
        — company, supplier, or Indigenomics.
      </p>
    </div>
  );
}
