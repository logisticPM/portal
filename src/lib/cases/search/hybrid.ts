// Pure hybrid fusion: BM25 + dense cosine ranks fused by Reciprocal Rank Fusion
// (Cormack SIGIR'09, k=60), aggregated to the case by MAX over its retrieval units
// (a strong single passage is the signal; sum would bias toward long judgments).
import { Bm25, tokenize } from "./bm25";
import type { LegalCase } from "../types";

export interface RetrievalUnit {
  unitId: string;   // `${caseId}#meta` or `${caseId}#chunk#<idx>`
  caseId: string;
  text: string;
  vec?: Float32Array; // present only for embedded chunk units
}
export interface HybridResult {
  caseId: string;
  score: number;
}

// Dot product. Vectors are L2-normalized by embedder contract, so dot == cosine.
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// Reciprocal Rank Fusion. rank = index in each pre-sorted list.
export function rrf(lists: { id: string }[][], k = 60): Map<string, number> {
  const m = new Map<string, number>();
  for (const list of lists)
    list.forEach((item, rank) => m.set(item.id, (m.get(item.id) ?? 0) + 1 / (k + rank)));
  return m;
}

// Compact lexical doc for a case's metadata so exact-token queries (citation, name,
// nation) hit via BM25 even though those fields aren't in the body chunks (spec §6).
export function metaText(c: Pick<LegalCase, "citation" | "citation2" | "styleOfCause" | "nations" | "outcome">): string {
  return [c.citation, c.citation2 ?? "", c.styleOfCause, c.nations.join(" "), c.outcome.holding]
    .filter(Boolean)
    .join(" ");
}

// Rank cases for a query. queryVec === null → BM25-only (dense path skipped).
export function hybridRank(
  units: RetrievalUnit[],
  query: string,
  queryVec: Float32Array | null,
  k = 60,
): HybridResult[] {
  const bm = new Bm25(units.map((u) => ({ id: u.unitId, tokens: tokenize(u.text) })));
  const lists: { id: string }[][] = [bm.search(tokenize(query)).map((r) => ({ id: r.id }))];

  if (queryVec) {
    const dense = units
      // length guard: never dot vectors of different dims (would yield NaN and
      // silently corrupt the dense ranking). Mismatched-dim vecs are simply skipped.
      .filter((u) => u.vec && u.vec.length === queryVec.length)
      .map((u) => ({ id: u.unitId, score: dot(queryVec, u.vec!) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .map((r) => ({ id: r.id }));
    lists.push(dense);
  }

  const fused = rrf(lists, k);
  const unitCase = new Map(units.map((u) => [u.unitId, u.caseId]));
  const byCase = new Map<string, number>();
  for (const [unitId, score] of fused) {
    const caseId = unitCase.get(unitId);
    if (!caseId) continue;
    byCase.set(caseId, Math.max(byCase.get(caseId) ?? 0, score));
  }
  return [...byCase.entries()]
    .map(([caseId, score]) => ({ caseId, score }))
    .sort((a, b) => b.score - a.score || a.caseId.localeCompare(b.caseId));
}
