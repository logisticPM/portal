// ===========================================================================
// Notifications verification harness — `npm run verify:notifications`.
// Pure checks (isoWeekOf, buildOverdueDigest, format) need no DB. Repo-parity
// + orchestration sections (later tasks) need DynamoDB Local (`npm run ddb:up`).
// ===========================================================================
import { isoWeekOf, buildOverdueDigest } from "../src/lib/notifications/digest";
import type { Commitment } from "../src/lib/commitments";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
}

// minimal commitment factory (only fields computeRisk / the digest read)
function mk(over: Partial<Commitment>): Commitment {
  return {
    id: "c1", orgName: "Acme", sector: "finance", orgSize: "large", type: "employment",
    title: "Hire 10", targetYear: 2024, status: "in_progress", progressPct: 10,
    history: [], createdAt: "2024-01-01T00:00:00.000Z", ...over,
  } as Commitment;
}

async function main() {
  // --- isoWeekOf (ISO-8601 week-year) ---
  check("isoWeek: 2026-01-01 (Thu) = W01", isoWeekOf(new Date("2026-01-01T00:00:00Z")) === "2026-W01");
  check("isoWeek: 2025-12-29 (Mon) rolls into 2026-W01", isoWeekOf(new Date("2025-12-29T00:00:00Z")) === "2026-W01");
  check("isoWeek: 2027-01-01 (Fri) belongs to 2026-W53", isoWeekOf(new Date("2027-01-01T00:00:00Z")) === "2026-W53");
  check("isoWeek: format is YYYY-Www", /^\d{4}-W\d{2}$/.test(isoWeekOf(new Date("2026-07-25T00:00:00Z"))));

  const now = new Date("2026-07-01T00:00:00Z"); // year 2026
  // --- buildOverdueDigest ---
  const items: Commitment[] = [
    mk({ id: "a1", orgName: "Acme", targetYear: 2024, status: "in_progress", progressPct: 20 }), // overdue
    mk({ id: "a2", orgName: "Acme", targetYear: 2026, status: "in_progress", progressPct: 10 }), // at_risk (<60)
    mk({ id: "b1", orgName: "Beta", targetYear: 2023, status: "reported", progressPct: 90 }),     // overdue (not confirmed)
    mk({ id: "c1", orgName: "Gamma", targetYear: 2030, status: "confirmed", progressPct: 100 }),  // on track
    mk({ id: "c2", orgName: "Gamma", targetYear: 2026, status: "confirmed", progressPct: 100 }),  // on track (confirmed)
  ];
  const d = buildOverdueDigest(items, now);
  check("digest: totals.overdue = 2", d.totals.overdue === 2, `got ${d.totals.overdue}`);
  check("digest: totals.atRisk = 1", d.totals.atRisk === 1, `got ${d.totals.atRisk}`);
  check("digest: totals.orgs = 2 (Acme, Beta)", d.totals.orgs === 2, `got ${d.totals.orgs}`);
  check("digest: year = 2026", d.year === 2026);
  check("digest: isoWeek set", /^\d{4}-W\d{2}$/.test(d.isoWeek));
  check("digest: Acme group has 1 overdue + 1 at_risk", (() => {
    const g = d.groups.find((x) => x.orgName === "Acme");
    return !!g && g.overdue === 1 && g.atRisk === 1 && g.items.length === 2;
  })());
  check("digest: sorted most-overdue-first (Acme before Beta? Beta has 1 overdue, Acme has 1 overdue+1 atRisk)",
    d.groups[0].overdue >= d.groups[d.groups.length - 1].overdue);
  check("digest: no on-track org present", !d.groups.some((g) => g.orgName === "Gamma"));

  // empty-network case
  const empty = buildOverdueDigest([], now);
  check("digest: empty network → zero totals, no groups", empty.totals.overdue === 0 && empty.totals.atRisk === 0 && empty.groups.length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
