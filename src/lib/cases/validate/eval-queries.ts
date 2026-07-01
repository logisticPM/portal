// Versioned retrieval-eval query set (spec §2). Layered so the report can attribute
// where hybrid helps: known_item (lexical/BM25), conceptual (semantic/dense), topical
// (broad). This is the Wave-A starter over the seeded fixtures; Wave B expands to
// ~30–50 against the full corpus. Changing this changes the eval surface.
export interface EvalQuery { qid: string; query: string; layer: "known_item" | "conceptual" | "topical"; }

export const EVAL_QUERIES: EvalQuery[] = [
  { qid: "known-001", query: "2014 SCC 44", layer: "known_item" },
  { qid: "known-002", query: "Haida Nation", layer: "known_item" },
  { qid: "conceptual-001", query: "the Crown's obligation to consult First Nations before approving resource projects", layer: "conceptual" },
  { qid: "conceptual-002", query: "judicial recognition that Indigenous peoples hold title to their traditional lands", layer: "conceptual" },
  { qid: "topical-001", query: "aboriginal title", layer: "topical" },
  { qid: "topical-002", query: "duty to consult", layer: "topical" },
];
