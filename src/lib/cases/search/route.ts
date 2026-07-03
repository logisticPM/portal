// Query-type routing (spec 2026-07-02). Pure + deterministic (no network, no key):
// decides whether a query should use the dense retriever. Stage 2 showed dense HURTS
// exact citation/case-name lookups (RRF pulls topical neighbours above the exact
// match) while helping conceptual/topical — so known-item queries route to BM25-only.
import { tokenize } from "./bm25";
import type { SearchIndex } from "./build-index";

export type RouteReason = "citation" | "case_name" | "semantic";
export interface QueryRoute {
  useDense: boolean; // false ⇒ known-item ⇒ BM25-only
  reason: RouteReason;
}

// Canadian court abbreviations used in neutral citations + reporter/slug forms.
const COURTS = "SCC|SCR|FCA|FC|BCCA|BCSC|ONCA|ONSC|NSCA|NSSC|ABCA|ABQB|SKCA|MBCA|QCCA|QCCS|YKCA|NLCA|PECA|TCC|CHRT";
const CITATION_RES: RegExp[] = [
  new RegExp(`\\b\\d{4}\\s+(?:${COURTS})\\s+\\d+\\b`, "i"),          // neutral: 2014 SCC 44
  /\[\d{4}\]\s+\d+\s+s\.?\s?c\.?\s?r\.?\s+\d+/i,                     // reporter: [1990] 1 SCR 1075
  /\b\d{4}-[a-z]{2,6}-\d+\b/i,                                       // slug id: 2004-scc-73
];

const MAX_NAME_TOKENS = 5; // a longer query is a question, not a name lookup
// Generic party tokens: a query made ONLY of these must not count as a case-name hit.
const GENERIC = new Set([
  "canada", "british", "columbia", "ontario", "quebec", "alberta", "saskatchewan",
  "manitoba", "yukon", "nova", "scotia", "brunswick", "the", "queen", "king", "r",
  "v", "c", "attorney", "general", "minister", "first", "nation", "nations", "band",
  "indian", "canadian", "her", "his", "majesty", "of", "and", "re",
]);

// Contiguous-subsequence test: is `needle` a run of tokens inside `hay`?
function containsSeq(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

// Tokenized styleOfCause per case, computed once per index object (memoized).
const nameCache = new WeakMap<SearchIndex, string[][]>();
function nameSeqs(index: SearchIndex): string[][] {
  let seqs = nameCache.get(index);
  if (!seqs) {
    seqs = [];
    for (const c of index.cases.values()) {
      const toks = tokenize(c.styleOfCause ?? "");
      if (toks.length) seqs.push(toks);
    }
    nameCache.set(index, seqs);
  }
  return seqs;
}

export function routeQuery(query: string, index: SearchIndex): QueryRoute {
  if (CITATION_RES.some((re) => re.test(query))) return { useDense: false, reason: "citation" };
  const q = tokenize(query);
  if (q.length >= 1 && q.length <= MAX_NAME_TOKENS && !q.every((t) => GENERIC.has(t))) {
    for (const seq of nameSeqs(index)) if (containsSeq(seq, q)) return { useDense: false, reason: "case_name" };
  }
  return { useDense: true, reason: "semantic" };
}
