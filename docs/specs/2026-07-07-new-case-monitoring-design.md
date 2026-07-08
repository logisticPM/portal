# Automated New-Case Monitoring (client idea #4) — Design

**Date:** 2026-07-07 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases/monitor` + `src/functions` + `src/app/cases` + `sst.config.ts`

## Motivation

Client brief, Ideas to Build #4: an "automated monitoring pipeline for new
judgments." The ingest pipeline already exists (harvest → fetch-fulltext →
promote → embed → index), but it only runs when a human runs it — so the corpus
silently goes stale between runs. This adds a **scheduled scan** that periodically
detects newly-published cases and surfaces them, so the team knows what's new
without manually re-running anything. This is the last of the client's 6 Ideas.

**Scope (settled): detect + surface only.** The scheduled job additively records
newly-detected cases as substrate and publishes a delta; it does **not**
auto-enrich (fetch-fulltext / promote / embed / index-rebuild stay
human-triggered). Rationale: enrichment runs LLM labeling and mutates the
production search artifact — keeping it a reviewed, credentialed step preserves the
project's governance-observable stance and avoids unattended cost / auto-mutation.
The monitor makes the *pending* work explicit.

## Decisions (from brainstorm)

- **In-product SST Cron** (approach A), weekly (`rate(7 days)`), over an external CI
  cron (B) or a manual script (C).
- **Detect + surface only** — additive; never promotes, never touches the artifact.
- **In-app "recently detected" page** as the delta surface (RSC, zero client JS).
- **Mirror the briefings structure** — a separate `monitor` module + repo with
  `SCAN#` meta items on a GSI2 partition (invisible to corpus scans), never
  touching `CaseRepo` (so `dynamo≡mock` parity is unaffected).
- **Window default 90 days**, weekly cadence — both env-configurable.

## Architecture

### 1. Scan core — `src/lib/cases/monitor/scan.ts` (new)

`scanRecent(windowDays, deps)` :
- Harvest `THEME_QUERIES` (all themes, incl. the expanded economic terms) over the
  window `[today - windowDays, today]` via the existing `harvestQuery` + `dateWindows`
  (a sub-year window = one page-set). Dedup by citation (`dedupeByCitation`).
- Map each to a bare substrate `LegalCase` (`a2ajToCase`, `corpusTier:"substrate"`).
- **Additive conditional write** (reusing the `cases-harvest-economic` pattern):
  `PutCommand` with `ConditionExpression: "attribute_not_exists(PK)"` per PROFILE;
  `ConditionalCheckFailedException` → already present → skip; other errors rethrow.
- Return `{ scanned, added, newCitations: string[] }` (newCitations capped, e.g. 50).
- `deps` (harvest fn + `send`) are injectable for offline tests.

**Lambda FS hardening:** `harvest.ts` `cached()` writes `scripts/.cache/a2aj`, which
is read-only in Lambda (the EROFS lesson from `cachedCall`). Make `cached()`
best-effort — wrap `mkdir`/`writeFile` in try/catch, warn once, proceed uncached —
so the monitor Lambda runs without a writable cache. (Targeted hardening of code the
monitor depends on.)

### 2. Scan report storage — `src/lib/cases/monitor/repo.ts` (new)

A `SCAN#<ISO-ts>` meta item (mirrors the `BRIEF#` pattern):
- `PK: "SCAN#<ts>"`, `SK: "SCAN"`; **no `GSI1PK`** (so the corpus GSI1 scan never
  sees it) and `et: "Scan"` (∉ `{Case, CaseChunk}`).
- `GSI2PK: "SCAN#ALL"`, `GSI2SK: <ts>` for descending listing.
- Fields: `ts`, `windowDays`, `scanned`, `added`, `newCitations` (string[]).
- `writeScan(report)` and `listScans(limit)` (Query GSI2 `SCAN#ALL`, newest first).
  Its own repo — does **not** extend `CaseRepo`.

### 3. Scheduled function — `src/functions/case-monitor.ts` + `sst.config.ts`

```ts
export const handler = async () => {
  const windowDays = Number(process.env.SCAN_WINDOW_DAYS ?? "90");
  const report = await scanRecent(windowDays);
  await writeScan(report);
  console.log(`[monitor] scanned ${report.scanned} · added ${report.added}`);
};
```

SST:
```ts
new sst.aws.Cron("CaseMonitor", {
  schedule: "rate(7 days)",
  function: {
    handler: "src/functions/case-monitor.handler",
    timeout: "300 seconds",
    memory: "512 MB",
    environment: { CASES_TABLE: "LegalCases", SCAN_WINDOW_DAYS: "90" },
    permissions: [{
      actions: ["dynamodb:Query", "dynamodb:PutItem"],
      resources: ["arn:aws:dynamodb:us-east-1:*:table/LegalCases", "arn:aws:dynamodb:us-east-1:*:table/LegalCases/index/*"],
    }],
  },
});
```
**No `bedrockPerms`** — detection-only, no LLM. Deploys automatically via the
push-to-main `sst deploy`.

### 4. Surface — `src/app/cases/monitoring/page.tsx` (new) + nav

RSC page (zero client JS): `listScans(20)` → a table of recent scans (date, window,
scanned, **added**), and for the latest scans, the `newCitations` list with a
"newly detected · pending enrichment" badge; each citation links to `/cases/<id>`
if that case now exists. A nav link in `src/app/cases/layout.tsx`. A short line
frames it: "New cases are detected automatically and enter as substrate; promotion
and enrichment are a reviewed step." Methodology page gains a matching note.

## Governance

- **Additive, detection-only:** the monitor only conditionally inserts new substrate
  records and writes a scan report — it never overwrites, promotes, embeds, or
  rebuilds the artifact. No unattended LLM; no auto-mutation of production search.
- **Corpus-invisible meta items:** `SCAN#` items have no `GSI1PK` and a non-case
  `et`, so they never appear in browse/search/facets (same guarantee as `BRIEF#`).
- **Review preserved:** newly-detected cases sit in substrate (excluded from default
  core-only browse) until a human runs the enrichment ops the delta points to —
  consistent with the "宁缺毋滥" + credentialed-enrichment discipline.
- Public court records (A2AJ open data); no new sources, no CanLII.

## Testing (offline, TDD)

`scripts/test-cases-monitor.ts` (node:assert/strict, async IIFE):
- **`scanRecent` additive tally:** injected harvest returns 3 records; injected
  `send` throws `ConditionalCheckFailedException` for one existing citation and
  resolves for two → `{ scanned: 3, added: 2 }` and `newCitations` lists the two;
  a non-conditional `send` error propagates.
- **`SCAN#` item shape:** `writeScan` builds an item with no `GSI1PK`, `et:"Scan"`,
  `GSI2PK:"SCAN#ALL"`; `listScans` (injected query) returns newest-first.
- **`harvest.ts` best-effort cache:** with a stubbed fs whose `writeFile` throws
  EROFS, `cached()` still returns the computed value (warns, doesn't throw).
- `npm run typecheck` clean; `npm run build` compiles (the new page renders).
  **`npm run verify` NOT run.**

## Operational / deploy

- Merged to main → `sst deploy` provisions the `CaseMonitor` Cron automatically.
- First run visible in CloudWatch logs and on `/cases/monitoring`. A scan can be
  triggered on demand for the demo by invoking the function (or temporarily setting
  `rate(1 day)`), then reverting.
- When a scan reports new cases, the human enrichment sequence is the existing
  `cases:fetch-fulltext` → `cases:embed:bedrock:cloud` → `cases:index-build:cloud`
  (+ the derived-layer refresh: summaries / figures / nations) — the same steps used
  after any corpus growth.

## Success criteria

- **Offline:** scan/repo/cache tests green; typecheck + build clean; `CaseRepo`
  untouched (parity intact).
- **Deployed:** the weekly Cron runs, additively records only genuinely-new cases,
  and `/cases/monitoring` shows recent scans + newly-detected cases with the
  pending-enrichment framing; no promotion/artifact mutation happens automatically.
