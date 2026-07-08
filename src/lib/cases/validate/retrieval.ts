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
