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

export function routeQuery(query: string, _index: SearchIndex): QueryRoute {
  if (CITATION_RES.some((re) => re.test(query))) return { useDense: false, reason: "citation" };
  return { useDense: true, reason: "semantic" };
}
