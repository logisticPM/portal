# Eval Measures Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `cases:eval` score the artifact-backed searcher production actually queries, and make a measurement that measured nothing abort instead of printing a scorecard of zeros.

**Architecture:** Three changes. `cases-eval.ts` ranks through `rankWithSearcher(idx.searcher, …)` instead of `hybridRank(idx.units, …)`. A new pure module `src/lib/cases/validate/eval-guards.ts` decides whether a run measured anything, so the decision is testable offline without running the script. `build-index.ts` exposes the artifact `buildId` so the report can state its provenance and age.

**Tech Stack:** TypeScript (strict), `tsx` scripts, `node:assert/strict` offline tests, S3 index artifact, DynamoDB.

**Spec:** `docs/superpowers/specs/2026-08-02-eval-measures-production-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/cases/validate/eval-guards.ts` | **New.** Pure: given evidence about a run, is the result meaningful? | Create |
| `scripts/test-cases-eval-guards.ts` | **New.** Offline tests for the guard + a stub `Searcher`. | Create |
| `src/lib/cases/search/build-index.ts` | Loads the index. | Add `buildId` to `SearchIndex` |
| `scripts/cases-eval.ts` | The eval runner. | Rank via searcher; call the guard; report provenance |
| `package.json` | npm scripts. | `cases:eval:cloud` gets `INDEX_BUCKET`; add `cases:eval:scan` |

The guard is a separate pure module rather than an inline `if` in the script for one reason: a script that ends in `run()` cannot be imported without executing, so an inline guard could only be tested by running the whole eval against real data — which is exactly the thing that is slow and credential-bound.

---

### Task 1: Expose the artifact build id

**Files:**
- Modify: `src/lib/cases/search/build-index.ts`

- [ ] **Step 1: Add the field to the interface**

In `src/lib/cases/search/build-index.ts`, in `export interface SearchIndex`, add after `source`:

```ts
  buildId: string | null;        // artifact build id; null on the scan path
```

- [ ] **Step 2: Populate it on both paths**

Artifact path — find the line beginning `cached = { units: [], cases: loaded.cases,` and add `buildId: loaded.buildId,` before `};`:

```ts
      cached = { units: [], cases: loaded.cases, embedderId: loaded.embedderId, vdim: loaded.vdim, searcher: loaded.searcher, source: "artifact", buildId: loaded.buildId };
```

Scan path — find the line beginning `cached = { units, cases, embedderId, vdim, searcher: makeInMemorySearcher(units),`:

```ts
  cached = { units, cases, embedderId, vdim, searcher: makeInMemorySearcher(units), source: "scan", buildId: null };
```

`null` rather than a synthesised id: the scan path has no build, and inventing one would let a scan run be reported as if it came from an artifact.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean. If another construction site of `SearchIndex` errors, add `buildId` there too rather than making the field optional — optional would let a future path silently omit it.

- [ ] **Step 4: Commit**

```bash
git add src/lib/cases/search/build-index.ts
git commit -m "feat(search): expose artifact buildId on SearchIndex"
```

---

### Task 2: The guard — refuse to report a measurement of nothing

**Files:**
- Create: `src/lib/cases/validate/eval-guards.ts`
- Test: `scripts/test-cases-eval-guards.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-eval-guards.ts`:

```ts
import assert from "node:assert/strict";
import { evalAbortReason, type EvalEvidence } from "../src/lib/cases/validate/eval-guards";

const base: EvalEvidence = { caseCount: 5453, emptyRankedLists: 0, totalRankedLists: 54, metrics: [0.403, 0.516, 0.523] };

// A healthy run passes.
assert.equal(evalAbortReason(base), null);

// An empty index cannot score anything, and this is checked before the others so the
// message names the actual cause rather than the symptom.
{
  const r = evalAbortReason({ ...base, caseCount: 0 });
  assert.ok(r, "empty index must abort");
  assert.match(r!, /index is empty/i);
}

// Every ranked list empty — the retriever returned nothing for any query.
{
  const r = evalAbortReason({ ...base, emptyRankedLists: 54, metrics: [0, 0, 0] });
  assert.ok(r, "an all-empty retriever must abort");
  assert.match(r!, /every ranked list/i);
  assert.doesNotMatch(r!, /every metric/i, "the more specific cause wins");
}

// Lists are non-empty but disjoint from every judgment: a different bug, same signature.
{
  const r = evalAbortReason({ ...base, emptyRankedLists: 0, metrics: [0, 0, 0, 0] });
  assert.ok(r, "an all-zero scorecard must abort");
  assert.match(r!, /every metric/i);
}

// THE REGRESSION THAT MATTERS: a genuinely bad retriever still reports its bad numbers.
// The guards exist to catch "measured nothing", never to turn "retrieval is poor" into a
// crash — that would hide the very result the eval is for.
assert.equal(evalAbortReason({ ...base, metrics: [0.02, 0, 0.01] }), null,
  "one zero among non-zeros is a real (bad) score, not a broken instrument");
assert.equal(evalAbortReason({ ...base, emptyRankedLists: 53, totalRankedLists: 54, metrics: [0.01, 0, 0] }), null,
  "53 of 54 empty is terrible retrieval, but it IS a measurement");

// Degenerate inputs must not abort on arithmetic alone.
assert.equal(evalAbortReason({ ...base, totalRankedLists: 0, emptyRankedLists: 0 }), null,
  "no lists at all is not the same as all lists empty");
assert.equal(evalAbortReason({ ...base, metrics: [] }), null,
  "no metrics collected yet is not an all-zero scorecard");

console.log("✅ test-cases-eval-guards passed");
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx tsx scripts/test-cases-eval-guards.ts
```

Expected: FAIL — `eval-guards` does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/cases/validate/eval-guards.ts`:

```ts
// Did the eval measure anything at all?
//
// On 2026-08-02 the runner printed a complete scorecard of zeros and exited 0, because it
// ranked against an empty unit list. Every number was arithmetically correct and
// collectively meaningless. A zero has to be EARNED — a retriever that misses every judged
// case — not defaulted to by an instrument with no input.
//
// Pure and separately importable: cases-eval.ts ends in run(), so an inline guard could
// only be exercised by running the whole credentialed eval.
export interface EvalEvidence {
  caseCount: number;          // cases in the loaded index
  emptyRankedLists: number;   // (query, mode) pairs that returned []
  totalRankedLists: number;   // (query, mode) pairs attempted
  metrics: number[];          // every aggregate metric about to be printed
}

export function evalAbortReason(e: EvalEvidence): string | null {
  if (e.caseCount === 0) {
    return "index is empty (0 cases) — nothing to score. Check INDEX_BUCKET/INDEX_FILE and CASES_TABLE.";
  }
  // Ordered before the all-zero check so the message names the cause rather than the
  // symptom; the all-zero check would also fire here and say less.
  if (e.totalRankedLists > 0 && e.emptyRankedLists === e.totalRankedLists) {
    return `every ranked list came back empty (${e.emptyRankedLists}/${e.totalRankedLists}) — the retriever found nothing for any query. ` +
      "This is a broken index, not a score of zero.";
  }
  if (e.metrics.length > 0 && e.metrics.every((m) => m === 0)) {
    return "every metric is exactly 0 across every mode — the ranked lists share nothing with any judgment. " +
      "A real corpus cannot miss all judged cases in all modes; suspect the instrument, not the retriever.";
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx tsx scripts/test-cases-eval-guards.ts
```

Expected: `✅ test-cases-eval-guards passed`

**If the "genuinely bad retriever" assertions fail, do NOT relax them.** They are the reason the guard is narrow. A guard that fires on poor retrieval destroys the eval's purpose.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/validate/eval-guards.ts scripts/test-cases-eval-guards.ts
git commit -m "feat(eval): abort when a run measured nothing, never on a merely bad score"
```

---

### Task 3: Score the searcher, wire the guard, report provenance

**Files:**
- Modify: `scripts/cases-eval.ts`

- [ ] **Step 1: Swap the imports**

Replace:

```ts
import { hybridRank, type RetrievalUnit } from "../src/lib/cases/search/hybrid";
```

with:

```ts
import { rankWithSearcher, type Searcher } from "../src/lib/cases/search/hybrid";
import { evalAbortReason } from "../src/lib/cases/validate/eval-guards";
```

- [ ] **Step 2: Rank through the searcher**

Replace the whole `rankBoth` function (its comment block included) with:

```ts
// Rank a query two ways through the SAME searcher production uses: BM25-only (null vec)
// and hybrid (query vec, only when the active embedder matches the stored vectors).
//
// Takes a Searcher, not RetrievalUnit[]. `idx.units` is documented empty on the artifact
// path, so ranking against it scored an empty corpus and reported zeros; and even on the
// scan path it rebuilds an in-process index with full-precision cosine, which is not the
// int8-rescored artifact searcher a user's query actually hits.
async function rankBoth(
  s: Searcher, query: string, embedder: Embedder,
  embedderId: string | null, vdim: number | null,
): Promise<{ bm25: string[]; hybrid: string[]; denseOn: boolean }> {
  const bm25 = rankWithSearcher(s, query, null).map((r) => r.caseId);
  let queryVec: Float32Array | null = null;
  if (embedderId && embedderId === embedder.id && vdim === embedder.dim)
    queryVec = (await embedder.embed([query]))[0];
  const hybrid = rankWithSearcher(s, query, queryVec).map((r) => r.caseId);
  return { bm25, hybrid, denseOn: queryVec !== null };
}
```

- [ ] **Step 3: Declare the counters (before the loop that uses them)**

In `scoreMode`, immediately after the line `let denseAny = false;`, add:

```ts
  let emptyLists = 0, totalLists = 0;
```

- [ ] **Step 4: Update both call sites**

In `scoreMode`, replace:

```ts
    const { bm25, hybrid, denseOn } = await rankBoth(idx.units, g.query, embedder, idx.embedderId, idx.vdim);
```

with:

```ts
    const { bm25, hybrid, denseOn } = await rankBoth(idx.searcher, g.query, embedder, idx.embedderId, idx.vdim);
    emptyLists += (bm25.length === 0 ? 1 : 0) + (hybrid.length === 0 ? 1 : 0);
    totalLists += 2;
```

In `poolMode`, replace:

```ts
    const { bm25, hybrid } = await rankBoth(idx.units, q.query, embedder, idx.embedderId, idx.vdim);
```

with:

```ts
    const { bm25, hybrid } = await rankBoth(idx.searcher, q.query, embedder, idx.embedderId, idx.vdim);
```

- [ ] **Step 5: Report provenance, then guard, then print**

In `scoreMode`, replace the single line:

```ts
  console.log(`gold=${gold.length} queries · embedder=${idx.embedderId ?? "(none)"} · dense=${denseAny ? "ON" : "SKIPPED (no matching vectors)"}`);
```

with:

```ts
  // Which index produced these numbers. The two sources are no longer interchangeable —
  // artifact means the int8-rescored searcher users query; scan means an in-process rebuild
  // at full precision. A report that does not say which is not comparable to any other.
  const built = idx.buildId ? Number(idx.buildId.split("-")[0]) : NaN;
  const builtAt = Number.isFinite(built) ? new Date(built).toISOString().slice(0, 10) : "unknown";
  const newer = Number.isFinite(built)
    ? [...idx.cases.values()].filter((c) => Date.parse(c.provenance?.ingestedAt ?? "") > built).length
    : 0;
  console.log(`index: source=${idx.source}${idx.buildId ? ` build=${idx.buildId} (${builtAt})` : ""} cases=${idx.cases.size}`);
  if (newer > 0)
    console.log(`⚠ ${newer} case(s) were ingested AFTER this artifact was built — the numbers below describe a stale corpus snapshot.`);
  console.log(`gold=${gold.length} queries · embedder=${idx.embedderId ?? "(none)"} · dense=${denseAny ? "ON" : "SKIPPED (no matching vectors)"}`);

  const abort = evalAbortReason({
    caseCount: idx.cases.size,
    emptyRankedLists: emptyLists,
    totalRankedLists: totalLists,
    metrics: [b.overall.ndcg10, b.overall.recall10, b.overall.mrr,
              h.overall.ndcg10, h.overall.recall10, h.overall.mrr,
              rt.overall.ndcg10, rt.overall.recall10, rt.overall.mrr],
  });
  if (abort) { console.error(`❌ this run measured nothing — ${abort}`); process.exit(1); }
```

The guard sits **after** the aggregates are computed (it needs the metrics) but **before** any metric is printed, so a degenerate run never emits a scorecard a reader could quote.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Confirm the guard is reachable from the script**

You have no AWS credentials, so do not try to run the eval. Verify the wiring by reading:
`evalAbortReason` is imported, called with all four fields, and its `process.exit(1)` sits
**above** the first `console.log` of any metric. State in your report which line numbers.

The end-to-end run is the controller's step, not yours.

- [ ] **Step 8: Commit**

```bash
git add scripts/cases-eval.ts
git commit -m "fix(eval): score the searcher users query, and abort on a measurement of nothing"
```

---

### Task 4: Make the fast path the default

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update the scripts**

Replace the `cases:eval:cloud` entry and add `cases:eval:scan` beside it:

```json
    "cases:eval:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases INDEX_BUCKET=indigenomics-portal-production-casesindexbucket-bbdveozx EMBED_PROVIDER=bedrock EMBED_MODEL=amazon.titan-embed-text-v2:0 EMBED_DIM=1024 BEDROCK_REGION=us-east-1 tsx scripts/cases-eval.ts",
    "cases:eval:scan": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases EMBED_PROVIDER=bedrock EMBED_MODEL=amazon.titan-embed-text-v2:0 EMBED_DIM=1024 BEDROCK_REGION=us-east-1 tsx scripts/cases-eval.ts",
```

`:cloud` loads the artifact — minutes. `:scan` is the escape hatch for when the artifact is stale or missing, and reads 43k items one page at a time; a previous run had not finished after 90 minutes at ~1.6% CPU. They are kept separate rather than made a flag because they measure **different searchers**, and the run prints which one it used.

- [ ] **Step 2: Verify the JSON parses and the scripts resolve**

```bash
node -e "const s=require('./package.json').scripts; console.log(s['cases:eval:cloud']); console.log(s['cases:eval:scan'])"
```

Expected: both lines print.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(eval): cases:eval:cloud loads the artifact; :scan keeps the table-scan path"
```

---

## After the tasks (controller, not a subagent)

1. Final whole-branch review.
2. **Prove the guard fires before trusting it.** Run against a table that does not exist:
   `AWS_PROFILE=bedrock AWS_REGION=us-east-1 CASES_TABLE=NoSuchTable npx tsx scripts/cases-eval.ts; echo "EXIT=$?"`
   Expected: non-zero. Either the scan throws (a loud failure, acceptable) or the guard
   prints `❌ this run measured nothing`. **A clean exit 0 with a scorecard means the guard
   is not wired and the whole branch is worthless** — fix before step 3.
3. **Credentialed run** — `AWS_PROFILE=bedrock npm run cases:eval:cloud`. Do not pipe through `tail`; it masks the exit code. This produces the first retrieval measurement of the searcher users actually query.
4. Record the result in `docs/research/`, stating the index source, the artifact build id, and whether the corpus had moved past it. **Do not compare it to the 2026-06-30 number as if they were the same measurement** — that one scored an in-memory full-precision searcher on a BM25-only run.
5. Open the PR. Wait for explicit approval before merging.

## Self-review notes

- **Spec coverage:** searcher not units (T3 §2–3), three aborts (T2), abort before printing (T3 §5), artifact default + scan escape hatch (T4), source printed (T3 §5), buildId + staleness (T1, T3 §5), "bad retriever still reports" regression (T2 §1).
- **Naming consistency:** `EvalEvidence`, `evalAbortReason`, `emptyLists`/`totalLists` → `emptyRankedLists`/`totalRankedLists` at the call boundary, `buildId` on both `SearchIndex` and the artifact loader.
- **Not covered, deliberately:** no change to `rankWithSearcher`, `scoreQuery`, `aggregate`, `routeQuery`, the gold set, or the artifact itself. The 4 missing gold slugs stay missing — they are 4 of 140 and cannot produce a total zero.
