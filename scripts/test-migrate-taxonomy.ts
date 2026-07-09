import assert from "node:assert/strict";
import { remapSector, remapType } from "../scripts/migrate-taxonomy";

assert.equal(remapSector("finance_banking"), "finance");
assert.equal(remapSector("mining_extractive"), "mining");
assert.equal(remapSector("telecom"), "telecom");          // canonical unchanged
assert.equal(remapSector("finance"), "finance");           // idempotent
assert.equal(remapType("cultural_awareness"), "cultural_learning");
assert.equal(remapType("procurement"), "procurement");     // unchanged
assert.equal(remapType("cultural_learning"), "cultural_learning"); // idempotent
console.log("✅ test-migrate-taxonomy passed");
