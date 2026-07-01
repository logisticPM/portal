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
