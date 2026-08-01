import assert from "node:assert/strict";
import { buildCoverage, jurisdictionOf, CANADIAN_JURISDICTIONS } from "../src/lib/cases/coverage";
import { caseFixtures } from "../src/lib/cases/query";
import type { LegalCase } from "../src/lib/cases/types";

const base: LegalCase = { ...caseFixtures[0], corpusTier: "substrate", fullTextAvailable: false };
const mk = (court: string, over: Partial<LegalCase> = {}): LegalCase => ({ ...base, court, ...over });

// --- code → jurisdiction ---
assert.equal(jurisdictionOf("BCSC"), "British Columbia");
assert.equal(jurisdictionOf("bcsc"), "British Columbia", "case-insensitive");
assert.equal(jurisdictionOf("  FCA "), "Federal", "trimmed");
assert.equal(jurisdictionOf("SCC"), "Federal");
assert.equal(jurisdictionOf("ZZZZ"), null, "an unknown code must not be silently bucketed");
assert.equal(jurisdictionOf(""), null);

// --- the point of the module: absence is reported, not omitted ---
{
  const rep = buildCoverage([mk("BCSC"), mk("BCCA")]);
  assert.equal(rep.rows.length, CANADIAN_JURISDICTIONS.length,
    "every Canadian jurisdiction gets a row even with nothing in it");

  const ab = rep.rows.find((r) => r.jurisdiction === "Alberta")!;
  assert.equal(ab.total, 0, "Alberta is present in the table with a zero, not missing from it");
  assert.deepEqual(ab.courts, []);

  assert.equal(rep.covered, 1, "one jurisdiction covered");
}

// --- an unrecognised court is surfaced, never folded into a real jurisdiction ---
{
  const rep = buildCoverage([mk("BCSC"), mk("NOPE"), mk("NOPE")]);
  assert.deepEqual(rep.unmapped, { NOPE: 2 });
  const totals = rep.rows.reduce((n, r) => n + r.total, 0);
  assert.equal(totals, 1, "unmapped cases are excluded from every jurisdiction total");
}

// --- courts[] is what makes a headline number readable ---
// "Ontario 468" means nothing until you can see it is appeal-only.
{
  const rep = buildCoverage([mk("ONCA"), mk("ONCA"), mk("ONSC")]);
  const on = rep.rows.find((r) => r.jurisdiction === "Ontario")!;
  assert.equal(on.total, 3);
  assert.deepEqual(on.courts, ["ONCA", "ONSC"], "sorted, de-duplicated court codes");
}

// --- core and fullText are counted independently of total ---
{
  const rep = buildCoverage([
    mk("BCSC", { corpusTier: "core", fullTextAvailable: true }),
    mk("BCSC", { corpusTier: "substrate", fullTextAvailable: true }),
    mk("BCSC", { corpusTier: "substrate", fullTextAvailable: false }),
  ]);
  const bc = rep.rows.find((r) => r.jurisdiction === "British Columbia")!;
  assert.equal(bc.total, 3);
  assert.equal(bc.core, 1);
  assert.equal(bc.fullText, 2, "full text is orthogonal to tier");
}

// --- the ordering is the one a Canadian reader expects, federal first ---
assert.equal(CANADIAN_JURISDICTIONS[0], "Federal");
assert.equal(CANADIAN_JURISDICTIONS[1], "British Columbia");
assert.equal(CANADIAN_JURISDICTIONS[CANADIAN_JURISDICTIONS.length - 1], "Nunavut");
assert.equal(new Set(CANADIAN_JURISDICTIONS).size, CANADIAN_JURISDICTIONS.length, "no duplicates");

console.log("✅ test-cases-coverage passed");
