// Run: npx tsx scripts/test-rap-chunk.ts
import { chunkDocument, splitInHalf } from "../src/lib/rap/chunk";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const para = (n: number) => `Commitment ${n}. Action: do thing ${n}.\nDeliverable: report ${n}.`;
const doc = Array.from({ length: 30 }, (_, i) => para(i + 1)).join("\n\n");

const chunks = chunkDocument(doc, 400);
check("splits a long document into several chunks", chunks.length > 1);
check("chunks are indexed in document order", chunks.every((c, i) => c.index === i));

// THE load-bearing property: no overlap, nothing lost. If this fails, commitments
// are being duplicated or dropped.
check(
  "concatenating chunks reproduces the source exactly (no overlap, no loss)",
  chunks.map((c) => c.text).join("\n\n").replace(/\s+/g, " ").trim() ===
    doc.replace(/\s+/g, " ").trim(),
);
check("every commitment paragraph survives somewhere",
  Array.from({ length: 30 }, (_, i) => i + 1).every((n) =>
    chunks.some((c) => c.text.includes(`Commitment ${n}.`))));
check("respects the target size (allowing one paragraph of overshoot)",
  chunks.every((c) => c.text.length <= 400 * 2));

// A document under target is one chunk — do not fragment small RAPs.
const small = chunkDocument(para(1), 400);
check("a small document stays a single chunk", small.length === 1);
check("an empty document yields no chunks", chunkDocument("", 400).length === 0);

// Recursive split, for a chunk that still truncates.
const big = chunkDocument(doc, 100000)[0];
const halves = splitInHalf(big);
check("splitInHalf returns two halves", halves !== null && halves.length === 2);
check(
  "halves reproduce the chunk (no loss)",
  halves !== null &&
    halves.map((h) => h.text).join("\n\n").replace(/\s+/g, " ").trim() ===
      big.text.replace(/\s+/g, " ").trim(),
);
check("an unsplittable single-line chunk returns null (caller must fail loudly)",
  splitInHalf({ text: "oneline", index: 0 }) === null);

// --- F2: splitLargeParagraph (chunk.ts:37-58) — the oversized-paragraph path. ---
// These fixtures force that branch; the fixtures above are 50-90 chars and never
// exceed targetChars, so it never ran and was completely untested.
//
// It used to be THE production path: loadDocumentText joined Textract LINE
// blocks with single newlines, so the paragraph split (/\n\s*\n/) never fired
// and the whole document arrived as one paragraph. loadDocumentText now emits
// LAYOUT-block paragraphs separated by real blank lines (see the 2026-07-16
// chunk-boundary spike in docs/rap-extraction-findings.md), so this is now the
// fallback for a single oversized paragraph rather than the common case. It
// still runs on any block bigger than targetChars, so it stays under test.

// A single "paragraph" (no blank lines) with several period-terminated
// sentences, deliberately sized so it must be split into multiple pieces at
// a small target.
const sentence = (n: number) =>
  `This is sentence number ${n} describing commitment activity in detail.`;
const bigParaSentences = Array.from({ length: 20 }, (_, i) => sentence(i + 1)).join(" ");
check("fixture is actually larger than target (branch precondition)", bigParaSentences.length > 400);

const sentenceChunks = chunkDocument(bigParaSentences, 400);
check("an oversized single paragraph is split into multiple pieces",
  sentenceChunks.length > 1);
check("no piece exceeds target when sentences are short enough to fit",
  sentenceChunks.every((c) => c.text.length <= 400));
check("splitting an oversized paragraph loses no text (sentences reproduce exactly)",
  sentenceChunks.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim() ===
    bigParaSentences.replace(/\s+/g, " ").trim());

// A single sentence longer than target: the code deliberately keeps it whole
// rather than cutting mid-sentence, so its piece legitimately overshoots.
const longSentence = `This one sentence is deliberately padded with a lot of extra words so that all by itself, with no period anywhere in the middle, it exceeds the small target size we are testing against here today.`;
check("long-sentence fixture is itself larger than target (branch precondition)",
  longSentence.length > 100);
const overlong = chunkDocument(longSentence, 100);
check("an over-long single sentence becomes its own whole piece (not split mid-sentence)",
  overlong.length === 1 && overlong[0].text === longSentence);

// Mix: a normal-sized sentence followed by one over-long sentence followed by
// more normal sentences — the over-long one should overshoot target while its
// neighbors still get packed normally, and nothing should be lost.
const mixed = `${sentence(1)} ${longSentence} ${sentence(2)} ${sentence(3)}`;
const mixedChunks = chunkDocument(mixed, 100);
check("mixed short/over-long sentences: no text lost",
  mixedChunks.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim() ===
    mixed.replace(/\s+/g, " ").trim());
check("mixed short/over-long sentences: only the over-long sentence's own piece exceeds target",
  mixedChunks.every((c) => c.text.length <= 100 || c.text.includes(longSentence)));

// The realistic failure mode this spike measures: consecutive bullet-list
// items with NO trailing period (real RAP OCR text — Textract LINE blocks
// carry no sentence punctuation on list items). Because splitLargeParagraph
// only splits AFTER a period, a run of unpunctuated bullets joined by "\n"
// has ZERO split points and becomes one single oversized piece, however large.
const bullets = Array.from(
  { length: 15 },
  (_, i) => `Require all employees to complete action item number ${i + 1} on the plan`,
).join("\n");
check("bullets-with-no-periods fixture is larger than target (branch precondition)",
  bullets.length > 300);
const bulletChunks = chunkDocument(bullets, 300);
check("a run of unpunctuated bullets has no sentence split point, so it stays ONE oversized piece",
  bulletChunks.length === 1 && bulletChunks[0].text.length > 300);
check("the unpunctuated-bullet block still loses no text",
  bulletChunks[0].text.replace(/\s+/g, " ").trim() === bullets.replace(/\s+/g, " ").trim());

process.exit(fail ? 1 : 0);
