import assert from "node:assert/strict";
import { buildCorpusStats } from "../src/lib/cases/query";
import { caseFixtures } from "../src/lib/cases/fixtures";
import type { LegalCase } from "../src/lib/cases/types";

const s = buildCorpusStats(caseFixtures);
assert.equal(s.total, 4, "total");
assert.equal(s.core, 4, "all fixtures are core");
assert.equal(s.substrate, 0, "no substrate fixtures");
assert.equal(s.fullText, 3, "3 fixtures have full text");
assert.equal(s.byLevel.scc, 3, "3 SCC");

const mk = (y: number): LegalCase => ({ corpusTier: "core", level: "scc", year: y, fullTextAvailable: true } as unknown as LegalCase);
const d = buildCorpusStats([mk(2014), mk(2019), mk(2004)]);
assert.equal(d.byDecade["2010s"], 2, "decade bucketing");
assert.equal(d.byDecade["2000s"], 1, "decade bucketing 2000s");
console.log("✅ corpusstats tests passed");
