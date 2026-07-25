# Overdue-Milestone Notifications — Design Spec

**Author:** Nate (En-Ping) · **Date:** 2026-07-25 · **Status:** approved design, ready for implementation plan

**Goal:** Turn the existing overdue/at-risk *signal* (`computeRisk`) into a **delivered weekly digest** for the Indigenomics institute, surfaced on **two channels** — an in-app notifications inbox and an email — driven by a weekly cron in production and by an on-demand "generate & send now" button for the Aug 10 showcase demo.

**Closes:** client Idea #5 (`docs/2026-07-14-action-items-eval.md` Finding E / action item P2): *"Idea #5's overdue signal is computed as a static insight but never delivered (no notification/subscription). Needs building — small."*

---

## 1. Context

The overdue/at-risk computation already exists and is fully working:

- `src/lib/commitments/insights.ts` → `computeRisk(items, currentYear): RiskReport` classifies each commitment as `overdue` (target year passed, not supplier-confirmed) or `at_risk` (due this year, `<60%` or stalled), returning `{ flags, overdueCount, atRiskCount, onTrackCount }`. Each `RiskFlag` carries its full `Commitment` (which includes `orgName`, `title`, `targetYear`, `progressPct`, `status`).
- It is displayed on-screen (`/my-commitments` banner, `/commitments` risk table, org badges) but **never delivered** anywhere.

This spec adds only the **delivery half**. The compute layer is reused verbatim — no changes to `insights.ts`.

## 2. Goals / non-goals

**Goals (v1):**
- A network-wide roll-up of overdue + at-risk milestones, grouped by organization, delivered to the Indigenomics institute.
- Weekly cadence in production (cron), plus an on-demand trigger for the demo.
- Two channels: persisted in-app inbox (the visible artifact for the video) **and** email via SES.
- Idempotent per ISO week (re-running does not duplicate).
- Data-residency-clean: recipient PII and delivery stay in the platform region (ca-central-1).

**Non-goals (deferred — see §10):**
- Per-company digests (undeliverable while company logins are `<slug>@demo` placeholders).
- User-configurable notification preferences, unsubscribe, digest scheduling per recipient.
- SMS / push / any channel beyond email + in-app.
- Bridging the overdue signal into the RAP-extraction (`RapData`) identity domain.

## 3. Architecture

```
 sst.aws.Cron "NotifyDigest" (weekly, prod-only) ─┐
                                                   ├──►  runDigest()  (src/lib/notifications/run.ts)
 institute "Generate & send now" button ──────────┘        │
   (server action, any stage)                              │  1. buildOverdueDigest(allCommitments, year)   ← reuses computeRisk
                                                            │  2. notificationsRepo.put(record)   (write FIRST)
                                                            │  3. sendDigestEmail(record)         (then send; set emailStatus)
                                                            ▼
        /notifications  (institute-only page)  reads notificationsRepo.latest(n)  → inbox + nav badge
```

Both trigger paths call the **same** `runDigest()` function. The only difference is who invokes it (EventBridge schedule vs. a Next.js server action).

**Region / residency.** The handler, the `Notifications` table, and the `Commitments` table it reads all live in the **stage's region** (ca-central-1 for the `ca`/production-Canada stage). SES is invoked **in that same region**, so the recipient address never leaves it. The digest payload is **aggregate, public commitment data** (org names, milestone titles, counts) — no per-person PII — consistent with the residency split (spec §4) and OCAP posture ([[data-governance-ocap-residency]]).

## 4. Components

Each unit has one responsibility, a defined interface, and is testable in isolation.

### 4.1 `src/lib/notifications/types.ts` — data shapes

```ts
export interface DigestOrgGroup {
  orgName: string;
  overdue: number;
  atRisk: number;
  items: { title: string; targetYear: number; kind: "overdue" | "at_risk"; reason: string }[];
}

export interface OverdueDigest {
  isoWeek: string;        // "2026-W30" — the idempotency key
  generatedAt: string;    // ISO 8601
  year: number;           // the currentYear computeRisk ran against
  totals: { overdue: number; atRisk: number; orgs: number };
  groups: DigestOrgGroup[]; // sorted: most overdue first, then most at-risk, then orgName
}

export type EmailStatus = "sent" | "failed" | "skipped"; // skipped = no recipient configured

export interface NotificationRecord extends OverdueDigest {
  recipient: string | null;
  emailStatus: EmailStatus;
  emailError?: string;   // present when emailStatus === "failed"
}

export interface NotificationsRepo {
  put(rec: NotificationRecord): Promise<NotificationRecord>; // upsert by isoWeek
  latest(n: number): Promise<NotificationRecord[]>;          // newest-first
  getByWeek(isoWeek: string): Promise<NotificationRecord | null>;
}
```

### 4.2 `src/lib/notifications/digest.ts` — pure compute

```ts
export function isoWeekOf(d: Date): string;                 // → "2026-W30" (ISO-8601 week)
export function buildOverdueDigest(items: Commitment[], now: Date): OverdueDigest;
```

- Runs `computeRisk(items, now.getFullYear())`, groups `flags` by `orgName`, produces per-org `overdue`/`atRisk` counts and item lists, and network `totals`.
- Pure (no I/O, takes `now` as a param so tests are deterministic). `totals.orgs` = number of distinct orgs with ≥1 flag.
- Sort: groups by `overdue` desc, then `atRisk` desc, then `orgName` asc; items within a group `overdue` before `at_risk`.

### 4.3 `src/lib/notifications/format.ts` — rendering

```ts
export function renderDigestEmail(d: OverdueDigest): { subject: string; html: string; text: string };
```

- `subject`: e.g. `"RAP Index: 34 overdue, 45 at-risk across 28 organizations (week 2026-W30)"`.
- `html` + `text`: a per-org breakdown. Deterministic; no external template engine.
- Empty case (`totals.overdue === 0 && totals.atRisk === 0`): subject `"RAP Index: all milestones on track (week …)"`, body says the network is on pace.

### 4.4 `Notifications` table + repo

- New DynamoDB table `Notifications`, same generic single-table shape as the others (`sst.config.ts` `singleTableShape`). Table-per-domain, matching the codebase convention (DataPortal / RapSurvey / Commitments / Alignment / RapData).
- Key layout: `PK = "NOTIFY#institute"`, `SK = "DIGEST#<isoWeek>"`. `latest(n)` = `Query` on the PK, `SK begins_with "DIGEST#"`, `ScanIndexForward: false`, `Limit: n`. `getByWeek` = `GetItem`. `put` = `PutItem` (overwrites the week's item → idempotent upsert).
- `src/lib/notifications/repo.mock.ts` (in-memory Map) + `repo.dynamo.ts` (DynamoDB) + `index.ts` selecting on `process.env.REPO_IMPL === "dynamo"` — the exact pattern in `src/lib/commitments/index.ts`. Table name from `NOTIFICATIONS_TABLE` env (like `COMMITMENTS_TABLE`).

### 4.5 `src/lib/notifications/email.ts` — SES sender

```ts
export interface Emailer { send(msg: { to: string; subject: string; html: string; text: string }): Promise<void>; }
export function makeSesEmailer(client?: SESv2Client): Emailer; // injectable client for tests
```

- Uses `@aws-sdk/client-sesv2` `SendEmailCommand`. `From` = `DIGEST_SENDER` env; `to` = `DIGEST_RECIPIENT` env.
- Throws on SES failure — the caller (`runDigest`) catches and records `emailStatus:"failed"` (see §6).

### 4.6 `src/lib/notifications/run.ts` — orchestrator (shared by cron + button)

```ts
export async function runDigest(deps?: {
  commitmentsRepo?: CommitmentRepo;
  notificationsRepo?: NotificationsRepo;
  emailer?: Emailer | null;   // null → skip email (emailStatus:"skipped")
  now?: Date;
}): Promise<NotificationRecord>;
```

Steps: (1) `commitmentsRepo.listCommitments()` (no filter = whole network); (2) `buildOverdueDigest`; (3) `notificationsRepo.put({...digest, recipient, emailStatus:"skipped"})` **first**, so the in-app record is never lost; (4) if `DIGEST_RECIPIENT` set and `emailer` present, `renderDigestEmail` → `emailer.send` → update record `emailStatus:"sent"` (or `"failed"` + `emailError` on throw). Returns the final record. Deps are injectable so tests never touch AWS.

### 4.7 `src/functions/notify-digest.ts` — cron handler

```ts
export async function handler(): Promise<void> { await runDigest(); }
```

Thin Lambda entry; `REPO_IMPL=dynamo` + a real SES emailer via env. Mirrors `src/functions/case-monitor.handler`.

### 4.8 In-app surface

- **Page** `src/app/notifications/page.tsx` — institute-only. `getSession()` guard (`kind === "indigenomics"`, else `redirect("/home")`), and `/notifications` added to `INDIGENOMICS_ONLY` in `src/middleware.ts`. Renders `notificationsRepo.latest(8)`: each digest expandable to its per-org breakdown, with `emailStatus` shown (sent/failed/skipped). `export const dynamic = "force-dynamic"`.
- **Trigger** — a server action `runDigestAction()` (institute-gated, re-checks session `kind`) that calls `runDigest()` and `revalidatePath("/notifications")`. Rendered as a "Generate & send now" button on the page. **This is what the showcase video demonstrates** — click → new inbox entry appears → email sent to the verified recipient, all on camera. Safe to click repeatedly (idempotent per week).
- **Nav badge** — the institute nav shows a count of the latest digest's `totals.overdue`. (Reuse whatever nav component the institute layout already uses; a single read of `notificationsRepo.latest(1)`.)

### 4.9 `sst.config.ts` wiring

- Declare `const notifications = new sst.aws.Dynamo("Notifications", singleTableShape);`.
- Add `notifications` to the `Web` function's `link:` array; add `NOTIFICATIONS_TABLE: notifications.name`, `DIGEST_SENDER`, `DIGEST_RECIPIENT` to the Web `environment`; add `{ actions: ["ses:SendEmail"], resources: ["*"] }` to the Web `transform.server.permissions` (for the button's server action).
- Add a **prod-gated** weekly cron (wrap in `if (isProd) { … }`) modeled on `CaseMonitor`:

```ts
if (isProd) {
  new sst.aws.Cron("NotifyDigest", {
    schedule: "cron(0 13 ? * MON *)",           // Mondays 13:00 UTC (~6am PT)
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

The cron is prod-only so dev/ca stages don't emit stray emails. The **button** path works in **every** stage (including ca), so the demo runs against the ca deployment.

## 5. Data flow (idempotency)

`isoWeek` is the idempotency key. Cron and button both `put` under `SK = DIGEST#<isoWeek>`, so a second run in the same week **overwrites** rather than appends. The video demo can therefore click the button freely; the inbox shows one entry per week, updated in place.

## 6. Error handling

- **Record-before-send:** the in-app record is persisted before the email attempt, so a SES failure never loses the in-app digest.
- **SES failure:** caught in `runDigest`; record updated to `emailStatus:"failed"` with `emailError`. The button/page still shows the digest; the UI surfaces "email failed" so the demo operator sees it.
- **No recipient configured:** `emailStatus:"skipped"` (in-app only). Lets the feature run in stages where SES isn't set up.
- **Cron isolation:** a thrown handler is retried by EventBridge per its default policy; because `put` is an idempotent upsert, a retry is safe.

## 7. Testing

All via the project's `tsx` assertion-harness pattern (no unit-test framework); AWS is never touched in tests (injected deps).

- **`digest` unit** (`scripts/verify-notifications.ts`, no DynamoDB): overdue vs at-risk grouping; per-org counts; `totals.orgs` distinct count; sort order; empty-network case; `isoWeekOf` boundary (e.g. year-end week rollover) against known dates.
- **`format` unit:** subject + all `totals` + each org name present in `html` and `text`; empty-case subject/body.
- **Notifications repo parity:** `mock ≡ dynamo` on `put`/`latest`/`getByWeek` (DynamoDB Local, `ddb:up`), folded into `npm run verify` or a new `verify:notifications` script wired in `package.json`.
- **Idempotency:** two `put`s for the same `isoWeek` → `latest` returns one record, updated not duplicated.
- **`runDigest` orchestration:** injected mock repos + a stub `Emailer` — asserts (a) record persisted before send, (b) `emailStatus:"sent"` on success with correct `to`/subject passed through, (c) `emailStatus:"failed"` + `emailError` when the emailer throws, (d) `emailStatus:"skipped"` when recipient unset. No real SES call.

## 8. Deploy / demo runbook

1. **SES identities (one-time, in the stage region, e.g. ca-central-1):** verify the `DIGEST_SENDER` address (or domain) and, while SES is in **sandbox**, verify the `DIGEST_RECIPIENT` address too. One verified recipient is sufficient for v1; no production-access request needed.
2. **Set env at deploy:** `DIGEST_SENDER` and `DIGEST_RECIPIENT` (see Open Questions §11 for the exact addresses). Deploy the stage (ca) with the standard command, adding these vars.
3. **Demo (Aug 10):** sign in as the institute, open `/notifications`, click **Generate & send now** → a digest appears in the inbox and lands in the recipient mailbox. Optionally pre-seed one or two prior weeks' records so the inbox isn't empty on camera.

## 9. Files

- Create: `src/lib/notifications/{types,digest,format,email,run,repo.mock,repo.dynamo,index}.ts`
- Create: `src/functions/notify-digest.ts`
- Create: `src/app/notifications/page.tsx` (+ its server action)
- Create: `scripts/verify-notifications.ts`
- Modify: `src/middleware.ts` (add `/notifications` to `INDIGENOMICS_ONLY`); `sst.config.ts` (table, Web link/env/perms, prod-gated cron); `package.json` (verify script); the institute nav component (badge)
- Reuse unchanged: `src/lib/commitments/insights.ts` (`computeRisk`)

## 10. Out of scope / future

- **Per-company digests** — the highest-value follow-up, deferred only because company logins are `<slug>@demo` placeholders and real sends need SES production access + verified/real addresses. `buildOverdueDigest` already yields per-org groups, so the later add-on is: filter groups by a real, verified company recipient and send one email per company — no rewrite.
- Notification preferences / unsubscribe / cadence per recipient.
- Additional channels (SMS, web push).

## 11. Open questions (deploy-time, not blocking implementation)

1. **Recipient address (`DIGEST_RECIPIENT`)** — the institute account uses `institute@demo`, which is not deliverable. For the demo we need a real, SES-verified address (e.g. the presenter's own address, or a client-provided institute inbox). Decide before the Aug 10 deploy.
2. **Sender identity (`DIGEST_SENDER`)** — a verified address/domain SES will send "From". Simplest for the demo: verify a single from-address in the stage region.
