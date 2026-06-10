// ===========================================================================
// surveyRepo — in-memory mock. Lets the frontend build survey pages WITHOUT
// running DynamoDB. Seeded from fixtures; state persists per dev-server run.
// Default impl (REPO_IMPL unset). Same interface as the DynamoDB version.
// ===========================================================================
import { organizations as seedOrgs, responses as seedResponses } from "./fixtures";
import type { Organization, SurveyRepo, SurveyResponse } from "./types";

const orgs: Organization[] = seedOrgs.map((o) => ({ ...o }));
const responses: SurveyResponse[] = seedResponses.map((r) => ({ ...r }));

export const mockSurveyRepo: SurveyRepo = {
  async putOrganization(org) {
    const i = orgs.findIndex((o) => o.id === org.id);
    if (i >= 0) orgs[i] = org;
    else orgs.push(org);
    return org;
  },

  async getOrganization(id) {
    return orgs.find((o) => o.id === id) ?? null;
  },

  async putResponse(response) {
    const i = responses.findIndex((r) => r.orgId === response.orgId && r.year === response.year);
    if (i >= 0) responses[i] = response;
    else responses.push(response);
    return response;
  },

  async getResponse(orgId, year) {
    return responses.find((r) => r.orgId === orgId && r.year === year) ?? null;
  },

  async listResponsesByYear(year) {
    return responses.filter((r) => r.year === year);
  },
};
