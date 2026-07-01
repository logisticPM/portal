# Retrieval Evaluation (Wave A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the retrieval-evaluation harness — graded gold format + ranking metrics (nDCG@k / recall@k / MRR) + a runner that scores **BM25-only vs hybrid** on the same queries via the pure `hybridRank` A/B — so hybrid retrieval quality becomes measurable.

**Architecture:** A read-only measurement layer. New ranking metrics join the existing pure functions in `validate/metrics.ts`; a pure `validate/retrieval.ts` scores a ranked case-id list against a graded gold query and aggregates per-layer + overall; a versioned `validate/eval-queries.ts` holds the layered query set; a committed fixture gold (`docs/research/gold/cases-retrieval-gold.jsonl`) exercises the format; `scripts/cases-eval.ts` builds the index once and runs `hybridRank(units, q, null)` (BM25) vs `hybridRank(units, q, queryVec)` (hybrid) per query, scoring both. Nothing in the retrieval/storage path changes — `searchCases`, `hybridRank`, `metrics.ts`'s existing functions, and the `dynamo ≡ mock` checks are all untouched. This is **Wave A** (harness + metrics + format + fixture, fully testable offline). **Wave B** (authoring the real ~30–50 queries, adjudicating the real gold, running `cases:embed`, producing the real numbers) is an operational pass, NOT in this plan.

**Tech Stack:** TypeScript, Next.js repo conventions, `tsx` standalone test scripts (`import assert from "node:assert/strict"`, end with `console.log("✅ … passed")`, no `npm test` runner), AWS DynamoDB DocumentClient (read-only Scan via the existing `getSearchIndex`).

**Spec:** `docs/specs/2026-06-30-retrieval-eval-gold-design.md`. **Branch:** `feat/legal-retrieval-eval` (already created, off `main`).

**Conventions to follow:**
- Tests: `npx tsx scripts/test-cases-<name>.ts`. Metric tests follow `scripts/test-cases-metrics.ts` (a `close(a,b)` float helper + textbook values).
- CJS quirk: this repo is not ESM (`package.json` has no `"type":"module"`), so **top-level `await` throws** in tsx test scripts — wrap async test bodies in `(async () => { ... })().catch((e) => { console.error("❌ test failed:", e); process.exit(1); });` (see `scripts/test-cases-embedder.ts`).
- Determinism: stable ordering; metric functions pure.
- Commit after each task with trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Real seeded fixture case IDs (for the gold fixture + smoke): `tsilhqotin-2014` (2014 SCC 44), `haida-2004` (2004 SCC 73), `calder-1973` ([1973] SCR 313), `fort-mckay-2020` (2020 ABCA 163).

---

## File Structure

**Modify:**
- `src/lib/cases/validate/metrics.ts` — add `dcgAtK`, `ndcgAtK`, `recallAtK`, `reciprocalRank` (ranking metrics) below the existing classification metrics.
- `scripts/test-cases-metrics.ts` — extend with ranking-metric worked examples.
- `package.json` — add `cases:eval`, `cases:eval:cloud`, `cases:eval:pool` scripts.

**Create:**
- `src/lib/cases/validate/retrieval.ts` — pure eval core: `GoldQuery`/`QueryScore`/`Aggregate` types, `scoreQuery`, `aggregate`, `poolCandidates`.
- `src/lib/cases/validate/eval-queries.ts` — `EvalQuery` type + starter `EVAL_QUERIES` (layered).
- `docs/research/gold/cases-retrieval-gold.jsonl` — committed fixture gold (6 queries over the seeded fixture cases).
- `scripts/cases-eval.ts` — the runner (score mode + `--pool` mode).
- `scripts/test-cases-retrieval.ts` — unit tests for the pure eval core.
- `scripts/test-cases-eval-queries.ts` — validates the query set + fixture gold are consistent.

**Untouched (do not edit):** `src/lib/cases/search/hybrid.ts`, `search/build-index.ts`, `search/embedder.ts`, `query.ts`, `repo.dynamo.ts`, `repo.mock.ts`, `cases-table.ts`, and the existing metrics/`cases-validate.ts`.

---

## Task 1: Ranking metrics

**Files:**
- Modify: `src/lib/cases/validate/metrics.ts`
- Test: `scripts/test-cases-metrics.ts`

- [ ] **Step 1: Write the failing test** — append to `scripts/test-cases-metrics.ts`, BEFORE its final `console.log("✅ metrics tests passed");` line, inserting:

```ts
import { dcgAtK, ndcgAtK, recallAtK, reciprocalRank } from "../src/lib/cases/validate/metrics";

// DCG worked example (Wikipedia nDCG): gains [3,2,3,0,1,2]
close(dcgAtK([3, 2, 3, 0, 1, 2], 6), 6.8611, 2e-3);
// nDCG@6 for the same multiset → ideal order [3,3,2,2,1,0]; ndcgAtK sorts idealGains internally
close(ndcgAtK([3, 2, 3, 0, 1, 2], [3, 2, 3, 0, 1, 2], 6), 0.9608, 2e-3);
// k truncates: DCG@2 = 3 + 2/log2(3)
close(dcgAtK([3, 2], 2), 3 + 2 / Math.log2(3));
// zero ideal → 0 (no relevant docs)
close(ndcgAtK([0, 0], [0, 0], 5), 0);
// recall@k is a ratio of counts
close(recallAtK(2, 4), 0.5);
close(recallAtK(0, 0), 0);
// reciprocal rank: first relevant at index 2 (0-based) → 1/3; none → 0
close(reciprocalRank([false, false, true, true]), 1 / 3);
close(reciprocalRank([false, false]), 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-metrics.ts`
Expected: FAIL — `dcgAtK` (and siblings) not exported from metrics.

- [ ] **Step 3: Write minimal implementation** — append to `src/lib/cases/validate/metrics.ts`:

```ts
// --- Ranking metrics for retrieval evaluation (graded relevance). Pure. ---

// Discounted Cumulative Gain over the first k ranked gains: Σ gain_i / log2(i+2).
export function dcgAtK(gains: number[], k: number): number {
  let s = 0;
  for (let i = 0; i < Math.min(k, gains.length); i++) s += gains[i] / Math.log2(i + 2);
  return s;
}

// Normalized DCG@k. idealGains is the full set of judged gains; it is sorted
// descending internally to form the ideal ranking. Returns 0 when IDCG is 0.
export function ndcgAtK(rankedGains: number[], idealGains: number[], k: number): number {
  const idcg = dcgAtK([...idealGains].sort((a, b) => b - a), k);
  return idcg === 0 ? 0 : dcgAtK(rankedGains, k) / idcg;
}

// Recall = |relevant retrieved| / |relevant total|. Caller counts relevant hits
// within top-k (binarized at rel≥1) and passes the totals. 0 when nothing relevant.
export function recallAtK(retrievedRelevant: number, totalRelevant: number): number {
  return totalRelevant === 0 ? 0 : retrievedRelevant / totalRelevant;
}

// Reciprocal rank: 1/(1-based rank of the first true), else 0. MRR = mean over queries.
export function reciprocalRank(ranked: boolean[]): number {
  const i = ranked.findIndex((x) => x);
  return i === -1 ? 0 : 1 / (i + 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-metrics.ts`
Expected: PASS — `✅ metrics tests passed`.

- [ ] **Step 5: Commit**

```bash
git -C /c/Users/chntw/Documents/7980/demo add src/lib/cases/validate/metrics.ts scripts/test-cases-metrics.ts
git -C /c/Users/chntw/Documents/7980/demo commit -m "feat(cases): ranking metrics (nDCG@k / recall@k / MRR) for retrieval eval

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Pure eval core (`retrieval.ts`)

**Files:**
- Create: `src/lib/cases/validate/retrieval.ts`
- Test: `scripts/test-cases-retrieval.ts`

- [ ] **Step 1: Write the failing test** — create `scripts/test-cases-retrieval.ts`:

```ts
import assert from "node:assert/strict";
import { scoreQuery, aggregate, poolCandidates, type GoldQuery } from "../src/lib/cases/validate/retrieval";

const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// gold: caseA highly relevant (2), caseB relevant (1); others unjudged ⇒ 0
const gold: GoldQuery = {
  qid: "q1", query: "duty to consult", layer: "topical",
  judgments: [{ caseId: "caseA", rel: 2 }, { caseId: "caseB", rel: 1 }],
};

// perfect ranking: [A, B, ...] → nDCG=1, recall=1, RR=1
const perfect = scoreQuery(gold, ["caseA", "caseB", "caseX"]);
close(perfect.ndcg10, 1); close(perfect.recall10, 1); close(perfect.rr, 1);

// B first, A third: recall still 1 (both in top10); RR=1 (B is relevant at rank1); nDCG<1
const shuffled = scoreQuery(gold, ["caseB", "caseX", "caseA"]);
close(shuffled.recall10, 1); close(shuffled.rr, 1); assert.ok(shuffled.ndcg10 < 1, "imperfect order → nDCG<1");

// only irrelevant retrieved: recall 0, RR 0, nDCG 0
const miss = scoreQuery(gold, ["caseX", "caseY"]);
close(miss.recall10, 0); close(miss.rr, 0); close(miss.ndcg10, 0);

// aggregate groups by layer and averages
const agg = aggregate([perfect, { ...miss, layer: "conceptual" }]);
assert.equal(agg.overall.n, 2);
close(agg.overall.recall10, 0.5);
assert.ok(agg.byLayer.topical && agg.byLayer.conceptual, "per-layer buckets present");
close(agg.byLayer.topical.recall10, 1);

// pooling: union of top-k of each list + extras, deduped, first-seen order
assert.deepEqual(
  poolCandidates([["a", "b", "c"], ["b", "d"]], ["e", "a"], 2),
  ["a", "b", "d", "e"],
);

console.log("✅ retrieval eval-core tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-retrieval.ts`
Expected: FAIL — `Cannot find module '.../validate/retrieval'`.

- [ ] **Step 3: Write minimal implementation** — create `src/lib/cases/validate/retrieval.ts`:

```ts
// Pure retrieval-eval core (spec §6). Scores a ranked case-id list against a graded
// gold query and aggregates per-layer + overall. No I/O — the runner loads the gold.
import { ndcgAtK, recallAtK, reciprocalRank } from "./metrics";

export interface GoldJudgment { caseId: string; rel: number; why?: string; }
export interface GoldQuery { qid: string; query: string; layer: string; judgments: GoldJudgment[]; }
export interface QueryScore { qid: string; layer: string; ndcg5: number; ndcg10: number; recall10: number; rr: number; }
export interface Aggregate { n: number; ndcg5: number; ndcg10: number; recall10: number; mrr: number; }

// Score one ranked caseId list. Unjudged cases ⇒ gain 0. recall/RR binarize at rel≥1.
export function scoreQuery(gold: GoldQuery, rankedCaseIds: string[]): QueryScore {
  const rel = new Map(gold.judgments.map((j) => [j.caseId, j.rel]));
  const gains = rankedCaseIds.map((id) => rel.get(id) ?? 0);
  const idealGains = gold.judgments.map((j) => j.rel);
  const totalRelevant = gold.judgments.filter((j) => j.rel >= 1).length;
  const relInTop10 = gains.slice(0, 10).filter((g) => g >= 1).length;
  return {
    qid: gold.qid,
    layer: gold.layer,
    ndcg5: ndcgAtK(gains, idealGains, 5),
    ndcg10: ndcgAtK(gains, idealGains, 10),
    recall10: recallAtK(relInTop10, totalRelevant),
    rr: reciprocalRank(gains.map((g) => g >= 1)),
  };
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function agg(scores: QueryScore[]): Aggregate {
  return {
    n: scores.length,
    ndcg5: mean(scores.map((s) => s.ndcg5)),
    ndcg10: mean(scores.map((s) => s.ndcg10)),
    recall10: mean(scores.map((s) => s.recall10)),
    mrr: mean(scores.map((s) => s.rr)),
  };
}

// Overall + per-layer aggregates. Layer buckets sorted for deterministic output.
export function aggregate(scores: QueryScore[]): { overall: Aggregate; byLayer: Record<string, Aggregate> } {
  const byLayer: Record<string, Aggregate> = {};
  for (const l of [...new Set(scores.map((s) => s.layer))].sort())
    byLayer[l] = agg(scores.filter((s) => s.layer === l));
  return { overall: agg(scores), byLayer };
}

// Union the top-k of each ranked list plus extra candidate ids; dedupe, first-seen
// order. Bounds adjudication effort and avoids single-system bias (spec §4).
export function poolCandidates(rankedLists: string[][], extra: string[], k: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of rankedLists)
    for (const id of list.slice(0, k)) if (!seen.has(id)) { seen.add(id); out.push(id); }
  for (const id of extra) if (!seen.has(id)) { seen.add(id); out.push(id); }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-retrieval.ts`
Expected: PASS — `✅ retrieval eval-core tests passed`.

- [ ] **Step 5: Commit**

```bash
git -C /c/Users/chntw/Documents/7980/demo add src/lib/cases/validate/retrieval.ts scripts/test-cases-retrieval.ts
git -C /c/Users/chntw/Documents/7980/demo commit -m "feat(cases): pure retrieval-eval core (scoreQuery/aggregate/poolCandidates)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Query set + fixture gold

**Files:**
- Create: `src/lib/cases/validate/eval-queries.ts`
- Create: `docs/research/gold/cases-retrieval-gold.jsonl`
- Test: `scripts/test-cases-eval-queries.ts`

- [ ] **Step 1: Write the failing test** — create `scripts/test-cases-eval-queries.ts`:

```ts
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { EVAL_QUERIES } from "../src/lib/cases/validate/eval-queries";
import type { GoldQuery } from "../src/lib/cases/validate/retrieval";

const LAYERS = new Set(["known_item", "conceptual", "topical"]);
const FIXTURE_IDS = new Set(["tsilhqotin-2014", "haida-2004", "calder-1973", "fort-mckay-2020"]);

// every query has a valid layer + unique qid
const qids = new Set<string>();
for (const q of EVAL_QUERIES) {
  assert.ok(LAYERS.has(q.layer), `bad layer: ${q.layer}`);
  assert.ok(!qids.has(q.qid), `dup qid: ${q.qid}`);
  qids.add(q.qid);
}
assert.ok(EVAL_QUERIES.some((q) => q.layer === "known_item"), "has known_item");
assert.ok(EVAL_QUERIES.some((q) => q.layer === "conceptual"), "has conceptual");
assert.ok(EVAL_QUERIES.some((q) => q.layer === "topical"), "has topical");

(async () => {
  const text = await fs.readFile("docs/research/gold/cases-retrieval-gold.jsonl", "utf8");
  const gold = text.trim().split(/\n+/).filter(Boolean).map((l) => JSON.parse(l) as GoldQuery);

  // every gold line parses, references a known fixture case, uses grades 0/1/2,
  // and its qid exists in EVAL_QUERIES
  for (const g of gold) {
    assert.ok(qids.has(g.qid), `gold qid not in EVAL_QUERIES: ${g.qid}`);
    assert.ok(g.judgments.length > 0, `gold ${g.qid} has no judgments`);
    for (const j of g.judgments) {
      assert.ok(FIXTURE_IDS.has(j.caseId), `unknown fixture case: ${j.caseId}`);
      assert.ok([0, 1, 2].includes(j.rel), `bad grade: ${j.rel}`);
    }
  }
  console.log(`✅ eval-queries + fixture gold consistent (${EVAL_QUERIES.length} queries, ${gold.length} gold)`);
})().catch((e) => { console.error("❌ test failed:", e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-eval-queries.ts`
Expected: FAIL — `Cannot find module '.../validate/eval-queries'`.

- [ ] **Step 3a: Create the query set** — `src/lib/cases/validate/eval-queries.ts`:

```ts
// Versioned retrieval-eval query set (spec §2). Layered so the report can attribute
// where hybrid helps: known_item (lexical/BM25), conceptual (semantic/dense), topical
// (broad). This is the Wave-A starter over the seeded fixtures; Wave B expands to
// ~30–50 against the full corpus. Changing this changes the eval surface.
export interface EvalQuery { qid: string; query: string; layer: "known_item" | "conceptual" | "topical"; }

export const EVAL_QUERIES: EvalQuery[] = [
  { qid: "known-001", query: "2014 SCC 44", layer: "known_item" },
  { qid: "known-002", query: "Haida Nation", layer: "known_item" },
  { qid: "conceptual-001", query: "the Crown's obligation to consult First Nations before approving resource projects", layer: "conceptual" },
  { qid: "conceptual-002", query: "judicial recognition that Indigenous peoples hold title to their traditional lands", layer: "conceptual" },
  { qid: "topical-001", query: "aboriginal title", layer: "topical" },
  { qid: "topical-002", query: "duty to consult", layer: "topical" },
];
```

- [ ] **Step 3b: Create the fixture gold** — `docs/research/gold/cases-retrieval-gold.jsonl` (exactly these 6 lines; grades per rubric rel-v1):

```jsonl
{"qid":"known-001","query":"2014 SCC 44","layer":"known_item","judgedAt":"2026-06-30","judge":"claude-opus-4-8","rubric":"rel-v1","judgments":[{"caseId":"tsilhqotin-2014","rel":2,"why":"the case reported at 2014 SCC 44"}]}
{"qid":"known-002","query":"Haida Nation","layer":"known_item","judgedAt":"2026-06-30","judge":"claude-opus-4-8","rubric":"rel-v1","judgments":[{"caseId":"haida-2004","rel":2,"why":"Haida Nation v. British Columbia"}]}
{"qid":"conceptual-001","query":"the Crown's obligation to consult First Nations before approving resource projects","layer":"conceptual","judgedAt":"2026-06-30","judge":"claude-opus-4-8","rubric":"rel-v1","judgments":[{"caseId":"haida-2004","rel":2,"why":"established the Crown's duty to consult"},{"caseId":"fort-mckay-2020","rel":1,"why":"applies the duty to consult in a resource-approval context"}]}
{"qid":"conceptual-002","query":"judicial recognition that Indigenous peoples hold title to their traditional lands","layer":"conceptual","judgedAt":"2026-06-30","judge":"claude-opus-4-8","rubric":"rel-v1","judgments":[{"caseId":"tsilhqotin-2014","rel":2,"why":"first judicial declaration of Aboriginal title"},{"caseId":"calder-1973","rel":1,"why":"early recognition of Aboriginal title in Canadian law"}]}
{"qid":"topical-001","query":"aboriginal title","layer":"topical","judgedAt":"2026-06-30","judge":"claude-opus-4-8","rubric":"rel-v1","judgments":[{"caseId":"tsilhqotin-2014","rel":2,"why":"aboriginal-title landmark"},{"caseId":"calder-1973","rel":2,"why":"aboriginal-title foundation"}]}
{"qid":"topical-002","query":"duty to consult","layer":"topical","judgedAt":"2026-06-30","judge":"claude-opus-4-8","rubric":"rel-v1","judgments":[{"caseId":"haida-2004","rel":2,"why":"duty-to-consult landmark"},{"caseId":"fort-mckay-2020","rel":1,"why":"duty to consult applied"}]}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-eval-queries.ts`
Expected: PASS — `✅ eval-queries + fixture gold consistent (6 queries, 6 gold)`.

- [ ] **Step 5: Commit**

```bash
git -C /c/Users/chntw/Documents/7980/demo add src/lib/cases/validate/eval-queries.ts docs/research/gold/cases-retrieval-gold.jsonl scripts/test-cases-eval-queries.ts
git -C /c/Users/chntw/Documents/7980/demo commit -m "feat(cases): layered eval query set + fixture retrieval gold

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Runner (`cases:eval`) + npm scripts

**Files:**
- Create: `scripts/cases-eval.ts`
- Modify: `package.json` (add `cases:eval`, `cases:eval:cloud`, `cases:eval:pool`)

- [ ] **Step 1: Create the runner** — `scripts/cases-eval.ts`:

```ts
// Retrieval-eval runner (spec §6). Scores BM25-only vs hybrid on the graded gold via
// the pure hybridRank A/B — builds the index ONCE, then per query runs
// hybridRank(units, q, null) [BM25] and hybridRank(units, q, queryVec) [hybrid].
// Read-only. Honest degradation: no gold → "unvalidated" exit 0; no matching vectors
// → dense skipped (BM25 column only). `--pool` emits an adjudication worklist instead.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import { getSearchIndex } from "../src/lib/cases/search/build-index";
import { getEmbedder, type Embedder } from "../src/lib/cases/search/embedder";
import { hybridRank, type RetrievalUnit } from "../src/lib/cases/search/hybrid";
import { scoreQuery, aggregate, poolCandidates, type GoldQuery, type Aggregate } from "../src/lib/cases/validate/retrieval";
import { EVAL_QUERIES } from "../src/lib/cases/validate/eval-queries";

const GOLD = process.env.GOLD_FILE ?? "docs/research/gold/cases-retrieval-gold.jsonl";
const POOL_K = 20;

async function loadGold(): Promise<GoldQuery[] | null> {
  let text: string;
  try { text = await fs.readFile(GOLD, "utf8"); } catch { return null; }
  return text.trim().split(/\n+/).filter(Boolean).map((l) => JSON.parse(l) as GoldQuery);
}

// Rank a query two ways over the same index: BM25-only (null vec) and hybrid (query
// vec, only when the active embedder matches the stored vectors' id + dim).
async function rankBoth(
  units: RetrievalUnit[], query: string, embedder: Embedder,
  embedderId: string | null, vdim: number | null,
): Promise<{ bm25: string[]; hybrid: string[]; denseOn: boolean }> {
  const bm25 = hybridRank(units, query, null).map((r) => r.caseId);
  let queryVec: Float32Array | null = null;
  if (embedderId && embedderId === embedder.id && vdim === embedder.dim)
    queryVec = (await embedder.embed([query]))[0];
  const hybrid = hybridRank(units, query, queryVec).map((r) => r.caseId);
  return { bm25, hybrid, denseOn: queryVec !== null };
}

const fmt = (a: Aggregate): string =>
  `nDCG@10=${a.ndcg10.toFixed(3)} recall@10=${a.recall10.toFixed(3)} MRR=${a.mrr.toFixed(3)} (n=${a.n})`;

async function scoreMode(): Promise<void> {
  const gold = await loadGold();
  if (!gold) { console.log(`ℹ️  no gold at ${GOLD} — retrieval UNVALIDATED.`); return; }
  const idx = await getSearchIndex();
  const embedder = getEmbedder();
  const bm25Scores = [], hybridScores = [];
  let denseAny = false;
  for (const g of gold) {
    const { bm25, hybrid, denseOn } = await rankBoth(idx.units, g.query, embedder, idx.embedderId, idx.vdim);
    denseAny = denseAny || denseOn;
    bm25Scores.push(scoreQuery(g, bm25));
    hybridScores.push(scoreQuery(g, hybrid));
  }
  const b = aggregate(bm25Scores), h = aggregate(hybridScores);
  console.log(`gold=${gold.length} queries · embedder=${idx.embedderId ?? "(none)"} · dense=${denseAny ? "ON" : "SKIPPED (no matching vectors)"}`);
  console.log(`BM25   overall: ${fmt(b.overall)}`);
  console.log(`Hybrid overall: ${fmt(h.overall)}`);
  console.log(`Δ nDCG@10 = ${(h.overall.ndcg10 - b.overall.ndcg10).toFixed(3)} (hybrid − bm25)`);
  for (const layer of Object.keys(h.byLayer))
    console.log(`  [${layer}] BM25 ${fmt(b.byLayer[layer])} | Hybrid ${fmt(h.byLayer[layer])}`);
}

async function poolMode(): Promise<void> {
  const idx = await getSearchIndex();
  const embedder = getEmbedder();
  const worklist: { qid: string; query: string; layer: string; candidates: string[] }[] = [];
  for (const q of EVAL_QUERIES) {
    const { bm25, hybrid } = await rankBoth(idx.units, q.query, embedder, idx.embedderId, idx.vdim);
    // Wave A: pool = union of the two ranked lists' top-K. Wave B adds structured
    // extras (same-theme core, seeds, Gallagher list, citation-graph neighbours).
    worklist.push({ qid: q.qid, query: q.query, layer: q.layer, candidates: poolCandidates([bm25, hybrid], [], POOL_K) });
  }
  console.log(JSON.stringify(worklist, null, 2));
}

const run = process.argv.includes("--pool") ? poolMode : scoreMode;
run().catch((e) => { console.error("❌ cases-eval failed:", e); process.exit(1); });
```

- [ ] **Step 2: Add npm scripts** — in `package.json`, after the `cases:embed:cloud` line, add a trailing comma to it and append:

```json
    "cases:eval": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases tsx scripts/cases-eval.ts",
    "cases:eval:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases tsx scripts/cases-eval.ts",
    "cases:eval:pool": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases tsx scripts/cases-eval.ts --pool"
```

- [ ] **Step 3: Verify package.json parses**

Run: `cd /c/Users/chntw/Documents/7980/demo && node -e "const s=require('./package.json').scripts; console.log(s['cases:eval'], '|', s['cases:eval:pool'])"`
Expected: prints both script strings (no JSON parse error).

- [ ] **Step 4: Typecheck**

Run: `cd /c/Users/chntw/Documents/7980/demo && npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 5: Commit**

```bash
git -C /c/Users/chntw/Documents/7980/demo add scripts/cases-eval.ts package.json
git -C /c/Users/chntw/Documents/7980/demo commit -m "feat(cases): cases:eval runner — BM25-vs-hybrid scoring + --pool worklist

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Integration — offline tests + live smoke + green suite

**Files:** none new (runs + verifies).

**Prereq:** Docker + DynamoDB Local on :8000 (`npm run ddb:up`). If unreachable → environmental, not a code failure.

- [ ] **Step 1: Run every new + existing cases unit test offline**

```bash
cd /c/Users/chntw/Documents/7980/demo && for t in metrics retrieval eval-queries pack bm25 hybrid embedder chunk embed-helper fulltext; do echo "== $t =="; npx tsx scripts/test-cases-$t.ts || echo "FAILED $t"; done
```
Expected: every script prints its `✅ … passed`, no `FAILED`.

- [ ] **Step 2: Live smoke — score mode, no vectors (dense skipped)**

```bash
cd /c/Users/chntw/Documents/7980/demo && npm run cases:create && npm run cases:seed && npm run cases:eval
```
Expected: prints `gold=6 queries · embedder=(none) · dense=SKIPPED (no matching vectors)`, a BM25 overall line, a Hybrid overall line equal to BM25 (Δ nDCG@10 = 0.000), and per-layer lines for `conceptual`/`known_item`/`topical`. No error.

- [ ] **Step 3: Live smoke — stub-embed then score (dense path exercised offline)**

```bash
cd /c/Users/chntw/Documents/7980/demo && npm run cases:embed && npm run cases:eval
```
Expected: `cases:embed` reports embedded chunk count; `cases:eval` now prints `embedder=stub-hash-v1 · dense=ON` and both BM25 and Hybrid lines (numbers may match or differ — the stub is non-semantic; this only proves the dense plumbing runs end-to-end). No error.

- [ ] **Step 4: Confirm `--pool` mode emits a worklist**

```bash
cd /c/Users/chntw/Documents/7980/demo && npm run cases:eval:pool | head -20
```
Expected: JSON array of `{qid, query, layer, candidates:[...]}` (one per EVAL_QUERIES entry), candidates being seeded case ids.

- [ ] **Step 5: Confirm the golden suite still passes (harness is additive)**

Run: `cd /c/Users/chntw/Documents/7980/demo && npm run verify`
Expected: `🎉 ALL PASS` (unchanged count — this feature adds no verify checks and touches no repo/query behaviour).

- [ ] **Step 6: Final typecheck**

Run: `cd /c/Users/chntw/Documents/7980/demo && npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit (if Step 2/3 leave any tracked change — otherwise skip)**

There should be no tracked changes from smoke runs (they only write to DynamoDB Local). If `git -C /c/Users/chntw/Documents/7980/demo status --short` shows tracked changes, investigate before committing. Otherwise this task is verification-only and needs no commit.

---

## Self-Review

**Spec coverage (each spec section → task):**
- §1 ranking metrics → Task 1. Query set → Task 3a. Gold file → Task 3b. Pure eval core → Task 2. Pooling helper → Task 2 (`poolCandidates`) + Task 4 (`--pool` wiring). Runner → Task 4. npm scripts → Task 4. ✓
- §1 DoD: metric unit tests → Task 1; retrieval core tests → Task 2; runner report + no-gold "unvalidated" + no-vector skip → Task 4 code + Task 5 smoke; typecheck/verify green → Task 5; query set layered + fixture format exercised → Task 3. ✓
- §2 layered query set (known_item/conceptual/topical) → Task 3a. ✓
- §3 gold format (graded 0/1/2, `why`, provenance stamps, unjudged⇒0) → Task 3b fixture + Task 2 `scoreQuery` (unjudged⇒0). Rubric rel-v1 lives in the spec; the fixture applies it. ✓
- §4 pooling (union top-K + extras, TREC-style) → Task 2 `poolCandidates` + Task 4 `poolMode`; structured extras deferred to Wave B (noted in code comment). ✓
- §5 metrics `dcgAtK`/`ndcgAtK`/`recallAtK`/`reciprocalRank`, k∈{5,10}, headline @10 → Task 1 + Task 2 (`scoreQuery` computes @5 and @10; runner headlines @10). ✓
- §6 eval core + runner with the two-way `hybridRank` A/B + honest degradation → Task 2 + Task 4. ✓
- §7 testing (pure units, fixture gold, runner smoke, verify unaffected) → Tasks 1/2/3 + Task 5. ✓
- §8 datasheet integration → the gold carries `judge`/`rubric`/`judgedAt`; the runner header prints embedder + gold size. A dedicated datasheet line is **[Open] in the spec** and deferred (not a Wave A code requirement). ✓ (no gap: spec §9 marks it open)
- §1 Wave B (real ~30–50 queries, real adjudication, real numbers) → explicitly out of this plan. ✓

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to". Every code step is complete. The `--pool` structured-extras deferral is a documented Wave B boundary (the comment names exactly what's deferred), not a placeholder.

**Type consistency:** `GoldQuery`/`GoldJudgment`/`QueryScore`/`Aggregate` defined in Task 2 (`retrieval.ts`), imported unchanged by Task 3's test and Task 4's runner. `dcgAtK`/`ndcgAtK`/`recallAtK`/`reciprocalRank` defined in Task 1, imported by Task 2. `EvalQuery`/`EVAL_QUERIES` defined in Task 3a, imported by Task 4 + Task 3's test. `scoreQuery(gold, rankedCaseIds)`, `aggregate(scores)→{overall,byLayer}`, `poolCandidates(rankedLists, extra, k)` signatures identical across definition (Task 2), tests (Task 2/3), and runner (Task 4). Runner uses `getSearchIndex()` (returns `{units, cases, embedderId, vdim}`), `getEmbedder()` (`{id, dim, embed}`), and `hybridRank(units, query, vec|null)` — all matching the merged Phase 2-B.2 signatures. Fixture case ids (`tsilhqotin-2014`/`haida-2004`/`calder-1973`/`fort-mckay-2020`) match the seeded fixtures. ✓
