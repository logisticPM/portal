# Cases Read-Path at Scale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/cases`, `/cases/methodology`, `/cases/activation` render in seconds (not ~3 minutes) over the real local corpus, by having `scanAll()` scan the profiles-only GSI1 instead of the full base table.

**Architecture:** Every list/stats/facets/activation path goes through `scanAll()`, which today base-table-`Scan`s all ~43k items (incl. ~160 MB of chunk vectors) and keeps only the ~3,489 `Case` profiles. GSI1 (already defined, `ProjectionType: ALL`) is projected **only** for profile items (chunk items lack `GSI1PK`/`GSI1SK`), so scanning GSI1 returns the same profiles with none of the chunk/vector payload. One-line access-pattern change; no schema change, no migration.

**Tech Stack:** TypeScript, `@aws-sdk/lib-dynamodb`, DynamoDB Local (Docker, :8000), `tsx` standalone tests.

Spec: `docs/specs/2026-07-02-cases-readpath-scale-design.md`.

Conventions: standalone `npx tsx scripts/test-cases-*.ts` tests, async-IIFE (repo not ESM), `node:assert/strict`, always `npm run typecheck`. Corpus must be loaded in DynamoDB Local (`npm run cases:ingest && npm run cases:fetch-fulltext` if `LegalCases` has only a handful of items).

---

### Task 1: Scan GSI1 in `scanAll` (profiles-only) + parity test

**Files:**
- Create: `scripts/test-cases-readpath.ts`
- Modify: `src/lib/cases/repo.dynamo.ts` (the `scanAll` function, ~lines 15-24)

- [ ] **Step 1: Write the parity test**

This test proves the GSI1 access pattern returns the SAME set of `Case` profiles as the
old base-table filter — the invariant the change depends on. It is fast: the base count
uses `Select: "COUNT"` (no item payload transferred), and GSI1 holds only ~3,489 profiles.

Create `scripts/test-cases-readpath.ts`:

```ts
// Integration test (needs the full local corpus in DynamoDB Local): scanning GSI1
// returns exactly the set of Case profiles the old base-table filter did. Fast — the
// base count is a COUNT scan (no payload), GSI1 holds only profiles.
import assert from "node:assert/strict";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

// Count Case items on the base table WITHOUT transferring item data (Select COUNT).
async function baseCaseCount(): Promise<number> {
  let n = 0;
  let start: Record<string, any> | undefined;
  do {
    const r = await ddbDoc.send(new ScanCommand({
      TableName: TABLE,
      Select: "COUNT",
      FilterExpression: "#et = :c",
      ExpressionAttributeNames: { "#et": "et" },
      ExpressionAttributeValues: { ":c": "Case" },
      ExclusiveStartKey: start,
    }));
    n += r.Count ?? 0;
    start = r.LastEvaluatedKey;
  } while (start);
  return n;
}

// Scan GSI1 → the profile ids it projects (with their full `data`).
async function gsi1Profiles(): Promise<{ ids: Set<string>; sampleHasData: boolean }> {
  const ids = new Set<string>();
  let sampleHasData = false;
  let start: Record<string, any> | undefined;
  do {
    const r = await ddbDoc.send(new ScanCommand({ TableName: TABLE, IndexName: "GSI1", ExclusiveStartKey: start }));
    for (const it of r.Items ?? []) {
      assert.equal(it.et, "Case", `GSI1 returned a non-Case item (et=${it.et}) — chunks should not be projected`);
      ids.add(String(it.data?.id));
      if (it.data?.id) sampleHasData = true;
    }
    start = r.LastEvaluatedKey;
  } while (start);
  return { ids, sampleHasData };
}

(async () => {
  const [baseN, { ids, sampleHasData }] = await Promise.all([baseCaseCount(), gsi1Profiles()]);
  assert.ok(baseN > 3000, `expected >3000 Case profiles, base COUNT found ${baseN} — is the full corpus loaded?`);
  assert.equal(ids.size, baseN, `GSI1 profile count ${ids.size} != base-table Case count ${baseN}`);
  assert.ok(sampleHasData, "GSI1 items are missing the `data` attribute (projection not ALL?)");
  assert.ok(ids.has("2004-scc-73"), "known case 2004-scc-73 missing from GSI1 scan");
  console.log(`✅ read-path parity: base=${baseN} · GSI1=${ids.size} (identical) · data present · known case present`);
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the parity test — it should PASS now (validates the DB access pattern, independent of `scanAll`)**

Run: `cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases npx tsx scripts/test-cases-readpath.ts`
(in bash you may instead inline: `DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases npx tsx scripts/test-cases-readpath.ts`)
Expected: `✅ read-path parity: base=<N> · GSI1=<N> (identical) · data present · known case present`, with N ≈ 3,489.

If it fails with `base COUNT found <small number>`, the corpus isn't loaded — run
`npm run cases:ingest && npm run cases:fetch-fulltext` first, then re-run.

- [ ] **Step 3: Change `scanAll` to scan GSI1**

In `src/lib/cases/repo.dynamo.ts`, replace the `scanAll` body:

```ts
async function scanAll(): Promise<LegalCase[]> {
  const out: LegalCase[] = [];
  let start: Record<string, any> | undefined;
  do {
    // Scan GSI1, not the base table: only Case profiles are projected into GSI1
    // (chunk items lack GSI1PK/SK), so this reads the ~3.5k small profiles instead of
    // the full ~43k-item table with ~160MB of chunk vectors we would only discard.
    // Turns a ~3-minute list/stats page into a few seconds. (GSI1 projection is ALL,
    // so `data` — which itemToCase reads — is present.)
    const r = await ddbDoc.send(new ScanCommand({ TableName: TABLE, IndexName: "GSI1", ExclusiveStartKey: start }));
    for (const it of r.Items ?? []) if (it.et === "Case") out.push(itemToCase(it));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Golden equivalence still holds (dynamo ≡ mock)**

This requires DynamoDB Local up. `npm run verify` re-seeds the 4 fixtures and checks
`dynamo ≡ mock`. NOTE: `verify` resets `LegalCases` to the 4 fixtures — so run it, but be
aware you must reload the full corpus afterward (`npm run cases:ingest && npm run cases:fetch-fulltext`) before the perf check in Task 2.

Run: `npm run verify`
Expected: all checks pass (the cases-hybrid section green), `dynamo ≡ mock` holds — the
fixtures also carry `GSI1PK`, so `scanAll` finds them via GSI1 exactly as before.

- [ ] **Step 6: Commit**

```bash
git add scripts/test-cases-readpath.ts src/lib/cases/repo.dynamo.ts
git commit -m "perf(cases): scanAll reads GSI1 (profiles-only) — list/stats pages seconds not minutes"
```

---

### Task 2: Perf verification over the real corpus

**Files:** none (verification only; record the result in the spec if useful).

**Precondition:** the FULL corpus is loaded again (Task 1 Step 5's `verify` reset it to 4 fixtures). Reload if needed: `npm run cases:ingest && npm run cases:fetch-fulltext`. Ensure only ONE Next dev server runs against this repo (two `next dev` share `.next` and interfere).

- [ ] **Step 1: Time `scanAll` over the real corpus**

Create nothing — use a one-off timing via the repo. Run:
```bash
DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo npx tsx -e "import('./src/lib/cases').then(async ({ casesRepo }) => { const t = Date.now(); const s = await casesRepo.getCorpusStats(); console.log('getCorpusStats', s.total, 'cases in', Date.now() - t, 'ms'); })"
```
Expected: prints `getCorpusStats <~3489> cases in <a few thousand> ms` — i.e. **seconds**, not ~180,000 ms. If it is still tens of seconds+, stop and report (the GSI scan may need a follow-up, e.g. narrowing the projected attributes).

- [ ] **Step 2: Render the pages (needs a session cookie; mock auth, no password)**

Start one dev server: `REPO_IMPL=dynamo DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases npx next dev -p 3000`. Then, with `MSYS_NO_PATHCONV=1` (git-bash), confirm each renders in seconds:
```bash
for p in /cases /cases/activation /cases/methodology; do curl -s -L -o /dev/null -w "$p -> HTTP %{http_code} %{time_total}s\n" --max-time 60 -b "portal_session=indigenomics" "http://localhost:3000$p"; done
```
Expected: all `HTTP 200` in single-digit seconds (first hit includes route compile).

- [ ] **Step 3: Record the before/after (optional, 2 lines)**

If useful for the capstone write-up, append a line to
`docs/specs/2026-07-02-cases-readpath-scale-design.md` under a `## Result` heading noting
the measured before (~180 s) → after (the seconds figure). Commit only if you add it:
```bash
git add docs/specs/2026-07-02-cases-readpath-scale-design.md
git commit -m "docs(cases): record read-path before/after timing"
```

---

## Notes for the implementer
- The whole change is offline (no AWS creds). It operates on the LOCAL corpus; the same
  code applies to the cloud table later (GSI1 exists there too) — no code difference.
- Do NOT touch `query.ts`, `hybridRank`, `getSearchIndex`, or the mock repo — behavior
  must stay identical; this is a pure access-pattern (perf) change.
- If `npm run verify` leaves the table as 4 fixtures, reload the corpus before Task 2.
