# Retrieval Evaluation: Gold Set + IR Metrics Harness — Design Spec

**Status:** Approved · extends the `cases` domain · branch `feat/legal-retrieval-eval` (off `main`, Phase 2-B.2 merged)
**Date:** 2026-06-30
**Audience:** Data group
**Purpose:** Make hybrid-retrieval quality **measurable**, not asserted. Phase 2-B.2 shipped BM25 + dense + RRF hybrid, but it runs on a non-semantic stub embedder and has never been scored. This adds (a) a **graded relevance gold set** (`cases-retrieval-gold.jsonl`) and (b) an **IR metrics harness** (nDCG@k / recall@k / MRR) that scores **BM25-only vs full hybrid** on the same queries — turning the embedder choice (OpenAI vs Bedrock vs bge-m3, dims, "does dense even help") into a data-driven decision and giving Phase 2-B.3 (RAG) a retrieval floor + regression guard.

> **Why this before RAG (the research):** LegalBench-RAG (`docs/research/2026-06-25-legal-search-state-of-the-art.md`) establishes that the bottleneck in legal RAG is **retrieval precision**. Building RAG on unmeasured retrieval makes every bad answer unattributable (retrieval miss vs composition error). Measure retrieval first. The gold set also answers the open embedder question and becomes the regression guard 2-B.3 leans on.

> **Relevance provenance (honest framing):** judgments are produced by **Claude as an LLM-as-judge** at construction time, not by licensed legal experts. This is a documented, literature-backed method (TREC auto-judgments, UMBRELA) and is **non-circular**: the retriever under test is BM25 + embeddings, independent of the judge. Mitigations: (1) a **high-confidence anchor subset** of legally-uncontroversial known-item pairs (e.g. "duty to consult" → Haida/Taku River/Mikisew); (2) a **`why` rationale per judgment** (auditable, citation-anchored where possible); (3) explicit **datasheet labeling** — "relevance judged by Claude (LLM-as-judge), rubric vN" — so nothing is overclaimed.

---

## 1. Scope

**Goal:** a static graded gold set + a deterministic harness that reports nDCG@10 / recall@10 / MRR for **BM25-only** and **hybrid**, per query-layer and overall, plus the dense **delta**.

**In scope:**
- **Ranking metrics** added to `src/lib/cases/validate/metrics.ts` (pure, unit-tested against textbook values, alongside the existing `prf1`/`cohenKappa`/`pabak`/`wilsonInterval`): `dcgAtK`, `ndcgAtK` (graded gains), `recallAtK` (binarized at rel≥1), `reciprocalRank` (→ MRR).
- **Versioned query set** (`src/lib/cases/validate/eval-queries.ts`): ~30–50 queries across three layers — `known_item` (citation/party-name → the exact case; stresses lexical/BM25), `conceptual` (natural-language / paraphrase, low token overlap; stresses dense), `topical` (broad theme queries, reusing `THEME_QUERIES`).
- **Gold file** `docs/research/gold/cases-retrieval-gold.jsonl` — one JSON object per query with graded (0/1/2) judgments + rationale (§3). Distinct from the existing `cases-gold.jsonl` (theme-label quality).
- **Pure eval core** `src/lib/cases/validate/retrieval.ts`: given a gold query and two ranked case-id lists (BM25-only, hybrid), compute the per-query metrics; aggregate across queries and layers.
- **Pooling helper** (`cases-eval.ts --pool` mode): for each query, union the top-K of BM25 + hybrid with structured-signal candidates (same-theme core, landmark seeds, Gallagher list, citation-graph neighbors) into a to-adjudicate worklist.
- **Runner** `scripts/cases-eval.ts`: load gold → build the retrieval index once → per query run the **pure `hybridRank` twice** (`queryVec=null` = BM25-only baseline, `queryVec` = hybrid) over the same index → score both against gold → print a per-layer + overall report with the dense delta. Honest degradation (no gold → "unvalidated", exit 0; no vectors → BM25 column only, note dense skipped).
- **npm scripts** `cases:eval` (+ `:cloud`), `cases:eval:pool`.

**Out of scope (later / YAGNI):**
- MAP/AP (easily added later; the three named metrics suffice now).
- Cross-encoder reranking eval, per-provider embedder bake-off automation (the harness *enables* it; running each provider is operational).
- RAG answer-quality eval (that's 2-B.3).
- Any change to `hybridRank`, `searchCases`, or the storage model — this is a **read-only** measurement layer.

**Definition of done:**
- New metric functions in `metrics.ts` pass unit tests against known textbook values (nDCG worked example, recall@k, MRR).
- `retrieval.ts` pure core passes unit tests on a toy gold + toy rankings (known nDCG/recall/MRR, per-layer aggregation).
- `cases:eval` runs against the seeded corpus and prints a BM25-vs-hybrid report without error; with no gold file it prints "unvalidated" and exits 0; with no stored vectors it reports the BM25 column and notes dense was skipped.
- `npm run typecheck` exit 0; `npm run verify` still green (the harness is additive/read-only — not part of the `dynamo ≡ mock` checks).
- The query set exists and is layered; the gold-file **format** is exercised by a committed fixture (a few queries) even before the full corpus-scale gold is adjudicated.

**Staging (two waves — the plan implements Wave A; Wave B is operational):**
- **Wave A (this plan):** metrics + query set + gold format + pooling + harness + tests + a small committed fixture gold. Fully testable on fixtures now; no dependency on the full corpus or a real embedder.
- **Wave B (operational, when the ingested corpus + a real embedder are present):** author the full ~30–50 queries, pool, adjudicate the real gold, run `cases:embed`, produce the real numbers + datasheet entry. Not code — a labeling+run pass.

---

## 2. Query set (layered, versioned)

`src/lib/cases/validate/eval-queries.ts` exports an ordered list; changing it changes the eval surface (versioned on purpose, like `sources.ts`).

```ts
export interface EvalQuery { qid: string; query: string; layer: "known_item" | "conceptual" | "topical"; }
export const EVAL_QUERIES: EvalQuery[] = [ /* ~30–50, ~1/3 per layer */ ];
```
- **known_item** (~10): a citation or party name whose single on-point target is unambiguous ("2014 SCC 44", "Tsilhqot'in"). Tests that exact legal tokens are findable (BM25 must win here).
- **conceptual** (~15): natural-language questions with deliberately low lexical overlap with the target's wording ("compensation when the Crown infringes a fishing right"). Tests semantic retrieval (dense should lift here).
- **topical** (~10): broad theme queries, reusing/expanding `THEME_QUERIES` ("duty to consult", "revenue sharing").

Layering lets the report attribute *where* hybrid helps ("BM25 wins known-item, dense wins conceptual, hybrid ≥ both overall") — the story that justifies the architecture.

## 3. Gold file format

`docs/research/gold/cases-retrieval-gold.jsonl`, one object per query:
```jsonc
{ "qid": "conceptual-003",
  "query": "compensation for infringement of fishing rights",
  "layer": "conceptual",
  "judgedAt": "2026-06-30", "judge": "claude-opus-4-8", "rubric": "rel-v1",
  "judgments": [
    { "caseId": "sparrow-1990", "rel": 2, "why": "sets the justification test for infringing an Aboriginal fishing right" },
    { "caseId": "gladstone-1996", "rel": 1, "why": "extends to a commercial fishing right" }
  ] }
```
- **Grades:** 2 = on-point authority; 1 = materially relevant, not primary; 0 = not relevant. Only judged cases listed; **unjudged ⇒ rel 0** (TREC pooling convention).
- **rel≥1** is the binarization threshold for recall@k and MRR.
- Each judgment carries `why` (auditable). Query-level `judge`/`rubric`/`judgedAt` stamp provenance for the datasheet.
- **Rubric `rel-v1`** (written into the spec/datasheet, applied consistently by the single adjudicator):
  - **2** — the case is a direct answer / the controlling authority for what the query asks.
  - **1** — the case materially addresses the query's subject but is secondary (applies/extends/distinguishes, or same doctrine lower court).
  - **0** — off-topic, or only an incidental mention.

## 4. Pooling (bound the judging effort, avoid single-system bias)

For each query, the candidate pool = union of:
- **BM25 top-K** and **hybrid top-K** (K=20) over the corpus — what the systems under test actually retrieve;
- **structured signals** — same-`theme` core cases, `SEED_CITATIONS` landmarks, Gallagher's list, and citation-graph neighbors (`casesCited`/`casesCiting`) of any already-relevant case.

The adjudicator judges the pooled union only (typ. tens of cases/query, not ~1,328). Consequence: relevant cases outside the pool are unseen → metrics are **pooled** (esp. recall). This is the standard TREC treatment; documented in the datasheet. `cases:eval:pool` emits the worklist (query + candidate cases with their holding/summary) for adjudication.

## 5. Metrics (pure, in `metrics.ts`)

```ts
export function dcgAtK(gains: number[], k: number): number;            // Σ gain_i / log2(i+2), i<k
export function ndcgAtK(rankedGains: number[], idealGains: number[], k: number): number; // dcg/idcg, 0 if idcg=0
export function recallAtK(retrievedRelevant: number, totalRelevant: number, k?: number): number; // |rel∩topK| / |rel|
export function reciprocalRank(ranked: boolean[]): number;             // 1/(rank of first true), else 0
```
- Graded gains feed nDCG; `idealGains` = judged gains sorted desc. `recallAtK` binarizes at rel≥1; `totalRelevant` = count of pooled rel≥1. MRR = mean of `reciprocalRank` across queries (first rel≥1 hit).
- Report at **k ∈ {5, 10}**; headline = nDCG@10, recall@10, MRR.
- Unit-tested against hand-computed worked examples (e.g. gains [2,0,1] → known DCG/nDCG).

## 6. Eval core + runner

**`src/lib/cases/validate/retrieval.ts` (pure):**
```ts
export interface GoldQuery { qid: string; query: string; layer: string; judgments: { caseId: string; rel: number }[]; }
export interface QueryScore { qid: string; layer: string; ndcg10: number; recall10: number; rr: number; /* +@5 */ }
// given the gold query + a ranked caseId[], look up graded gains and compute the row
export function scoreQuery(gold: GoldQuery, rankedCaseIds: string[], k?: number): QueryScore;
// mean over queries, and grouped by layer
export function aggregate(scores: QueryScore[]): { overall: {...}; byLayer: Record<string, {...}> };
```
**`scripts/cases-eval.ts` (runner):**
```
load gold (else "unvalidated", exit 0)
idx = getSearchIndex(); embedder = getEmbedder()
for each gold query:
   bm25Ranked   = hybridRank(idx.units, q, null).map(r => r.caseId)          // BM25-only baseline
   queryVec     = (idx.embedderId === embedder.id && idx.vdim === embedder.dim) ? embed(q) : null
   hybridRanked = hybridRank(idx.units, q, queryVec).map(r => r.caseId)       // hybrid (or BM25 if no vec)
   scoreQuery(gold, bm25Ranked) ; scoreQuery(gold, hybridRanked)
print per-layer + overall table for both columns + delta (hybrid − bm25); note if dense skipped
```
Reaching into the pure `hybridRank` (not just `repo.hybridSearch`) is deliberate: it gives a clean in-process A/B independent of what vectors are stored, so the report always shows the BM25 baseline and, when vectors exist, the dense lift.

## 7. Testing

- **Pure units:** `dcgAtK`/`ndcgAtK`/`recallAtK`/`reciprocalRank` vs worked values; `scoreQuery`/`aggregate` on a toy gold + toy rankings (known nDCG@10/recall@10/MRR, correct per-layer grouping); unjudged-⇒-0 behavior.
- **Fixture gold:** a small `cases-retrieval-gold.jsonl` covering the seeded fixture cases is committed so the format + runner are exercised in CI-style offline runs.
- **Runner smoke:** `cases:eval` against the seeded corpus prints both columns; no-gold → "unvalidated" exit 0; no-vectors → BM25 column + skip note.
- **`npm run verify` unaffected** (additive read-only path; not in the `dynamo ≡ mock` checks). `npm run typecheck` exit 0.

## 8. Datasheet integration

The eval report (and a datasheet line via the existing `cases-datasheet.ts` or the report header) records: gold provenance (**judge = Claude**, `rubric` version, pooling depth K, query-set composition + count, `judgedAt`), corpus size at eval time, active embedder id/dim, and the headline nDCG@10/recall@10/MRR for BM25 vs hybrid. This is the "methodology transparency" deliverable — the numbers are always paired with how the labels were made.

## 9. Open questions

- **[Open]** Exact query count within 30–50 and the precise wording — authored in Wave B; the layer proportions (~10/15/10) are fixed here.
- **[Open]** Whether to fold a one-line metrics summary into `cases-datasheet.ts` output vs keeping the eval report standalone — decide during implementation; both write the same provenance fields.
- **[Open]** MAP/AP — deferred; add if a reviewer wants the extra ranking metric.
