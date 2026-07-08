import assert from "node:assert/strict";
import { caseFixtures } from "../src/lib/cases/query"; // re-exported for convenience
import { filterCases, searchCases, buildFacets, buildActivation, buildGraph, isCourtGranted } from "../src/lib/cases/query";

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

// isCourtGranted: grant/order verb required, background recital excluded (fidelity 2026-07-07)
assert.equal(isCourtGranted("the court is awarding the appellants $30 million"), true, "grant verb kept");
assert.equal(isCourtGranted("ordered to pay $40,000 in costs"), true, "order verb kept");
assert.equal(isCourtGranted("Canada entered into a $23.34 billion settlement"), false, "contextual recital excluded");
assert.equal(isCourtGranted("was advised that $25.5 million in funding was available"), false, "funding availability excluded");
assert.equal(isCourtGranted("the reserve covers 2,589 square kilometres"), false, "no grant verb excluded");

// economicFigures: per-kind ranges from court-granted awarded/ordered figures, one amount per case, no sums
const ef = buildActivation([
  { ...caseFixtures[0], id: "f1", extractedFigures: [
    { raw: "$10", amount: 10, currency: "CAD", kind: "settlement", role: "awarded", quote: "the court awarded $10", sourceParagraph: "para-1", sourceUrl: "u" },
    { raw: "$40", amount: 40, currency: "CAD", kind: "settlement", role: "awarded", quote: "the court awarded $40", sourceParagraph: "para-1", sourceUrl: "u" },
    { raw: "$999", amount: 999, currency: "CAD", kind: "settlement", role: "claimed", quote: "the plaintiff claimed $999", sourceParagraph: "para-1", sourceUrl: "u" },
  ] },
  { ...caseFixtures[1], id: "f2", extractedFigures: [
    { raw: "$20", amount: 20, currency: "CAD", kind: "settlement", role: "ordered", quote: "ordered to pay $20", sourceParagraph: "para-1", sourceUrl: "u" },
  ] },
]).economicFigures;
assert.equal(ef.totalCases, 2, "denominator = cases passed");
assert.equal(ef.casesWithFigures, 2, "both cases have a court-granted figure");
assert.equal(ef.byKind.settlement?.countCases, 2, "one amount per case");
assert.equal(ef.byKind.settlement?.max, 40, "case f1 keeps its largest granted (40, not the claimed 999)");
assert.equal(ef.byKind.settlement?.min, 20);
assert.equal(ef.byKind.settlement?.median, 30, "median of [20,40]");
assert.equal(ef.byKind.settlement?.unit, "CAD");
assert.equal((ef as any).settlement, undefined, "no flat cross-case total field");

// byKind key order is deterministic regardless of input case order (dynamo≡mock parity)
const cA = { ...caseFixtures[0], id: "A", extractedFigures: [
  { raw: "$5", amount: 5, currency: "CAD", kind: "settlement" as const, role: "awarded" as const, quote: "awarded $5", sourceParagraph: "para-1", sourceUrl: "u" },
  { raw: "$7", amount: 7, currency: "CAD", kind: "damages" as const, role: "awarded" as const, quote: "awarded $7 in damages", sourceParagraph: "para-1", sourceUrl: "u" },
] };
const cB = { ...caseFixtures[1], id: "B", extractedFigures: [
  { raw: "$3", amount: 3, currency: "CAD", kind: "damages" as const, role: "awarded" as const, quote: "awarded $3 in damages", sourceParagraph: "para-1", sourceUrl: "u" },
] };
assert.equal(
  JSON.stringify(buildActivation([cA, cB]).economicFigures.byKind),
  JSON.stringify(buildActivation([cB, cA]).economicFigures.byKind),
  "byKind JSON is input-order-independent (sorted keys)");

// equity guard: a $-amount mislabeled equity (no unit) is excluded from the percent range
const eqGuard = buildActivation([
  { ...caseFixtures[0], id: "eq1", extractedFigures: [
    { raw: "$500,000", amount: 500000, currency: "CAD", kind: "equity", role: "awarded", quote: "awarded $500,000", sourceParagraph: "para-1", sourceUrl: "u" },
    { raw: "30%", amount: 30, currency: "CAD", unit: "percent", kind: "equity", role: "awarded", quote: "awarded a 30% equity stake", sourceParagraph: "para-1", sourceUrl: "u" },
  ] },
]).economicFigures;
assert.equal(eqGuard.byKind.equity?.unit, "%", "equity range is percent-only");
assert.equal(eqGuard.byKind.equity?.max, 30, "the $500,000 mislabeled equity is excluded");

// citation graph: tsilhqotin cites haida indirectly? haida is cited BY tsilhqotin
const g = buildGraph(all, "haida-2004");
assert.equal(g.citing[0]?.id, "tsilhqotin-2014", "haida is cited by tsilhqotin");

// --- Phase 2-A: corpusTier ---
import { filterCases as fc2 } from "../src/lib/cases/query";
const withSub = [
  ...caseFixtures,
  { ...caseFixtures[0], id: "sub-1", citation: "9999 SCC 1", corpusTier: "substrate" as const,
    themes: [] as never[], outcome: { outcomeType: "unclassified" as const, winType: "unclassified" as const, whoWon: "", holding: "" } },
];
assert.equal(fc2(withSub).length, 4, "default filter is core-only (excludes substrate)");
assert.equal(fc2(withSub, { tier: "substrate" }).length, 1, "tier:substrate returns substrate only");
assert.equal(fc2(withSub, { tier: "core" }).length, 4, "tier:core returns core only");

console.log("✅ query tests passed");
