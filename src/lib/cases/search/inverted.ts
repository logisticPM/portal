// Inverted-index BM25 with EXACT parity to ./bm25.ts (same constants, same idf,
// same tie-break, same float accumulation order). A query touches only its own
// terms' postings lists → ms-level scoring instead of an O(corpus) pass per query.
// Built once (at artifact build or index load), reused for every query.

export interface InvertedIndex {
  ids: string[];              // docIdx → id
  n: number;
  avgdl: number;
  docLen: Uint32Array;        // per docIdx
  terms: Map<string, { df: number; start: number }>; // start = pair offset into postings
  postings: Uint32Array;      // packed pairs (docIdx, tf), grouped per term
}

export function buildInverted(docs: { id: string; tokens: string[] }[]): InvertedIndex {
  const ids = docs.map((d) => d.id);
  const docLen = new Uint32Array(docs.length);
  let total = 0;
  // term → Map<docIdx, tf>, built in first-appearance order (Map preserves insertion)
  const acc = new Map<string, Map<number, number>>();
  docs.forEach((d, i) => {
    docLen[i] = d.tokens.length;
    total += d.tokens.length;
    for (const t of d.tokens) {
      let m = acc.get(t);
      if (!m) acc.set(t, (m = new Map()));
      m.set(i, (m.get(i) ?? 0) + 1);
    }
  });
  let pairs = 0;
  for (const m of acc.values()) pairs += m.size;
  const postings = new Uint32Array(pairs * 2);
  const terms = new Map<string, { df: number; start: number }>();
  let cursor = 0;
  for (const [t, m] of acc) {
    terms.set(t, { df: m.size, start: cursor });
    for (const [docIdx, tf] of m) { postings[cursor * 2] = docIdx; postings[cursor * 2 + 1] = tf; cursor++; }
  }
  return { ids, n: docs.length, avgdl: docs.length ? total / docs.length : 0, docLen, terms, postings };
}

// Identical math to Bm25.search: idf = log(1+(N-df+0.5)/(df+0.5)); per-doc score
// accumulated in deduped first-appearance query-term order (float-order parity).
// DO NOT reorder/parallelize the term loop or restructure the accumulator — the
// per-doc sum must accumulate in this exact order to stay bit-identical to bm25.ts
// (float addition is non-associative; a reorder can pass small fixtures yet drift
// on the real corpus, silently invalidating published eval numbers).
export function scoreInverted(idx: InvertedIndex, queryTokens: string[], k1 = 1.2, b = 0.75): { id: string; score: number }[] {
  if (!queryTokens.length) return [];
  const q = [...new Set(queryTokens)].filter((t) => idx.terms.has(t));
  const scores = new Map<number, number>(); // docIdx → score
  for (const term of q) {
    const { df, start } = idx.terms.get(term)!;
    const idf = Math.log(1 + (idx.n - df + 0.5) / (df + 0.5));
    for (let p = start; p < start + df; p++) {
      const docIdx = idx.postings[p * 2];
      const f = idx.postings[p * 2 + 1];
      const dl = idx.docLen[docIdx];
      const denom = f + k1 * (1 - b + (b * dl) / (idx.avgdl || 1));
      scores.set(docIdx, (scores.get(docIdx) ?? 0) + idf * ((f * (k1 + 1)) / denom));
    }
  }
  const out: { id: string; score: number }[] = [];
  for (const [docIdx, score] of scores) if (score > 0) out.push({ id: idx.ids[docIdx], score });
  return out.sort((a, b2) => b2.score - a.score || a.id.localeCompare(b2.id));
}
