// PURE query logic over Commitment[] — shared by repo.mock and repo.dynamo so the
// two impls are identical by construction (the verify.ts golden test).
import type {
  Commitment,
  CommitmentFilter,
  CommitmentStatus,
  CommitmentSummary,
  GroupStat,
  PeriodStat,
} from "./types";

export const STATUSES: CommitmentStatus[] = [
  "committed",
  "in_progress",
  "reported",
  "confirmed",
  "stalled",
];

export function filterCommitments(items: Commitment[], f?: CommitmentFilter): Commitment[] {
  return items.filter(
    (c) =>
      (!f?.sector || c.sector === f.sector) &&
      (!f?.orgSize || c.orgSize === f.orgSize) &&
      (!f?.type || c.type === f.type) &&
      (!f?.status || c.status === f.status) &&
      (!f?.orgId || c.orgId === f.orgId),
  );
}

// Sort object keys for deterministic JSON.stringify across mock and dynamo
// (scan order is not guaranteed; key insertion order would vary otherwise).
function sortKeys<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) as T;
}

// sector → type → count, both levels key-sorted for deterministic JSON.
function buildMatrix(items: Commitment[]): Record<string, Record<string, number>> {
  const acc: Record<string, Record<string, number>> = {};
  for (const c of items) {
    const row = (acc[c.sector] ??= {});
    row[c.type] = (row[c.type] ?? 0) + 1;
  }
  const out: Record<string, Record<string, number>> = {};
  for (const [s, row] of Object.entries(acc)) out[s] = sortKeys(row);
  return sortKeys(out);
}

function group(items: Commitment[], key: (c: Commitment) => string): Record<string, GroupStat> {
  const acc: Record<string, { count: number; sum: number }> = {};
  for (const c of items) {
    const k = key(c);
    const g = (acc[k] ??= { count: 0, sum: 0 });
    g.count += 1;
    g.sum += c.progressPct;
  }
  const out: Record<string, GroupStat> = {};
  for (const [k, g] of Object.entries(acc)) {
    out[k] = { count: g.count, avgProgress: Math.round(g.sum / g.count) };
  }
  return sortKeys(out);
}

export function buildSummary(items: Commitment[]): CommitmentSummary {
  const total = items.length;
  const orgCount = new Set(items.map((c) => c.orgName)).size;
  const avgProgress = total
    ? Math.round(items.reduce((s, c) => s + c.progressPct, 0) / total)
    : 0;
  const confirmed = items.filter((c) => c.status === "confirmed").length;
  const confirmedPct = total ? Math.round((confirmed / total) * 100) : 0;

  // progress over time — every distinct period across all histories
  const periods = Array.from(new Set(items.flatMap((c) => c.history.map((h) => h.period)))).sort();
  const overTime: PeriodStat[] = periods.map((period) => {
    const points = items.flatMap((c) => c.history.filter((h) => h.period === period));
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
      CommitmentStatus,
      number
    >;
    let sum = 0;
    for (const p of points) {
      byStatus[p.status] += 1;
      sum += p.progressPct;
    }
    return { period, byStatus, avgProgress: points.length ? Math.round(sum / points.length) : 0 };
  });

  return {
    total,
    orgCount,
    avgProgress,
    confirmedPct,
    bySector: group(items, (c) => c.sector),
    bySize: group(items, (c) => c.orgSize),
    byType: group(items, (c) => c.type),
    byRapType: group(
      items.filter((c) => !!c.rapType),
      (c) => c.rapType as string,
    ),
    matrix: buildMatrix(items),
    overTime,
  };
}
