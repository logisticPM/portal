import assert from "node:assert/strict";
import { caseFixtures } from "../src/lib/cases/query"; // re-exported for convenience
import { filterCases, searchCases, buildFacets, buildActivation, buildGraph } from "../src/lib/cases/query";

const all = caseFixtures;

// filter by theme
assert.equal(filterCases(all, { themes: ["duty_to_consult"] }).length, 2, "two duty_to_consult cases");
// filter by level
assert.equal(filterCases(all, { level: "scc" }).length, 3, "three SCC cases");
// filter by winType
assert.equal(filterCases(all, { winType: "party_win" }).length, 2, "two party_win cases");

// search: exact citation outranks
const r = searchCases(all, "2014 SCC 44");
assert.equal(r[0].id, "tsilhqotin-2014", "citation match ranks first");
// search: case name
assert.equal(searchCases(all, "Haida")[0].id, "haida-2004", "name match");
// empty query returns all (filtered)
assert.equal(searchCases(all, "").length, all.length, "empty query → all");

// facets
const f = buildFacets(all);
assert.equal(f.byLevel.scc, 3, "facet scc=3");
assert.equal(f.byTheme.land_rights, 2, "facet land_rights=2");

// activation summary
const a = buildActivation(all);
assert.equal(a.totalCases, 4, "4 cases");
assert.equal(a.valueRealization.realized, 2, "2 realized");
assert.ok(a.landmarkCases.length > 0, "has landmark cases");

// citation graph: tsilhqotin cites haida indirectly? haida is cited BY tsilhqotin
const g = buildGraph(all, "haida-2004");
assert.equal(g.citing[0]?.id, "tsilhqotin-2014", "haida is cited by tsilhqotin");

console.log("✅ query tests passed");
