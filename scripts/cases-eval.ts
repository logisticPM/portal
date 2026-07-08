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
import { routeQuery } from "../src/lib/cases/search/route";
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
