// Pure reduction of the network commitment list into a delivered digest.
// Reuses computeRisk verbatim — no risk logic lives here.
import { computeRisk, type Commitment } from "@/lib/commitments";
import type { DigestOrgGroup, OverdueDigest } from "./types";

// ISO-8601 week label, e.g. "2026-W30". Uses the Thursday of the week to derive
// the ISO week-year (which can differ from the calendar year at boundaries).
export function isoWeekOf(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // move to Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function buildOverdueDigest(items: Commitment[], now: Date): OverdueDigest {
  const year = now.getUTCFullYear();
  const { flags } = computeRisk(items, year);

  const byOrg = new Map<string, DigestOrgGroup>();
  for (const f of flags) {
    const name = f.commitment.orgName;
    let g = byOrg.get(name);
    if (!g) {
      g = { orgName: name, overdue: 0, atRisk: 0, items: [] };
      byOrg.set(name, g);
    }
    if (f.kind === "overdue") g.overdue++;
    else g.atRisk++;
    g.items.push({
      title: f.commitment.title,
      targetYear: f.commitment.targetYear,
      kind: f.kind,
      reason: f.reason,
    });
  }

  const groups = [...byOrg.values()]
    .map((g) => ({
      ...g,
      // items: overdue before at_risk, then title
      items: g.items.sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === "overdue" ? -1 : 1)),
    }))
    .sort((a, b) => b.overdue - a.overdue || b.atRisk - a.atRisk || a.orgName.localeCompare(b.orgName));

  const overdue = groups.reduce((s, g) => s + g.overdue, 0);
  const atRisk = groups.reduce((s, g) => s + g.atRisk, 0);
  return {
    isoWeek: isoWeekOf(now),
    generatedAt: now.toISOString(),
    year,
    totals: { overdue, atRisk, orgs: groups.length },
    groups,
  };
}
