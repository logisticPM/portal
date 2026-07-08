import type { Opportunity, OpportunityRepo, OpportunityStatus } from "./types";

let store: Opportunity[] = [];

const byScore = (a: Opportunity, b: Opportunity) => b.score - a.score || a.id.localeCompare(b.id);

export const mockAlignmentRepo: OpportunityRepo = {
  async listForOrg(orgId) {
    return store.filter((o) => o.orgId === orgId).sort(byScore);
  },
  async listAll() {
    return [...store].sort(byScore);
  },
  async upsert(o) {
    store = [...store.filter((x) => x.id !== o.id), o];
    return o;
  },
  async remove(id) {
    store = store.filter((o) => o.id !== id);
  },
  async setStatus(id: string, status: OpportunityStatus) {
    store = store.map((o) => (o.id === id ? { ...o, status } : o));
  },
};

// test-only reset
export function _resetMockAlignment() {
  store = [];
}
