import assert from "node:assert/strict";
import type { CaseChunk } from "../src/lib/cases/types";
import { classifyDrop, lcsSpan, widenFold } from "../src/lib/cases/ingest/drop-cause";
import { normWs } from "../src/lib/cases/ingest/summarizer";

const p = (n: number, text: string): CaseChunk => ({ paragraph: `para-${n}`, text });
// Mirrors assembleInput's line format. Passing a NON-CONTIGUOUS join is the point:
// that is what the over-budget path produces.
const assemble = (chunks: CaseChunk[]) => chunks.map((c) => `[para ${c.paragraph}] ${c.text}`).join("\n");

// --- lcsSpan: length AND where the run starts IN THE QUOTE ---
assert.deepEqual(lcsSpan("abcdef", "zzabcdefzz"), { len: 6, quoteStart: 0 });
assert.deepEqual(lcsSpan("XXhello world", "hello world"), { len: 11, quoteStart: 2 },
  "quoteStart is an offset into the FIRST argument");
assert.deepEqual(lcsSpan("abc", "xyz"), { len: 0, quoteStart: 0 });
assert.deepEqual(lcsSpan("", "abc"), { len: 0, quoteStart: 0 });

// --- widenFold ---
assert.equal(widenFold("(emphasis added) ."), widenFold("(emphasis added)."), "space before punctuation");
assert.equal(widenFold("a…b"), widenFold("a...b"), "ellipsis character vs three dots");
assert.equal(widenFold("soft­hyphen"), widenFold("softhyphen"), "soft hyphen is invisible");
assert.equal(widenFold("ﬁre"), widenFold("fire"), "fi ligature from PDF extraction");

const chunks = [
  p(1, "The appellant sought judicial review of the Minister's decision."),
  p(2, "The Crown owed a fiduciary duty to the Nation in these circumstances."),
  p(3, "Compensation was assessed at fair market value as of the date of taking."),
];
const full = assemble(chunks);

// 1. locate_bug — present verbatim, so locate() should have found it.
assert.equal(classifyDrop("The Crown owed a fiduciary duty to the Nation", chunks, full).cause, "locate_bug");
// A quote spanning DOCUMENT-adjacent chunks is also findable, so also not a real drop.
assert.equal(classifyDrop("in these circumstances. Compensation was assessed", chunks, full).cause, "locate_bug");

// 2. marker_bleed — the model swept a paragraph marker in.
assert.equal(classifyDrop("circumstances. [para para-3] Compensation was assessed", chunks, full).cause, "marker_bleed");

// 3. assembly_boundary — adjacent in the PROMPT only. para-1 and para-3 are not
//    document-adjacent, so no window in locate() can span them. Marker stripped, so the
//    seam alone is the cause.
{
  const spliced = assemble([chunks[0], chunks[2]]);    // what the over-budget path emits
  const seamOnly = "Minister's decision. Compensation was assessed";
  assert.equal(classifyDrop(seamOnly, chunks, spliced.replace(/\[para [^\]]+\] /g, "")).cause,
    "assembly_boundary");
}

// 4. normalization — differs only by a fold normWs does not do.
{
  const punct = [p(1, "The order is set aside , and the appeal is allowed .")];
  const asm = assemble(punct);
  assert.equal(classifyDrop("The order is set aside, and the appeal is allowed.", punct, asm).cause,
    "normalization");
}

// 5. transcription — a real passage with one word changed mid-quote.
assert.equal(
  classifyDrop("The Crown owed a fiduciary duty to the People in these circumstances.", chunks, full).cause,
  "transcription");

// 6. unseen — shares nothing substantial with anything the model was given.
{
  const v = classifyDrop("The tribunal awarded punitive damages of four million dollars.", chunks, full);
  assert.equal(v.cause, "unseen");
  assert.ok(v.bestOverlap < 0.5, `unseen must be low overlap, got ${v.bestOverlap.toFixed(2)}`);
}

// --- ORDERING REGRESSION: marker_bleed must outrank assembly_boundary ---
// A marker-bearing quote is DEFINITIONALLY present in the assembled text — that is where
// the markers live. So if assembly_boundary were tested first it would absorb every
// marker case and marker_bleed would read zero however often it happened. The
// precondition assertion below is the point: it proves BOTH buckets match this input, so
// the test really is exercising precedence rather than passing by accident.
{
  const spliced = assemble([chunks[0], chunks[2]]);
  const withMarker = "Minister's decision. [para para-3] Compensation";
  assert.ok(normWs(spliced).includes(normWs(withMarker)),
    "precondition: this quote IS in the assembled text, so assembly_boundary also matches");
  assert.equal(classifyDrop(withMarker, chunks, spliced).cause, "marker_bleed",
    "marker_bleed must be tested BEFORE assembly_boundary");
}

// --- divergence offset is measured from the LCS anchor, not the quote start ---
{
  const v = classifyDrop("ZZZZ The Crown owed a fiduciary duty to the Nation in these XX", chunks, full);
  assert.ok(v.divergenceAt !== null && v.divergenceAt > 5,
    "divergence is reported after the matched run, not at index 0");
}

console.log("✅ test-cases-drop-cause passed");
