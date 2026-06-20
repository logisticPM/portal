import assert from "node:assert/strict";
import {
  parseProfileForm,
  parseContextForm,
  applyProfilePatch,
  applyContextPatch,
} from "../src/lib/survey/context-form";
import { blankOrganization, blankResponse } from "../src/lib/survey/defaults";

const now = "2026-06-18T00:00:00.000Z";

// --- profile: parse + apply overwrites the slice, preserves the rest ---
const orgBase = { ...blankOrganization("org-acme", now), totalStudents: 7 };
const pf = new FormData();
pf.set("industry", "mining");
pf.set("latestRapType", "stretch");
pf.set("totalEmployees", "1200");
pf.set("asx200", "true");
pf.set("contactName", "  Dana Whitefeather ");
pf.set("contactEmail", "dana@acme.example");
const org = applyProfilePatch(orgBase, parseProfileForm(pf));
assert.equal(org.industry, "mining");
assert.equal(org.latestRapType, "stretch");
assert.equal(org.totalEmployees, 1200);
assert.equal(org.asx200, true);
assert.equal(org.contactName, "Dana Whitefeather");
assert.equal(org.contactEmail, "dana@acme.example");
assert.equal(org.totalStudents, 7); // un-surfaced field preserved
assert.equal(org.createdAt, now);

// unchecked checkbox → false; blank/negative number → keep base; empty text → keep base
const orgBase2 = { ...blankOrganization("org-acme", now), totalEmployees: 50, asx200: true, contactName: "Prior" };
const pf2 = new FormData();
pf2.set("industry", "retail");
pf2.set("latestRapType", "reflect");
pf2.set("totalEmployees", ""); // blank → keep base
pf2.set("contactName", "   ");  // whitespace → keep base
pf2.set("contactEmail", "");    // blank → keep base
// asx200 absent → false
const org2 = applyProfilePatch(orgBase2, parseProfileForm(pf2));
assert.equal(org2.totalEmployees, 50);
assert.equal(org2.asx200, false);
assert.equal(org2.contactName, "Prior");

// --- context: parse + apply ---
const rBase = blankResponse("org-acme", "2025", now);
const cf = new FormData();
cf.set("staffTotal", "210");
cf.set("board", "1");
cf.set("seniorExec", "4");
cf.set("middleManagement", "35");
cf.set("entryLevel", "170");
cf.set("clElearning", "8000");
cf.set("clFaceToFace", "1500");
cf.set("clImmersion", "40");
cf.set("hasCulturalProtocolsDoc", "true");
cf.set("hasEmploymentStrategy", "true");
cf.append("governanceStructures", "internal_employee_group");
cf.append("governanceStructures", "external_advisory");
cf.set("seniorLeaderEngagement", "5");
cf.set("partnershipsFormal", "4");
cf.set("partnershipsInformal", "2");
cf.set("partneredWith", "Supply Nation, CareerTrackers ,, Jawun");
const r = applyContextPatch(rBase, parseContextForm(cf));
assert.equal(r.indigenousStaff.total, 210);
assert.equal(r.indigenousStaffByLevel.board, 1);
assert.equal(r.indigenousStaffByLevel.entryLevel, 170);
assert.equal(r.indigenousStaffByLevel.councillors, 0); // untouched field preserved
assert.deepEqual(r.culturalLearning, { elearning: 8000, faceToFace: 1500, immersion: 40 });
assert.equal(r.hasCulturalProtocolsDoc, true);
assert.equal(r.hasEmploymentStrategy, true);
assert.deepEqual(r.governanceStructures, ["internal_employee_group", "external_advisory"]);
assert.equal(r.seniorLeaderEngagement, 5);
assert.deepEqual(r.partnerships, { formal: 4, informal: 2 });
assert.deepEqual(r.partneredWith, ["Supply Nation", "CareerTrackers", "Jawun"]);
assert.equal(r.procurementTotal, 0); // un-surfaced field preserved

// "not collected" wins over the number; empty governance → ["none"]
const cf2 = new FormData();
cf2.set("staffTotal", "999");
cf2.set("staffNotCollected", "true");
cf2.set("seniorLeaderEngagement", "9"); // out of range → keep base (1)
cf2.set("partneredWith", "");
const r2 = applyContextPatch(blankResponse("org-acme", "2025", now), parseContextForm(cf2));
assert.equal(r2.indigenousStaff.total, null);
assert.deepEqual(r2.governanceStructures, ["none"]);
assert.equal(r2.seniorLeaderEngagement, 1);
assert.deepEqual(r2.partneredWith, []);

console.log("ok: survey-context-form");
