// ===========================================================================
// Exploratory analytics — the Option-A read model (see docs/rap-dashboard-
// architecture.md). Pure, dependency-free, client-safe functions.
//
// The idea: the server materializes the whole corpus into ONE flat "fact table"
// (buildFacts) and ships it to the browser; every pivot / drill-down / graph
// below runs in-memory on that array — no per-interaction backend query. At RAP
// data scale (hundreds–thousands of rows) the entire analytical surface fits in
// memory, so exploration is instant and needs no OLAP backend. In production the
// hand-rolled aggregation here would be swapped for Arquero / DuckDB-Wasm; the
// data-flow (one dataset → client-side slicing) is the point.
// ===========================================================================
import type {
  ClaimBasis, Commitment, CommitmentRollup, CommitmentType, Jurisdiction,
  Pillar, ProgressStatus, RapDocument, RapOrganization, Sector, SizeBand,
} from "./types";

// A target magnitude is unit-typed so we never sum apples (dollars) and oranges
// (percentages / head-counts). Derived from targetText since targetValue is raw.
export type TargetUnit = "currency" | "percent" | "count" | "none";

// One denormalized row per commitment — the atom of exploration.
export interface Fact {
  commitId: string;
  action: string;
  deliverable: string;
  orgId: string;
  orgName: string;
  sector: Sector;
  sizeBand: SizeBand;
  region: string;
  jurisdiction: Jurisdiction;
  rapId: string;
  rapTitle: string;
  pillar: Pillar;
  commitmentType: CommitmentType;
  claimBasis: ClaimBasis;
  status: ProgressStatus;
  percentComplete: number;
  targetText: string | null;
  targetValue: number | null;
  targetUnit: TargetUnit;
  dueDate: string | null;
  confidence: number;
}

// Any categorical column can be a grouping/relationship dimension.
export type Dimension =
  | "sector" | "orgName" | "commitmentType" | "pillar"
  | "claimBasis" | "status" | "sizeBand" | "region" | "jurisdiction";

// What we aggregate.
export type Measure = "count" | "currency" | "avgProgress";

export const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: "sector", label: "Sector" },
  { key: "orgName", label: "Organization" },
  { key: "commitmentType", label: "Commitment type" },
  { key: "pillar", label: "Pillar" },
  { key: "claimBasis", label: "Claim basis" },
  { key: "status", label: "Progress status" },
  { key: "sizeBand", label: "Org size" },
  { key: "region", label: "Region" },
  { key: "jurisdiction", label: "Jurisdiction" },
];

export const MEASURES: { key: Measure; label: string; fmt: (n: number) => string }[] = [
  { key: "count", label: "Commitments", fmt: (n) => `${n}` },
  { key: "currency", label: "$ committed", fmt: fmtMoney },
  { key: "avgProgress", label: "Avg progress", fmt: (n) => `${Math.round(n)}%` },
];

// --- unit classification ---------------------------------------------------
// targetValue is a raw magnitude (100_000_000 could be $ or a head-count); the
// unit lives in the human targetText. Keep this the single source of truth so
// currency sums stay honest.
export function classifyUnit(targetText: string | null): TargetUnit {
  if (!targetText) return "none";
  if (/\$|dollar|CAD|USD/i.test(targetText)) return "currency";
  if (/%|percent/i.test(targetText)) return "percent";
  return "count";
}

// --- fact table ------------------------------------------------------------
export function buildFacts(
  commitments: Commitment[],
  orgById: Map<string, RapOrganization>,
  rapById: Map<string, RapDocument>,
  rollupById: Map<string, CommitmentRollup>,
): Fact[] {
  return commitments.map((c) => {
    const org = orgById.get(c.orgId);
    const rap = rapById.get(c.rapId);
    const roll = rollupById.get(c.id);
    return {
      commitId: c.id,
      action: c.action,
      deliverable: c.deliverable,
      orgId: c.orgId,
      orgName: org?.name ?? c.orgId,
      sector: c.sector,
      sizeBand: org?.sizeBand ?? "unknown",
      region: org?.region ?? "—",
      jurisdiction: rap?.jurisdiction ?? "other",
      rapId: c.rapId,
      rapTitle: rap?.title ?? c.rapId,
      pillar: c.pillar,
      commitmentType: c.commitmentType,
      claimBasis: c.provenance.claimBasis,
      status: roll?.latestStatus ?? "not_started",
      percentComplete: roll?.percentComplete ?? 0,
      targetText: c.targetText,
      targetValue: c.targetValue,
      targetUnit: classifyUnit(c.targetText),
      dueDate: c.dueDate,
      confidence: c.provenance.extractionConfidence,
    };
  });
}

// --- generic aggregation ---------------------------------------------------
export function factValue(f: Fact, measure: Measure): number {
  if (measure === "currency") return f.targetUnit === "currency" ? f.targetValue ?? 0 : 0;
  if (measure === "avgProgress") return f.percentComplete;
  return 1; // count
}

export function dimValue(f: Fact, dim: Dimension): string {
  return String(f[dim]);
}

export interface Group {
  key: string;
  value: number; // measure total (or mean for avgProgress)
  count: number; // # facts
  share: number; // fraction of grand total (0..1), by the same measure
}

export function aggregate(facts: Fact[], dim: Dimension, measure: Measure): Group[] {
  const buckets = new Map<string, Fact[]>();
  for (const f of facts) {
    const k = dimValue(f, dim);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(f);
  }
  const rows = [...buckets.entries()].map(([key, fs]) => ({
    key,
    value: reduceMeasure(fs, measure),
    count: fs.length,
  }));
  const grand = measure === "avgProgress"
    ? reduceMeasure(facts, "avgProgress")
    : rows.reduce((s, r) => s + r.value, 0);
  return rows
    .map((r) => ({ ...r, share: grand > 0 && measure !== "avgProgress" ? r.value / grand : 0 }))
    .filter((r) => r.value > 0 || measure === "avgProgress")
    .sort((a, b) => b.value - a.value);
}

export function reduceMeasure(facts: Fact[], measure: Measure): number {
  if (facts.length === 0) return 0;
  if (measure === "avgProgress") {
    return facts.reduce((s, f) => s + f.percentComplete, 0) / facts.length;
  }
  return facts.reduce((s, f) => s + factValue(f, measure), 0);
}

// --- cross-tab (any dim × any dim) -----------------------------------------
export interface CrossTab {
  rows: string[];
  cols: string[];
  cells: number[][]; // [rowIdx][colIdx]
  max: number;
  rowTotals: number[];
  colTotals: number[];
  total: number;
}

export function crosstab(facts: Fact[], rowDim: Dimension, colDim: Dimension, measure: Measure): CrossTab {
  const rowKeys = orderedKeys(facts, rowDim, measure);
  const colKeys = orderedKeys(facts, colDim, measure);
  const rowIdx = new Map(rowKeys.map((k, i) => [k, i]));
  const colIdx = new Map(colKeys.map((k, i) => [k, i]));
  const cells = rowKeys.map(() => colKeys.map(() => 0));
  const counts = rowKeys.map(() => colKeys.map(() => 0));
  for (const f of facts) {
    const r = rowIdx.get(dimValue(f, rowDim));
    const c = colIdx.get(dimValue(f, colDim));
    if (r == null || c == null) continue;
    cells[r][c] += factValue(f, measure);
    counts[r][c] += 1;
  }
  // avgProgress: turn sums into means per cell
  if (measure === "avgProgress") {
    for (let r = 0; r < cells.length; r++)
      for (let c = 0; c < cells[r].length; c++)
        cells[r][c] = counts[r][c] ? cells[r][c] / counts[r][c] : 0;
  }
  const rowTotals = cells.map((row) => row.reduce((s, v) => s + v, 0));
  const colTotals = colKeys.map((_, c) => cells.reduce((s, row) => s + row[c], 0));
  const total = rowTotals.reduce((s, v) => s + v, 0);
  const max = Math.max(0, ...cells.flat());
  return { rows: rowKeys, cols: colKeys, cells, max, rowTotals, colTotals, total };
}

function orderedKeys(facts: Fact[], dim: Dimension, measure: Measure): string[] {
  return aggregate(facts, dim, measure).map((g) => g.key);
}

// --- mosaic / treemap layout ------------------------------------------------
// Two categoricals + a measure in one figure: columns (primary) whose WIDTH is
// the primary share, subdivided into rows (secondary) whose HEIGHT is the share
// within that column. Pure geometry → SVG rects. Robust (no slivers-from-
// randomness); doubles as part-to-whole AND relationship-between-two-dims.
export interface MosaicCell {
  primary: string;
  secondary: string;
  value: number;
  x: number; y: number; w: number; h: number;
}

export function mosaic(
  facts: Fact[], primaryDim: Dimension, secondaryDim: Dimension, measure: Measure,
  width: number, height: number, gap = 2,
): MosaicCell[] {
  const cols = aggregate(facts, primaryDim, measure); // sorted desc, share set
  const grand = cols.reduce((s, c) => s + c.value, 0);
  if (grand <= 0) return [];
  const out: MosaicCell[] = [];
  let x = 0;
  for (const col of cols) {
    const w = (col.value / grand) * width;
    const sub = aggregate(facts.filter((f) => dimValue(f, primaryDim) === col.key), secondaryDim, measure);
    const colTotal = sub.reduce((s, c) => s + c.value, 0);
    let y = 0;
    for (const cell of sub) {
      const h = colTotal > 0 ? (cell.value / colTotal) * height : 0;
      out.push({
        primary: col.key, secondary: cell.key, value: cell.value,
        x: x + gap / 2, y: y + gap / 2, w: Math.max(0, w - gap), h: Math.max(0, h - gap),
      });
      y += h;
    }
    x += w;
  }
  return out;
}

// --- bipartite relationship graph ------------------------------------------
// Two dimensions as node columns (e.g. orgName ↔ pillar); an edge wherever a
// fact links a left value to a right value, weighted by the measure. Deterministic
// layout (nodes evenly spaced on two vertical rails) — no physics, SSR-safe.
export interface GraphNode { id: string; label: string; side: "left" | "right"; x: number; y: number; weight: number; }
export interface GraphEdge { source: string; target: string; weight: number; }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; maxEdge: number; maxNode: number; }

export function bipartiteGraph(
  facts: Fact[], leftDim: Dimension, rightDim: Dimension, measure: Measure,
  width: number, height: number, railInset = 160, vpad = 28,
): Graph {
  const leftKeys = orderedKeys(facts, leftDim, measure);
  const rightKeys = orderedKeys(facts, rightDim, measure);
  const edgeMap = new Map<string, number>();
  const leftW = new Map<string, number>();
  const rightW = new Map<string, number>();
  for (const f of facts) {
    const l = dimValue(f, leftDim), r = dimValue(f, rightDim);
    const v = factValue(f, measure) || 1;
    edgeMap.set(`${l} ${r}`, (edgeMap.get(`${l} ${r}`) ?? 0) + v);
    leftW.set(l, (leftW.get(l) ?? 0) + v);
    rightW.set(r, (rightW.get(r) ?? 0) + v);
  }
  const place = (keys: string[], side: "left" | "right", wmap: Map<string, number>): GraphNode[] => {
    const x = side === "left" ? railInset : width - railInset;
    const step = keys.length > 1 ? (height - 2 * vpad) / (keys.length - 1) : 0;
    return keys.map((k, i) => ({
      id: `${side}:${k}`, label: k, side, x,
      y: keys.length > 1 ? vpad + i * step : height / 2, weight: wmap.get(k) ?? 0,
    }));
  };
  const nodes = [...place(leftKeys, "left", leftW), ...place(rightKeys, "right", rightW)];
  const edges: GraphEdge[] = [...edgeMap.entries()].map(([k, weight]) => {
    const [l, r] = k.split(" ");
    return { source: `left:${l}`, target: `right:${r}`, weight };
  });
  return {
    nodes, edges,
    maxEdge: Math.max(1, ...edges.map((e) => e.weight)),
    maxNode: Math.max(1, ...nodes.map((n) => n.weight)),
  };
}

// --- formatting helpers -----------------------------------------------------
export function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n % 1_000_000_000 ? 1 : 0)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

export function measureFmt(measure: Measure): (n: number) => string {
  return MEASURES.find((m) => m.key === measure)!.fmt;
}
