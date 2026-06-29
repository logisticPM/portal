import assert from "node:assert/strict";
import { includeCandidate, emptyPrisma, tallyExclude } from "../src/lib/cases/ingest/include";
import { caseFixtures } from "../src/lib/cases/fixtures";

// a flagship case (has Indigenous nation + economic theme text) is included
const ok = includeCandidate({ ...caseFixtures[0] });
assert.equal(ok.include, true, "Tsilhqot'in included");

// a noise case (no Indigenous + no economic signal) is excluded with a reason
const noise = { ...caseFixtures[0], nations: [] as string[],
  chunks: [{ paragraph: "para-1", text: "A routine tax appeal about GST input credits." }],
  summary: undefined, outcome: { ...caseFixtures[0].outcome, holding: "tax appeal" } };
const ex = includeCandidate(noise);
assert.equal(ex.include, false, "noise excluded");
assert.ok(ex.reason && ex.reason.length > 0, "exclusion has a reason");

// PRISMA tally
const p = emptyPrisma();
tallyExclude(p, "no_indigenous_signal");
assert.equal(p.excluded.no_indigenous_signal, 1);
console.log("✅ include tests passed");
