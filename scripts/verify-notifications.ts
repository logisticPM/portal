// ===========================================================================
// Notifications verification harness — `npm run verify:notifications`.
// Pure checks (isoWeekOf, buildOverdueDigest, format) need no DB. Repo-parity
// + orchestration sections (later tasks) need DynamoDB Local (`npm run ddb:up`).
// ===========================================================================
import { isoWeekOf, buildOverdueDigest } from "../src/lib/notifications/digest";
import { renderDigestEmail } from "../src/lib/notifications/format";
import type { Commitment } from "../src/lib/commitments";
import type { OverdueDigest } from "../src/lib/notifications/types";
import { mockNotificationsRepo, _resetMockNotifications } from "../src/lib/notifications/repo.mock";
import { dynamoNotificationsRepo } from "../src/lib/notifications/repo.dynamo";
import { NOTIFICATIONS_TABLE } from "../src/lib/notifications/notifications-table";
import { createSingleTable } from "../src/lib/dynamo/create";

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

async function resetNotificationsTable() {
  const { ddbDoc } = await import("../src/lib/dynamo/client");
  const { ScanCommand, BatchWriteCommand } = await import("@aws-sdk/lib-dynamodb");
  const r = await ddbDoc.send(new ScanCommand({ TableName: NOTIFICATIONS_TABLE, ProjectionExpression: "PK, SK" }));
  const keys = (r.Items ?? []) as { PK: string; SK: string }[];
  for (let i = 0; i < keys.length; i += 25) {
    await ddbDoc.send(new BatchWriteCommand({ RequestItems: { [NOTIFICATIONS_TABLE]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) } }));
  }
}

// Connection-failure heuristic: only these should downgrade to a SKIP. Any
// other exception (a real bug in createSingleTable, a TypeError from bad
// array access, etc.) must fail loudly instead of hiding behind the skip.
function isDbUnreachable(e: unknown): boolean {
  const msg = String(e instanceof Error ? `${e.name} ${e.message}` : e).toLowerCase();
  return (
    msg.includes("econnrefused") ||
    msg.includes("connection refused") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed") ||
    msg.includes("networkingerror") ||
    msg.includes("timeouterror") ||
    msg.includes("enotfound")
  );
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
  check("format: subject has org count", /\b2 organizations\b/.test(mail.subject));
  check("format: subject has iso week", mail.subject.includes(d.isoWeek));
  check("format: html mentions Acme + Beta", mail.html.includes("Acme") && mail.html.includes("Beta"));
  check("format: text mentions a milestone title", mail.text.includes("Hire 10"));
  check("format: text is non-empty and has no undefined", mail.text.length > 0 && !/undefined/.test(mail.text));
  const emptyMail = renderDigestEmail(empty);
  check("format: empty digest → on-track subject", /on track/i.test(emptyMail.subject));

  // --- renderDigestEmail: HTML-escaping regression (org name + title carry HTML metacharacters) ---
  // Supplier-entered orgName/title land in an emailed HTML digest — this pins that escapeHtml()
  // is actually called on both, not just implemented-but-unused. Deleting the escapeHtml(...)
  // wrapper, or dropping a call site, must turn these checks red.
  const escFixture: OverdueDigest = {
    isoWeek: "2026-W30",
    generatedAt: "2026-07-25T00:00:00.000Z",
    year: 2026,
    totals: { overdue: 1, atRisk: 0, orgs: 1 },
    groups: [
      {
        orgName: "A&B <Corp>",
        overdue: 1,
        atRisk: 0,
        items: [{ title: `"Hire" <10> & more`, targetYear: 2024, kind: "overdue", reason: "Target 2024 passed" }],
      },
    ],
  };
  const escMail = renderDigestEmail(escFixture);
  check("format: html escapes org name metacharacters", escMail.html.includes("A&amp;B &lt;Corp&gt;"));
  check("format: html escapes title metacharacters (incl. quotes)", escMail.html.includes(`&quot;Hire&quot; &lt;10&gt; &amp; more`));
  check("format: html has no raw org metacharacters", !escMail.html.includes("<Corp>"));
  check("format: html has no raw title metacharacters", !escMail.html.includes("<10>"));
  check("format: text preserves raw (unescaped) org name", escMail.text.includes("A&B <Corp>"));
  check("format: text preserves raw (unescaped) title", escMail.text.includes(`"Hire" <10> & more`));

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

  // --- repo parity (needs DynamoDB Local: npm run ddb:up) ---
  try {
    await createSingleTable(NOTIFICATIONS_TABLE);
    await resetNotificationsTable();
    _resetMockNotifications();

    const recA = { ...buildOverdueDigest(items, new Date("2026-07-20T00:00:00Z")), recipient: "a@b.co", emailStatus: "sent" as const };
    const recB = { ...buildOverdueDigest(items, new Date("2026-07-27T00:00:00Z")), recipient: "a@b.co", emailStatus: "skipped" as const };
    const recC = { ...buildOverdueDigest(items, new Date("2026-07-13T00:00:00Z")), recipient: "a@b.co", emailStatus: "sent" as const };

    for (const rec of [recA, recB, recC]) {
      await mockNotificationsRepo.put(rec);
      await dynamoNotificationsRepo.put(rec);
    }

    const mLatest = await mockNotificationsRepo.latest(5);
    const dLatest = await dynamoNotificationsRepo.latest(5);
    check("repo: latest parity (mock ≡ dynamo)", JSON.stringify(mLatest) === JSON.stringify(dLatest), `${mLatest.length} vs ${dLatest.length}`);
    check("repo: latest is newest-first", mLatest[0].isoWeek > mLatest[1].isoWeek && mLatest[1].isoWeek > mLatest[2].isoWeek);

    // bound/truncation: 3 distinct weeks are stored, latest(2) must return exactly
    // the 2 newest — not just "however many happen to fit" — for both mock and dynamo.
    const mLatest2 = await mockNotificationsRepo.latest(2);
    const dLatest2 = await dynamoNotificationsRepo.latest(2);
    const expectedTop2 = [recB.isoWeek, recA.isoWeek]; // newest-first: B (07-27) then A (07-20); C (07-13) excluded
    check(
      "repo: latest(2) truncates to exactly 2, newest-first (mock)",
      mLatest2.length === 2 && mLatest2.map((r) => r.isoWeek).join(",") === expectedTop2.join(","),
      `got ${mLatest2.map((r) => r.isoWeek).join(",")}`,
    );
    check(
      "repo: latest(2) truncates to exactly 2, newest-first (dynamo)",
      dLatest2.length === 2 && dLatest2.map((r) => r.isoWeek).join(",") === expectedTop2.join(","),
      `got ${dLatest2.map((r) => r.isoWeek).join(",")}`,
    );
    check("repo: latest(2) parity (mock ≡ dynamo)", JSON.stringify(mLatest2) === JSON.stringify(dLatest2));

    const mWk = await mockNotificationsRepo.getByWeek(recA.isoWeek);
    const dWk = await dynamoNotificationsRepo.getByWeek(recA.isoWeek);
    check("repo: getByWeek parity", JSON.stringify(mWk) === JSON.stringify(dWk));

    // idempotency: re-put same week overwrites, not appends
    await dynamoNotificationsRepo.put({ ...recA, emailStatus: "failed", emailError: "boom" });
    const after = await dynamoNotificationsRepo.latest(5);
    check("repo: idempotent per week (no dup)", after.length === 3);
    check("repo: re-put updated in place", after.find((x) => x.isoWeek === recA.isoWeek)?.emailStatus === "failed");
  } catch (e) {
    if (isDbUnreachable(e)) {
      check("repo parity SKIPPED (DynamoDB Local down?)", true, String(e instanceof Error ? e.message : e));
    } else {
      // A genuine bug (bad key, TypeError, undefined-var typo, etc.) must NOT be
      // relabeled as a skip — fail loudly so it can't hide behind the try/catch.
      check("repo parity: unexpected error", false, String(e instanceof Error ? `${e.name}: ${e.message}` : e));
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
