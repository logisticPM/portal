"use client";
// Themed overview charts for /rap — KPIs, commitments-by-sector, by-type and
// progress-status. Uses the SAME color-blind-safe palette (and the same
// domain-ordered color scheme) as /rap/explore, so the two pages match and a
// category keeps its color across both. Data is computed server-side and passed in.
import { categoryColor, PaletteSelect, useRapTheme } from "@/lib/rap/use-rap-theme";
import type { ProgressStatus } from "@/lib/rap/types";

type Bar = { key: string; label: string; value: number };
type Props = {
  kpis: { raps: number; orgs: number; commitments: number; sectors: number; onTrackPct: number };
  bySector: Bar[];
  byType: Bar[];
  byStatus: { key: ProgressStatus; label: string; value: number }[];
};

export function RapCharts({ kpis, bySector, byType, byStatus }: Props) {
  const { theme, themeKey, setTheme } = useRapTheme();
  const sectorDomain = [...bySector.map((b) => b.key)].sort();
  const typeDomain = [...byType.map((b) => b.key)].sort();
  const maxSector = Math.max(1, ...bySector.map((b) => b.value));
  const maxType = Math.max(1, ...byType.map((b) => b.value));

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <PaletteSelect themeKey={themeKey} setTheme={setTheme} theme={theme} />
      </div>

      <div className="grid sm:grid-cols-4 gap-4">
        <Kpi big={String(kpis.raps)} sub={`RAPs from ${kpis.orgs} organizations`} accent={theme.accentHex} />
        <Kpi big={String(kpis.commitments)} sub="commitments tracked" accent={theme.accentHex} />
        <Kpi big={String(kpis.sectors)} sub="sectors covered" accent={theme.accentHex} />
        <Kpi big={`${kpis.onTrackPct}%`} sub="on track or met" accent={theme.accentHex} />
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <Section title="Commitments by sector">
          {bySector.map((b) => (
            <ColorBar key={b.key} label={b.label} value={b.value} max={maxSector}
              color={categoryColor(theme, sectorDomain, b.key)} />
          ))}
        </Section>

        <Section title="Commitments by type">
          {[...byType].sort((a, b) => b.value - a.value).map((b) => (
            <ColorBar key={b.key} label={b.label} value={b.value} max={maxType}
              color={categoryColor(theme, typeDomain, b.key)} />
          ))}
        </Section>
      </div>

      <Section title="Progress status">
        <div className="flex flex-wrap gap-4">
          {byStatus.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-sm">
              <span className="inline-block w-3 h-3 rounded" style={{ background: theme.status[s.key] }} />
              {s.label} · <span className="text-ink3">{s.value}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Kpi({ big, sub, accent }: { big: string; sub: string; accent: string }) {
  return (
    <div className="bg-panel rounded border border-line shadow-card p-5">
      <div className="font-serif text-4xl" style={{ color: accent }}>{big}</div>
      <div className="text-ink3 text-sm">{sub}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-ink3 text-xs uppercase tracking-widest mb-3">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ColorBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="text-ink3">{value}</span>
      </div>
      <div className="h-3 bg-ink/10 rounded overflow-hidden">
        <div className="h-full rounded" style={{ width: `${Math.round((value / max) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}
