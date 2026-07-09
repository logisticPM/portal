// commitmentsToFacts carries native commitments enums onto the Fact WITHOUT the
// old rap remap: sector/type verbatim, status un-collapsed (reported != confirmed),
// orgSize passed through as sizeBand.
import assert from "node:assert/strict";
import { commitmentsToFacts } from "../src/lib/rap-index/commitments-to-facts";
import type { Commitment } from "../src/lib/commitments/types";

const base: Commitment = {
  id: "c1", orgName: "Acme", sector: "consulting", orgSize: "enterprise",
  type: "cultural_learning", title: "t", targetYear: 2030, status: "reported",
  progressPct: 60, history: [], createdAt: "2025-01-01",
};
const conf: Commitment = { ...base, id: "c2", status: "confirmed" };

const facts = commitmentsToFacts([base, conf]);
assert.equal(facts[0].sector, "consulting");        // verbatim, not "other"
assert.equal(facts[0].commitmentType, "cultural_learning"); // verbatim
assert.equal(facts[0].status, "reported");          // NOT collapsed to "met"
assert.equal(facts[1].status, "confirmed");         // reported != confirmed
assert.equal(facts[0].sizeBand, "enterprise");      // native org size
console.log("✅ test-commitments-facts passed");
