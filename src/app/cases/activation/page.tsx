import Link from "next/link";
import { casesRepo } from "@/lib/cases";
import { StatCard, Bar } from "../ui";
import { getSession } from "@/lib/auth";
import { resolveLens, lensConfig } from "@/lib/cases/lenses";

const cad = (n: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);

export default async function ActivationPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const s = await casesRepo.getActivationSummary();
  const themes = Object.entries(s.byTheme);
  const maxTheme = Math.max(1, ...themes.map(([, n]) => n));
  const real = s.valueRealization;
  const ef = s.economicFigures;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-2xl">Activation dashboard</h1>
      <p className="mt-1 text-sm text-ink3">Turning Indigenous legal wins into economic intelligence (curated core cases).</p>
      <p className="mt-1 text-sm text-ink3">{lensConfig(resolveLens(searchParams.lens, getSession())).tagline}</p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <StatCard label="curated cases" value={s.totalCases} />
        <StatCard label="value realized" value={real.realized ?? 0} />
        <StatCard label="negotiating" value={real.negotiating ?? 0} />
      </div>

      <section className="mt-6">
        <h2 className="font-serif text-lg">Recorded economic figures <span className="text-xs font-sans font-normal text-ink3">(as recorded in the judgments)</span></h2>
        <p className="mt-1 text-sm text-ink3">Figures recorded in {ef.casesWithFigures} of {ef.totalCases} core cases.</p>
        <div className="mt-2 space-y-1 text-sm">
          {Object.entries(ef.byKind).map(([kind, r]) => (
            <div key={kind} className="flex justify-between rounded border border-line bg-panel px-3 py-2">
              <span className="capitalize">{kind.replace(/_/g, " ")} <span className="text-ink3">· {r.countCases} case{r.countCases === 1 ? "" : "s"}</span></span>
              <span className="text-ink2">
                {r.unit === "%" ? `${r.min}–${r.max}% (median ${r.median}%)` : `${cad(r.min)}–${cad(r.max)} (median ${cad(r.median)})`}
              </span>
            </div>
          ))}
          {Object.keys(ef.byKind).length === 0 && <p className="text-ink3">No court-awarded figures recorded yet.</p>}
        </div>
        <p className="mt-2 text-xs text-ink3">The courts&rsquo; own numbers, extracted and citation-anchored — not estimates, projections, or a corpus total; nominal amounts across different years, not inflation-adjusted.</p>
      </section>

      <section className="mt-6">
        <h2 className="font-serif text-lg">By theme</h2>
        <div className="mt-2 space-y-1">
          {themes.map(([t, n]) => <Bar key={t} label={t.replace(/_/g, " ")} n={n} max={maxTheme} />)}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-serif text-lg">Value-realization funnel</h2>
        <div className="mt-2 flex gap-3 text-sm">
          {(["declared", "negotiating", "realized", "stalled"] as const).map((k) => (
            <div key={k} className="rounded border border-line bg-panel px-3 py-2">
              <div className="font-serif text-lg">{real[k] ?? 0}</div><div className="text-xs text-ink3">{k}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-serif text-lg">Landmark cases <span className="text-xs font-sans font-normal text-ink3">(by citation authority)</span></h2>
        <ul className="mt-1 text-sm">
          {s.landmarkCases.map((c) => (
            <li key={c.id}><Link href={`/cases/${c.id}`} className="hover:text-amber hover:underline">{c.styleOfCause}</Link> <span className="text-ink3">cited {c.citingCount}×</span></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
