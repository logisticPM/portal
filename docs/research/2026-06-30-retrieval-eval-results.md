# Retrieval Evaluation — BM25 Baseline (Wave B, first pass)

**Date:** 2026-06-30 · **Branch:** `feat/legal-retrieval-goldset` · harness: `cases:eval` (spec `docs/specs/2026-06-30-retrieval-eval-gold-design.md`)

## Setup (methodology, stated up front)
- **Corpus at eval time:** 3,489 cases (core 6 / substrate 3,483), 1,331 with full text, **39,954 chunk items**, 0 vectors (dense not yet run).
- **Query set:** 18 queries, layered 6/6/6 — `known_item` (citation/party name), `conceptual` (plain-language, low lexical overlap), `topical` (broad theme). Source: `src/lib/cases/validate/eval-queries.ts`.
- **Relevance judgments:** **Claude-as-judge (LLM-as-judge)**, rubric `rel-v1` (2 = on-point authority, 1 = materially relevant, 0 = not), one rationale per judgment. Not licensed-expert judgment; documented and **non-circular** (the retriever under test is BM25 + embeddings, independent of the judge). Gold: `docs/research/gold/cases-retrieval-gold.jsonl`.
- **Pooling:** candidates pooled from BM25 top-20 (dense not available yet), **augmented with well-known on-point landmarks** the query implies even when BM25 missed them (so recall is not defined purely by what BM25 retrieves). Recall is therefore **pooled recall**, and BM25's numbers here are, if anything, conservative on the augmented queries.
- **Metrics:** nDCG@10 (graded), recall@10 (rel≥1), MRR. Computed by `src/lib/cases/validate/metrics.ts` + `retrieval.ts`.

## BM25 baseline
| layer | nDCG@10 | recall@10 | MRR | n |
|---|---|---|---|---|
| **overall** | **0.403** | **0.516** | **0.523** | 18 |
| known_item | 0.594 | 0.833 | 0.597 | 6 |
| conceptual | 0.326 | 0.400 | 0.486 | 6 |
| topical | 0.288 | 0.314 | 0.487 | 6 |

(Dense/hybrid columns equal BM25 in this run — `dense=SKIPPED (no matching vectors)`; a real embedder is required for Stage 2.)

## Reading the numbers
- **known_item is strongest** (nDCG 0.594, recall 0.833) — exact tokens favour lexical matching, as expected. But **MRR is only 0.597**: for bare party-name queries ("Sparrow", "Guerin", "Delgamuukw") the actual case is not reliably ranked first, because cases that *cite* the landmark share the surname token. Actionable: exact-citation / party boosting, or dense semantics, should raise rank-1 accuracy.
- **conceptual is weak** (nDCG 0.326, recall 0.400) — plain-language questions with deliberately low lexical overlap ("talk to Indigenous groups before permitting a pipeline") under-retrieve on BM25. **This is the clearest place dense retrieval should help** — the Stage-2 hypothesis.
- **topical is lowest on nDCG/recall** (0.288 / 0.314) — broad terms surface many cases; the relevant set is large and BM25 doesn't concentrate the landmarks at the top.
- **Corpus-supplementation signal:** `topical-005` (resource revenue sharing) had the thinnest relevant set — the corpus is light on revenue-sharing / economic-value cases, matching the earlier finding that the economic-activation source types (settlements, IBAs, revenue-sharing agreements) are underrepresented in a pure case-law corpus.

## Next (Stage 2 — needs an embedding key)
Provision an embedder (Bedrock Titan v2 / OpenAI `3-small` / OpenRouter), implement `ProviderEmbedder.embed`, run `cases:embed`, **re-pool with dense's top-k and judge the new candidates** (to remove BM25-only pooling bias), then re-run `cases:eval` for the hybrid delta — expecting the largest lift on the `conceptual` layer. These BM25 numbers are the baseline that lift is measured against.

---

# Stage 2 — Hybrid (Bedrock Titan v2 dense), 2026-07-02

**Harness:** `cases:eval:bedrock` · embedder `bedrock:amazon.titan-embed-text-v2:0` (1024-d, L2-normalized) · `dense=ON`.

## What changed since the Stage-1 baseline
- **Dense vectors computed over the whole corpus:** all **39,954 chunk items** embedded with Titan v2 (via `cases:embed:bedrock`, concurrent worker pool). Hybrid = BM25 + dense cosine fused with RRF (k=60).
- **Gold re-pooled with the dense retriever:** ran `cases:eval:pool:bedrock` (BM25 ∪ dense top-k), then Claude-as-judge (rubric `rel-v1`) adjudicated the **402 newly-surfaced candidates**, adding **+113 rel≥1 judgments across the 12 conceptual/topical queries**. This removes the BM25-only pooling bias that would otherwise under-count dense hits.
- **Known-item queries got 0 additions by design.** A citation/party-name lookup's relevant set is the target case + its own litigation chain (already judged); dense's topical neighbours are *non-relevant* for such a query, so adding them would be wrong. This keeps the known-item measurement honest.
- **Consequence:** the relevance sets grew, so **BM25 was re-scored on the expanded gold** and its numbers differ from the Stage-1 table above. The valid comparison is **BM25 vs Hybrid _within this run_** (same gold), not Stage-2 Hybrid vs Stage-1 BM25.

## Results (same expanded gold, n=18)
| layer | metric | BM25 | Hybrid | Δ (hybrid − bm25) |
|---|---|---|---|---|
| **overall** | nDCG@10 | 0.534 | **0.578** | **+0.043** |
| | recall@10 | 0.526 | 0.521 | −0.005 |
| | MRR | 0.690 | **0.789** | +0.099 |
| **conceptual** | nDCG@10 | 0.470 | **0.620** | **+0.150** |
| | recall@10 | 0.363 | 0.443 | +0.080 |
| | MRR | 0.681 | **1.000** | +0.319 |
| **topical** | nDCG@10 | 0.539 | **0.621** | +0.082 |
| | recall@10 | 0.383 | 0.394 | +0.011 |
| | MRR | 0.792 | **0.917** | +0.125 |
| **known_item** | nDCG@10 | 0.594 | **0.492** | **−0.102** |
| | recall@10 | 0.833 | 0.726 | −0.107 |
| | MRR | 0.597 | 0.449 | −0.148 |

## Reading the numbers
- **Conceptual: the hypothesis holds, strongly.** +0.150 nDCG@10 and **MRR 0.681 → 1.000** — on plain-language questions with low lexical overlap, dense semantics reliably lifts the on-point authority (Haida, Clyde River, Guerin, …) to rank 1. This is dense retrieval's clear win and the main reason to have it.
- **Topical: a solid, consistent lift** (+0.082 nDCG, MRR 0.792 → 0.917). Short keyword queries also benefit.
- **Known-item: dense *hurts* (−0.102 nDCG, MRR 0.597 → 0.449).** For an exact citation/party lookup ("2014 SCC 44", "Sparrow") BM25's token match already nails the target; blending dense in via RRF lets topically-similar neighbours outrank the exact case and dilutes precision.
- **Net:** the overall +0.043 masks a real divergence. Hybrid is not a free win everywhere.

## Actionable conclusion — route by query type
Do **not** apply hybrid uniformly. Detect the query shape and route:
- **Citation / party-name lookups → lexical (BM25) or an exact-citation matcher.** Dense is a net negative here.
- **Natural-language / conceptual questions → hybrid (dense + BM25).** This is where dense earns its cost.
- **Topical keywords → hybrid** (modest but consistent gain).

A lightweight query classifier (regex for neutral citations like `\d{4}\s+SCC\s+\d+`, short-proper-noun detection for party names) or a per-layer RRF weighting would capture the conceptual/topical lift while protecting known-item precision. This is the recommended follow-up before wiring dense into the portal's default search path.

## Provenance / caveats
- Vectors: Titan v2 in `us-east-1`, full corpus, one credentialed run (2026-07-02). Cost was a few $.
- Judgments remain **Claude-as-judge**, `rel-v1`, re-pooled with dense — consistency signal, not licensed-expert ground truth. The known-item discipline (no topical-neighbour additions) is the load-bearing methodological choice; revisiting it would change the known-item delta.

## Query routing (T5 confirmation, 2026-07-03 — real dense, `cases:eval:bedrock`)

The routing recommended above was implemented (spec `2026-07-02-query-routing-design.md`,
merged PR #91: `routeQuery` — citation regex + corpus-grounded case-name match →
BM25-only; everything else → hybrid) and measured with real Titan v2 dense on the same
expanded gold:

| layer | metric | BM25 | Hybrid (uniform) | **Routed** |
|---|---|---|---|---|
| **overall** | nDCG@10 | 0.534 | 0.578 | **0.612** |
| | recall@10 | 0.526 | 0.521 | **0.557** |
| | MRR | 0.690 | 0.789 | **0.838** |
| known_item | nDCG@10 | 0.594 | 0.492 | **0.594** |
| | MRR | 0.597 | 0.449 | **0.597** |
| conceptual | nDCG@10 | 0.470 | 0.620 | **0.620** |
| | MRR | 0.681 | 1.000 | **1.000** |
| topical | nDCG@10 | 0.539 | 0.621 | **0.621** |

- **Every success criterion met exactly:** known-item fully recovers to the BM25 line
  (the −0.102 hybrid regression is erased), conceptual/topical keep their full hybrid
  lift, overall beats uniform hybrid by +0.034 nDCG@10 (and +0.077 over BM25).
- **Classifier: 18/18 correctly routed** (6 known-item → BM25, 12 conceptual·topical
  → hybrid), with dense ON — matching the offline stub-run classification exactly
  (routing is deterministic and embedding-independent, as designed).
- Routed is now the portal's live search behavior (`hybridSearch` seam) wherever a
  query-time embedder is configured; without one it degrades to BM25-only as before.
