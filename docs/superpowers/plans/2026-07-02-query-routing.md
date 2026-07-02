# Query-Type Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route each search query to BM25-only (citation/case-name lookups) or hybrid (everything else), so dense retrieval stops hurting known-item precision while keeping its conceptual/topical lift.

**Architecture:** A new pure `routeQuery(query, index)` module decides `useDense`. It is called once at the `hybridSearch` seam (`repo.dynamo.ts`): known-item → skip the embed call, pass `queryVec=null`; otherwise embed + hybrid as today. `hybridRank` and `searchCases` are unchanged. The eval runner gains a third "Routed" column plus a classifier-accuracy check.

**Tech Stack:** TypeScript, Node, `tsx` for standalone tests (no test framework), DynamoDB Local for the eval, Bedrock Titan v2 for the credentialed eval column.

Spec: `docs/specs/2026-07-02-query-routing-design.md`.

Conventions (this repo): tests are standalone `npx tsx scripts/test-cases-*.ts`; the repo is **not** ESM (`"type":"module"` absent) so test bodies wrap in an async IIFE; always run `npm run typecheck` (tsx strips types).

---

### Task 1: `routeQuery` — citation detection

**Files:**
- Create: `src/lib/cases/search/route.ts`
- Create: `scripts/test-cases-route.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-route.ts`:

```ts
import { routeQuery } from "../src/lib/cases/search/route";
import type { SearchIndex } from "../src/lib/cases/search/build-index";
import type { LegalCase } from "../src/lib/cases/types";

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`FAIL ${msg}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}

// Minimal index: routeQuery only reads index.cases (styleOfCause) for name matching.
function fixtureIndex(): SearchIndex {
  const cases = new Map<string, LegalCase>();
  const add = (id: string, styleOfCause: string) => cases.set(id, { id, styleOfCause } as LegalCase);
  add("1990-1-scr-1075", "R. v. Sparrow");
  add("1997-3-scr-1010", "Delgamuukw v. British Columbia");
  add("2005-scc-69", "Mikisew Cree First Nation v. Canada (Minister of Canadian Heritage)");
  return { units: [], cases, embedderId: null, vdim: null };
}

(async () => {
  const idx = fixtureIndex();

  // --- citations route to BM25-only ---
  eq(routeQuery("2014 SCC 44", idx), { useDense: false, reason: "citation" }, "neutral citation");
  eq(routeQuery("2004 scc 73", idx), { useDense: false, reason: "citation" }, "lowercase neutral citation");
  eq(routeQuery("[1990] 1 SCR 1075", idx), { useDense: false, reason: "citation" }, "SCR reporter");
  eq(routeQuery("2004-scc-73", idx), { useDense: false, reason: "citation" }, "slug id");

  console.log("✅ route: citation detection");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-route.ts`
Expected: FAIL — `Cannot find module '.../route'` (module not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/cases/search/route.ts`:

```ts
// Query-type routing (spec 2026-07-02). Pure + deterministic (no network, no key):
// decides whether a query should use the dense retriever. Stage 2 showed dense HURTS
// exact citation/case-name lookups (RRF pulls topical neighbours above the exact
// match) while helping conceptual/topical — so known-item queries route to BM25-only.
import { tokenize } from "./bm25";
import type { SearchIndex } from "./build-index";

export type RouteReason = "citation" | "case_name" | "semantic";
export interface QueryRoute {
  useDense: boolean; // false ⇒ known-item ⇒ BM25-only
  reason: RouteReason;
}

// Canadian court abbreviations used in neutral citations + reporter/slug forms.
const COURTS = "SCC|SCR|FCA|FC|BCCA|BCSC|ONCA|ONSC|NSCA|NSSC|ABCA|ABQB|SKCA|MBCA|QCCA|QCCS|YKCA|NLCA|PECA|TCC|CHRT";
const CITATION_RES: RegExp[] = [
  new RegExp(`\\b\\d{4}\\s+(?:${COURTS})\\s+\\d+\\b`, "i"),          // neutral: 2014 SCC 44
  /\[\d{4}\]\s+\d+\s+s\.?\s?c\.?\s?r\.?\s+\d+/i,                     // reporter: [1990] 1 SCR 1075
  /\b\d{4}-[a-z]{2,6}-\d+\b/i,                                       // slug id: 2004-scc-73
];

export function routeQuery(query: string, _index: SearchIndex): QueryRoute {
  if (CITATION_RES.some((re) => re.test(query))) return { useDense: false, reason: "citation" };
  return { useDense: true, reason: "semantic" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-route.ts`
Expected: PASS — prints `✅ route: citation detection`.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/lib/cases/search/route.ts scripts/test-cases-route.ts
git commit -m "feat(cases): routeQuery citation detection (query-type routing)"
```

---

### Task 2: `routeQuery` — corpus-grounded case-name matching

**Files:**
- Modify: `src/lib/cases/search/route.ts`
- Modify: `scripts/test-cases-route.ts`

- [ ] **Step 1: Add failing tests**

In `scripts/test-cases-route.ts`, add these assertions before the final `console.log`, and change that log to `"✅ route: citation + case-name"`:

```ts
  // --- case names route to BM25-only (matched against the corpus) ---
  eq(routeQuery("Sparrow", idx).useDense, false, "party name Sparrow");
  eq(routeQuery("Sparrow", idx).reason, "case_name", "Sparrow reason");
  eq(routeQuery("Delgamuukw", idx).useDense, false, "party name Delgamuukw");
  eq(routeQuery("Mikisew Cree", idx).useDense, false, "party name Mikisew Cree");

  // --- natural-language + topical route to hybrid ---
  eq(routeQuery("duty to consult", idx), { useDense: true, reason: "semantic" }, "topical keywords");
  eq(routeQuery("When must government consult Indigenous groups before a pipeline?", idx),
     { useDense: true, reason: "semantic" }, "NL question");

  // --- guard: a long question that happens to contain a party surname → hybrid ---
  eq(routeQuery("what did the court decide about fishing rights in the Sparrow appeal case", idx).useDense,
     true, "long query containing a name is not a known-item lookup");

  // --- guard: an all-generic query (only common party tokens) → hybrid ---
  eq(routeQuery("Canada", idx).useDense, true, "generic-only token is not a case-name lookup");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-route.ts`
Expected: FAIL at `party name Sparrow` (still returns `useDense:true` — name matching not implemented).

- [ ] **Step 3: Implement case-name matching**

In `src/lib/cases/search/route.ts`, add the helpers below (after `CITATION_RES`) and extend `routeQuery`:

```ts
const MAX_NAME_TOKENS = 5; // a longer query is a question, not a name lookup
// Generic party tokens: a query made ONLY of these must not count as a case-name hit.
const GENERIC = new Set([
  "canada", "british", "columbia", "ontario", "quebec", "alberta", "saskatchewan",
  "manitoba", "yukon", "nova", "scotia", "brunswick", "the", "queen", "king", "r",
  "v", "c", "attorney", "general", "minister", "first", "nation", "nations", "band",
  "indian", "canadian", "her", "his", "majesty", "of", "and", "re",
]);

// Contiguous-subsequence test: is `needle` a run of tokens inside `hay`?
function containsSeq(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

// Tokenized styleOfCause per case, computed once per index object (memoized).
const nameCache = new WeakMap<SearchIndex, string[][]>();
function nameSeqs(index: SearchIndex): string[][] {
  let seqs = nameCache.get(index);
  if (!seqs) {
    seqs = [];
    for (const c of index.cases.values()) {
      const toks = tokenize(c.styleOfCause ?? "");
      if (toks.length) seqs.push(toks);
    }
    nameCache.set(index, seqs);
  }
  return seqs;
}
```

Replace the body of `routeQuery` with:

```ts
export function routeQuery(query: string, index: SearchIndex): QueryRoute {
  if (CITATION_RES.some((re) => re.test(query))) return { useDense: false, reason: "citation" };
  const q = tokenize(query);
  if (q.length >= 1 && q.length <= MAX_NAME_TOKENS && !q.every((t) => GENERIC.has(t))) {
    for (const seq of nameSeqs(index)) if (containsSeq(seq, q)) return { useDense: false, reason: "case_name" };
  }
  return { useDense: true, reason: "semantic" };
}
```

(The `_index` param is now used — rename it to `index`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-route.ts`
Expected: PASS — prints `✅ route: citation + case-name`.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/lib/cases/search/route.ts scripts/test-cases-route.ts
git commit -m "feat(cases): routeQuery corpus-grounded case-name matching"
```

---

### Task 3: Wire routing into `hybridSearch`

**Files:**
- Modify: `src/lib/cases/repo.dynamo.ts:66-82` (the `hybridSearch` method)

- [ ] **Step 1: Add the import**

At the top of `src/lib/cases/repo.dynamo.ts`, next to the existing search imports, add:

```ts
import { routeQuery } from "./search/route";
```

- [ ] **Step 2: Route before embedding**

Replace the embed block in `hybridSearch` (currently lines ~68-76) so the dense path is gated by `routeQuery`. The method becomes:

```ts
  async hybridSearch(query, filter) {
    const idx = await getSearchIndex();
    const embedder = getEmbedder();
    let queryVec = null as Float32Array | null;
    const route = routeQuery(query, idx);
    if (!route.useDense) {
      // known-item lookup (citation / case name): BM25-only, skip the embed call.
    } else if (idx.embedderId === embedder.id && idx.vdim === embedder.dim) {
      queryVec = (await embedder.embed([query]))[0];
    } else if (idx.embedderId) {
      console.warn(`[hybrid] embedder/dim mismatch active=${embedder.id}/${embedder.dim} stored=${idx.embedderId}/${idx.vdim} → BM25-only`);
    } else {
      console.warn(`[hybrid] no stored vectors → BM25-only`);
    }
    const ranked = hybridRank(idx.units, query, queryVec);
    const ordered = ranked
      .map((r) => idx.cases.get(r.caseId))
      .filter((c): c is LegalCase => !!c);
    return filterCases(ordered, filter); // Array.filter preserves rank order
  },
```

- [ ] **Step 3: Verify the existing hybrid unit test still passes**

Run: `npx tsx scripts/test-cases-hybrid.ts`
Expected: PASS (routeQuery isn't exercised here — `hybridRank` is called directly — but this confirms no import/type breakage).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/repo.dynamo.ts
git commit -m "feat(cases): route queries at the hybridSearch seam (BM25-only for known-item)"
```

---

### Task 4: Eval — add the "Routed" column + classifier accuracy

**Files:**
- Modify: `scripts/cases-eval.ts`

- [ ] **Step 1: Import routeQuery**

Add to the imports at the top of `scripts/cases-eval.ts`:

```ts
import { routeQuery } from "../src/lib/cases/search/route";
```

- [ ] **Step 2: Score the routed variant + track classifier decisions**

In `scoreMode`, replace the score-collection loop and the aggregate/print block (currently lines ~45-59) with:

```ts
  const bm25Scores = [], hybridScores = [], routedScores = [];
  let denseAny = false;
  const misroutes: string[] = [];
  for (const g of gold) {
    const { bm25, hybrid, denseOn } = await rankBoth(idx.units, g.query, embedder, idx.embedderId, idx.vdim);
    denseAny = denseAny || denseOn;
    bm25Scores.push(scoreQuery(g, bm25));
    hybridScores.push(scoreQuery(g, hybrid));
    // Routed: the classifier decides per query which ranked list to use.
    const route = routeQuery(g.query, idx);
    routedScores.push(scoreQuery(g, route.useDense ? hybrid : bm25));
    // Classifier check: known-item should route to BM25 (useDense=false); others to hybrid.
    const expectedDense = g.layer !== "known_item";
    if (route.useDense !== expectedDense)
      misroutes.push(`${g.qid} (${g.layer}) → ${route.reason}/useDense=${route.useDense}`);
  }
  const b = aggregate(bm25Scores), h = aggregate(hybridScores), rt = aggregate(routedScores);
  console.log(`gold=${gold.length} queries · embedder=${idx.embedderId ?? "(none)"} · dense=${denseAny ? "ON" : "SKIPPED (no matching vectors)"}`);
  console.log(`BM25   overall: ${fmt(b.overall)}`);
  console.log(`Hybrid overall: ${fmt(h.overall)}`);
  console.log(`Routed overall: ${fmt(rt.overall)}`);
  console.log(`Δ nDCG@10  hybrid−bm25 = ${(h.overall.ndcg10 - b.overall.ndcg10).toFixed(3)} · routed−bm25 = ${(rt.overall.ndcg10 - b.overall.ndcg10).toFixed(3)} · routed−hybrid = ${(rt.overall.ndcg10 - h.overall.ndcg10).toFixed(3)}`);
  for (const layer of Object.keys(h.byLayer))
    console.log(`  [${layer}] BM25 ${fmt(b.byLayer[layer])} | Hybrid ${fmt(h.byLayer[layer])} | Routed ${fmt(rt.byLayer[layer])}`);
  console.log(`classifier: ${gold.length - misroutes.length}/${gold.length} correctly routed${misroutes.length ? " · misroutes: " + misroutes.join(", ") : ""}`);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Verify classifier accuracy offline (no Bedrock needed)**

The corpus must be loaded in DynamoDB Local (`npm run cases:ingest && npm run cases:fetch-fulltext` if not). Then run the stub-embedder eval — dense will be `SKIPPED` (stub id ≠ stored `bedrock:` id), so BM25/Hybrid/Routed numbers are not the real deltas, **but the `classifier:` line is valid** (routeQuery is pure, independent of embeddings):

Run: `npm run cases:eval`
Expected: the final line reads `classifier: 18/18 correctly routed` (6 known-item → BM25, 12 conceptual·topical → hybrid), no misroutes.

- [ ] **Step 5: Commit**

```bash
git add scripts/cases-eval.ts
git commit -m "test(cases): eval Routed column + classifier-accuracy check"
```

---

### Task 5: Credentialed validation run + record results

**Files:**
- Modify: `docs/research/2026-06-30-retrieval-eval-results.md`

**Precondition:** valid AWS credentials with Bedrock Titan v2 access (us-east-1), the full corpus embedded with `bedrock:amazon.titan-embed-text-v2:0` (already done in Stage 2; re-run `cases:embed:bedrock` only if the table was reset), and DynamoDB Local up. This step embeds only the 18 query strings, so it is fast.

- [ ] **Step 1: Run the routed eval with real dense**

Run (with creds in env):
```bash
AWS_RETRY_MODE=adaptive AWS_MAX_ATTEMPTS=10 npm run cases:eval:bedrock
```
Expected: `dense=ON`; a `Routed overall` line; per-layer `Routed` columns; `classifier: 18/18 correctly routed`.

- [ ] **Step 2: Confirm success criteria**

Check against the spec's success criteria:
- Routed `known_item` nDCG@10 ≈ BM25's (≈0.594, recovering the −0.102 hybrid regression).
- Routed `conceptual`/`topical` ≈ Hybrid's (keep +0.150 / +0.082).
- Routed `overall` nDCG@10 > Hybrid's 0.578.
- `classifier: 18/18`.

If any criterion fails, STOP and report — do not paper over it (e.g., a misroute means the regex/name rules need adjustment, not the numbers).

- [ ] **Step 3: Record the numbers**

Append a short "Query routing" subsection to the Stage 2 section of `docs/research/2026-06-30-retrieval-eval-results.md`: the three-way table (BM25 / Hybrid / Routed) per layer + overall, the classifier accuracy, and one sentence confirming the known-item regression is recovered without losing the conceptual/topical lift.

- [ ] **Step 4: Commit**

```bash
git add docs/research/2026-06-30-retrieval-eval-results.md
git commit -m "docs(cases): query-routing eval results (recovers known-item, keeps conceptual lift)"
```

---

## Notes for the implementer

- `routeQuery` is pure and offline — Tasks 1, 2, 4-step-4 need **no** AWS credentials. Only Task 5 needs Bedrock.
- Do not touch `hybridRank`, `searchCases`, or the storage layer — the `dynamo≡mock` golden equivalence must stay intact (the mock has no vectors, so routing is a no-op there).
- `tokenize` (from `bm25.ts`) lowercases and splits on `[a-z0-9]+`, no stopword removal — that's why the `GENERIC` set and the `MAX_NAME_TOKENS` cap are needed to keep case-name matching precision-first.
