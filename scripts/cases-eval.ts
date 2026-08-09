// Retrieval-eval runner (spec §6). Scores BM25-only vs hybrid on the graded gold —
// builds the index ONCE, then per query runs rankWithSearcher(idx.searcher, q, null)
// [BM25] and rankWithSearcher(idx.searcher, q, queryVec) [hybrid].
//
// Ranks through idx.searcher, NOT idx.units: units are documented empty on the artifact
// path, and even on the scan path they rebuild an in-process full-precision index rather
// than the int8-rescored artifact searcher a user's query hits. Scoring the searcher is
// what makes this measure the product (spec 2026-08-02).
//
// Read-only. Honest degradation: no gold → "unvalidated" exit 0; no matching vectors
// → dense skipped (BM25 column only). `--pool` emits an adjudication worklist instead.
// Dishonest degradation is NOT allowed: a run that measured nothing exits non-zero via
// evalAbortReason rather than printing a scorecard of zeros.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import { getSearchIndex } from "../src/lib/cases/search/build-index";
import { getEmbedder, type Embedder } from "../src/lib/cases/search/embedder";
import { rankWithSearcher, type Searcher } from "../src/lib/cases/search/hybrid";
import { evalAbortReason } from "../src/lib/cases/validate/eval-guards";
import { routeQuery } from "../src/lib/cases/search/route";
import { scoreQuery, aggregate, poolCandidates, type GoldQuery, type Aggregate } from "../src/lib/cases/validate/retrieval";
import { EVAL_QUERIES } from "../src/lib/cases/validate/eval-queries";

const GOLD = process.env.GOLD_FILE ?? "docs/research/gold/cases-retrieval-gold.jsonl";
const POOL_K = 20;
// Extras are capped and the cap is reported, because judging cost scales with the pool and an
// unbounded citation graph would silently multiply it.
const NEIGHBOUR_SEEDS = 5;
const MAX_EXTRAS = 10;

async function loadGold(): Promise<GoldQuery[] | null> {
  let text: string;
  try { text = await fs.readFile(GOLD, "utf8"); } catch { return null; }
  return text.trim().split(/\n+/).filter(Boolean).map((l) => JSON.parse(l) as GoldQuery);
}

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

const fmt = (a: Aggregate): string =>
  `nDCG@10=${a.ndcg10.toFixed(3)} recall@10=${a.recall10.toFixed(3)} MRR=${a.mrr.toFixed(3)} (n=${a.n})`;

async function scoreMode(): Promise<void> {
  const gold = await loadGold();
  if (!gold) { console.log(`ℹ️  no gold at ${GOLD} — retrieval UNVALIDATED.`); return; }
  const idx = await getSearchIndex();
  const embedder = getEmbedder();
  const bm25Scores = [], hybridScores = [], routedScores = [];
  let denseAny = false;
  let emptyLists = 0, totalLists = 0;
  const misroutes: string[] = [];
  for (const g of gold) {
    const { bm25, hybrid, denseOn } = await rankBoth(idx.searcher, g.query, embedder, idx.embedderId, idx.vdim);
    emptyLists += (bm25.length === 0 ? 1 : 0) + (hybrid.length === 0 ? 1 : 0);
    totalLists += 2;
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
  console.log(`BM25   overall: ${fmt(b.overall)}`);
  console.log(`Hybrid overall: ${fmt(h.overall)}`);
  console.log(`Routed overall: ${fmt(rt.overall)}`);
  console.log(`Δ nDCG@10  hybrid−bm25 = ${(h.overall.ndcg10 - b.overall.ndcg10).toFixed(3)} · routed−bm25 = ${(rt.overall.ndcg10 - b.overall.ndcg10).toFixed(3)} · routed−hybrid = ${(rt.overall.ndcg10 - h.overall.ndcg10).toFixed(3)}`);
  for (const layer of Object.keys(h.byLayer))
    console.log(`  [${layer}] BM25 ${fmt(b.byLayer[layer])} | Hybrid ${fmt(h.byLayer[layer])} | Routed ${fmt(rt.byLayer[layer])}`);
  console.log(`classifier: ${gold.length - misroutes.length}/${gold.length} correctly routed${misroutes.length ? " · misroutes: " + misroutes.join(", ") : ""}`);
}

async function poolMode(): Promise<void> {
  const idx = await getSearchIndex();
  const embedder = getEmbedder();
  const worklist: { qid: string; query: string; layer: string; candidates: string[] }[] = [];
  let extrasAdded = 0;
  for (const q of EVAL_QUERIES) {
    const { bm25, hybrid } = await rankBoth(idx.searcher, q.query, embedder, idx.embedderId, idx.vdim);
    // Pool every system scoreMode scores. routed adds NOTHING today and that is not an oversight:
    // it is a per-query selector between these same two lists, so its candidates are already a
    // subset of the union. It is passed so the pool stays correct if routed ever becomes a genuine
    // merged ranking, which is the change that would silently reintroduce single-system bias.
    const routed = routeQuery(q.query, idx).useDense ? hybrid : bm25;
    // This is the line that actually changes the pool, and the defect that is real: with `[]`
    // extras, every judged case is one the retrievers themselves retrieved, so a relevant case
    // neither finds is invisible rather than missed, and recall@10 is really POOLED recall.
    // Citation-graph neighbours are picked by who-cited-whom — a signal neither retriever ranks
    // on — so they are the one source of candidates a lexical and a dense retriever can both miss.
    const base = poolCandidates([bm25, hybrid, routed], [], POOL_K);
    const neighbours: string[] = [];
    for (const id of base.slice(0, NEIGHBOUR_SEEDS)) {
      const c = idx.cases.get(id);
      for (const cited of c?.casesCited ?? []) {
        if (neighbours.length >= MAX_EXTRAS) break;
        const hit = [...idx.cases.values()].find((x) => x.citation === cited);
        if (hit && !base.includes(hit.id) && !neighbours.includes(hit.id)) neighbours.push(hit.id);
      }
    }
    extrasAdded += neighbours.length;
    worklist.push({ qid: q.qid, query: q.query, layer: q.layer, candidates: poolCandidates([bm25, hybrid, routed], neighbours, POOL_K) });
  }
  console.error(`pooled ${worklist.length} queries · ${extrasAdded} citation-graph extra(s) added · POOL_K=${POOL_K} MAX_EXTRAS=${MAX_EXTRAS}`);
  console.log(JSON.stringify(worklist, null, 2));
}

const run = process.argv.includes("--pool") ? poolMode : scoreMode;
run().catch((e) => { console.error("❌ cases-eval failed:", e); process.exit(1); });
