// Suppliers-domain labels: the two new sectors resolve to human labels, and the
// canonical helper covers them (no raw snake_case leak).
import assert from "node:assert/strict";
import { labelFor, SECTOR_LABELS, CANONICAL_SECTORS } from "../src/lib/taxonomy";

assert.equal(labelFor("sector", "technology"), "Technology");
assert.equal(labelFor("sector", "professional_services"), "Professional services");
assert.equal(SECTOR_LABELS["technology"], "Technology");
assert.equal(SECTOR_LABELS["professional_services"], "Professional services");
assert.ok(CANONICAL_SECTORS.includes("technology"));
assert.ok(CANONICAL_SECTORS.includes("professional_services"));
console.log("✅ test-supplier-labels passed");
