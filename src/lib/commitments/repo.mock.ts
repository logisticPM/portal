import type { CommitmentRepo } from "./types";
import { commitmentFixtures } from "./fixtures";
import { buildSummary, filterCommitments } from "./query";

export const mockCommitmentsRepo: CommitmentRepo = {
  async listCommitments(filter) {
    return [...filterCommitments(commitmentFixtures, filter)].sort(
      (a, b) => b.targetYear - a.targetYear || a.id.localeCompare(b.id),
    );
  },
  async getCommitment(id) {
    return commitmentFixtures.find((c) => c.id === id) ?? null;
  },
  async getSummary(filter) {
    return buildSummary(filterCommitments(commitmentFixtures, filter));
  },
};
