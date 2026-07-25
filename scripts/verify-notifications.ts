// ===========================================================================
// Notifications verification harness — `npm run verify:notifications`.
// Pure checks (isoWeekOf, buildOverdueDigest, format) need no DB. Repo-parity
// + orchestration sections (later tasks) need DynamoDB Local (`npm run ddb:up`).
// ===========================================================================
import { isoWeekOf, buildOverdueDigest } from "../src/lib/notifications/digest";
import { renderDigestEmail } from "../src/lib/notifications/format";
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

  // --- renderDigestEmail ---
  const mail = renderDigestEmail(d);
  check("format: subject has counts", /2 overdue/.test(mail.subject) && /1 at-risk/.test(mail.subject));
  check("format: subject has org count", /2 organization/.test(mail.subject));
  check("format: subject has iso week", mail.subject.includes(d.isoWeek));
  check("format: html mentions Acme + Beta", mail.html.includes("Acme") && mail.html.includes("Beta"));
  check("format: text mentions a milestone title", mail.text.includes("Hire 10"));
  check("format: text is non-empty and has no undefined", mail.text.length > 0 && !/undefined/.test(mail.text));
  const emptyMail = renderDigestEmail(empty);
  check("format: empty digest → on-track subject", /on track/i.test(emptyMail.subject));

  // --- sort-order tiebreak pinning (isolated fixtures so the checks above stay undisturbed) ---

  // (1) group atRisk tiebreak: equal overdue, different atRisk — higher-atRisk group sorts first.
  // A buggy `a.atRisk - b.atRisk` (ascending) comparator would put TieB before TieA here.
  const atRiskTiebreakItems: Commitment[] = [
    mk({ id: "ta1", orgName: "TieA", targetYear: 2024, status: "in_progress", progressPct: 50 }), // overdue
    mk({ id: "ta2", orgName: "TieA", targetYear: 2026, status: "in_progress", progressPct: 10 }), // at_risk
    mk({ id: "ta3", orgName: "TieA", targetYear: 2026, status: "in_progress", progressPct: 20 }), // at_risk
    mk({ id: "tb1", orgName: "TieB", targetYear: 2023, status: "reported", progressPct: 80 }),    // overdue
    mk({ id: "tb2", orgName: "TieB", targetYear: 2026, status: "in_progress", progressPct: 15 }),  // at_risk
  ];
  const dAtRiskTie = buildOverdueDigest(atRiskTiebreakItems, now);
  {
    const tieA = dAtRiskTie.groups.find((g) => g.orgName === "TieA");
    const tieB = dAtRiskTie.groups.find((g) => g.orgName === "TieB");
    check(
      "tiebreak setup: TieA overdue=1/atRisk=2, TieB overdue=1/atRisk=1",
      !!tieA && !!tieB && tieA.overdue === 1 && tieA.atRisk === 2 && tieB.overdue === 1 && tieB.atRisk === 1,
      `TieA=${JSON.stringify(tieA)} TieB=${JSON.stringify(tieB)}`,
    );
    const idxA = dAtRiskTie.groups.findIndex((g) => g.orgName === "TieA");
    const idxB = dAtRiskTie.groups.findIndex((g) => g.orgName === "TieB");
    check(
      "digest: group atRisk tiebreak — equal overdue, higher atRisk (TieA) sorts before lower (TieB)",
      idxA >= 0 && idxB >= 0 && idxA < idxB,
      `order=${dAtRiskTie.groups.map((g) => g.orgName).join(",")}`,
    );
  }

  // (2) group orgName tiebreak: equal overdue AND atRisk — ascending orgName wins.
  const orgNameTiebreakItems: Commitment[] = [
    mk({ id: "z1", orgName: "Zulu", targetYear: 2024, status: "in_progress", progressPct: 50 }), // overdue
    mk({ id: "z2", orgName: "Zulu", targetYear: 2026, status: "in_progress", progressPct: 10 }), // at_risk
    mk({ id: "y1", orgName: "Alpha", targetYear: 2023, status: "reported", progressPct: 70 }),   // overdue
    mk({ id: "y2", orgName: "Alpha", targetYear: 2026, status: "in_progress", progressPct: 5 }), // at_risk
  ];
  const dOrgNameTie = buildOverdueDigest(orgNameTiebreakItems, now);
  {
    const alpha = dOrgNameTie.groups.find((g) => g.orgName === "Alpha");
    const zulu = dOrgNameTie.groups.find((g) => g.orgName === "Zulu");
    check(
      "tiebreak setup: Alpha and Zulu both overdue=1/atRisk=1",
      !!alpha && !!zulu && alpha.overdue === 1 && alpha.atRisk === 1 && zulu.overdue === 1 && zulu.atRisk === 1,
      `alpha=${JSON.stringify(alpha)} zulu=${JSON.stringify(zulu)}`,
    );
    check(
      "digest: group orgName tiebreak — equal overdue+atRisk sorts ascending by orgName (Alpha before Zulu)",
      dOrgNameTie.groups.length === 2 && dOrgNameTie.groups[0].orgName === "Alpha" && dOrgNameTie.groups[1].orgName === "Zulu",
      `order=${dOrgNameTie.groups.map((g) => g.orgName).join(",")}`,
    );
  }

  // (3) item title tiebreak within a group: same-kind items must sort by title; overdue must
  // still precede at_risk when an org has both. Titles are deliberately out of alphabetical
  // order in the input to prove the sort — not insertion order — determines output order.
  const itemTitleTiebreakItems: Commitment[] = [
    mk({ id: "g1", orgName: "Gizmo", title: "Zebra Training", targetYear: 2024, status: "in_progress", progressPct: 30 }),   // overdue
    mk({ id: "g2", orgName: "Gizmo", title: "Apple Program", targetYear: 2023, status: "in_progress", progressPct: 40 }),    // overdue
    mk({ id: "g3", orgName: "Gizmo", title: "Mango Initiative", targetYear: 2026, status: "in_progress", progressPct: 10 }), // at_risk
  ];
  const dItemTitleTie = buildOverdueDigest(itemTitleTiebreakItems, now);
  {
    const gizmo = dItemTitleTie.groups.find((g) => g.orgName === "Gizmo");
    check(
      "tiebreak setup: Gizmo has 2 overdue + 1 at_risk",
      !!gizmo && gizmo.overdue === 2 && gizmo.atRisk === 1 && gizmo.items.length === 3,
      `gizmo=${JSON.stringify(gizmo)}`,
    );
    check(
      "digest: item title tiebreak — same-kind items sort by title (Apple before Zebra), overdue precedes at_risk",
      !!gizmo &&
        gizmo.items[0].kind === "overdue" && gizmo.items[0].title === "Apple Program" &&
        gizmo.items[1].kind === "overdue" && gizmo.items[1].title === "Zebra Training" &&
        gizmo.items[2].kind === "at_risk" && gizmo.items[2].title === "Mango Initiative",
      `order=${gizmo?.items.map((i) => `${i.kind}:${i.title}`).join(", ")}`,
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
