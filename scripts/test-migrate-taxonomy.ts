import assert from "node:assert/strict";
import { remapSector, remapType, remapGsi2Sk } from "../scripts/migrate-taxonomy";

assert.equal(remapSector("finance_banking"), "finance");
assert.equal(remapSector("mining_extractive"), "mining");
assert.equal(remapSector("telecom"), "telecom");          // canonical unchanged
assert.equal(remapSector("finance"), "finance");           // idempotent
assert.equal(remapType("cultural_awareness"), "cultural_learning");
assert.equal(remapType("procurement"), "procurement");     // unchanged
assert.equal(remapType("cultural_learning"), "cultural_learning"); // idempotent
assert.equal(remapGsi2Sk("COMMIT#cultural_awareness#c-1"), "COMMIT#cultural_learning#c-1");
assert.equal(remapGsi2Sk("COMMIT#procurement#c-2"), "COMMIT#procurement#c-2"); // canonical unchanged
assert.equal(remapGsi2Sk("COMMIT#cultural_learning#c-3"), "COMMIT#cultural_learning#c-3"); // idempotent
assert.equal(remapGsi2Sk("META"), "META"); // non-commit key untouched
console.log("✅ test-migrate-taxonomy passed");
