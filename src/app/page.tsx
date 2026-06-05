import { repo } from "@/lib/repo";
import { TierBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Home() {
  const companies = await repo.listParties("company");
  const suppliers = await repo.listParties("supplier");

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-serif text-3xl mb-2">
          Pick a role <span className="text-ink3 text-base">(demo — no real auth)</span>
        </h1>
        <p className="text-ink2">
          Three audiences, one confirmed dataset.{" "}
          <span className="text-ink3">
            Dev-only role switcher — companies and suppliers are separate party types; pick whose
            view to see.
          </span>
        </p>
      </div>

      <section>
        <h2 className="text-ink3 text-xs uppercase tracking-widest mb-3">
          Company — Nate&apos;s pages
        </h2>
        <div className="grid gap-2">
          {companies.map((c) => (
            <div key={c.id} className="flex items-center gap-4 bg-panel rounded px-4 py-3">
              <span className="flex-1">{c.name}</span>
              <a className="text-ink3 hover:text-ink underline" href={`/report?as=${c.id}`}>
                report
              </a>
              <a className="text-ink3 hover:text-ink underline" href={`/coverage?as=${c.id}`}>
                coverage
              </a>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10 pt-8">
        <h2 className="text-cedar text-xs uppercase tracking-widest mb-3">
          Supplier — your pages (Jack)
        </h2>
        <div className="grid gap-2">
          {suppliers.map((s) => (
            <div key={s.id} className="flex items-center gap-4 bg-panel rounded px-4 py-3">
              <span className="flex-1">{s.name}</span>
              <TierBadge party={s} />
              <a className="text-amber hover:underline" href={`/confirm?as=${s.id}`}>
                confirm
              </a>
              <a className="text-amber hover:underline" href={`/record?as=${s.id}`}>
                my record
              </a>
            </div>
          ))}
        </div>
        <a href="/register" className="inline-block mt-3 text-cedar hover:underline text-sm">
          + register a new supplier
        </a>
      </section>

      <section className="border-t border-white/10 pt-8">
        <h2 className="text-amber text-xs uppercase tracking-widest mb-3">
          Indigenomics — your page (Jack)
        </h2>
        <a
          className="inline-block bg-panel rounded px-4 py-3 text-amber hover:underline"
          href="/analytics"
        >
          → RAP analysis (the Index)
        </a>
      </section>
    </div>
  );
}
