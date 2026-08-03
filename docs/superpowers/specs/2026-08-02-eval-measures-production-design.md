# The Retrieval Eval Does Not Measure the Retrieval Users Get

**Date:** 2026-08-02 · **Status:** proposed (design), pre-implementation
**Domain:** `scripts/cases-eval.ts`, `package.json` (eval scripts)

## What happened

Pointing the eval at the S3 index artifact — the same artifact production loads — produced
a complete scorecard of zeros:

```
gold=18 queries · embedder=bedrock:amazon.titan-embed-text-v2:0 · dense=ON
BM25   overall: nDCG@10=0.000 recall@10=0.000 MRR=0.000 (n=18)
Hybrid overall: nDCG@10=0.000 recall@10=0.000 MRR=0.000 (n=18)
classifier: 18/18 correctly routed
```

It exited 0. Nothing warned. The gold is fine — 136 of its 140 judged case ids are in the
corpus, and the index reported `cases=5453`.

The cause is one field:

```ts
// build-index.ts:38
units: RetrievalUnit[];   // empty when artifact-backed (units are baked into searcher)
```

`cases-eval.ts` ranks with `hybridRank(idx.units, …)`. On the artifact path `units` is `[]`,
so all 18 queries ranked an empty corpus, every ranked list came back empty, and every
metric was legitimately 0.

## The real defect is not the zeros

`hybridRank(units, …)` is exactly `rankWithSearcher(makeInMemorySearcher(units), …)`, so the
**ranking algorithm** the eval exercises is the one production uses. What differs is the
**searcher underneath it**:

| | eval today | production (`repo.dynamo.ts:128`) |
|---|---|---|
| index | `makeInMemorySearcher(units)` — inverted index rebuilt in process | artifact-backed, prebuilt |
| vectors | full-precision `Float32Array` cosine | int8 quantized + rescore (#207) |
| source | table scan only | S3 artifact |

So even when the eval *does* produce numbers — the 2026-06-30 baseline of nDCG@10 0.403 —
it is scoring a searcher that no user ever queries. Quantization is exactly the kind of
change that moves ranking, and it is invisible to the current harness by construction.

Two consequences, and the second is the one that matters:

1. **`cases:eval:cloud` never sets `INDEX_BUCKET`,** so it always falls back to scanning the
   whole table item-by-item — 43k items including vectors. A run left going for 90 minutes
   had not finished; CPU sampling showed ~1.6% utilisation, i.e. pure network wait. That is
   why this eval has effectively never been run against the cloud corpus.
2. **A harness whose input was empty reported a scorecard instead of failing.** Every number
   it printed was arithmetically correct and collectively meaningless. This is the same
   failure mode the drop-forensics work kept hitting, now in the instrument itself.

## Changes

### 1. Score the searcher, not the units

`rankBoth` takes `Searcher` instead of `RetrievalUnit[]` and calls `rankWithSearcher`. Both
call sites change (`scoreMode` and the `--pool` worklist). The scan path is unaffected — it
already builds a searcher from its units — so the eval keeps working there **and** starts
working on the artifact path, where it measures what production measures.

### 2. Refuse to emit a scorecard that measures nothing

Three aborts, before any metric is printed:

- **`idx.cases.size === 0`** → the index is empty; nothing can be scored.
- **Every query returned an empty ranked list** → the retriever found nothing for any of 18
  queries. That is not a score of zero; it is a broken index.
- **Every metric across every mode is exactly 0** → the last-resort guard. A real corpus
  cannot miss all 140 judged cases across 18 queries in three modes; identical exact zeros
  mean the instrument, not the retriever.

Each aborts non-zero with what to check. **A zero must be earned, not defaulted to.**

Note the third guard subsumes the second, and both are kept deliberately: the second names
the cause precisely ("retriever returned nothing"), while the third catches the case where
lists are non-empty but disjoint from every judgment — a different bug with the same
signature.

### 3. Make the fast path the default

`cases:eval:cloud` sets `INDEX_BUCKET` so it loads the artifact instead of scanning. A
separate `cases:eval:scan` keeps the table-scan path for when the artifact is stale or
absent, and the run prints which source it used, because the two are no longer
interchangeable — they now measure different searchers, and the report must say which.

### 4. Report the artifact's build id and age

The artifact is built by a separate job; the corpus moves underneath it. `loadArtifacts`
already returns `buildId`. Print it with the results, plus a warning when the artifact
predates the newest case in the corpus, so a stale measurement is visible as stale rather
than being read as current.

## Explicitly NOT doing

- **No change to ranking, scoring, fusion, or the router.** `rankWithSearcher`, `scoreQuery`,
  `aggregate`, `routeQuery` are untouched. This spec changes what gets fed in and what
  happens when the answer is degenerate.
- **No change to the gold set.** The 4 missing ids (`tsilhqotin-2014`, `haida-2004`,
  `fort-mckay-2020`, `calder-1973`) are old curated slugs and are a separate question —
  they are 4 of 140 and cannot explain a total zero.
- **No re-baselining.** Producing a new number is the *next* step and belongs with its own
  interpretation; this spec makes the instrument trustworthy first.
- **No artifact rebuild.**

## Testing

`scripts/test-cases-eval-guards.ts`, offline, with a stub `Searcher`:

- A searcher returning results that hit the gold → metrics > 0, exit 0.
- A searcher returning `[]` for every query → **aborts**, non-zero, names the empty-retriever
  cause. Asserted on the exit path, not just the message.
- A searcher returning plausible-but-wrong ids (disjoint from all judgments) → **aborts** via
  the all-zero guard, and the message distinguishes this from the empty case.
- An index with `cases.size === 0` → aborts before any query runs.
- A searcher hitting some gold but not all → metrics between 0 and 1, exit 0, **no abort**.
  This is the regression that keeps the guards from firing on a genuinely poor retriever.

That last case is the important one: the guards must not turn "retrieval is bad" into a
crash. Only "retrieval measured nothing" aborts.

## Success criteria

- The eval scores the artifact-backed searcher — the one users query.
- `cases:eval:cloud` completes in minutes, not never.
- No configuration produces a scorecard of zeros; a degenerate run exits non-zero.
- The report states which index source and which artifact build produced the numbers.
- A genuinely bad retriever still reports its bad numbers rather than aborting.
