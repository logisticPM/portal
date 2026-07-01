import type { LegalCase } from "./types";

const prov = (url: string): LegalCase["provenance"] => ({
  source: "a2aj", sourceUrl: url, upstreamLicense: "See upstream license (non-commercial).",
  ingestedAt: "2026-06-27T00:00:00.000Z", unofficial: true,
});

export const caseFixtures: LegalCase[] = [
  {
    id: "tsilhqotin-2014", citation: "2014 SCC 44", citation2: "[2014] 2 SCR 257",
    styleOfCause: "Tsilhqot'in Nation v. British Columbia",
    court: "Supreme Court of Canada", level: "scc", year: 2014, jurisdiction: "Canada",
    nations: ["Tsilhqot'in Nation"], themes: ["land_rights", "self_determination"],
    outcome: { outcomeType: "precedent", winType: "party_win",
      whoWon: "Tsilhqot'in Nation", holding: "First judicial declaration of Aboriginal title; title includes the right to the economic benefit of the land." },
    economic: { valueType: "other", economicSummary: "Title carries the right to use, manage, and reap the economic benefits of ~1,750 km² of land." },
    valueRealization: { status: "realized", note: "Declared title over the claim area.", asOf: "2014-06-26" },
    summary: { claims: [
      { text: "Aboriginal title confers the right to the economic benefit of the land.", sourceParagraph: "para-2", sourceUrl: "https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/14246/index.do" },
    ] },
    chunks: [
      { paragraph: "para-1", text: "This is the first case to address whether Aboriginal title has been established." },
      { paragraph: "para-2", text: "Aboriginal title confers the right to use and control the land and to reap its economic benefits." },
    ],
    casesCited: ["[1997] 3 SCR 1010"], casesCiting: [], citingCount: 0,
    enrichmentLevel: "deep", corpusTier: "core", fullTextAvailable: true,
    provenance: prov("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/14246/index.do"),
  },
  {
    id: "haida-2004", citation: "2004 SCC 73",
    styleOfCause: "Haida Nation v. British Columbia (Minister of Forests)",
    court: "Supreme Court of Canada", level: "scc", year: 2004, jurisdiction: "Canada",
    nations: ["Haida Nation"], themes: ["duty_to_consult"],
    outcome: { outcomeType: "precedent", winType: "doctrine_win",
      whoWon: "Haida Nation (doctrine)", holding: "Established the Crown's duty to consult and accommodate, triggered even by unproven claims." },
    economic: { valueType: "other", economicSummary: "Resource licences now carry a constitutional consultation obligation before title is established." },
    valueRealization: { status: "realized", note: "Duty to consult now standard before resource approvals.", asOf: "2004-11-18" },
    summary: { claims: [
      { text: "The Crown has a duty to consult triggered by knowledge of a potential claim.", sourceParagraph: "para-1", sourceUrl: "https://canlii.org/en/ca/scc/doc/2004/2004scc73/2004scc73.html" },
    ] },
    chunks: [{ paragraph: "para-1", text: "The duty to consult arises when the Crown has knowledge of a potential Aboriginal claim and contemplates conduct that might adversely affect it." }],
    casesCited: [], casesCiting: ["2014 SCC 44"], citingCount: 1,
    enrichmentLevel: "deep", corpusTier: "core", fullTextAvailable: true,
    provenance: prov("https://canlii.org/en/ca/scc/doc/2004/2004scc73/2004scc73.html"),
  },
  {
    id: "calder-1973", citation: "[1973] SCR 313",
    styleOfCause: "Calder et al. v. Attorney-General of British Columbia",
    court: "Supreme Court of Canada", level: "scc", year: 1973, jurisdiction: "Canada",
    nations: ["Nisga'a"], themes: ["land_rights"],
    outcome: { outcomeType: "precedent", winType: "mixed",
      whoWon: "Nisga'a (doctrine; lost on procedure)", holding: "First recognition that Aboriginal title exists at common law independent of statute." },
    casesCited: [], casesCiting: [], citingCount: 0,
    enrichmentLevel: "index", corpusTier: "core", fullTextAvailable: true,
    provenance: prov("https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/5113/index.do"),
  },
  {
    id: "fort-mckay-2020", citation: "2020 ABCA 163",
    styleOfCause: "Fort McKay First Nation v. Prosper Petroleum Ltd.",
    court: "Alberta Court of Appeal", level: "provincial_appeal", year: 2020, jurisdiction: "Alberta",
    nations: ["Fort McKay First Nation"], themes: ["duty_to_consult", "resource_revenue"],
    outcome: { outcomeType: "remand", winType: "party_win",
      whoWon: "Fort McKay First Nation", holding: "AER must consider the honour of the Crown; Rigel oil sands approval vacated and remitted." },
    casesCited: ["2004 SCC 73"], casesCiting: [], citingCount: 0,
    enrichmentLevel: "index", corpusTier: "core", fullTextAvailable: false, // provincial gap — A2AJ has no ABCA
    provenance: { source: "summary_site", sourceUrl: "https://sites.usask.ca/nativelaw/2020/05/14/fort-mckay-first-nation-v-prosper-petroleum-ltd-2020-abca-163/",
      upstreamLicense: "Official text at albertacourts.ca; summary via USask Indigenous Law Centre.", ingestedAt: "2026-06-27T00:00:00.000Z", unofficial: true },
  },
];
