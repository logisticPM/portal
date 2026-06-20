// ===========================================================================
// surveyRepo — in-memory mock. Lets the frontend build survey pages WITHOUT
// running DynamoDB. Seeded from fixtures; state persists per dev-server run.
// Default impl (REPO_IMPL unset). Same interface as the DynamoDB version.
//
// The store is pinned to globalThis: in Next.js a server action ("use server")
// and an RSC page render can load this module in SEPARATE bundle layers, each
// with its own module scope. Without a shared store, a write from the action is
// invisible to the next page render (the two would mutate different arrays).
// globalThis is shared across layers, so all instances see one store.
// (Production uses repo.dynamo and is unaffected.)
// ===========================================================================
import { organizations as seedOrgs, responses as seedResponses } from "./fixtures";
import type { Organization, SurveyRepo, SurveyResponse } from "./types";

type SurveyStore = { orgs: Organization[]; responses: SurveyResponse[] };

const g = globalThis as typeof globalThis & { __surveyStore?: SurveyStore };
const store: SurveyStore =
  g.__surveyStore ??
  (g.__surveyStore = {
    orgs: seedOrgs.map((o) => ({ ...o })),
    responses: seedResponses.map((r) => ({ ...r })),
  });

export const mockSurveyRepo: SurveyRepo = {
  async putOrganization(org) {
    const i = store.orgs.findIndex((o) => o.id === org.id);
    if (i >= 0) store.orgs[i] = org;
    else store.orgs.push(org);
    return org;
  },

  async getOrganization(id) {
    return store.orgs.find((o) => o.id === id) ?? null;
  },

  async putResponse(response) {
    const i = store.responses.findIndex(
      (r) => r.orgId === response.orgId && r.year === response.year,
    );
    if (i >= 0) store.responses[i] = response;
    else store.responses.push(response);
    return response;
  },

  async getResponse(orgId, year) {
    return store.responses.find((r) => r.orgId === orgId && r.year === year) ?? null;
  },

  async listResponsesByYear(year) {
    return store.responses.filter((r) => r.year === year);
  },
};
