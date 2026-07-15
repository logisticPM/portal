// Per-organization rollups for the institute "Organizations" view (leaderboard +
// scorecard). Pure functions over Commitment[]; the repo contract is unchanged —
// pages fetch all commitments and roll them up here. Orgs are keyed by a slug of
// orgName (stable + URL-safe; orgName is always present, orgId is optional).
import type { Commitment } from "./types";
import { computeRisk } from "./insights";
import { resolveOrgEvidence, evidenceDeps, type EvidenceRow, type EvidenceDeps } from "@/lib/index-evidence";

export interface OrgRollup {
  key: string; // URL slug
  orgName: string;
  orgId?: string;
  sectors: string[]; // distinct, sorted
  total: number;
  avgProgress: number;
  confirmedPct: number;
  overdueCount: number;
  atRiskCount: number;
}

// confirmedPct over the confirmable (procurement) commitments only — the honest
// denominator (§6). Numerator = those whose evidence tier resolved to "confirmed".
export function orgConfirmedPct(evidence: EvidenceRow[], confirmableIds: Set<string>): number {
  const denom = evidence.filter((e) => confirmableIds.has(e.commitmentId) && e.ranks).length;
  if (denom === 0) return 0;
  const num = evidence.filter((e) => confirmableIds.has(e.commitmentId) && e.tier === "confirmed").length;
  return Math.round((num / denom) * 100);
}

export function slugifyOrg(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function rollupOne(orgName: string, items: Commitment[], currentYear: number): OrgRollup {
  const total = items.length;
  const avgProgress = total
    ? Math.round(items.reduce((s, c) => s + c.progressPct, 0) / total)
    : 0;
  const confirmed = items.filter((c) => c.status === "confirmed").length;
  const risk = computeRisk(items, currentYear);
  return {
    key: slugifyOrg(orgName),
    orgName,
    orgId: items.find((c) => c.orgId)?.orgId,
    sectors: Array.from(new Set(items.map((c) => c.sector))).sort(),
    total,
    avgProgress,
    confirmedPct: total ? Math.round((confirmed / total) * 100) : 0,
    overdueCount: risk.overdueCount,
    atRiskCount: risk.atRiskCount,
  };
}

// Leaderboard: one row per org, best average progress first.
export function rollupOrgs(items: Commitment[], currentYear: number): OrgRollup[] {
  const byOrg = new Map<string, Commitment[]>();
  for (const c of items) {
    const arr = byOrg.get(c.orgName) ?? [];
    arr.push(c);
    byOrg.set(c.orgName, arr);
  }
  return Array.from(byOrg.entries())
    .map(([name, list]) => rollupOne(name, list, currentYear))
    .sort(
      (a, b) =>
        b.avgProgress - a.avgProgress || b.total - a.total || a.orgName.localeCompare(b.orgName),
    );
}

// Same leaderboard as rollupOrgs, but confirmedPct is driven by the resolver's
// confirmed evidence tier (over the org's confirmable/procurement commitments)
// instead of raw commitment status. All other fields are computed over orgItems
// exactly as rollupOne does, so avgProgress / order are unchanged.
export async function rollupOrgsWithEvidence(
  items: Commitment[],
  currentYear: number,
  deps: EvidenceDeps = evidenceDeps,
): Promise<OrgRollup[]> {
  const byOrg = new Map<string, Commitment[]>();
  for (const c of items) {
    const arr = byOrg.get(c.orgName) ?? [];
    arr.push(c);
    byOrg.set(c.orgName, arr);
  }
  const out: OrgRollup[] = [];
  for (const [name, orgItems] of byOrg.entries()) {
    const rollup = rollupOne(name, orgItems, currentYear);
    const ev = await resolveOrgEvidence(orgItems, deps);
    const confirmableIds = new Set(orgItems.filter((c) => c.type === "procurement").map((c) => c.id));
    out.push({ ...rollup, confirmedPct: orgConfirmedPct(ev, confirmableIds) });
  }
  return out.sort(
    (a, b) =>
      b.avgProgress - a.avgProgress || b.total - a.total || a.orgName.localeCompare(b.orgName),
  );
}

// One org's scorecard: its rollup + its commitments (newest target first).
export function orgScorecard(
  items: Commitment[],
  key: string,
  currentYear: number,
): { org: OrgRollup; commitments: Commitment[] } | null {
  const list = items
    .filter((c) => slugifyOrg(c.orgName) === key)
    .sort((a, b) => b.targetYear - a.targetYear || a.id.localeCompare(b.id));
  if (!list.length) return null;
  return { org: rollupOne(list[0].orgName, list, currentYear), commitments: list };
}
