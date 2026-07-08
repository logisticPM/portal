// Versioned retrieval-eval query set (spec §2). Layered so the report can attribute
// where hybrid helps: known_item (lexical/BM25 — citation/party name → the exact
// case), conceptual (semantic/dense — natural language, low lexical overlap with the
// target's wording), topical (broad theme). Wave B set (~18) over the full corpus.
// Changing this changes the eval surface, so it is versioned on purpose.
export interface EvalQuery { qid: string; query: string; layer: "known_item" | "conceptual" | "topical"; }

export const EVAL_QUERIES: EvalQuery[] = [
  // known_item — exact tokens (neutral citation or party name); BM25 must win here
  { qid: "known-001", query: "2014 SCC 44", layer: "known_item" },
  { qid: "known-002", query: "2004 SCC 73", layer: "known_item" },
  { qid: "known-003", query: "Delgamuukw", layer: "known_item" },
  { qid: "known-004", query: "Sparrow", layer: "known_item" },
  { qid: "known-005", query: "Guerin", layer: "known_item" },
  { qid: "known-006", query: "Mikisew Cree", layer: "known_item" },

  // conceptual — plain-language questions, deliberately avoiding the doctrinal terms
  { qid: "conceptual-001", query: "When must government talk to Indigenous groups before permitting a pipeline or mine?", layer: "conceptual" },
  { qid: "conceptual-002", query: "Can Indigenous groups claim ownership of land they never signed away by treaty?", layer: "conceptual" },
  { qid: "conceptual-003", query: "What limits the government's power to restrict Indigenous fishing or hunting?", layer: "conceptual" },
  { qid: "conceptual-004", query: "Does the Crown owe a trust-like obligation when managing reserve land or resources?", layer: "conceptual" },
  { qid: "conceptual-005", query: "Are Métis and non-status people covered by federal responsibility for Indians?", layer: "conceptual" },
  { qid: "conceptual-006", query: "Getting compensated for broken promises in a historic treaty", layer: "conceptual" },

  // topical — broad theme queries (reuse/expand THEME_QUERIES)
  { qid: "topical-001", query: "aboriginal title", layer: "topical" },
  { qid: "topical-002", query: "duty to consult", layer: "topical" },
  { qid: "topical-003", query: "treaty rights", layer: "topical" },
  { qid: "topical-004", query: "fiduciary duty", layer: "topical" },
  { qid: "topical-005", query: "resource revenue sharing", layer: "topical" },
  { qid: "topical-006", query: "self-government", layer: "topical" },
];
