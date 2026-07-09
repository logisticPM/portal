"use client";
// Client-side exploration surface (Option A). Receives ONE fact array and does
// every aggregation in-memory — pick any dimension/measure, click anything to
// drill down. Zero charting deps: hand-rolled SVG + CSS. Colors come from a
// color-blind-safe theme (see lib/rap/palette.ts) the user can switch live.
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  aggregate, crosstab, DIMENSIONS, dimValue, factValue, fmtMoney, measureFmt,
  MEASURES, reduceMeasure,
} from "@/lib/rap/analytics";
import type { Dimension, Fact, Measure } from "@/lib/rap/analytics";
import { labelFor } from "@/lib/taxonomy";
import { textOn } from "@/lib/rap/palette";
import type { Theme } from "@/lib/rap/palette";
import { PaletteSelect, useRapTheme } from "@/lib/rap/use-rap-theme";
import type { TreeNode } from "./TreemapChart";
import type { BarDatum } from "./BarChart";
import type { HeatSerie } from "./HeatmapChart";
import type { NetNode, NetLink } from "./NetworkChart";

// nivo pulls in d3; load each chart client-only (ssr:false) so it's code-split
// and never runs during SSR.
const chartLoading = () => (
  <div style={{ height: 560 }} className="flex items-center justify-center text-ink3 text-sm">Loading chart…</div>
);
const TreemapChart = dynamic(() => import("./TreemapChart"), { ssr: false, loading: chartLoading });
const BarChart = dynamic(() => import("./BarChart"), { ssr: false, loading: chartLoading });
const HeatmapChart = dynamic(() => import("./HeatmapChart"), { ssr: false, loading: chartLoading });
const NetworkChart = dynamic(() => import("./NetworkChart"), { ssr: false, loading: chartLoading });

// Assign colors by each category's position in its dimension's FULL domain (not
// a hash) → every visible category gets a DISTINCT palette color, and it stays
// put as you drill/filter. Built once from the unfiltered facts.
function buildColorIndex(facts: Fact[]): Map<Dimension, Map<string, number>> {
  const maps = new Map<Dimension, Map<string, number>>();
  for (const d of DIMENSIONS) {
    const keys = [...new Set(facts.map((f) => dimValue(f, d.key)))].sort();
    maps.set(d.key, new Map(keys.map((k, i) => [k, i])));
  }
  return maps;
}

type Filter = { dim: Dimension; key: string };
type View = "contribution" | "treemap" | "crosstab" | "graph";
const VIEWS: { key: View; label: string }[] = [
  { key: "contribution", label: "Contribution" },
  { key: "treemap", label: "Treemap" },
  { key: "crosstab", label: "Cross-tab" },
  { key: "graph", label: "Relationships" },
];

export function ExploreClient({ facts }: { facts: Fact[] }) {
  const [primary, setPrimary] = useState<Dimension>("sector");
  const [secondary, setSecondary] = useState<Dimension>("commitmentType");
  const [measure, setMeasure] = useState<Measure>("count");
  const [view, setView] = useState<View>("treemap");
  const [filters, setFilters] = useState<Filter[]>([]);
  const { theme, themeKey, setTheme } = useRapTheme();

  const colorIndex = useMemo(() => buildColorIndex(facts), [facts]);
  const color = (dim: Dimension, key: string): string => {
    if (dim === "status") return theme.status[key as keyof typeof theme.status] ?? theme.categorical[0];
    return theme.categorical[(colorIndex.get(dim)?.get(key) ?? 0) % theme.categorical.length];
  };

  const filtered = useMemo(
    () => facts.filter((f) => filters.every((fl) => dimValue(f, fl.dim) === fl.key)),
    [facts, filters],
  );

  // Hide dimensions that are a single constant across the data (e.g. pillar/
  // region/jurisdiction/claimBasis for the commitments source) — grouping by
  // them yields one meaningless tile. Data-driven so it self-adjusts per source.
  const activeDimensions = useMemo(
    () => DIMENSIONS.filter(
      (d) => new Set(facts.map((f) => dimValue(f, d.key))).size >= 2,
    ),
    [facts],
  );

  const addFilter = (dim: Dimension, key: string) =>
    setFilters((cur) => (cur.some((f) => f.dim === dim && f.key === key) ? cur : [...cur, { dim, key }]));
  const removeFilter = (i: number) => setFilters((cur) => cur.filter((_, j) => j !== i));

  const fmt = measureFmt(measure);
  const kpis = useMemo(() => ({
    commitments: filtered.length,
    dollars: reduceMeasure(filtered, "currency"),
    orgs: new Set(filtered.map((f) => f.orgName)).size,
    progress: reduceMeasure(filtered, "avgProgress"),
  }), [filtered]);

  const vp: ViewProps = { facts: filtered, measure, fmt, onPick: addFilter, theme, color };

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid sm:grid-cols-4 gap-4">
        <Kpi big={String(kpis.commitments)} sub="commitments" accent={theme.accentHex} />
        <Kpi big={fmtMoney(kpis.dollars)} sub="$ committed (currency targets)" accent={theme.accentHex} />
        <Kpi big={String(kpis.orgs)} sub="organizations" accent={theme.accentHex} />
        <Kpi big={`${Math.round(kpis.progress)}%`} sub="avg progress" accent={theme.accentHex} />
      </div>

      {/* controls */}
      <div className="bg-panel rounded border border-line p-4 flex flex-wrap items-end gap-4">
        <Select label="Group by" value={primary} onChange={(v) => setPrimary(v as Dimension)}
          options={activeDimensions.map((d) => ({ value: d.key, label: d.label }))} />
        <Select label={view === "contribution" ? "Then (unused)" : "Against"} value={secondary}
          onChange={(v) => setSecondary(v as Dimension)} disabled={view === "contribution"}
          options={activeDimensions.map((d) => ({ value: d.key, label: d.label }))} />
        <Select label="Measure" value={measure} onChange={(v) => setMeasure(v as Measure)}
          options={MEASURES.map((m) => ({ value: m.key, label: m.label }))} />
        <PaletteSelect themeKey={themeKey} setTheme={setTheme} theme={theme} />
        <div className="ml-auto flex gap-1">
          {VIEWS.map((v) => (
            <button key={v.key} onClick={() => setView(v.key)}
              className="text-sm px-3 py-2 rounded border"
              style={view === v.key
                ? { background: theme.accentHex, borderColor: theme.accentHex, color: textOn(theme.accentHex) }
                : { borderColor: "#E0D5C0" }}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* drill-down breadcrumb */}
      {filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink3">Filtered:</span>
          {filters.map((f, i) => (
            <button key={`${f.dim}:${f.key}`} onClick={() => removeFilter(i)}
              className="px-2 py-1 rounded-full border hover:opacity-80"
              style={{ borderColor: theme.accentHex, color: theme.accentHex }}>
              {DIMENSIONS.find((d) => d.key === f.dim)?.label}: {labelFor(f.dim, f.key)} ✕
            </button>
          ))}
          <button onClick={() => setFilters([])} className="text-ink3 underline">clear all</button>
        </div>
      )}

      {/* the active view */}
      <div className="bg-panel rounded border border-line p-4">
        {filtered.length === 0 ? (
          <div className="text-ink3 text-sm py-12 text-center">No commitments match the current filters.</div>
        ) : view === "contribution" ? (
          <Contribution {...vp} dim={primary} />
        ) : view === "treemap" ? (
          <Treemap {...vp} primary={primary} secondary={secondary} />
        ) : view === "crosstab" ? (
          <CrossTabView {...vp} rowDim={primary} colDim={secondary} />
        ) : (
          <GraphView {...vp} leftDim={primary} rightDim={secondary} />
        )}
      </div>
    </div>
  );
}

// ---- Contribution / part-to-whole -----------------------------------------
function Contribution({ facts, dim, measure, fmt, onPick, color }: ViewProps & { dim: Dimension }) {
  const data: BarDatum[] = aggregate(facts, dim, measure).map((g) => ({
    id: labelFor(dim, g.key), value: g.value, color: color(dim, g.key), key: g.key, share: g.share,
  }));
  return (
    <div>
      <Caption>{`${measureLabel(measure)} by ${dimLabel(dim)} — bar length = value, hover for share of total`}</Caption>
      <BarChart data={data} fmt={fmt} onPick={(k) => onPick(dim, k)} />
    </div>
  );
}

// ---- Treemap / mosaic (primary width × secondary height) ------------------
function Treemap({ facts, primary, secondary, measure, onPick, color }: ViewProps & { primary: Dimension; secondary: Dimension }) {
  // Build the 2-level hierarchy nivo wants: primary (org) groups → secondary
  // (type) leaves. Aggregation stays ours; nivo only lays it out + renders.
  const cols = aggregate(facts, primary, measure);
  const data: TreeNode = {
    id: "root",
    name: "", // blank so nivo doesn't render a "root" parent label
    children: cols.map((col) => {
      const pLabel = labelFor(primary, col.key);
      const sub = aggregate(facts.filter((f) => dimValue(f, primary) === col.key), secondary, measure);
      return {
        id: col.key,
        name: pLabel,
        pkey: col.key,
        children: sub.map((s) => ({
          id: `${col.key}::${s.key}`,
          name: labelFor(secondary, s.key),
          tkey: s.key,
          ppkey: col.key,   // parent (primary) key, for parent+leaf drill
          pname: pLabel,
          value: s.value,
        })),
      };
    }),
  };
  return (
    <div>
      <Caption>{`${measureLabel(measure)}: tile area = ${measureLabel(measure).toLowerCase()} · grouped by ${dimLabel(primary)}, colored by ${dimLabel(secondary)}. Hover for detail, click to drill in.`}</Caption>
      <TreemapChart data={data} colorOf={(k) => color(secondary, k)}
        onDrill={(level, key, parentKey) => {
          if (level === "primary") { onPick(primary, key); return; }
          if (parentKey) onPick(primary, parentKey);   // the sector this leaf sits in
          onPick(secondary, key);                        // the type
        }} />
      <Legend dim={secondary} facts={facts} measure={measure} onPick={onPick} color={color} />
    </div>
  );
}

// ---- Cross-tab heatmap -----------------------------------------------------
function CrossTabView({ facts, rowDim, colDim, measure, fmt, onPick }: ViewProps & { rowDim: Dimension; colDim: Dimension }) {
  const ct = crosstab(facts, rowDim, colDim, measure);
  const series: HeatSerie[] = ct.rows.map((rk, ri) => ({
    id: labelFor(rowDim, rk),
    data: ct.cols.map((ck, ci) => ({
      x: labelFor(colDim, ck),
      y: ct.cells[ri][ci] > 0 ? ct.cells[ri][ci] : null,
      rowKey: rk,
      colKey: ck,
    })),
  }));
  return (
    <div>
      <Caption>{`${measureLabel(measure)}: ${dimLabel(rowDim)} (rows) × ${dimLabel(colDim)} (columns). Darker = higher. Click a cell to drill in.`}</Caption>
      <HeatmapChart series={series} max={ct.max} fmt={fmt}
        onDrill={(rk, ck) => { onPick(rowDim, rk); onPick(colDim, ck); }} />
    </div>
  );
}

// ---- Relationship graph (bipartite) ---------------------------------------
function GraphView({ facts, leftDim, rightDim, measure, fmt, onPick, theme, color }: ViewProps & { leftDim: Dimension; rightDim: Dimension }) {
  const nodes: NetNode[] = [
    ...aggregate(facts, leftDim, measure).map((g) => ({
      id: `L:${g.key}`, label: labelFor(leftDim, g.key), dim: leftDim, nkey: g.key, color: color(leftDim, g.key), weight: g.value,
    })),
    ...aggregate(facts, rightDim, measure).map((g) => ({
      id: `R:${g.key}`, label: labelFor(rightDim, g.key), dim: rightDim, nkey: g.key, color: color(rightDim, g.key), weight: g.value,
    })),
  ];
  const w = (f: Fact) => (measure === "avgProgress" ? 1 : factValue(f, measure));
  const linkMap = new Map<string, number>();
  for (const f of facts) {
    const k = `${dimValue(f, leftDim)}|${dimValue(f, rightDim)}`;
    linkMap.set(k, (linkMap.get(k) ?? 0) + w(f));
  }
  const links: NetLink[] = [...linkMap.entries()].filter(([, v]) => v > 0).map(([k, weight]) => {
    const [l, r] = k.split("|");
    return { source: `L:${l}`, target: `R:${r}`, weight };
  });
  const maxNode = Math.max(1, ...nodes.map((n) => n.weight));
  const maxEdge = Math.max(1, ...links.map((l) => l.weight));
  return (
    <div>
      <Caption>{`Relationships: ${dimLabel(leftDim)} ↔ ${dimLabel(rightDim)} — node size = ${measureLabel(measure).toLowerCase()}, link thickness = co-occurrence. Click a node to filter.`}</Caption>
      <NetworkChart nodes={nodes} links={links} maxNode={maxNode} maxEdge={maxEdge}
        accent={theme.accentHex} fmt={fmt} onPick={(d, key) => onPick(d as Dimension, key)} />
    </div>
  );
}

// ---- shared bits -----------------------------------------------------------
type ViewProps = {
  facts: Fact[];
  measure: Measure;
  fmt: (n: number) => string;
  onPick: (dim: Dimension, key: string) => void;
  theme: Theme;
  color: (dim: Dimension, key: string) => string;
};

function Legend({ dim, facts, measure, onPick, color }: { dim: Dimension; facts: Fact[]; measure: Measure; onPick: (d: Dimension, k: string) => void; color: (d: Dimension, k: string) => string }) {
  const groups = aggregate(facts, dim, measure);
  return (
    <div className="flex flex-wrap gap-3 mt-3 text-xs">
      {groups.map((g) => (
        <button key={g.key} onClick={() => onPick(dim, g.key)} className="flex items-center gap-1.5 hover:underline">
          <span className="inline-block w-3 h-3 rounded" style={{ background: color(dim, g.key) }} />
          {labelFor(dim, g.key)}
        </button>
      ))}
    </div>
  );
}

function Kpi({ big, sub, accent }: { big: string; sub: string; accent: string }) {
  return (
    <div className="bg-panel rounded border border-line shadow-card p-5">
      <div className="font-serif text-3xl" style={{ color: accent }}>{big}</div>
      <div className="text-ink3 text-sm">{sub}</div>
    </div>
  );
}

function Select({ label, value, onChange, options, disabled = false }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean;
}) {
  return (
    <label className={`text-sm ${disabled ? "opacity-50" : ""}`}>
      <div className="text-ink3 text-xs uppercase tracking-widest mb-1">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
        className="px-3 py-2 rounded border border-line bg-bg disabled:cursor-not-allowed">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return <div className="text-ink3 text-xs mb-3">{children}</div>;
}

function dimLabel(dim: Dimension): string {
  return DIMENSIONS.find((d) => d.key === dim)?.label ?? dim;
}
function measureLabel(measure: Measure): string {
  return MEASURES.find((m) => m.key === measure)?.label ?? measure;
}
