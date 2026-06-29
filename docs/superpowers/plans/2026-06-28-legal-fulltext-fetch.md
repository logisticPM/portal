# Substrate Full-Text Fetch (Phase 2-B.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the ~3485 A2AJ substrate records from metadata-only to full-text by fetching `unofficial_text_en` per case, then re-run core promotion on the real text.

**Architecture:** Pure additive to the `cases` domain. A pure `applyFullText(case, text)` (unit-tested) does the chunk/flag update; a rate-limited, cached, resumable `cases:fetch-fulltext` script drives it over the substrate; the existing promotion loop is factored into `promoteSubstrate()` so a new `cases:promote` can re-run it on the now-full-text substrate. `CaseRepo`/pages unchanged.

**Tech Stack:** TypeScript, AWS DynamoDB (`@aws-sdk/lib-dynamodb`), DynamoDB Local (Docker, :8000), Node 24 global fetch (via `scripts/fetch-polyfill.ts`), tsx assertion scripts (no vitest).

**Spec:** `docs/specs/2026-06-28-fulltext-fetch-design.md`. **Conventions:** mirror existing `src/lib/cases/ingest/*` and `scripts/cases-ingest.ts`.

---

## File structure (locked)

```
src/lib/cases/ingest/
  harvest.ts      # MODIFY: rate-limit fetchCitation (sleep on cache miss)        (Task 1)
  fulltext.ts     # CREATE (pure): applyFullText(case, text)                       (Task 2)
scripts/
  test-cases-fulltext.ts  # CREATE: applyFullText unit test                        (Task 2)
  cases-ingest.ts         # MODIFY: extract exported promoteSubstrate()            (Task 3)
  cases-fetch-fulltext.ts # CREATE: fetch full text over substrate (live)          (Task 4)
  cases-promote.ts        # CREATE: re-run promotion over current substrate (live) (Task 4)
package.json              # MODIFY: cases:fetch-fulltext + cases:promote scripts   (Task 4)
```

---

## Task 1: Rate-limit `fetchCitation`

**Files:**
- Modify: `src/lib/cases/ingest/harvest.ts`

- [ ] **Step 1: Edit `fetchCitation` in `src/lib/cases/ingest/harvest.ts`**

Replace:
```ts
export async function fetchCitation(citation: string): Promise<A2ajRecord | null> {
  return cached(`fetch_${citation}`, () => fetchA2aj(citation));
}
```
with (adds the existing `sleep(SLEEP_MS)` on cache miss only — `cached` skips the fn on a hit, so cached re-runs stay fast):
```ts
export async function fetchCitation(citation: string): Promise<A2ajRecord | null> {
  return cached(`fetch_${citation}`, async () => {
    const r = await fetchA2aj(citation);
    await sleep(SLEEP_MS);
    return r;
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/cases/ingest/harvest.ts
git commit -m "feat(cases): rate-limit fetchCitation for the full-text fetch pass"
```

---

## Task 2: `applyFullText` (pure) + test

**Files:**
- Create: `src/lib/cases/ingest/fulltext.ts`
- Test: `scripts/test-cases-fulltext.ts`

- [ ] **Step 1: Write the failing test `scripts/test-cases-fulltext.ts`**

```ts
import assert from "node:assert/strict";
import { applyFullText } from "../src/lib/cases/ingest/fulltext";
import { caseFixtures } from "../src/lib/cases/fixtures";

// a metadata-only substrate stub: no chunks, fullTextAvailable false
const base = { ...caseFixtures[0], chunks: undefined, fullTextAvailable: false } as const;

// with text → chunks populated, flag set, input NOT mutated
const out = applyFullText(base, "Para one text.\n\nPara two text.");
assert.equal(out.fullTextAvailable, true, "flag set");
assert.equal(out.chunks?.length, 2, "two paragraph chunks");
assert.equal(out.chunks?.[0].paragraph, "para-1");
assert.equal(base.fullTextAvailable, false, "input not mutated");

// empty/whitespace text → unchanged stub, flag stays false, no chunks
const empty = applyFullText(base, "   ");
assert.equal(empty.fullTextAvailable, false, "empty text stays unavailable");
assert.equal(empty.chunks, undefined, "no chunks on empty text");

console.log("✅ fulltext tests passed");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/test-cases-fulltext.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/ingest/fulltext'`.

- [ ] **Step 3: Implement `src/lib/cases/ingest/fulltext.ts`**

```ts
// Pure: populate a substrate record with fetched full text (spec §3). No mutation.
// Empty text → record stays a metadata stub (some A2AJ /fetch return no text).
import { chunkText } from "./a2aj";
import type { LegalCase } from "../types";

export function applyFullText(c: LegalCase, text: string): LegalCase {
  const t = (text ?? "").trim();
  if (!t) return { ...c, fullTextAvailable: false };
  return { ...c, chunks: chunkText(t), fullTextAvailable: true };
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx tsx scripts/test-cases-fulltext.ts && npm run typecheck`
Expected: PASS — `✅ fulltext tests passed`, typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/ingest/fulltext.ts scripts/test-cases-fulltext.ts
git commit -m "feat(cases): applyFullText pure updater + tests"
```

---

## Task 3: Extract `promoteSubstrate()` (DRY)

**Files:**
- Modify: `scripts/cases-ingest.ts`

- [ ] **Step 1: Refactor `scripts/cases-ingest.ts`** — extract the promotion loop into an exported `promoteSubstrate()`, and have `ingest()` call it. Replace the current `ingest()` function (the one that builds `prisma`, loops over `substrate`, pushes `core`, writes prisma) with these two functions:

```ts
export async function promoteSubstrate(substrate: LegalCase[]): Promise<{ core: LegalCase[]; prisma: ReturnType<typeof emptyPrisma> }> {
  const prisma = emptyPrisma();
  prisma.identified = substrate.length;
  prisma.deduped = substrate.length;
  const core: LegalCase[] = [];
  for (const c of substrate) {
    prisma.screened++;
    const enr = enrichment[c.citation];
    if (enr) {
      core.push({ ...c, ...enr, corpusTier: "core", enrichmentLevel: "deep",
        labelMeta: { method: "curated", confidence: "high", needsReview: false } });
      prisma.included++;
      continue;
    }
    const verdict = includeCandidate(c);
    if (!verdict.include) { tallyExclude(prisma, verdict.reason ?? "unknown"); continue; }
    let labeled;
    try {
      const text = [c.styleOfCause, ...(c.chunks?.map((x) => x.text) ?? [])].join(" ");
      labeled = await labelCase(text);
    } catch {
      continue; // no LLM models configured → leave in substrate
    }
    core.push({ ...c, themes: labeled.themes as Theme[], corpusTier: "core", labelMeta: labeled.labelMeta });
    prisma.included++;
  }
  return { core, prisma };
}

export async function ingest() {
  const raw = await gatherRaw();
  const substrate: LegalCase[] = raw.map((r) => ({ ...a2ajToCase(r), corpusTier: "substrate" }));
  await upsert(substrate);
  const { core, prisma } = await promoteSubstrate(substrate);
  await upsert(core);
  await fs.writeFile("scripts/.cache/prisma.json", JSON.stringify(prisma, null, 2));
  console.log(`✅ substrate ${substrate.length} · core ${core.length} · excluded ${substrate.length - core.length}`);
  console.log("PRISMA:", JSON.stringify(prisma.excluded));
}
```
(Keep all existing imports, `gatherRaw`, `upsert`, the `fetch-polyfill` import, and the `if (require.main === module) ingest()...` line unchanged.)

- [ ] **Step 2: Confirm `ingest()` behavior is unchanged**

Run: `npm run typecheck`
Expected: exit 0. (Behavior is byte-equivalent — the loop body is identical, just relocated.)

- [ ] **Step 3: Commit**

```bash
git add scripts/cases-ingest.ts
git commit -m "refactor(cases): extract promoteSubstrate() for reuse by cases:promote"
```

---

## Task 4: Fetch-fulltext + promote scripts

**Files:**
- Create: `scripts/cases-fetch-fulltext.ts`
- Create: `scripts/cases-promote.ts`
- Modify: `package.json`

- [ ] **Step 1: Implement `scripts/cases-fetch-fulltext.ts`**

```ts
// Live: fetch full text for substrate records lacking it. Idempotent (skips records
// already fullTextAvailable), rate-limited (fetchCitation sleeps), cached + resumable.
// Flushes to DynamoDB every batch so partial progress persists across re-runs.
import "./fetch-polyfill";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { toCaseItem } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { fetchCitation } from "../src/lib/cases/ingest/harvest";
import { applyFullText } from "../src/lib/cases/ingest/fulltext";
import type { LegalCase } from "../src/lib/cases/types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

async function flush(batch: LegalCase[]) {
  for (let i = 0; i < batch.length; i += 25)
    await ddbDoc.send(new BatchWriteCommand({
      RequestItems: { [TABLE]: batch.slice(i, i + 25).map((c) => ({ PutRequest: { Item: toCaseItem(c) } })) },
    }));
}

async function main() {
  const subs = await dynamoCaseRepo.listCases({ tier: "substrate" });
  const todo = subs.filter((c) => !c.fullTextAvailable);
  console.log(`full text: ${todo.length} of ${subs.length} substrate records need fetching`);
  let done = 0, withText = 0, batch: LegalCase[] = [];
  for (const c of todo) {
    const rec = await fetchCitation(c.citation);
    const updated = applyFullText(c, rec?.unofficial_text_en ?? "");
    if (updated.fullTextAvailable) withText++;
    batch.push(updated);
    if (++done % 100 === 0) { await flush(batch); batch = []; console.log(`  ${done}/${todo.length} (with text: ${withText})`); }
  }
  if (batch.length) await flush(batch);
  console.log(`✅ full text applied to ${done} records (${withText} got text, ${done - withText} had none)`);
}
main().catch((e) => { console.error("❌ cases-fetch-fulltext failed:", e); process.exit(1); });
```

- [ ] **Step 2: Implement `scripts/cases-promote.ts`**

```ts
// Live: re-run core promotion over the current substrate (no re-harvest). Uses the
// shared promoteSubstrate() so logic matches cases:ingest exactly.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { toCaseItem } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { promoteSubstrate } from "./cases-ingest";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

async function main() {
  const substrate = await dynamoCaseRepo.listCases({ tier: "substrate" });
  const { core, prisma } = await promoteSubstrate(substrate);
  for (let i = 0; i < core.length; i += 25)
    await ddbDoc.send(new BatchWriteCommand({
      RequestItems: { [TABLE]: core.slice(i, i + 25).map((c) => ({ PutRequest: { Item: toCaseItem(c) } })) },
    }));
  await fs.writeFile("scripts/.cache/prisma.json", JSON.stringify(prisma, null, 2));
  console.log(`✅ promoted: core ${core.length} of ${substrate.length} substrate · excluded ${substrate.length - core.length}`);
  console.log("PRISMA:", JSON.stringify(prisma.excluded));
}
main().catch((e) => { console.error("❌ cases-promote failed:", e); process.exit(1); });
```

- [ ] **Step 3: Add npm scripts to `package.json`** (in `"scripts"`, mirroring `cases:ingest`):

```json
"cases:fetch-fulltext": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-fetch-fulltext.ts",
"cases:promote": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-promote.ts"
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Live run (DynamoDB Local up; substrate must exist — run `cases:ingest` first if the table is empty)**

```bash
npm run ddb:up
npm run cases:create
# If the table has no substrate yet (fresh table), populate it first:
#   npm run cases:ingest        # lands ~3485 substrate (cached harvest = fast)
npm run cases:fetch-fulltext    # fetch full text (resumable; re-run if it times out)
npm run cases:promote           # re-run promotion on full-text substrate
```
Expected: `cases:fetch-fulltext` prints progress and a final `✅ full text applied to N records (M got text...)`; `cases:promote` prints `✅ promoted: core <K> of <N> substrate` where **K is substantially higher than the pre-full-text core** and the PRISMA `no_indigenous_signal` count drops sharply (the ~94% false-exclusion resolves because the filter now sees real text). Re-running `cases:fetch-fulltext` is fast (cache hits) and a no-op for already-full-text records.

- [ ] **Step 6: Independently confirm full text landed**

Run a tsx one-liner (`DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo`):
```ts
import('./src/lib/cases/repo.dynamo').then(async (m) => {
  const subs = await m.dynamoCaseRepo.listCases({ tier: "substrate" });
  const ft = subs.filter((c) => c.fullTextAvailable).length;
  console.log(`substrate ${subs.length} · fullTextAvailable ${ft} · chunked ${subs.filter(c=>c.chunks?.length).length}`);
});
```
Expected: `fullTextAvailable` is the large majority of substrate (a few may legitimately have no `/fetch` text).

- [ ] **Step 7: Commit**

```bash
git add scripts/cases-fetch-fulltext.ts scripts/cases-promote.ts package.json
git commit -m "feat(cases): cases:fetch-fulltext + cases:promote (substrate full-text pass)"
```

---

## Task 5: Regression + datasheet refresh

**Files:** (no source changes — verification + regenerated artifact)

- [ ] **Step 1: Full regression**

Run: `npm run verify`
Expected: all checks green (the new scripts don't touch the seam or existing checks; `verify` reseeds its own golden state). 0 failures.

- [ ] **Step 2: Regenerate the datasheet** (now reflects full-text substrate + accurate PRISMA)

Run: `npm run cases:datasheet`
Expected: `✅ wrote docs/research/cases-datasheet.md`; open it — the PRISMA `no_indigenous_signal` count is much lower than before and core count is higher.

- [ ] **Step 3: Commit the refreshed datasheet**

```bash
git add docs/research/cases-datasheet.md
git commit -m "docs(cases): refresh datasheet after full-text fetch (accurate PRISMA)"
```

---

## Final verification
- [ ] **Unit suite:** `npx tsx scripts/test-cases-fulltext.ts` → `✅`; plus the existing `test-cases-*` all still green.
- [ ] **Regression:** `npm run verify` → 0 failures.
- [ ] **Typecheck:** `npm run typecheck` → exit 0.
- [ ] **Live DoD:** substrate `fullTextAvailable` is the large majority; `cases:promote` core count is materially higher than pre-full-text; PRISMA `no_indigenous_signal` dropped sharply.

## Notes for the implementer
- `cases:fetch-fulltext` is resumable: it only fetches records where `fullTextAvailable===false`, and `fetchCitation` is disk-cached — re-run after any timeout. With ~3485 records and a 150 ms sleep, the first full pass is ~20–30 min; budget a generous Bash timeout and re-run as needed.
- Non-flagship cases still need `LABEL_MODELS` to get themes during promotion; without keys they pass the inclusion filter but the label step `continue`s (stays substrate). That's expected — the win here is the now-accurate inclusion/PRISMA on real text, not full labeling.
- `promoteSubstrate` is the single source of promotion logic — do not duplicate it in `cases-promote.ts`; import it from `cases-ingest.ts`.
