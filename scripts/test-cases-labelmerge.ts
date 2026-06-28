import assert from "node:assert/strict";
import { mergeLabels } from "../src/lib/cases/ingest/labeler";
import type { Theme } from "../src/lib/cases/types";

const M: [string, string] = ["m1", "m2"];
const full = mergeLabels(["land_rights", "treaty"] as Theme[], ["treaty", "land_rights"] as Theme[], M);
assert.deepEqual(full.themes.sort(), ["land_rights", "treaty"]);
assert.equal(full.labelMeta.agreement, "full");
assert.equal(full.labelMeta.confidence, "high");
assert.equal(full.labelMeta.needsReview, false);

const partial = mergeLabels(["land_rights", "treaty"] as Theme[], ["land_rights"] as Theme[], M);
assert.deepEqual(partial.themes, ["land_rights"], "only agreed labels become themes");
assert.equal(partial.labelMeta.agreement, "partial");
assert.equal(partial.labelMeta.confidence, "low");
assert.equal(partial.labelMeta.needsReview, true);

const none = mergeLabels([] as Theme[], ["treaty"] as Theme[], M);
assert.deepEqual(none.themes, []);
assert.equal(none.labelMeta.agreement, "none");
assert.equal(none.labelMeta.needsReview, true);
console.log("✅ labelmerge tests passed");
