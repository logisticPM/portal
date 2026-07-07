// Recorded economic figures (spec 2026-07-07): parse + mechanical verify + extract.
// Wrapped in an async IIFE: this repo is NOT ESM, so top-level await is illegal.
import assert from "node:assert/strict";
import { parseAmount, verifyFigures, extractFigures, type RawFigure } from "../src/lib/cases/ingest/figures";
import type { CaseChunk, LegalCase } from "../src/lib/cases/types";
import type { LlmModel } from "../src/lib/cases/ingest/llm";

(async () => {
// --- parseAmount ---
assert.deepEqual(parseAmount("$1,234,567"), { amount: 1234567 });
assert.deepEqual(parseAmount("$30 million"), { amount: 30_000_000 });
assert.deepEqual(parseAmount("CAD 5,000"), { amount: 5000 });
assert.deepEqual(parseAmount("51%"), { amount: 51, unit: "percent" });
assert.equal(parseAmount("the 1990s"), null, "bare number without currency marker → null");
assert.equal(parseAmount("section 35"), null, "no currency, no percent → null");

// --- verifyFigures ---
const chunks: CaseChunk[] = [
  { paragraph: "para-1", text: "The background of the dispute is set out here." },
  { paragraph: "para-2", text: "The Crown was ordered to pay $30 million in equitable compensation." },
  { paragraph: "para-3", text: "The band also received a 51% equity stake in the venture." },
];
const raws: RawFigure[] = [
  { raw: "$30 million", quote: "ordered to pay $30 million in equitable compensation", paragraph: "para-2", kind: "compensation", role: "awarded" },
  { raw: "51%", quote: "received a 51% equity stake", paragraph: "para-3", kind: "equity", role: "ordered" },
  { raw: "$999 billion", quote: "the sum of $999 billion was awarded", paragraph: "para-2", kind: "damages", role: "awarded" }, // fabricated — not in text
  { raw: "$30 million", quote: "totally different clause not present", paragraph: "para-2", kind: "compensation", role: "awarded" }, // quote not in text
];
const { figures, dropped } = verifyFigures(raws, chunks, "https://ex.org/x");
assert.equal(figures.length, 2, "only the two real, in-text figures survive");
assert.equal(dropped, 2, "fabricated + quote-not-in-text dropped");
assert.equal(figures[0].amount, 30_000_000);
assert.equal(figures[0].sourceParagraph, "para-2");
assert.equal(figures[1].unit, "percent");
assert.equal(figures[1].amount, 51);

// re-anchor: quote spanning an adjacent chunk pair verifies (anchor = first chunk)
const split: CaseChunk[] = [
  { paragraph: "para-1", text: "The Crown was ordered to pay" },
  { paragraph: "para-2", text: "$40,000 in costs to the applicant." },
];
const spanned = verifyFigures(
  [{ raw: "$40,000", quote: "ordered to pay $40,000 in costs", paragraph: "para-1", kind: "compensation", role: "ordered" }],
  split, "https://ex.org/y");
assert.equal(spanned.figures.length, 1, "quote spanning adjacent chunks verifies");
assert.equal(spanned.figures[0].sourceParagraph, "para-1");

// --- extractFigures (fake model) ---
const fakeModel: LlmModel = {
  id: "fake",
  call: async () => JSON.stringify({ figures: [
    { raw: "$30 million", quote: "ordered to pay $30 million in equitable compensation", paragraph: "para-2", kind: "compensation", role: "awarded" },
  ] }),
};
const baseCase = (over: Partial<LegalCase>): LegalCase => ({
  id: "c1", citation: "2020 SCC 1", styleOfCause: "Test", court: "SCC", level: "scc", year: 2020,
  jurisdiction: "CA", nations: [], themes: [],
  outcome: { outcomeType: "precedent", winType: "party_win", whoWon: "", holding: "compensation" },
  casesCited: [], casesCiting: [], citingCount: 0, enrichmentLevel: "index", corpusTier: "core",
  fullTextAvailable: true, chunks,
  provenance: { source: "a2aj", sourceUrl: "https://ex.org/x", upstreamLicense: "open", ingestedAt: "2026", unofficial: true },
  ...over,
});
const okRes = await extractFigures(baseCase({}), fakeModel);
assert.equal(okRes.status, "generated");
assert.equal(okRes.figures?.length, 1);
assert.equal((await extractFigures(baseCase({ corpusTier: "substrate" }), fakeModel)).status, "skipped_not_core");
assert.equal((await extractFigures(baseCase({ chunks: [] }), fakeModel)).status, "skipped_no_fulltext");

console.log("✅ test-cases-figures passed");
})().catch((e) => { console.error(e); process.exit(1); });
