// Pure remap helper for the CCAB->CCIB data migration.
import assert from "node:assert/strict";
import { fixCcab } from "./migrate-supplier-ccib";

assert.equal(fixCcab("CCAB"), "CCIB");
assert.equal(fixCcab("CCAB Certified (PAR Gold)"), "CCIB Certified (PAR Gold)");
assert.equal(fixCcab("CCAB Certified Indigenous Business"), "CCIB Certified Indigenous Business");
assert.equal(fixCcab("Samson Cree Nation"), "Samson Cree Nation"); // no CCAB -> unchanged
assert.equal(fixCcab("CCIB Certified"), "CCIB Certified"); // idempotent
console.log("✅ test-migrate-supplier-ccib passed");
