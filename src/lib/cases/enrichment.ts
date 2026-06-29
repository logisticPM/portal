// Editorial deep enrichment, keyed by citation. A2AJ supplies the skeleton;
// these are the curated, citation-anchored economic-justice fields. This is
// SEED DATA the team curates over time (grows with the flagship corpus) — not
// code. Merge logic lives in seed-cases.ts.
import type { Theme, CaseOutcome, EconomicDimension, ValueRealization, CitationAnchored } from "./types";

export interface Enrichment {
  nations: string[];
  themes: Theme[];
  outcome: CaseOutcome;
  economic?: EconomicDimension;
  valueRealization?: ValueRealization;
  summary?: CitationAnchored;
}

export const enrichment: Record<string, Enrichment> = {
  "2014 SCC 44": {
    nations: ["Tsilhqot'in Nation"], themes: ["land_rights", "self_determination"],
    outcome: { outcomeType: "precedent", winType: "party_win", whoWon: "Tsilhqot'in Nation",
      holding: "First judicial declaration of Aboriginal title; title includes the right to the land's economic benefit." },
    economic: { valueType: "other", economicSummary: "Right to use, manage, and reap the economic benefits of ~1,750 km²." },
    valueRealization: { status: "realized", note: "Title declared over the claim area.", asOf: "2014-06-26" },
    summary: { claims: [{ text: "Aboriginal title confers the right to the economic benefit of the land.",
      sourceParagraph: "para-2", sourceUrl: "https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/14246/index.do" }] },
  },
  "2004 SCC 73": {
    nations: ["Haida Nation"], themes: ["duty_to_consult"],
    outcome: { outcomeType: "precedent", winType: "doctrine_win", whoWon: "Haida Nation (doctrine)",
      holding: "Established the Crown's duty to consult and accommodate, triggered even by unproven claims." },
    economic: { valueType: "other", economicSummary: "Resource licences now carry a constitutional consultation obligation." },
    valueRealization: { status: "realized", note: "Duty to consult standard before resource approvals.", asOf: "2004-11-18" },
  },
  // Curators add the remaining flagship citations here over time.
};
