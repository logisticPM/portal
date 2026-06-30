import assert from "node:assert/strict";
import { tokenize, Bm25 } from "../src/lib/cases/search/bm25";

// keeps legal exact tokens (digits + neutral-citation parts), lowercases, no stemming
assert.deepEqual(tokenize("Haida 2004 SCC 73"), ["haida", "2004", "scc", "73"]);

const docs = [
  { id: "d1", tokens: tokenize("the quick brown fox") },
  { id: "d2", tokens: tokenize("the lazy dog sleeps") },
  { id: "d3", tokens: tokenize("quick quick fox runs") },
];
const bm = new Bm25(docs);
const ranked = bm.search(tokenize("quick fox"));

// d3 (quick×2, fox×1) outranks d1 (quick×1, fox×1); d2 (neither) scores 0 → absent
assert.equal(ranked[0].id, "d3", "d3 first");
assert.equal(ranked[1].id, "d1", "d1 second");
assert.ok(!ranked.some((r) => r.id === "d2"), "d2 (no match) absent");

// deterministic: empty query → empty results
assert.deepEqual(bm.search([]), []);

console.log("✅ bm25 tests passed");
