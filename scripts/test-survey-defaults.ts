import assert from "node:assert/strict";
import { blankOrganization, blankResponse } from "../src/lib/survey/defaults";

const now = "2026-06-18T00:00:00.000Z";

// blankOrganization
const org = blankOrganization("org-acme", now);
assert.equal(org.id, "org-acme");
assert.equal(org.industry, "unspecified");
assert.equal(org.latestRapType, "reflect");
assert.equal(org.asx200, false);
assert.equal(org.totalEmployees, 0);
assert.equal(org.contactName, "");
assert.equal(org.contactEmail, "");
assert.equal(org.createdAt, now);
assert.deepEqual(org.members, { organisations: 0, individuals: 0 });

// blankResponse
const r = blankResponse("org-acme", "2025", now);
assert.equal(r.orgId, "org-acme");
assert.equal(r.year, "2025");
assert.equal(r.reportingPeriod, "2024-07-01..2025-06-30");
assert.equal(r.indigenousStaff.total, null);
assert.deepEqual(r.indigenousStaffByLevel, {
  board: 0, councillors: 0, seniorExec: 0, middleManagement: 0, entryLevel: 0,
});
assert.deepEqual(r.culturalLearning, { elearning: 0, faceToFace: 0, immersion: 0 });
assert.deepEqual(r.governanceStructures, ["none"]);
assert.equal(r.seniorLeaderEngagement, 1);
assert.deepEqual(r.partnerships, { formal: 0, informal: 0 });
assert.deepEqual(r.partneredWith, []);
assert.equal(r.hasCulturalProtocolsDoc, false);
assert.equal(r.hasEmploymentStrategy, false);
assert.equal(r.submittedAt, now);

console.log("ok: survey-defaults");
