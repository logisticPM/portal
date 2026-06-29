import Link from "next/link";
import { casesRepo } from "@/lib/cases";

function Bar({ label, n, max }: { label: string; n: number; max: number }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="w-40 shrink-0">{label}</div>
      <div className="h-4 flex-1 rounded bg-gray-100">
        <div className="h-4 rounded bg-blue-500" style={{ width: `${max ? (n / max) * 100 : 0}%` }} />
      </div>
      <div className="w-8 text-right text-gray-500">{n}</div>
    </div>
  );
}

export default async function ActivationPage() {
  const s = await casesRepo.getActivationSummary();
  const themes = Object.entries(s.byTheme);
  const maxTheme = Math.max(1, ...themes.map(([, n]) => n));
  const real = s.valueRealization;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Activation Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">Turning Indigenous legal wins into economic intelligence.</p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded border p-3"><div className="text-2xl font-semibold">{s.totalCases}</div><div className="text-xs text-gray-500">cases</div></div>
        <div className="rounded border p-3"><div className="text-2xl font-semibold">{(real.realized ?? 0)}</div><div className="text-xs text-gray-500">value realized</div></div>
        <div className="rounded border p-3"><div className="text-2xl font-semibold">{(real.negotiating ?? 0)}</div><div className="text-xs text-gray-500">negotiating</div></div>
      </div>

      <section className="mt-6">
        <h2 className="font-semibold">By theme</h2>
        <div className="mt-2 space-y-1">
          {themes.map(([t, n]) => <Bar key={t} label={t.replace(/_/g, " ")} n={n} max={maxTheme} />)}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">Value-realization funnel</h2>
        <div className="mt-2 flex gap-3 text-sm">
          {(["declared", "negotiating", "realized", "stalled"] as const).map((k) => (
            <div key={k} className="rounded border px-3 py-2">
              <div className="text-lg font-semibold">{real[k] ?? 0}</div><div className="text-xs text-gray-500">{k}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">Landmark cases <span className="text-xs font-normal text-gray-500">(by citation authority)</span></h2>
        <ul className="mt-1 text-sm">
          {s.landmarkCases.map((c) => (
            <li key={c.id}><Link href={`/cases/${c.id}`} className="hover:underline">{c.styleOfCause}</Link> <span className="text-gray-400">cited {c.citingCount}×</span></li>
          ))}
        </ul>
      </section>
    </main>
  );
}
