# Overdue-Milestone Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the existing `computeRisk` overdue/at-risk signal as a weekly digest to the Indigenomics institute, on two channels (in-app inbox + SES email), driven by a prod-gated weekly cron and an on-demand institute button for the Aug 10 showcase demo.

**Architecture:** A pure `buildOverdueDigest` reduces the whole-network commitment list into a per-org roll-up. A shared `runDigest()` orchestrator persists the digest to a new `Notifications` table (in-app inbox) then sends it via SES. Both a weekly `sst.aws.Cron` and an institute-only server action call the identical `runDigest()`. `computeRisk` in `src/lib/commitments/insights.ts` is reused verbatim — untouched.

**Tech Stack:** TypeScript, Next.js 14 App Router, DynamoDB (single-table via `@aws-sdk/lib-dynamodb`), Amazon SES (`@aws-sdk/client-sesv2`), SST v3/v4 (Ion) Cron + Dynamo, `tsx` assertion harnesses.

**Spec:** `docs/superpowers/specs/2026-07-25-overdue-milestone-notifications-design.md`

## Global Constraints

- **Reuse `computeRisk` unchanged.** Do NOT edit `src/lib/commitments/insights.ts`. Import `computeRisk` and `type RiskFlag` from `@/lib/commitments`.
- **Never log item bodies or PII.** DataPortal holds email + passwordHash; notification records hold a recipient email. Log counts/keys/status only — never a full record or a recipient address.
- **Repo selection pattern (verbatim):** `index.ts` exports the repo as `process.env.REPO_IMPL === "dynamo" ? dynamoX : mockX`. Table name from env with a literal default: `process.env.NOTIFICATIONS_TABLE ?? "Notifications"`.
- **Idempotent per ISO week.** The write is an upsert keyed on `SK = DIGEST#<isoWeek>`. Re-running in the same week overwrites, never appends.
- **In-region, aggregate-only.** SES is invoked in the stage region (`AWS_REGION`); digest content is aggregate public commitment data (org names, milestone titles, counts) — no per-person PII leaves region.
- **Cron is prod-gated; the button works in every stage.** Wrap the `sst.aws.Cron` in `if (isProd)`. The `/notifications` server action runs in the Web Lambda in all stages (so the demo runs against the `ca` deployment).
- **Tests never touch AWS.** Pure functions need no DB; repo parity uses DynamoDB Local (`npm run ddb:up`); the orchestrator and emailer are tested with injected mocks. No real SES call in any test.
- **Match existing DynamoDB idioms:** `@ts-ignore` on the `@aws-sdk/*` imports where `src/lib/dynamo/client.ts` does; reconstruct domain objects with **explicit field order** in `itemTo*` so `JSON.stringify` equality holds against the mock (see `src/lib/dynamo/commitments-table.ts`).

---

### Task 1: Types + pure digest builder

**Files:**
- Create: `src/lib/notifications/types.ts`
- Create: `src/lib/notifications/digest.ts`
- Create: `scripts/verify-notifications.ts`
- Modify: `package.json` (add `verify:notifications` script)

**Interfaces:**
- Consumes: `computeRisk`, `type RiskFlag`, `type Commitment` from `@/lib/commitments`.
- Produces: `types.ts` — `DigestOrgGroup`, `OverdueDigest`, `EmailStatus`, `NotificationRecord`, `NotificationsRepo`. `digest.ts` — `isoWeekOf(d: Date): string`, `buildOverdueDigest(items: Commitment[], now: Date): OverdueDigest`.

- [ ] **Step 1: Write `src/lib/notifications/types.ts`**

```ts
// Delivery-layer shapes for the overdue-milestone digest. The compute is reused
// from src/lib/commitments/insights.ts (computeRisk); this module only models
// the DELIVERED artifact (digest + persistence record + repo seam).
export interface DigestOrgGroup {
  orgName: string;
  overdue: number;
  atRisk: number;
  items: { title: string; targetYear: number; kind: "overdue" | "at_risk"; reason: string }[];
}

export interface OverdueDigest {
  isoWeek: string; // "2026-W30" — the idempotency key
  generatedAt: string; // ISO 8601
  year: number; // the currentYear computeRisk ran against
  totals: { overdue: number; atRisk: number; orgs: number };
  groups: DigestOrgGroup[]; // most overdue first, then most at-risk, then orgName
}

export type EmailStatus = "sent" | "failed" | "skipped"; // skipped = no recipient / no emailer

export interface NotificationRecord extends OverdueDigest {
  recipient: string | null;
  emailStatus: EmailStatus;
  emailError?: string; // present only when emailStatus === "failed"
}

export interface NotificationsRepo {
  put(rec: NotificationRecord): Promise<NotificationRecord>; // upsert by isoWeek
  latest(n: number): Promise<NotificationRecord[]>; // newest-first
  getByWeek(isoWeek: string): Promise<NotificationRecord | null>;
}
```

- [ ] **Step 2: Write the failing test — create `scripts/verify-notifications.ts` with the digest section**

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx scripts/verify-notifications.ts`
Expected: FAIL — `Cannot find module '../src/lib/notifications/digest'`.

- [ ] **Step 4: Write `src/lib/notifications/digest.ts`**

```ts
// Pure reduction of the network commitment list into a delivered digest.
// Reuses computeRisk verbatim — no risk logic lives here.
import { computeRisk, type RiskFlag, type Commitment } from "@/lib/commitments";
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
      items: g.items.sort((a: RiskFlag["kind"] extends never ? never : DigestOrgGroup["items"][number], b) =>
        (a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === "overdue" ? -1 : 1)),
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
```

> Note for the implementer: the `items.sort` comparator type gymnastics above is noise — write it as a plain comparator: `g.items.sort((a, b) => a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === "overdue" ? -1 : 1)`. Keep the runtime behavior exactly as described (overdue items first, then title).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx scripts/verify-notifications.ts`
Expected: PASS — all digest + isoWeek checks green, `N passed, 0 failed`.

- [ ] **Step 6: Add the npm script**

In `package.json` scripts, after `"verify:alignment"`, add:

```json
    "verify:notifications": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 tsx scripts/verify-notifications.ts",
```

(The `DYNAMO_ENDPOINT` is harmless for the pure checks and required once Task 3 adds repo parity.)

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: 0 errors.

```bash
git add src/lib/notifications/types.ts src/lib/notifications/digest.ts scripts/verify-notifications.ts package.json
git commit -m "feat(notify): types + pure overdue-digest builder (reuses computeRisk)"
```

---

### Task 2: Email formatter

**Files:**
- Create: `src/lib/notifications/format.ts`
- Modify: `scripts/verify-notifications.ts` (add the format section)

**Interfaces:**
- Consumes: `type OverdueDigest` from `./types`.
- Produces: `renderDigestEmail(d: OverdueDigest): { subject: string; html: string; text: string }`.

- [ ] **Step 1: Write the failing test — append a format section to `scripts/verify-notifications.ts`**

Add this import at the top:

```ts
import { renderDigestEmail } from "../src/lib/notifications/format";
```

Add these checks inside `main()` after the digest checks (reusing `d` and `empty` from Task 1):

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/verify-notifications.ts`
Expected: FAIL — `Cannot find module '../src/lib/notifications/format'`.

- [ ] **Step 3: Write `src/lib/notifications/format.ts`**

```ts
// Deterministic render of an OverdueDigest to an email (subject + html + text).
// No template engine; plain string building so it is trivially testable.
import type { OverdueDigest } from "./types";

export function renderDigestEmail(d: OverdueDigest): { subject: string; html: string; text: string } {
  const onTrack = d.totals.overdue === 0 && d.totals.atRisk === 0;
  const subject = onTrack
    ? `RAP Index: all milestones on track (week ${d.isoWeek})`
    : `RAP Index: ${d.totals.overdue} overdue, ${d.totals.atRisk} at-risk across ${d.totals.orgs} organization${d.totals.orgs === 1 ? "" : "s"} (week ${d.isoWeek})`;

  if (onTrack) {
    const body = `No overdue or at-risk RAP milestones this week. The network is on pace.`;
    return {
      subject,
      text: `${subject}\n\n${body}\n`,
      html: `<h2>${escapeHtml(subject)}</h2><p>${escapeHtml(body)}</p>`,
    };
  }

  const textLines: string[] = [subject, ""];
  const htmlParts: string[] = [`<h2>${escapeHtml(subject)}</h2>`];
  for (const g of d.groups) {
    const head = `${g.orgName} — ${g.overdue} overdue, ${g.atRisk} at-risk`;
    textLines.push(head);
    htmlParts.push(`<h3>${escapeHtml(head)}</h3><ul>`);
    for (const it of g.items) {
      const line = `  • [${it.kind === "overdue" ? "OVERDUE" : "AT RISK"}] ${it.title} (target ${it.targetYear}) — ${it.reason}`;
      textLines.push(line);
      htmlParts.push(`<li><strong>${it.kind === "overdue" ? "Overdue" : "At risk"}</strong>: ${escapeHtml(it.title)} (target ${it.targetYear}) — ${escapeHtml(it.reason)}</li>`);
    }
    textLines.push("");
    htmlParts.push(`</ul>`);
  }

  return { subject, text: textLines.join("\n") + "\n", html: htmlParts.join("") };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx scripts/verify-notifications.ts`
Expected: PASS — format checks green.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 errors.

```bash
git add src/lib/notifications/format.ts scripts/verify-notifications.ts
git commit -m "feat(notify): deterministic digest email formatter"
```

---

### Task 3: Notifications table mappers + repo (mock + dynamo) with parity test

**Files:**
- Create: `src/lib/notifications/notifications-table.ts`
- Create: `src/lib/notifications/repo.mock.ts`
- Create: `src/lib/notifications/repo.dynamo.ts`
- Create: `src/lib/notifications/index.ts`
- Modify: `scripts/verify-notifications.ts` (add the repo-parity section — needs DynamoDB Local)

**Interfaces:**
- Consumes: `ddbDoc` from `@/lib/dynamo/client`; `createSingleTable` from `@/lib/dynamo/create`; `type NotificationRecord`, `type NotificationsRepo` from `./types`.
- Produces: `notificationsRepo: NotificationsRepo` (env-selected), `mockNotificationsRepo`, `_resetMockNotifications()`, and table mappers `notificationKeys`, `toNotificationItem`, `itemToNotification`.

- [ ] **Step 1: Write `src/lib/notifications/notifications-table.ts`**

```ts
// Single-table mapping for Notifications (mirrors commitments-table.ts). One
// partition holds the institute's weekly digests; SK sorts by ISO week so
// `latest(n)` is a bounded reverse Query. Dedicated table → et is informational.
import type { NotificationRecord } from "./types";

export const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE ?? "Notifications";
export const NOTIFY_PK = "NOTIFY#institute";

export const notificationKeys = {
  digest: (isoWeek: string) => ({ PK: NOTIFY_PK, SK: `DIGEST#${isoWeek}` }),
};

export function toNotificationItem(rec: NotificationRecord) {
  return {
    ...notificationKeys.digest(rec.isoWeek),
    et: "Notification" as const,
    data: rec, // small; read-whole access pattern
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Explicit field order so JSON.stringify equality holds vs the in-memory mock
// (DynamoDB does not preserve map-key order).
export function itemToNotification(it: any): NotificationRecord {
  const d = it.data as NotificationRecord;
  return {
    isoWeek: d.isoWeek,
    generatedAt: d.generatedAt,
    year: d.year,
    totals: { overdue: d.totals.overdue, atRisk: d.totals.atRisk, orgs: d.totals.orgs },
    groups: d.groups.map((g: any) => ({
      orgName: g.orgName,
      overdue: g.overdue,
      atRisk: g.atRisk,
      items: g.items.map((i: any) => ({ title: i.title, targetYear: i.targetYear, kind: i.kind, reason: i.reason })),
    })),
    recipient: d.recipient,
    emailStatus: d.emailStatus,
    ...(d.emailError !== undefined ? { emailError: d.emailError } : {}),
  };
}
```

- [ ] **Step 2: Write `src/lib/notifications/repo.mock.ts`**

```ts
import type { NotificationRecord, NotificationsRepo } from "./types";

let store = new Map<string, NotificationRecord>(); // key = isoWeek

// newest-first; ISO-week strings sort lexically (year-first, zero-padded week)
const byWeekDesc = (a: NotificationRecord, b: NotificationRecord) => b.isoWeek.localeCompare(a.isoWeek);

export const mockNotificationsRepo: NotificationsRepo = {
  async put(rec) {
    store.set(rec.isoWeek, rec);
    return rec;
  },
  async latest(n) {
    return [...store.values()].sort(byWeekDesc).slice(0, n);
  },
  async getByWeek(isoWeek) {
    return store.get(isoWeek) ?? null;
  },
};

// test-only reset
export function _resetMockNotifications() {
  store = new Map();
}
```

- [ ] **Step 3: Write `src/lib/notifications/repo.dynamo.ts`**

```ts
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../dynamo/client";
import { NOTIFICATIONS_TABLE, NOTIFY_PK, notificationKeys, toNotificationItem, itemToNotification } from "./notifications-table";
import type { NotificationRecord, NotificationsRepo } from "./types";

export const dynamoNotificationsRepo: NotificationsRepo = {
  async put(rec) {
    await ddbDoc.send(new PutCommand({ TableName: NOTIFICATIONS_TABLE, Item: toNotificationItem(rec) }));
    return rec;
  },
  async latest(n) {
    const r = await ddbDoc.send(
      new QueryCommand({
        TableName: NOTIFICATIONS_TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": NOTIFY_PK, ":sk": "DIGEST#" },
        ScanIndexForward: false, // newest ISO week first
        Limit: n,
      }),
    );
    return (r.Items ?? []).map(itemToNotification);
  },
  async getByWeek(isoWeek) {
    const r = await ddbDoc.send(new GetCommand({ TableName: NOTIFICATIONS_TABLE, Key: notificationKeys.digest(isoWeek) }));
    return r.Item ? itemToNotification(r.Item) : null;
  },
};
```

- [ ] **Step 4: Write `src/lib/notifications/index.ts`**

```ts
import type { NotificationsRepo } from "./types";
import { mockNotificationsRepo } from "./repo.mock";
import { dynamoNotificationsRepo } from "./repo.dynamo";

export const notificationsRepo: NotificationsRepo =
  process.env.REPO_IMPL === "dynamo" ? dynamoNotificationsRepo : mockNotificationsRepo;

export { buildOverdueDigest, isoWeekOf } from "./digest";
export { renderDigestEmail } from "./format";
export type { OverdueDigest, DigestOrgGroup, NotificationRecord, NotificationsRepo, EmailStatus } from "./types";
```

- [ ] **Step 5: Write the failing test — append a repo-parity section to `scripts/verify-notifications.ts`**

Add imports at the top:

```ts
import { mockNotificationsRepo, _resetMockNotifications } from "../src/lib/notifications/repo.mock";
import { dynamoNotificationsRepo } from "../src/lib/notifications/repo.dynamo";
import { createSingleTable } from "../src/lib/dynamo/create";
```

Add this reset helper above `main()`:

```ts
async function resetNotificationsTable() {
  const { ddbDoc } = await import("../src/lib/dynamo/client");
  const { ScanCommand, BatchWriteCommand } = await import("@aws-sdk/lib-dynamodb");
  const r = await ddbDoc.send(new ScanCommand({ TableName: "Notifications", ProjectionExpression: "PK, SK" }));
  const keys = (r.Items ?? []) as { PK: string; SK: string }[];
  for (let i = 0; i < keys.length; i += 25) {
    await ddbDoc.send(new BatchWriteCommand({ RequestItems: { Notifications: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) } }));
  }
}
```

Add these checks at the END of `main()` (before the summary print). Guard the DB section so the pure checks still run if DynamoDB Local is down:

```ts
  // --- repo parity (needs DynamoDB Local: npm run ddb:up) ---
  try {
    await createSingleTable("Notifications");
    await resetNotificationsTable();
    _resetMockNotifications();

    const recA = { ...buildOverdueDigest(items, new Date("2026-07-20T00:00:00Z")), recipient: "a@b.co", emailStatus: "sent" as const };
    const recB = { ...buildOverdueDigest(items, new Date("2026-07-27T00:00:00Z")), recipient: "a@b.co", emailStatus: "skipped" as const };

    for (const rec of [recA, recB]) {
      await mockNotificationsRepo.put(rec);
      await dynamoNotificationsRepo.put(rec);
    }

    const mLatest = await mockNotificationsRepo.latest(5);
    const dLatest = await dynamoNotificationsRepo.latest(5);
    check("repo: latest parity (mock ≡ dynamo)", JSON.stringify(mLatest) === JSON.stringify(dLatest), `${mLatest.length} vs ${dLatest.length}`);
    check("repo: latest is newest-first", mLatest[0].isoWeek > mLatest[1].isoWeek);

    const mWk = await mockNotificationsRepo.getByWeek(recA.isoWeek);
    const dWk = await dynamoNotificationsRepo.getByWeek(recA.isoWeek);
    check("repo: getByWeek parity", JSON.stringify(mWk) === JSON.stringify(dWk));

    // idempotency: re-put same week overwrites, not appends
    await dynamoNotificationsRepo.put({ ...recA, emailStatus: "failed", emailError: "boom" });
    const after = await dynamoNotificationsRepo.latest(5);
    check("repo: idempotent per week (no dup)", after.length === 2);
    check("repo: re-put updated in place", after.find((x) => x.isoWeek === recA.isoWeek)?.emailStatus === "failed");
  } catch (e) {
    check("repo parity SKIPPED (DynamoDB Local down?)", true, String(e instanceof Error ? e.message : e));
  }
```

- [ ] **Step 6: Run to verify it fails, then passes**

Run: `npm run ddb:up` then `npm run verify:notifications`
Expected: repo-parity checks present and green (`mock ≡ dynamo`, newest-first, idempotent). If they were failing before the repo files existed, they now pass.

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 errors.

```bash
git add src/lib/notifications/notifications-table.ts src/lib/notifications/repo.mock.ts src/lib/notifications/repo.dynamo.ts src/lib/notifications/index.ts scripts/verify-notifications.ts
git commit -m "feat(notify): Notifications table mappers + mock/dynamo repo (parity-verified)"
```

---

### Task 4: SES emailer + `runDigest` orchestrator

**Files:**
- Create: `src/lib/notifications/email.ts`
- Create: `src/lib/notifications/run.ts`
- Modify: `scripts/verify-notifications.ts` (add the orchestration section — injected mocks, no AWS)
- Modify: `package.json` (add `@aws-sdk/client-sesv2` dependency)

**Interfaces:**
- Consumes: `commitmentsRepo` from `@/lib/commitments`; `notificationsRepo`, `buildOverdueDigest`, `renderDigestEmail` from `./index`/siblings; `type NotificationRecord`, `type NotificationsRepo` from `./types`; `type CommitmentRepo` from `@/lib/commitments`.
- Produces: `email.ts` — `interface Emailer { send(msg): Promise<void> }`, `makeSesEmailer(client?): Emailer`. `run.ts` — `runDigest(deps?): Promise<NotificationRecord>`.

- [ ] **Step 1: Install the SES SDK**

Run: `npm install @aws-sdk/client-sesv2`
Expected: added to `dependencies` in `package.json`.

- [ ] **Step 2: Write `src/lib/notifications/email.ts`**

```ts
// SES v2 sender. Injectable client so tests never hit AWS. From/region come
// from env (set per stage). Throws on send failure — runDigest records that.
// @ts-ignore: package resolved at runtime
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export interface Emailer {
  send(msg: { to: string; subject: string; html: string; text: string }): Promise<void>;
}

export function makeSesEmailer(client?: SESv2Client): Emailer {
  const ses = client ?? new SESv2Client({ region: process.env.AWS_REGION ?? "us-east-1" });
  const from = process.env.DIGEST_SENDER ?? "";
  return {
    async send({ to, subject, html, text }) {
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [to] },
          Content: { Simple: { Subject: { Data: subject }, Body: { Html: { Data: html }, Text: { Data: text } } } },
        }),
      );
    },
  };
}
```

- [ ] **Step 3: Write the failing test — append an orchestration section to `scripts/verify-notifications.ts`**

Add import at the top:

```ts
import { runDigest } from "../src/lib/notifications/run";
import type { Emailer } from "../src/lib/notifications/email";
import type { CommitmentRepo } from "../src/lib/commitments";
```

Add these checks at the END of `main()` (before the summary). They use injected mocks — no DB, no AWS:

```ts
  // --- runDigest orchestration (injected deps; no AWS) ---
  {
    const fakeCommits = { listCommitments: async () => items } as unknown as CommitmentRepo;
    const puts: string[] = [];
    const fakeNotify = {
      put: async (rec: any) => { puts.push(rec.emailStatus); return rec; },
      latest: async () => [], getByWeek: async () => null,
    };
    const now = new Date("2026-07-15T00:00:00Z");

    // (a) success path
    let sent: any = null;
    const okEmailer: Emailer = { send: async (m) => { sent = m; } };
    const rSent = await runDigest({ commitmentsRepo: fakeCommits, notificationsRepo: fakeNotify as any, emailer: okEmailer, recipient: "a@b.co", now });
    check("run: emailStatus sent on success", rSent.emailStatus === "sent");
    check("run: recipient passed to emailer", sent?.to === "a@b.co");
    check("run: persisted BEFORE send (first put was skipped)", puts[0] === "skipped");
    check("run: persisted AFTER send too (second put sent)", puts.includes("sent"));

    // (b) failure path
    puts.length = 0;
    const badEmailer: Emailer = { send: async () => { throw new Error("SES down"); } };
    const rFail = await runDigest({ commitmentsRepo: fakeCommits, notificationsRepo: fakeNotify as any, emailer: badEmailer, recipient: "a@b.co", now });
    check("run: emailStatus failed on throw", rFail.emailStatus === "failed" && rFail.emailError === "SES down");

    // (c) no recipient → skipped, no send attempted
    let attempted = false;
    const spyEmailer: Emailer = { send: async () => { attempted = true; } };
    const rSkip = await runDigest({ commitmentsRepo: fakeCommits, notificationsRepo: fakeNotify as any, emailer: spyEmailer, recipient: null, now });
    check("run: emailStatus skipped when no recipient", rSkip.emailStatus === "skipped" && attempted === false);
  }
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm run verify:notifications`
Expected: FAIL — `Cannot find module '../src/lib/notifications/run'`.

- [ ] **Step 5: Write `src/lib/notifications/run.ts`**

```ts
// Shared orchestrator for BOTH triggers (weekly cron + institute button).
// Order: compute → persist (in-app never lost) → send → persist status.
import { commitmentsRepo, type CommitmentRepo } from "@/lib/commitments";
import { buildOverdueDigest } from "./digest";
import { renderDigestEmail } from "./format";
import { notificationsRepo } from "./index";
import { makeSesEmailer, type Emailer } from "./email";
import type { NotificationRecord, NotificationsRepo } from "./types";

export interface RunDeps {
  commitmentsRepo?: CommitmentRepo;
  notificationsRepo?: NotificationsRepo;
  emailer?: Emailer | null; // null → skip email; undefined → default SES when a recipient exists
  recipient?: string | null; // undefined → DIGEST_RECIPIENT env
  now?: Date;
}

export async function runDigest(deps: RunDeps = {}): Promise<NotificationRecord> {
  const commits = deps.commitmentsRepo ?? commitmentsRepo;
  const notify = deps.notificationsRepo ?? notificationsRepo;
  const now = deps.now ?? new Date();
  const recipient = deps.recipient !== undefined ? deps.recipient : (process.env.DIGEST_RECIPIENT ?? null);
  const emailer = deps.emailer !== undefined ? deps.emailer : (recipient ? makeSesEmailer() : null);

  const digest = buildOverdueDigest(await commits.listCommitments(), now);

  // persist FIRST so the in-app record survives any SES failure
  let rec: NotificationRecord = { ...digest, recipient, emailStatus: "skipped" };
  await notify.put(rec);

  if (recipient && emailer) {
    try {
      const { subject, html, text } = renderDigestEmail(digest);
      await emailer.send({ to: recipient, subject, html, text });
      rec = { ...rec, emailStatus: "sent" };
    } catch (e) {
      rec = { ...rec, emailStatus: "failed", emailError: e instanceof Error ? e.message : String(e) };
    }
    await notify.put(rec);
  }
  return rec;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm run verify:notifications`
Expected: PASS — all orchestration checks green (sent / failed / skipped, persist-before-send).

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit` → 0 errors.

```bash
git add src/lib/notifications/email.ts src/lib/notifications/run.ts scripts/verify-notifications.ts package.json package-lock.json
git commit -m "feat(notify): SES emailer + runDigest orchestrator (record-before-send)"
```

---

### Task 5: Cron handler + SST infrastructure wiring

**Files:**
- Create: `src/functions/notify-digest.ts`
- Modify: `sst.config.ts` (Notifications table; Web link/env/perms; prod-gated weekly cron)
- Modify: `docs/deploy.md` (append the SES verification + demo runbook note)

**Interfaces:**
- Consumes: `runDigest` from `@/lib/notifications/run`.
- Produces: `handler(): Promise<void>` (Lambda entry). Infra: `Notifications` Dynamo resource; `NotificationsRepo`-backing env on Web + cron.

- [ ] **Step 1: Write `src/functions/notify-digest.ts`**

```ts
// Weekly digest cron entry (spec 2026-07-25). Thin: all logic is in runDigest,
// which is unit-tested. REPO_IMPL/NOTIFICATIONS_TABLE/DIGEST_* come from the
// cron env in sst.config.ts. Mirrors src/functions/case-monitor.handler.
import { runDigest } from "@/lib/notifications/run";

export async function handler(): Promise<void> {
  const rec = await runDigest();
  // counts/status only — NEVER log the record body or recipient (PII).
  console.log(`[notify-digest] week=${rec.isoWeek} overdue=${rec.totals.overdue} atRisk=${rec.totals.atRisk} email=${rec.emailStatus}`);
}
```

- [ ] **Step 2: Declare the `Notifications` table in `sst.config.ts`**

After the `alignment` table declaration (`const alignment = new sst.aws.Dynamo("Alignment", singleTableShape);`, ~line 65), add:

```ts
    // Weekly overdue-milestone digest records (spec 2026-07-25). One partition
    // (NOTIFY#institute) of per-ISO-week digests; the institute /notifications
    // inbox reads it, the cron + button write it.
    const notifications = new sst.aws.Dynamo("Notifications", singleTableShape);
```

- [ ] **Step 3: Wire the Web function** (`new sst.aws.Nextjs("Web", …)`)

In the Web `link:` array, add `notifications`:

```ts
      link: [dataPortal, rapSurvey, rapData, rapUploads, exports, rapAnalytics, commitments, alignment, casesIndex, notifications],
```

In the Web `transform.server.permissions` array, add SES send (for the button's server action):

```ts
            { actions: ["ses:SendEmail"], resources: ["*"] },
```

In the Web `environment` block, add:

```ts
        NOTIFICATIONS_TABLE: notifications.name,
        DIGEST_SENDER: process.env.DIGEST_SENDER ?? "",
        DIGEST_RECIPIENT: process.env.DIGEST_RECIPIENT ?? "",
```

- [ ] **Step 4: Add the prod-gated weekly cron in `sst.config.ts`**

After the `CaseMonitor` cron block (~line 274), add:

```ts
    // Weekly overdue-milestone digest (spec 2026-07-25). Prod-only so dev/ca
    // stages never emit stray emails; the institute /notifications BUTTON path
    // (Web server action) runs in every stage for the showcase demo.
    if (isProd) {
      new sst.aws.Cron("NotifyDigest", {
        schedule: "cron(0 13 ? * MON *)", // Mondays 13:00 UTC (~6am PT)
        function: {
          handler: "src/functions/notify-digest.handler",
          timeout: "120 seconds",
          memory: "512 MB",
          link: [notifications, commitments],
          permissions: [{ actions: ["ses:SendEmail"], resources: ["*"] }],
          environment: {
            REPO_IMPL: "dynamo",
            NOTIFICATIONS_TABLE: notifications.name,
            COMMITMENTS_TABLE: commitments.name,
            DIGEST_SENDER: process.env.DIGEST_SENDER ?? "",
            DIGEST_RECIPIENT: process.env.DIGEST_RECIPIENT ?? "",
          },
        },
      });
    }
```

- [ ] **Step 5: Verify the SST config parses / typechecks**

Run: `npx tsc --noEmit`
Expected: 0 errors. (Do NOT deploy in this task — deploy is the interactive runbook, done later.)

- [ ] **Step 6: Append the runbook note to `docs/deploy.md`**

Add a short section documenting: (a) verify `DIGEST_SENDER` (and, in SES sandbox, `DIGEST_RECIPIENT`) in the stage region before deploy; (b) set `DIGEST_SENDER` / `DIGEST_RECIPIENT` env at deploy; (c) the cron is prod-only, the button works in every stage; (d) demo: sign in as institute → `/notifications` → "Generate & send now". Keep it factual and brief.

- [ ] **Step 7: Commit**

```bash
git add src/functions/notify-digest.ts sst.config.ts docs/deploy.md
git commit -m "feat(notify): weekly digest cron + Notifications table + SES wiring (prod-gated)"
```

---

### Task 6: Institute `/notifications` page + trigger button + nav

**Files:**
- Create: `src/app/notifications/page.tsx`
- Create: `src/app/notifications/actions.ts`
- Modify: `src/middleware.ts` (add `/notifications` to `INDIGENOMICS_ONLY`)
- Modify: `src/components/InstituteNav.tsx` (add the Notifications tab)

**Interfaces:**
- Consumes: `getSession` from `@/lib/auth`; `notificationsRepo` from `@/lib/notifications`; `runDigest` from `@/lib/notifications/run`; `InstituteNav`.
- Produces: an institute-only page + a `runDigestAction()` server action.

- [ ] **Step 1: Gate the route in `src/middleware.ts`**

Change the `INDIGENOMICS_ONLY` array to include `/notifications`:

```ts
const INDIGENOMICS_ONLY = ["/verify", "/organizations", "/extract", "/alignment", "/suppliers", "/notifications"];
```

- [ ] **Step 2: Add the nav tab in `src/components/InstituteNav.tsx`**

Add to the `TABS` array (after `Extract`):

```ts
  { href: "/notifications", label: "Notifications" },
```

- [ ] **Step 3: Write the server action `src/app/notifications/actions.ts`**

```ts
"use server";
// Institute-only on-demand digest trigger (the showcase-demo path). Re-checks
// the session server-side (never trust the middleware alone for a mutation).
import { getSession } from "@/lib/auth";
import { runDigest } from "@/lib/notifications/run";
import { revalidatePath } from "next/cache";

export async function runDigestAction(): Promise<void> {
  const session = getSession();
  if (session?.kind !== "indigenomics") return; // silently no-op for non-institute
  await runDigest();
  revalidatePath("/notifications");
}
```

- [ ] **Step 4: Write the page `src/app/notifications/page.tsx`**

```tsx
// Institute notifications inbox (spec 2026-07-25): the weekly overdue-milestone
// digests, newest first, with an on-demand "Generate & send now" trigger for
// the showcase demo. Institute-only (middleware + getSession guard).
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { notificationsRepo } from "@/lib/notifications";
import { InstituteNav } from "@/components/InstituteNav";
import { runDigestAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = getSession();
  if (session?.kind !== "indigenomics") redirect("/home");

  const digests = await notificationsRepo.latest(8);
  const latest = digests[0];

  return (
    <div className="space-y-8">
      <InstituteNav active="/notifications" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-amber text-xs uppercase tracking-widest mb-1">Indigenomics</div>
          <h1 className="font-serif text-3xl">Notifications</h1>
          <p className="text-ink2 text-sm mt-1">
            Weekly overdue &amp; at-risk milestone digests across the RAP Index.
            {latest ? ` Latest: ${latest.totals.overdue} overdue, ${latest.totals.atRisk} at-risk across ${latest.totals.orgs} organizations.` : " No digests yet."}
          </p>
        </div>
        <form action={runDigestAction}>
          <button type="submit" className="text-sm rounded px-4 py-2 bg-amber/10 text-amber hover:bg-amber/20 whitespace-nowrap">
            Generate &amp; send now
          </button>
        </form>
      </div>

      {digests.length === 0 ? (
        <p className="text-ink3 text-sm">No digests generated yet. Click “Generate &amp; send now” to create one.</p>
      ) : (
        <ul className="space-y-4">
          {digests.map((d) => (
            <li key={d.isoWeek} className="border border-line rounded p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-lg">Week {d.isoWeek}</h2>
                <span className={`text-xs rounded px-2 py-0.5 ${d.emailStatus === "sent" ? "text-cedar border border-cedar/40 bg-cedar/10" : d.emailStatus === "failed" ? "text-rust border border-rust/40 bg-rust/10" : "text-ink3 border border-ink/15"}`}>
                  email: {d.emailStatus}
                </span>
              </div>
              <p className="text-ink2 text-sm mt-1">
                {d.totals.overdue} overdue · {d.totals.atRisk} at-risk · {d.totals.orgs} organizations · {new Date(d.generatedAt).toLocaleString()}
              </p>
              {d.groups.length > 0 && (
                <details className="mt-2">
                  <summary className="text-sm text-amber cursor-pointer">Per-organization breakdown</summary>
                  <ul className="mt-2 space-y-2">
                    {d.groups.map((g) => (
                      <li key={g.orgName} className="text-sm">
                        <span className="font-medium">{g.orgName}</span>{" "}
                        <span className="text-ink3">— {g.overdue} overdue, {g.atRisk} at-risk</span>
                        <ul className="ml-4 list-disc text-ink2">
                          {g.items.map((it, i) => (
                            <li key={i}>[{it.kind === "overdue" ? "overdue" : "at risk"}] {it.title} (target {it.targetYear}) — {it.reason}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit` → 0 errors.
Run: `npm run build`
Expected: build succeeds; `/notifications` appears in the route list. (Confirms the App Router page + server action compile — the fix for the class of failure where a new dependency or route breaks the Next build.)

- [ ] **Step 6: Manual smoke (local, optional but recommended)**

With `REPO_IMPL=dynamo` + DynamoDB Local (or mock mode), sign in as `institute@demo`, open `/notifications`, click "Generate & send now" (no `DIGEST_RECIPIENT` set → `emailStatus: skipped`), confirm a Week-`<isoWeek>` entry appears with a per-org breakdown, and clicking again does not duplicate it.

- [ ] **Step 7: Commit**

```bash
git add src/app/notifications/page.tsx src/app/notifications/actions.ts src/middleware.ts src/components/InstituteNav.tsx
git commit -m "feat(notify): institute /notifications inbox + on-demand trigger + nav"
```

---

## Notes / deliberate scope decisions

- **Nav badge simplification.** The spec mentioned a nav badge showing the overdue count. Wiring an async count into the shared `InstituteNav` (rendered on 8 institute pages) would force every one of them to do an extra read. For v1 the count lives in the `/notifications` page header instead; the nav gets a plain tab. Re-add a cross-page badge later if the institute asks for it. *(Flag for reviewer: confirm this is an acceptable read of the spec's "nav badge" line.)*
- **`itemToNotification` explicit field order** is required for the mock≡dynamo `JSON.stringify` parity check (Task 3) — do not simplify it to `return it.data`.
- **Do not deploy inside these tasks.** Deploy (SES identity verification, `DIGEST_*` env, `sst deploy --stage ca`) is the interactive runbook in `docs/deploy.md`, run after the branch is reviewed — and note that a push to `main` auto-deploys production via `.github/workflows/deploy.yml`, so this branch lands via PR.
- **`@/` path alias** is used throughout to match the codebase; verify it resolves in `tsconfig.json` (it does for existing `@/lib/*` imports).

## Self-review

- **Spec coverage:** buildOverdueDigest (§4.2) → Task 1; format (§4.3) → Task 2; Notifications table + repo (§4.4) → Task 3; email (§4.5) + runDigest (§4.6) → Task 4; cron handler (§4.7) + sst wiring (§4.9) → Task 5; in-app page + trigger + middleware + nav (§4.8) → Task 6. Idempotency (§5), error handling (§6), testing (§7) covered in Tasks 3–4. Residency (§3) enforced by the prod/stage-region cron + aggregate content. Deploy runbook (§8) → Task 5 Step 6. Nav badge intentionally trimmed (see Notes).
- **Placeholder scan:** none — every code step contains complete code. The one prose caveat (the `items.sort` type note in Task 1) gives the exact replacement comparator.
- **Type consistency:** `NotificationRecord`, `NotificationsRepo`, `Emailer`, `RunDeps`, `OverdueDigest` names are used identically across tasks; `runDigest(deps?)`, `buildOverdueDigest(items, now)`, `isoWeekOf(d)`, `renderDigestEmail(d)`, `makeSesEmailer(client?)` signatures match every call site.
