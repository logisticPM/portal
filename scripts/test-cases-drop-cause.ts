import assert from "node:assert/strict";
import type { CaseChunk } from "../src/lib/cases/types";
import { classifyDrop, classifyElision, lcsSpan, widenFold, MIN_FRAGMENT } from "../src/lib/cases/ingest/drop-cause";
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

// --- classifyElision returns null for quotes that are not elided at all ---
assert.equal(classifyElision("no ellipsis anywhere in this sentence", [p(1, "irrelevant")]), null);
assert.equal(MIN_FRAGMENT, 20);

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
  // NOTE: this fixture strips the markers before calling, which is NOT what the runner ever
  // passes. The test pins the bucket's semantics; it does not show the bucket is reachable.
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

// --- elision: legitimate quoting with the middle omitted ---
{
  const long = [p(1,
    "The appellant argued that the consultation was inadequate in every material respect. " +
    "Counsel devoted considerable time to the history of the negotiations. " +
    "I conclude that the Crown discharged its duty to consult in the circumstances.")];
  const asm = assemble(long);

  // Both fragments live in ONE chunk, in order → elision.
  const q = "The appellant argued that the consultation was inadequate in every material respect. " +
            "... I conclude that the Crown discharged its duty to consult";
  const v = classifyDrop(q, long, asm);
  assert.equal(v.cause, "elision");
  assert.equal(v.elisionDiag, undefined, "the bucket is earned, so there is no failure diagnostic");

  // Every ellipsis spelling reaches the same verdict.
  for (const marker of ["…", ". . .", "[...]", "[…]", "...."]) {
    assert.equal(classifyDrop(q.replace("...", marker), long, asm).cause, "elision",
      `spelling ${JSON.stringify(marker)} must classify the same as "..."`);
  }

  // Reversed → the fragments are all present but not in order.
  const rev = "I conclude that the Crown discharged its duty to consult" +
              " ... The appellant argued that the consultation was inadequate in every material respect.";
  const rv = classifyDrop(rev, long, asm);
  assert.notEqual(rv.cause, "elision");
  assert.equal(rv.elisionDiag, "out_of_order");

  // A fragment under MIN_FRAGMENT matches incidentally, so it does not earn the bucket.
  const short = "The appellant argued that the consultation was inadequate ... duty";
  const sv = classifyDrop(short, long, asm);
  assert.notEqual(sv.cause, "elision");
  assert.equal(sv.elisionDiag, "fragment_too_short");

  // A second fragment present in no chunk at all.
  const bogus = "The appellant argued that the consultation was inadequate in every material respect." +
                " ... The tribunal awarded punitive damages of four million dollars.";
  const bv = classifyDrop(bogus, long, asm);
  assert.notEqual(bv.cause, "elision");
  assert.equal(bv.elisionDiag, "fragment_not_found");
}

// --- cross_chunk_only: legitimate in real writing, but not the strict bucket ---
{
  const two = [
    p(1, "The Crown owed a fiduciary duty to the Nation in these circumstances of dispossession."),
    p(2, "Compensation was assessed at fair market value as of the date of the taking of the land."),
  ];
  const asm = assemble(two);
  const q = "The Crown owed a fiduciary duty to the Nation in these circumstances" +
            " ... Compensation was assessed at fair market value as of the date";
  const v = classifyDrop(q, two, asm);
  assert.notEqual(v.cause, "elision", "fragments in different chunks do not earn the strict bucket");
  assert.equal(v.elisionDiag, "cross_chunk_only");
}

// --- ORDERING REGRESSION: elision must outrank transcription ---
// This is the assertion the whole change exists for. An elided quote whose LONGEST fragment
// exceeds half the quote clears LCS >= 0.5, so if transcription were tested first it would
// absorb the case and the contamination inside that bucket would stay invisible forever.
// The precondition proves both buckets match this input.
{
  const long = [p(1,
    "The duty to consult arises when the Crown has knowledge of a potential Aboriginal claim and " +
    "contemplates conduct that might adversely affect it, a threshold that is not demanding. " +
    "Accordingly the appeal is allowed.")];
  const asm = assemble(long);
  const q = "The duty to consult arises when the Crown has knowledge of a potential Aboriginal claim and " +
            "contemplates conduct that might adversely affect it ... Accordingly the appeal is allowed.";
  const v = classifyDrop(q, long, asm);
  assert.ok(v.bestOverlap >= 0.5,
    `precondition: longest fragment is ${v.bestOverlap.toFixed(2)} of the quote, so transcription also matches`);
  assert.equal(v.cause, "elision", "elision must be tested BEFORE transcription");
}

// --- marker_bleed vs elision: the precedence is UNREACHABLE, and that is the finding ---
// A quote cannot be both. Chunk text never contains "[para " (assembleInput adds the markers),
// so any fragment carrying a marker is found in no chunk → fragment_not_found; and a marker
// isolated between two ellipses is 13 characters → fragment_too_short. A precedence test here
// would pass no matter which order the checks ran in, which is worse than no test: it reads
// like a guarantee. Asserting the unreachability instead is the honest version.
{
  const long = [p(1, "The appellant argued that the consultation was inadequate in every material respect. " +
    "I conclude that the Crown discharged its duty to consult in the circumstances.")];
  const q = "The appellant argued that the consultation was inadequate in every material respect. " +
            "... [para para-1] I conclude that the Crown discharged its duty to consult";
  const el = classifyElision(q, long);
  assert.equal(el?.isElision, false);
  assert.equal(el?.diag, "fragment_not_found",
    "a marker inside a fragment makes that fragment unfindable — so the two buckets never both match");
}

// --- a five-dot run (sentence period + four-dot elision) must not strand a dot ---
{
  const long = [p(1,
    "The appellant argued that the consultation was inadequate in every material respect. " +
    "Counsel devoted considerable time to the history of the negotiations. " +
    "I conclude that the Crown discharged its duty to consult in the circumstances.")];
  const asm = assemble(long);
  const q = "The appellant argued that the consultation was inadequate in every material respect. " +
            ".... I conclude that the Crown discharged its duty to consult";
  assert.equal(classifyDrop(q, long, asm).cause, "elision",
    "a capped dot run would weld the stray dot onto fragment 2 and report fragment_not_found");
}

// --- the spelling must not decide the verdict when the seam is NOT a sentence boundary ---
// Bare dots swallow a preceding period; brackets do not. If the pattern does not absorb it
// for both, the same quote against the same source gets different answers by typography.
{
  const long = [p(1,
    "The Crown consulted the Nation in good faith throughout the process, and the appellant " +
    "has not established any deficiency in the accommodation that was ultimately offered.")];
  const asm = assemble(long);
  const head = "The Crown consulted the Nation in good faith throughout the process,";
  const tail = "has not established any deficiency in the accommodation";
  for (const marker of ["...", "…", "[...]", "(...)", ". . ."]) {
    assert.equal(classifyDrop(`${head} ${marker} ${tail}`, long, asm).cause, "elision",
      `spelling ${JSON.stringify(marker)} must not change the verdict`);
  }
}

// --- an ellipsis at the EDGE of a quote is still an elision ---
{
  const long = [p(1,
    "Counsel devoted considerable time to the history of the negotiations between the parties. " +
    "I conclude that the Crown discharged its duty to consult in the circumstances.")];
  const asm = assemble(long);
  const lead = "... I conclude that the Crown discharged its duty to consult";
  const trail = "Counsel devoted considerable time to the history of the negotiations ...";
  for (const q of [lead, trail]) {
    const v = classifyDrop(q, long, asm);
    assert.equal(v.cause, "elision", `edge elision must not fall through to transcription: ${q}`);
    assert.ok(v.bestOverlap >= 0.9,
      `precondition: ${v.bestOverlap.toFixed(2)} overlap means transcription would otherwise claim it`);
  }
}

console.log("✅ test-cases-drop-cause passed");
