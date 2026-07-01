import Link from "next/link";
import { casesRepo } from "@/lib/cases";

function Bar({ label, n, max }: { label: string; n: number; max: number }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="w-40 shrink-0 text-ink2">{label}</div>
      <div className="h-4 flex-1 rounded bg-ink/10 overflow-hidden">
        <div className="h-4 rounded bg-amber" style={{ width: `${max ? (n / max) * 100 : 0}%` }} />
      </div>
      <div className="w-8 text-right text-ink3">{n}</div>
    </div>
  );
}

export default async function ActivationPage() {
  const s = await casesRepo.getActivationSummary();
  const themes = Object.entries(s.byTheme);
  const maxTheme = Math.max(1, ...themes.map(([, n]) => n));
  const real = s.valueRealization;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-2xl">Activation Dashboard</h1>
      <p className="mt-1 text-sm text-ink3">Turning Indigenous legal wins into economic intelligence.</p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="bg-panel rounded border border-line shadow-card p-3"><div className="font-serif text-2xl">{s.totalCases}</div><div className="text-xs text-ink3">cases</div></div>
        <div className="bg-panel rounded border border-line shadow-card p-3"><div className="font-serif text-2xl">{(real.realized ?? 0)}</div><div className="text-xs text-ink3">value realized</div></div>
        <div className="bg-panel rounded border border-line shadow-card p-3"><div className="font-serif text-2xl">{(real.negotiating ?? 0)}</div><div className="text-xs text-ink3">negotiating</div></div>
      </div>

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
            <div key={k} className="bg-panel rounded border border-line px-3 py-2">
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
