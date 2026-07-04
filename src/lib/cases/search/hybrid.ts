// Pure hybrid fusion: BM25 + dense cosine ranks fused by Reciprocal Rank Fusion
// (Cormack SIGIR'09, k=60), aggregated to the case by MAX over its retrieval units
// (a strong single passage is the signal; sum would bias toward long judgments).
import { tokenize } from "./bm25";
import { buildInverted, scoreInverted, type InvertedIndex } from "./inverted";
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

// Pluggable search backend: the in-memory impl is built from RetrievalUnits (scan
// fallback, tests, eval); the artifact impl (see ./artifact.ts, Task 3) is loaded
// from a prebuilt binary. hybridRank keeps its signature as a thin wrapper so
// existing callers/tests/eval are unchanged — parity by construction.
export interface Searcher {
  bm25Rank(query: string): { id: string }[];             // pre-sorted
  denseRank(queryVec: Float32Array): { id: string }[];   // pre-sorted; [] when no usable vectors
  caseOf(unitId: string): string | undefined;
}

export function makeInMemorySearcher(units: RetrievalUnit[]): Searcher {
  const inv: InvertedIndex = buildInverted(units.map((u) => ({ id: u.unitId, tokens: tokenize(u.text) })));
  const unitCase = new Map(units.map((u) => [u.unitId, u.caseId]));
  return {
    bm25Rank: (query) => scoreInverted(inv, tokenize(query)).map((r) => ({ id: r.id })),
    denseRank: (queryVec) =>
      units
        // length guard: never dot vectors of different dims (would yield NaN and
        // silently corrupt the dense ranking). Mismatched-dim vecs are simply skipped.
        .filter((u) => u.vec && u.vec.length === queryVec.length)
        .map((u) => ({ id: u.unitId, score: dot(queryVec, u.vec!) }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .map((r) => ({ id: r.id })),
    caseOf: (unitId) => unitCase.get(unitId),
  };
}

// Rank cases for a query using a Searcher backend. queryVec === null → BM25-only
// (dense path skipped).
export function rankWithSearcher(
  s: Searcher,
  query: string,
  queryVec: Float32Array | null,
  k = 60,
): HybridResult[] {
  const lists: { id: string }[][] = [s.bm25Rank(query)];
  if (queryVec) lists.push(s.denseRank(queryVec));

  const fused = rrf(lists, k);
  const byCase = new Map<string, number>();
  for (const [unitId, score] of fused) {
    const caseId = s.caseOf(unitId);
    if (!caseId) continue;
    byCase.set(caseId, Math.max(byCase.get(caseId) ?? 0, score));
  }
  return [...byCase.entries()]
    .map(([caseId, score]) => ({ caseId, score }))
    .sort((a, b) => b.score - a.score || a.caseId.localeCompare(b.caseId));
}

// Rank cases for a query. queryVec === null → BM25-only (dense path skipped).
// Thin wrapper over rankWithSearcher + makeInMemorySearcher for signature-compatible
// existing callers (route handlers, eval scripts, tests).
export function hybridRank(
  units: RetrievalUnit[],
  query: string,
  queryVec: Float32Array | null,
  k = 60,
): HybridResult[] {
  return rankWithSearcher(makeInMemorySearcher(units), query, queryVec, k);
}
