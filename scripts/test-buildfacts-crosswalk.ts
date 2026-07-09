// buildFacts crosswalks rap ProgressStatus -> canonical status and SizeBand ->
// canonical org-size. Uses the exported crosswalk helpers directly.
import assert from "node:assert/strict";
import { statusToCanonical, sizeToCanonical } from "../src/lib/rap/analytics";

assert.equal(statusToCanonical("not_started"), "committed");
assert.equal(statusToCanonical("on_track"), "in_progress");
assert.equal(statusToCanonical("delayed"), "in_progress");
assert.equal(statusToCanonical("met"), "reported");
assert.equal(statusToCanonical("missed"), "stalled");
assert.equal(sizeToCanonical("lt_50"), "small");
assert.equal(sizeToCanonical("50_249"), "medium");
assert.equal(sizeToCanonical("250_999"), "large");
assert.equal(sizeToCanonical("1000_plus"), "enterprise");
assert.equal(sizeToCanonical("unknown"), "unknown");
console.log("✅ test-buildfacts-crosswalk passed");
