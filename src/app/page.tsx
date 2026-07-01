import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Pre-login landing. Signed in → straight to your dashboard.
export default function Home() {
  if (getSession()) redirect("/home");

  return (
    <div className="space-y-12">
      <section className="max-w-3xl space-y-5">
        <div className="text-amber text-xs uppercase tracking-[0.2em]">Indigenomics Data Portal</div>
        <h1 className="font-serif text-4xl sm:text-5xl leading-tight">
          Verified Indigenous economic data.
        </h1>
        <p className="text-ink2 text-lg">
          Companies report what they spend with Indigenous businesses. The named supplier{" "}
          <strong>confirms</strong> each entry. The result is a sovereign, confirmed dataset, and
          the RAP Index built on it. Collecting data isn&apos;t the innovation; confirming it is.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <a
            href="/login"
            className="bg-cedar/20 text-cedar border border-cedar/40 rounded px-5 py-2.5 hover:bg-cedar/30"
          >
            Sign in
          </a>
          <a
            href="/register"
            className="border border-ink/15 text-ink2 rounded px-5 py-2.5 hover:text-ink"
          >
            Create an account
          </a>
        </div>
      </section>

      <section className="grid sm:grid-cols-3 gap-4">
        {[
          {
            t: "Report → Confirm",
            d: "Every claim is confirmed by the named Indigenous supplier. Silence is never “confirmed.”",
          },
          {
            t: "Coverage & the Index",
            d: "See how much reported spend is actually confirmed, by flow type and by ownership tier.",
          },
          {
            t: "Owned by suppliers (OCAP)",
            d: "Suppliers own their record: exportable, revocable, and a public showcase if they choose.",
          },
        ].map((c) => (
          <div key={c.t} className="bg-panel rounded border border-line shadow-card p-5">
            <div className="font-serif text-lg mb-1">{c.t}</div>
            <p className="text-ink3 text-sm">{c.d}</p>
          </div>
        ))}
      </section>

      <p className="text-ink3 text-sm">
        Three audiences, one confirmed dataset: company, Indigenous supplier, and Indigenomics (the
        institute). Demo on synthetic data · no real auth.
      </p>
    </div>
  );
}
