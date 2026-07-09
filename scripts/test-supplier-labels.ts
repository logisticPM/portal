// Suppliers-domain labels: the two new sectors resolve to human labels, and the
// canonical helper covers them (no raw snake_case leak).
import assert from "node:assert/strict";
import { labelFor, SECTOR_LABELS, CANONICAL_SECTORS } from "../src/lib/taxonomy";
import { parties } from "../src/lib/seed/fixtures";

assert.equal(labelFor("sector", "technology"), "Technology");
assert.equal(labelFor("sector", "professional_services"), "Professional services");
assert.equal(SECTOR_LABELS["technology"], "Technology");
assert.equal(SECTOR_LABELS["professional_services"], "Professional services");
assert.ok(CANONICAL_SECTORS.includes("technology"));
assert.ok(CANONICAL_SECTORS.includes("professional_services"));

const suppliers = parties.filter((p) => p.role === "supplier");
const animikii = suppliers.find((s) => s.name === "Animikii");
const ntg = suppliers.find((s) => s.name === "Nations Translation Group");
assert.equal(animikii?.sectorNorm, "technology", "Animikii re-normalized to technology");
assert.equal(ntg?.sectorNorm, "professional_services", "NTG re-normalized to professional_services");

console.log("✅ test-supplier-labels passed");
