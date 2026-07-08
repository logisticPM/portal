# Automated New-Case Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly scheduled scan that additively detects newly-published judgments (recording them as substrate) and surfaces the delta on an in-app page — detection-only, no auto-enrichment.

**Architecture:** A `monitor` module (mirrors `briefs`): `scan.ts` harvests a recent window and conditionally inserts only new PROFILEs (the `cases-harvest-economic` additive pattern); `repo.ts` writes/lists `SCAN#` meta items on the GSI2 `SCAN#ALL` partition (invisible to the corpus, never touches `CaseRepo`). An `sst.aws.Cron` invokes a thin handler weekly; a `/cases/monitoring` RSC page lists scans. Enrichment stays human-run.

**Tech Stack:** TypeScript, `tsx`, AWS SDK v3 (`@aws-sdk/lib-dynamodb`), SST v3 (`sst.aws.Cron`), Next.js 14 RSC, `node:assert/strict` tests via `npx tsx`.

Each task leaves a green `tsc`. Run every command from the worktree root; do NOT run `npm run verify`.

---

### Task 1: Scan report type + repo (`monitor/types.ts`, `monitor/repo.ts`)

**Files:**
- Create: `src/lib/cases/monitor/types.ts`
- Create: `src/lib/cases/monitor/repo.ts`
- Test: `scripts/test-cases-monitor.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-monitor.ts`:

```ts
// New-case monitoring (spec 2026-07-07): scan-report item shape + additive scan.
// Async IIFE — this repo is NOT ESM (top-level await is illegal).
import assert from "node:assert/strict";
import { scanItem } from "../src/lib/cases/monitor/repo";

(async () => {
  // --- Task 1: SCAN# meta item shape ---
  const item = scanItem({ ts: "2026-07-07T00:00:00.000Z", windowDays: 90, scanned: 10, added: 3, newCitations: ["2026 SCC 1"] });
  assert.equal(item.PK, "SCAN#2026-07-07T00:00:00.000Z");
  assert.equal(item.SK, "SCAN");
  assert.equal(item.et, "Scan", "non-Case et so corpus queries ignore it");
  assert.equal(item.GSI2PK, "SCAN#ALL");
  assert.equal(item.GSI2SK, "2026-07-07T00:00:00.000Z");
  assert.equal(item.GSI1PK, undefined, "no GSI1PK — invisible to the corpus GSI1 scan");
  assert.equal(item.data.added, 3);

  console.log("✅ test-cases-monitor passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `npx tsx scripts/test-cases-monitor.ts`
Expected: FAIL — cannot resolve `../src/lib/cases/monitor/repo`.

- [ ] **Step 3: Create the type**

Create `src/lib/cases/monitor/types.ts`:

```ts
// A single scheduled-scan report (spec 2026-07-07).
export interface ScanReport {
  ts: string;             // ISO timestamp of the scan
  windowDays: number;     // recency window scanned
  scanned: number;        // candidate records seen (deduped)
  added: number;          // genuinely-new cases written to substrate
  newCitations: string[]; // citations of the added cases (capped at 50)
}
```

- [ ] **Step 4: Create the repo**

Create `src/lib/cases/monitor/repo.ts` (mirrors `briefs/repo.ts` — meta items invisible to the corpus, listed via GSI2):

```ts
// Dynamo access for scan reports. Items live in the LegalCases table but are
// invisible to the corpus: no GSI1PK (scanAll scans GSI1), et ∉ {Case,CaseChunk},
// listed via GSI2 under a dedicated "SCAN#ALL" partition. Own repo — NOT CaseRepo.
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../../dynamo/client";
import { GSI2 } from "../../dynamo/cases-table";
import type { ScanReport } from "./types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

export const scanKeys = { scan: (ts: string) => ({ PK: `SCAN#${ts}`, SK: "SCAN" }) };

// Pure item builder (unit-tested): no GSI1PK, non-Case et, GSI2 listing key.
export function scanItem(r: ScanReport): Record<string, unknown> {
  return { ...scanKeys.scan(r.ts), et: "Scan", GSI2PK: "SCAN#ALL", GSI2SK: r.ts, data: r };
}

export async function writeScan(r: ScanReport): Promise<void> {
  await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: scanItem(r) }));
}

export async function listScans(limit = 20): Promise<ScanReport[]> {
  const res = await ddbDoc.send(new QueryCommand({
    TableName: TABLE, IndexName: GSI2,
    KeyConditionExpression: "GSI2PK = :p",
    ExpressionAttributeValues: { ":p": "SCAN#ALL" },
    ScanIndexForward: false, Limit: limit,
  }));
  return (res.Items ?? []).map((i) => i.data as ScanReport);
}
```

- [ ] **Step 5: Run it, verify it PASSES**

Run: `npx tsx scripts/test-cases-monitor.ts && npx tsc --noEmit`
Expected: `✅ test-cases-monitor passed`; tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/monitor/types.ts src/lib/cases/monitor/repo.ts scripts/test-cases-monitor.ts
git commit -m "feat(cases): scan-report type + monitor repo (GSI2 SCAN# meta items)"
```

---

### Task 2: Additive scan core + Lambda-safe harvest cache

**Files:**
- Modify: `src/lib/cases/ingest/harvest.ts` (`cached()` best-effort)
- Create: `src/lib/cases/monitor/scan.ts`
- Test: `scripts/test-cases-monitor.ts` (extend)

- [ ] **Step 1: Harden the harvest cache for read-only FS**

In `src/lib/cases/ingest/harvest.ts`, replace the `cached` function body so the cache write is best-effort (a Lambda's read-only `/var/task` must not be fatal — the EROFS lesson from `cachedCall`). Replace:

```ts
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, key.replace(/[^a-z0-9]+/gi, "_") + ".json");
  try { return JSON.parse(await fs.readFile(file, "utf8")) as T; } catch { /* miss */ }
  const val = await fn();
  await fs.writeFile(file, JSON.stringify(val));
  return val;
}
```

with:

```ts
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const file = path.join(CACHE_DIR, key.replace(/[^a-z0-9]+/gi, "_") + ".json");
  try { return JSON.parse(await fs.readFile(file, "utf8")) as T; } catch { /* miss (incl. no dir) */ }
  const val = await fn();
  // Best-effort disk cache: a read-only FS (e.g. a Lambda's /var/task) must never be
  // fatal — mkdir/write inside try/catch, then proceed uncached.
  try { await fs.mkdir(CACHE_DIR, { recursive: true }); await fs.writeFile(file, JSON.stringify(val)); } catch { /* uncached */ }
  return val;
}
```

(No dedicated unit test — `cached` is internal and `fs` isn't injectable here; the change mirrors the proven `cachedCall` fix and is verified by `tsc` + the deployed Lambda run.)

- [ ] **Step 2: Write the failing test**

In `scripts/test-cases-monitor.ts`, add these imports at the top (after the existing import):

```ts
import { scanRecent } from "../src/lib/cases/monitor/scan";
import type { A2ajRecord } from "../src/lib/cases/ingest/a2aj";
```

Then add, immediately before the final `console.log("✅ test-cases-monitor passed");`:

```ts
  // --- Task 2: additive scan (injected harvest + send) ---
  const rec = (cit: string): A2ajRecord => ({ dataset: "SCC", citation_en: cit, name_en: "X v. Y", document_date_en: "2026-01-01", url_en: "u" });
  const fakeHarvest = async () => [rec("2026 SCC 1"), rec("2026 SCC 2"), rec("2026 SCC 3")];
  const calls: any[] = [];
  const fakeSend = async (cmd: any) => {
    calls.push(cmd);
    if (cmd.input.Item.PK === "CASE#2026-scc-2") { const e: any = new Error("exists"); e.name = "ConditionalCheckFailedException"; throw e; }
    return {};
  };
  const report = await scanRecent(90, { harvest: fakeHarvest, send: fakeSend, now: () => new Date("2026-07-07T00:00:00.000Z") });
  assert.equal(report.scanned, 3);
  assert.equal(report.added, 2, "existing case (2026-scc-2) skipped via conditional put");
  assert.deepEqual(report.newCitations, ["2026 SCC 1", "2026 SCC 3"]);
  assert.equal(report.windowDays, 90);
  assert.equal(report.ts, "2026-07-07T00:00:00.000Z");
  assert.equal(calls[0].input.ConditionExpression, "attribute_not_exists(PK)", "additive conditional write");

  let threw = false;
  try {
    await scanRecent(90, { harvest: fakeHarvest, now: () => new Date(),
      send: async () => { const e: any = new Error("boom"); e.name = "ProvisionedThroughputExceededException"; throw e; } });
  } catch { threw = true; }
  assert.ok(threw, "a non-conditional error propagates, not swallowed");
```

- [ ] **Step 3: Run it, verify it FAILS**

Run: `npx tsx scripts/test-cases-monitor.ts`
Expected: FAIL — cannot resolve `../src/lib/cases/monitor/scan`.

- [ ] **Step 4: Create the scan core**

Create `src/lib/cases/monitor/scan.ts`:

```ts
// Additive recent-window scan (spec 2026-07-07). Harvests all theme queries over the
// window and conditionally inserts ONLY new PROFILEs (the cases-harvest-economic
// pattern) — never overwrites, promotes, or touches the artifact. harvest + send are
// injectable for offline tests.
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../../dynamo/client";
import { caseToItems } from "../../dynamo/cases-table";
import { a2ajToCase, type A2ajRecord } from "../ingest/a2aj";
import { dedupeByCitation } from "../ingest/dedup";
import { harvestQuery } from "../ingest/harvest";
import { THEME_QUERIES } from "../ingest/sources";
import type { LegalCase } from "../types";
import type { ScanReport } from "./types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
const MAX_NEW_CITATIONS = 50;

export type HarvestFn = (from: string, to: string) => Promise<A2ajRecord[]>;

// Default: harvest every theme query over [from, to] (a sub-year window = one page-set,
// so WINDOW_YEARS=1) and dedupe by citation.
const defaultHarvest: HarvestFn = async (from, to) => {
  const all: A2ajRecord[] = [];
  for (const queries of Object.values(THEME_QUERIES))
    for (const q of queries) all.push(...(await harvestQuery(q, from, to, 1)));
  return dedupeByCitation(all);
};

export interface ScanDeps { harvest?: HarvestFn; send?: (cmd: unknown) => Promise<unknown>; now?: () => Date }

export async function scanRecent(windowDays: number, deps: ScanDeps = {}): Promise<ScanReport> {
  const harvest = deps.harvest ?? defaultHarvest;
  const send = deps.send ?? ((cmd: unknown) => ddbDoc.send(cmd as never));
  const now = (deps.now ?? (() => new Date()))();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10);

  const raw = await harvest(from, to);
  const added: string[] = [];
  for (const r of raw) {
    const c: LegalCase = { ...a2ajToCase(r), corpusTier: "substrate" };
    const [profile] = caseToItems(c); // bare substrate → PROFILE only
    try {
      await send(new PutCommand({ TableName: TABLE, Item: profile, ConditionExpression: "attribute_not_exists(PK)" }));
      added.push(c.citation);
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === "ConditionalCheckFailedException") continue; // already present → skip
      throw e;
    }
  }
  return { ts: now.toISOString(), windowDays, scanned: raw.length, added: added.length, newCitations: added.slice(0, MAX_NEW_CITATIONS) };
}
```

- [ ] **Step 5: Run it, verify it PASSES**

Run: `npx tsx scripts/test-cases-monitor.ts && npx tsc --noEmit`
Expected: `✅ test-cases-monitor passed`; tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/ingest/harvest.ts src/lib/cases/monitor/scan.ts scripts/test-cases-monitor.ts
git commit -m "feat(cases): additive recent-window scan + Lambda-safe harvest cache"
```

---

### Task 3: Scheduled function + SST Cron

**Files:**
- Create: `src/functions/case-monitor.ts`
- Modify: `sst.config.ts`

- [ ] **Step 1: Create the handler**

Create `src/functions/case-monitor.ts`:

```ts
// Scheduled new-case monitor (spec 2026-07-07). Detection-only: additively records
// newly-published cases as substrate and writes a scan report. No promotion/embed/
// artifact mutation — enrichment stays a reviewed human step. (Node 20 Lambda has a
// global fetch, so no polyfill is needed.)
import { scanRecent } from "../lib/cases/monitor/scan";
import { writeScan } from "../lib/cases/monitor/repo";

export const handler = async () => {
  const windowDays = Number(process.env.SCAN_WINDOW_DAYS ?? "90");
  const report = await scanRecent(windowDays);
  await writeScan(report);
  console.log(`[monitor] window ${windowDays}d · scanned ${report.scanned} · added ${report.added}`);
  return { scanned: report.scanned, added: report.added };
};
```

- [ ] **Step 2: Verify the SST Cron API for the installed version**

Run: `grep -rl "sst.aws.Cron\|new sst.aws" node_modules/sst/dist 2>/dev/null | head` and check `node_modules/sst/dist/components/aws/cron.d.ts` for the `Cron` args shape (`schedule` + `function` / `job`). The block below targets SST v3 (ion). If the installed API differs (e.g. `function` is named `job`, or `schedule` uses `cron(...)`/`rate(...)` differently), adapt the block accordingly.

- [ ] **Step 3: Add the Cron to `sst.config.ts`**

In `sst.config.ts`, immediately AFTER the `briefGen` function definition (the `const briefGen = new sst.aws.Function("BriefGen", { … });` block) and BEFORE `new sst.aws.Nextjs("Web", …)`, add:

```ts
    // Scheduled new-case monitor (spec 2026-07-07). Detection-only — additively
    // records newly-published cases as substrate + writes a scan report; NO Bedrock,
    // no promotion, no artifact mutation. Enrichment stays a human-run op.
    new sst.aws.Cron("CaseMonitor", {
      schedule: "rate(7 days)",
      function: {
        handler: "src/functions/case-monitor.handler",
        timeout: "300 seconds",
        memory: "512 MB",
        environment: { CASES_TABLE: "LegalCases", SCAN_WINDOW_DAYS: "90" },
        permissions: [{
          actions: ["dynamodb:Query", "dynamodb:PutItem"],
          resources: [
            "arn:aws:dynamodb:us-east-1:*:table/LegalCases",
            "arn:aws:dynamodb:us-east-1:*:table/LegalCases/index/*",
          ],
        }],
      },
    });
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (`sst.config.ts` is validated by SST at deploy, not by `tsc`/`next build`; the handler compiles under `tsc`.)

- [ ] **Step 5: Commit**

```bash
git add src/functions/case-monitor.ts sst.config.ts
git commit -m "feat(cases): weekly CaseMonitor cron + handler (detection-only)"
```

---

### Task 4: Monitoring page + nav + methodology + offline gate

**Files:**
- Create: `src/app/cases/monitoring/page.tsx`
- Modify: `src/app/cases/layout.tsx`
- Modify: `docs/research/2026-06-28-legal-corpus-construction-methodology.md`

- [ ] **Step 1: Create the page**

Create `src/app/cases/monitoring/page.tsx`:

```tsx
import { listScans } from "@/lib/cases/monitor/repo";

export const dynamic = "force-dynamic"; // reads live scan reports from DynamoDB

export default async function MonitoringPage() {
  const scans = await listScans(20);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-2xl">Monitoring</h1>
      <p className="mt-1 text-sm text-ink3">
        New judgments are detected automatically each week and enter as substrate;
        promotion and enrichment are a reviewed step (not automatic).
      </p>
      {scans.length === 0 && <p className="mt-4 text-sm text-ink3">No scans recorded yet.</p>}
      {scans.map((s) => (
        <section key={s.ts} className="mt-4 rounded border border-line bg-panel px-3 py-2">
          <div className="text-sm">
            <span className="font-serif">{new Date(s.ts).toLocaleDateString("en-CA")}</span>{" "}
            <span className="text-ink3">· window {s.windowDays}d · scanned {s.scanned} · </span>
            <span className="text-cedar">added {s.added}</span>
          </div>
          {s.newCitations.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1 text-xs">
              {s.newCitations.map((c) => (
                <li key={c} className="rounded border border-line bg-ink/5 px-2 py-0.5">
                  {c} <span className="text-ink3">· pending enrichment</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add the nav link**

In `src/app/cases/layout.tsx`, add a `Monitoring` link immediately AFTER the `Briefings` nav link (`<Link href="/cases/briefings" …>Briefings</Link>`):

```tsx
            <Link href="/cases/monitoring" className="hover:text-amber">Monitoring</Link>
```

- [ ] **Step 3: Append the methodology note**

APPEND to the END of `docs/research/2026-06-28-legal-corpus-construction-methodology.md` (leading blank line):

```markdown

## Automated monitoring (2026-07-07) — detection-only, additive

A weekly `CaseMonitor` cron (`sst.aws.Cron`) harvests recent A2AJ cases over a
90-day window and additively inserts only genuinely-new records as substrate
(conditional `attribute_not_exists(PK)` write — never overwrites or promotes). Each
run writes a `SCAN#` report (invisible to the corpus: no GSI1PK, GSI2 `SCAN#ALL`
partition), surfaced at `/cases/monitoring`. The monitor detects and surfaces only;
promotion, full-text fetch, embedding, and index rebuild remain a reviewed,
credentialed human step (no unattended LLM, no automatic mutation of the production
search artifact).
```

- [ ] **Step 4: Run the full offline gate**

Run: `npx tsx scripts/test-cases-monitor.ts && npx tsc --noEmit && npm run build`
Expected: test prints `✅ test-cases-monitor passed`; `tsc` exit 0; `next build` completes (compiles + generates pages incl. `/cases/monitoring`, exit 0). Wait for the build.

> Do NOT run `npm run verify`.

- [ ] **Step 5: Commit**

```bash
git add src/app/cases/monitoring/page.tsx src/app/cases/layout.tsx docs/research/2026-06-28-legal-corpus-construction-methodology.md
git commit -m "feat(cases): /cases/monitoring page + nav + methodology note"
```

---

## Post-merge / deploy (NOT part of code tasks)

- Merge to main → the push-to-main `sst deploy` provisions the `CaseMonitor` cron automatically.
- Verify: check CloudWatch logs for the `[monitor]` line on the next fire (or invoke the function once on demand for the demo), then confirm `/cases/monitoring` shows the scan.
- When a scan reports new cases, run the existing human enrichment sequence: `cases:fetch-fulltext` → `cases:embed:bedrock:cloud` → `cases:index-build:cloud`, then refresh the derived layers (summaries / figures / nations) — the same steps used after any corpus growth.
