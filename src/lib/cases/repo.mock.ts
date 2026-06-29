import type { CaseRepo } from "./types";
import { caseFixtures } from "./fixtures";
import { filterCases, searchCases, buildFacets, buildActivation, buildGraph } from "./query";

export const mockCaseRepo: CaseRepo = {
  async listCases(filter) {
    return [...filterCases(caseFixtures, filter)].sort((a, b) => b.year - a.year);
  },
  async getCase(id) {
    return caseFixtures.find((c) => c.id === id) ?? null;
  },
  async searchCases(query, filter) {
    return searchCases(caseFixtures, query, filter);
  },
  async listFacets(filter) {
    return buildFacets(filterCases(caseFixtures, filter));
  },
  async getActivationSummary() {
    return buildActivation(caseFixtures);
  },
  async getCitationGraph(id) {
    return buildGraph(caseFixtures, id);
  },
  async exportCases(filter) {
    return { cases: filterCases(caseFixtures, filter), asOf: new Date().toISOString() };
  },
};
