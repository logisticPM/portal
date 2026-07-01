import type { Commitment, CommitmentPatch, CommitmentRepo } from "./types";
import { commitmentFixtures } from "./fixtures";
import { buildSummary, filterCommitments } from "./query";

// Mutable in-memory store seeded from fixtures. Writes persist for the life of
// the server process (dev) — resets on restart. Real persistence is DynamoDB.
let store: Commitment[] = [...commitmentFixtures];

export const mockCommitmentsRepo: CommitmentRepo = {
  async listCommitments(filter) {
    return [...filterCommitments(store, filter)].sort(
      (a, b) => b.targetYear - a.targetYear || a.id.localeCompare(b.id),
    );
  },
  async getCommitment(id) {
    return store.find((c) => c.id === id) ?? null;
  },
  async getSummary(filter) {
    return buildSummary(filterCommitments(store, filter));
  },
  async createCommitment(c) {
    store = [...store.filter((x) => x.id !== c.id), c];
    return c;
  },
  async updateCommitment(id, patch: CommitmentPatch) {
    const cur = store.find((c) => c.id === id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    store = store.map((c) => (c.id === id ? next : c));
    return next;
  },
  async deleteCommitment(id) {
    store = store.filter((c) => c.id !== id);
  },
};
