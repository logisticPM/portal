import assert from "node:assert/strict";
import { commitmentsToFacts } from "../src/lib/rap-index/commitments-to-facts";
import type { Commitment } from "../src/lib/commitments";

const sample: Commitment = {
  id: "c1", orgName: "RBC", orgId: "org-rbc", sector: "finance", orgSize: "enterprise",
  type: "procurement", title: "Grow Indigenous procurement", targetYear: 2027,
  status: "reported", progressPct: 35, history: [], createdAt: "2025-01-01T00:00:00.000Z",
  source: { label: "RBC RAP", url: "https://example.com" }, detail: "five ambition areas",
  targetText: "5% of spend",
};

const [f] = commitmentsToFacts([sample]);
assert.equal(f.commitId, "c1");
assert.equal(f.orgName, "RBC");
assert.equal(f.sector, "finance");
assert.equal(f.sizeBand, "enterprise", "orgSize passed through natively");
assert.equal(f.status, "reported", "status passed through natively (no collapse)");
assert.equal(f.percentComplete, 35);
assert.equal(f.claimBasis, "self_reported");
assert.equal(f.pillar, "other", "commitments domain has no pillar");
assert.equal(f.dueDate, "2027-12-31");
assert.equal(f.targetUnit, "percent", '"5% of spend" classifies as a percent target');
assert.equal(f.targetValue, null, "percent target has no currency value");
assert.equal(f.confidence, 1);
assert.equal(commitmentsToFacts([]).length, 0, "empty in → empty out");
console.log("OK test-explore-facts");
