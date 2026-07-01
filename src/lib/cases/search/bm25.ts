// In-process BM25 (Robertson/Sparck-Jones). k1=1.2, b=0.75 (standard). Lexical
// matching guarantees exact legal tokens (neutral citations, section numbers) are
// findable — the property dense embeddings blur (spec §2, BEIR). No stemming / no
// stopword removal: deterministic, and stopwords already get near-zero idf weight.
export function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export interface Bm25Doc {
  id: string;
  tokens: string[];
}

export class Bm25 {
  private readonly k1: number;
  private readonly b: number;
  private readonly docs: Bm25Doc[];
  private readonly df = new Map<string, number>();   // document frequency
  private readonly len = new Map<string, number>();  // doc length in tokens
  private readonly avgdl: number;

  constructor(docs: Bm25Doc[], k1 = 1.2, b = 0.75) {
    this.docs = docs;
    this.k1 = k1;
    this.b = b;
    let total = 0;
    for (const d of docs) {
      this.len.set(d.id, d.tokens.length);
      total += d.tokens.length;
      for (const t of new Set(d.tokens)) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avgdl = docs.length ? total / docs.length : 0;
  }

  private idf(term: string): number {
    const n = this.df.get(term) ?? 0;
    // BM25 idf with +1 smoothing → always > 0 for present terms
    return Math.log(1 + (this.docs.length - n + 0.5) / (n + 0.5));
  }

  // Returns docs with score > 0, sorted by score desc then id asc (deterministic).
  search(queryTokens: string[]): { id: string; score: number }[] {
    if (!queryTokens.length) return [];
    const q = [...new Set(queryTokens)].filter((t) => this.df.has(t));
    const out: { id: string; score: number }[] = [];
    for (const d of this.docs) {
      const dl = this.len.get(d.id) ?? 0;
      const tf = new Map<string, number>();
      for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const term of q) {
        const f = tf.get(term) ?? 0;
        if (!f) continue;
        const denom = f + this.k1 * (1 - this.b + (this.b * dl) / (this.avgdl || 1));
        score += this.idf(term) * ((f * (this.k1 + 1)) / denom);
      }
      if (score > 0) out.push({ id: d.id, score });
    }
    return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }
}
