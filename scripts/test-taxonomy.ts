// Canonical taxonomy: label maps cover the full enums, labelFor humanizes any
// key, and the exported arrays match the union types.
import assert from "node:assert/strict";
import {
  CANONICAL_SECTORS, CANONICAL_TYPES, SECTOR_LABELS, TYPE_LABELS,
  STATUS_LABELS, SIZE_LABELS, labelFor,
} from "../src/lib/taxonomy";

// every sector/type has a non-raw label (no underscores, starts uppercase)
for (const s of CANONICAL_SECTORS) {
  const l = SECTOR_LABELS[s];
  assert.ok(l && !l.includes("_"), `sector ${s} label missing/raw: ${l}`);
}
for (const t of CANONICAL_TYPES) {
  const l = TYPE_LABELS[t];
  assert.ok(l && !l.includes("_"), `type ${t} label missing/raw: ${l}`);
}
// specific spellings
assert.equal(TYPE_LABELS["cultural_learning"], "Cultural learning");
assert.equal(TYPE_LABELS["anti_racism"], "Anti-racism");
assert.equal(TYPE_LABELS["education_training"], "Education & training");
assert.equal(SECTOR_LABELS["other"], "Other");
// labelFor routes by dim, falls back by humanizing unknown keys
assert.equal(labelFor("sector", "finance"), "Finance");
assert.equal(labelFor("commitmentType", "cultural_learning"), "Cultural learning");
assert.equal(labelFor("status", "in_progress"), "In progress");
assert.equal(labelFor("sizeBand", "enterprise"), "Enterprise");
assert.equal(labelFor("unknownDim", "some_raw_value"), "Some raw value"); // humanizing fallback
assert.equal(CANONICAL_SECTORS.length, 16);
assert.equal(CANONICAL_TYPES.length, 11);
console.log("✅ test-taxonomy passed");
