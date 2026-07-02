import assert from "node:assert/strict";
import { filterCases } from "../src/lib/cases/query";
import type { LegalCase } from "../src/lib/cases/types";

const mk = (id: string, tier: "core" | "substrate"): LegalCase => ({
  id, corpusTier: tier, themes: [], level: "scc", year: 2000, fullTextAvailable: false,
  outcome: { winType: "unclassified" }, nations: [],
} as unknown as LegalCase);

const cases = [mk("a", "core"), mk("b", "substrate"), mk("c", "core")];
assert.equal(filterCases(cases).length, 2, "omitted → core-only");
assert.equal(filterCases(cases, { tier: "core" }).length, 2, "tier core");
assert.equal(filterCases(cases, { tier: "substrate" }).length, 1, "tier substrate");
assert.equal(filterCases(cases, { tier: "all" }).length, 3, "tier all → both");
console.log("✅ filter-tier tests passed");
