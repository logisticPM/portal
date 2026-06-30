import assert from "node:assert/strict";
import { applyFullText } from "../src/lib/cases/ingest/fulltext";
import { caseFixtures } from "../src/lib/cases/fixtures";

// a metadata-only substrate stub: no chunks, fullTextAvailable false
const base = { ...caseFixtures[0], chunks: undefined, fullTextAvailable: false } as const;

// with text → chunks populated, flag set, input NOT mutated
const out = applyFullText(base, "Para one text.\n\nPara two text.");
assert.equal(out.fullTextAvailable, true, "flag set");
assert.equal(out.chunks?.length, 2, "two paragraph chunks");
assert.equal(out.chunks?.[0].paragraph, "para-1");
assert.equal(base.fullTextAvailable, false, "input not mutated");

// empty/whitespace text → unchanged stub, flag stays false, no chunks
const empty = applyFullText(base, "   ");
assert.equal(empty.fullTextAvailable, false, "empty text stays unavailable");
assert.equal(empty.chunks, undefined, "no chunks on empty text");

console.log("✅ fulltext tests passed");
