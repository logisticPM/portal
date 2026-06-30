import assert from "node:assert/strict";
import { needsEmbed } from "./cases-embed";

// missing vector → needs embedding
assert.equal(needsEmbed({ text: "x" }, "stub-hash-v1"), true, "no vec → embed");
// stale embedder id → re-embed
assert.equal(needsEmbed({ text: "x", vec: new Uint8Array(4), embedderId: "old" }, "stub-hash-v1"), true, "stale id → embed");
// current embedder id → skip
assert.equal(needsEmbed({ text: "x", vec: new Uint8Array(4), embedderId: "stub-hash-v1" }, "stub-hash-v1"), false, "current → skip");

console.log("✅ embed-helper tests passed");
