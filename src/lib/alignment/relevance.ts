// ===========================================================================
// Deterministic capability relevance — a REAL, offline, zero-cost topical signal
// between a procurement commitment and each candidate supplier. Reuses the cases
// module's in-process BM25 (lexical term overlap), so "relevance" is genuine even
// with no embedder configured — unlike the old stub-embedding cosine, which was
// documented as "NOT semantically meaningful". This is what lets cross-sector
// capability matches (e.g. a "catering" supplier for a "catering" target in a
// different RAP sector) surface without a paid embedder.
// ===========================================================================
import { Bm25, tokenize } from "../cases/search/bm25";

// BM25 scores for the pool against the commitment query, normalized to [0,1] by
// the batch max (so the best in-pool match ≈ 1). Returns an array aligned to
// `suppliers`; suppliers with no lexical overlap score 0.
export function bm25Relevance(
  commitmentText: string,
  suppliers: { id: string; text: string }[],
): number[] {
  if (suppliers.length === 0) return [];
  const bm25 = new Bm25(suppliers.map((s) => ({ id: s.id, tokens: tokenize(s.text) })));
  const hits = bm25.search(tokenize(commitmentText)); // score-desc, score > 0 only
  const byId = new Map(hits.map((h) => [h.id, h.score]));
  const max = hits.length ? hits[0].score : 0;
  return suppliers.map((s) => (max > 0 ? (byId.get(s.id) ?? 0) / max : 0));
}
