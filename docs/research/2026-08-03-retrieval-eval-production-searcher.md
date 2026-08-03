# Retrieval Evaluation — First Measurement of the Searcher Users Query

**Date:** 2026-08-03 · **Branch:** `fix/eval-measures-production` · harness: `cases:eval:cloud`
(spec `docs/superpowers/specs/2026-08-02-eval-measures-production-design.md`)

## Setup (methodology, stated up front)

- **Index source:** the S3 artifact production loads — `source=artifact`,
  `build=1785455243384-lggv3qwx`, **built 2026-07-30**, 5,453 cases. This is the
  int8-quantized, rescored searcher a user's query actually hits.
- **Embedder:** `bedrock:amazon.titan-embed-text-v2:0`, dim 1024. `dense=ON`.
- **Query set:** 18 queries, layered 6/6/6 — `known_item` (citation / party name),
  `conceptual` (plain language, low lexical overlap), `topical` (broad theme).
  Source: `src/lib/cases/validate/eval-queries.ts`.
- **Relevance judgments:** **LLM-as-judge**, rubric `rel-v1`, 140 judged case ids across the
  18 queries. **Not licensed-practitioner judgment.** Gold:
  `docs/research/gold/cases-retrieval-gold.jsonl`.
- **Metrics:** nDCG@10 (graded), recall@10 (rel≥1), MRR.

## Why this run is not comparable to the 2026-06-30 baseline

The earlier result (`docs/research/2026-06-30-retrieval-eval-results.md`, nDCG@10 0.403)
scored a **different searcher**. Until this branch, `cases-eval.ts` ranked with
`hybridRank(idx.units, …)`, which is `rankWithSearcher(makeInMemorySearcher(units), …)` — an
inverted index rebuilt in-process with full-precision cosine. Production ranks with the
artifact-backed searcher: prebuilt BM25, int8 vectors with rescore.

Today's BM25 column reads 0.405 against the old 0.403. **That near-identity is a
coincidence between two different instruments, not evidence of stability.** The two numbers
should not be placed in the same table.

The eval also never ran against the cloud corpus before, because `cases:eval:cloud` did not
set `INDEX_BUCKET` and therefore fell back to scanning 43k items one page at a time — a run
left going for 90 minutes had not finished, at ~1.6% CPU (pure network wait).

## Results

```
BM25   overall: nDCG@10=0.405  recall@10=0.415  MRR=0.613  (n=18)
Hybrid overall: nDCG@10=0.472  recall@10=0.496  MRR=0.714  (n=18)
Routed overall: nDCG@10=0.492  recall@10=0.441  MRR=0.801  (n=18)

Δ nDCG@10   hybrid−bm25 = +0.068 · routed−bm25 = +0.088 · routed−hybrid = +0.020
classifier: 18/18 correctly routed
```

Dense retrieval earns its place: +0.068 nDCG@10 over lexical alone, and MRR moves 0.613 →
0.801, i.e. the first correct result arrives materially higher up the list.

## By layer — and the one place dense makes things worse

| layer | BM25 nDCG@10 | Hybrid nDCG@10 | BM25 MRR | Hybrid MRR |
|---|---:|---:|---:|---:|
| conceptual | 0.426 | **0.545** | 0.690 | **1.000** |
| topical | 0.328 | **0.472** | 0.576 | **0.833** |
| known_item | **0.460** | 0.400 ↓ | **0.571** | 0.309 ↓ |

**`conceptual` MRR is 1.000** — all six plain-language queries put a relevant case first.

**`known_item` is where hybrid loses.** Asking for a citation or a party name, semantic
similarity pushes lexically exact matches down: nDCG 0.460 → 0.400, MRR 0.571 → 0.309.

This is the strongest result in the run, because it validates a design decision that until
now rested on intuition. `routeQuery` sends known-item queries to BM25 and everything else
to hybrid; it classified **18/18 correctly**, and the Routed row recovers known_item's 0.460
while keeping the conceptual and topical gains. **The router is not fastidiousness — it is
worth +0.088 nDCG over BM25 and +0.020 over always-hybrid, and without it every citation
lookup would be measurably worse.**

## What this does NOT establish

- **Not an answer to "can Legal info answer questions correctly."** This measures whether
  the retriever surfaces relevant *cases* for 18 queries. Briefing quality — whether the
  generated answer is right and properly anchored — is a separate question. The claim-level
  measurement for that is `docs/research/2026-07-31-claim-drop-forensics.md`.
- **Not validated by practitioners.** Relevance is LLM-as-judge. The datasheet's standing
  caveat holds: absent human-labelled gold, the corpus is exploratory. RM-3 is the item that
  changes this, and it is still open.
- **Not a current-corpus measurement.** The artifact was built 2026-07-30; the corpus has
  moved since (3 cases promoted 2026-08-01). No staleness warning fired, so nothing ingested
  after the build is missing from the index — but the vectors are a three-day-old snapshot.
- **n=18.** Six queries per layer. A 0.06 difference on six queries is a direction, not a
  precise effect size.

## Guard behaviour

This run could not have produced a false scorecard. Verified end-to-end before it: pointed
at a locally built, valid-but-empty artifact (`buildArtifacts({units: [], cases: new Map()})`,
384 bytes, zero AWS calls), the runner printed the provenance line, then:

```
❌ this run measured nothing — index is empty (0 cases) — nothing to score.
EXIT=1
```

Zero `overall:` lines emitted. On 2026-08-02, the same class of input produced three rows of
zeros and exit 0.

## Open

- **The artifact-load fallback is silent by design.** When the artifact cannot be read, the
  index falls back to a table scan and the run continues against a *different searcher*,
  with one `console.warn`. The report now prints `source=`, so a reader can see it — but a
  run intended to measure production can still quietly measure something else. Observed once
  during this work (expired token); harmless there because the scan then failed too.
- **4 gold case ids are absent from the corpus** (`tsilhqotin-2014`, `haida-2004`,
  `fort-mckay-2020`, `calder-1973`) — old curated slugs, 4 of 140. They depress recall
  slightly and equally across all three modes.
