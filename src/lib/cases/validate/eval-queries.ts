// Versioned retrieval-eval query set (spec §2). Layered so the report can attribute
// where hybrid helps: known_item (lexical/BM25 — citation/party name → the exact
// case), conceptual (semantic/dense — natural language, low lexical overlap with the
// target's wording), topical (broad theme). Wave C set (50, layered 17/17/16) over
// the full corpus. Changing this changes the eval surface, so it is versioned on purpose.
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

  // --- wave C (2026-08-09), taking the set to 50 -------------------------------------------
  // known_item (+11): PASTE the output of `npm run cases:draw-known-items:cloud` here. Drawn from
  // the corpus rather than written from memory, so every query resolves to a real case.

  // conceptual (+11) — plain-language questions written from the DOCTRINAL AREA, never from a
  // target case. A query written while looking at the case it should retrieve inherits that case's
  // vocabulary, and lexical retrieval then wins for a reason unrelated to retrieval quality. Each
  // deliberately avoids the term of art a lawyer would use.
  { qid: "conceptual-007", query: "If a company starts building on land my community claims, can we get a court to stop the work while the case is heard?", layer: "conceptual" },
  { qid: "conceptual-008", query: "Who has to pay when a First Nation wins a case about land taken decades ago?", layer: "conceptual" },
  { qid: "conceptual-009", query: "Can a court review a band council's decision to remove someone from office?", layer: "conceptual" },
  { qid: "conceptual-010", query: "Two Indigenous groups both say the same territory is theirs — how does a court handle that?", layer: "conceptual" },
  { qid: "conceptual-011", query: "What happens if the government approves a project before finishing talks with a First Nation?", layer: "conceptual" },
  { qid: "conceptual-012", query: "Can a First Nation run a business on its reserve without provincial permits?", layer: "conceptual" },
  { qid: "conceptual-013", query: "Can a First Nation sue on behalf of all its members at once instead of one by one?", layer: "conceptual" },
  { qid: "conceptual-014", query: "How much detail must a community give about its historic practices to prove a right?", layer: "conceptual" },
  { qid: "conceptual-015", query: "Does signing an agreement with a mining company limit what a First Nation can argue in court later?", layer: "conceptual" },
  { qid: "conceptual-016", query: "If a treaty promised a share of resource money, can a community collect on that today?", layer: "conceptual" },
  { qid: "conceptual-017", query: "Can someone who is not a party to a case ask the court to let them make arguments?", layer: "conceptual" },

  // topical (+10) — broad themes, weighted toward this project's economic-justice focus.
  { qid: "topical-007", query: "impact benefit agreement", layer: "topical" },
  { qid: "topical-008", query: "economic development agreement", layer: "topical" },
  { qid: "topical-009", query: "Métis rights", layer: "topical" },
  { qid: "topical-010", query: "specific claims", layer: "topical" },
  { qid: "topical-011", query: "reserve land surrender", layer: "topical" },
  { qid: "topical-012", query: "commercial fishing licence", layer: "topical" },
  { qid: "topical-013", query: "forestry tenure", layer: "topical" },
  { qid: "topical-014", query: "mineral exploration permit", layer: "topical" },
  { qid: "topical-015", query: "band council governance", layer: "topical" },
  { qid: "topical-016", query: "compensation for infringement", layer: "topical" },
];
