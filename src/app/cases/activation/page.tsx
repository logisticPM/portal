import Link from "next/link";
import { casesRepo } from "@/lib/cases";
import { StatCard, Bar } from "../ui";

const cad = (n: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);

export default async function ActivationPage() {
  const s = await casesRepo.getActivationSummary();
  const themes = Object.entries(s.byTheme);
  const maxTheme = Math.max(1, ...themes.map(([, n]) => n));
  const real = s.valueRealization;
  const ev = s.economicValue;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-2xl">Activation dashboard</h1>
      <p className="mt-1 text-sm text-ink3">Turning Indigenous legal wins into economic intelligence (curated core cases).</p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <StatCard label="curated cases" value={s.totalCases} />
        <StatCard label="value realized" value={real.realized ?? 0} />
        <StatCard label="negotiating" value={real.negotiating ?? 0} />
      </div>

      <section className="mt-6">
        <h2 className="font-serif text-lg">Economic value <span className="text-xs font-sans font-normal text-ink3">(recorded across core cases)</span></h2>
        <div className="mt-2 grid grid-cols-3 gap-3">
          <StatCard label="settlements" value={cad(ev.settlement)} />
          <StatCard label="resource revenue" value={cad(ev.resourceRevenue)} />
          <StatCard label="equity stake %" value={ev.equity} />
        </div>
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
