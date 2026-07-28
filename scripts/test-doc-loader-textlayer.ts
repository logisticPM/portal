// The text-layer loader replaces Textract OCR with the PDF's own embedded text.
// Its two load-bearing behaviours are (a) attaching the correct "[p.N]" marker
// to each paragraph — page grounding is the whole reason this pipeline beats a
// plain summariser — and (b) recovering paragraph boundaries from glyph
// geometry, because a flat line join makes chunkDocument split on the size
// budget and cut through commitments.
// Fixtures are synthesised with pdf-lib so no binary blobs are committed.
// Run: npx tsx scripts/test-doc-loader-textlayer.ts
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { DEFAULT_TARGET_CHARS } from "../src/lib/rap/chunk";
import {
  bucketIntoLines,
  buildTextFromPages,
  columnsLookLikeProse,
  detectColumnBoundaries,
  detectColumnGutters,
  extractPagesFromPdf,
  groupItemsIntoParagraphs,
  loadFromBytes,
  splitLineIntoColumns,
  type TextItem,
} from "../src/lib/rap/doc-loader/textlayer";
import { ScannedDocumentError, UnsupportedDocumentError } from "../src/lib/rap/doc-loader/types";

let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
}

// --- buildTextFromPages: the "[p.N]" contract -------------------------------
const text = buildTextFromPages([["Alpha para"], ["Beta para", "Gamma para"]]);
check("page 1 paragraph carries [p.1]", text.includes("[p.1]\nAlpha para"));
check("page 2 paragraphs carry [p.2]", text.includes("[p.2]\nBeta para") && text.includes("[p.2]\nGamma para"));
check("paragraphs are blank-line separated", text.split("\n\n").length === 3, JSON.stringify(text));
check("page order preserved", text.indexOf("Alpha") < text.indexOf("Beta"));
check("empty paragraphs dropped", !buildTextFromPages([["", "   "], ["Real"]]).includes("[p.1]"));

// A page whose extraction produced zero paragraphs (the "hole" that
// extractPagesFromPdf's pageIndex-based backfill can leave when a page's
// pagerender threw and was caught+swallowed by pdf-parse) must not shift
// later pages' markers — index into `pages` is the source of truth, not a
// running counter of pages that produced text.
const withHole = buildTextFromPages([["Page one text"], [], ["Page three text"]]);
check("a paragraph-less page leaves no marker of its own", !withHole.includes("[p.2]"), withHole);
check("a later page still reports its TRUE page number past a hole", withHole.includes("[p.3]\nPage three text"), withHole);

// --- buildTextFromPages: the marker must fit INSIDE the size budget ---------
// buildTextFromPages pre-splits an oversized paragraph so that no marker-less
// piece can reach chunkDocument. That only works if the emitted block —
// MARKER INCLUDED — stays within DEFAULT_TARGET_CHARS: chunk.ts's own
// splitLargeParagraph re-splits anything over the target and keeps the "[p.N]"
// line on the FIRST piece only, so a block that overshoots by even the marker's
// own length reintroduces exactly the orphaned, marker-less piece the pre-split
// exists to prevent.
//
// The fixture packs to the boundary on purpose: 200 sentences of exactly 59
// chars joined by single spaces means a greedy sentence packer lands on
// 60k - 1 chars. Against a 6000 target that is k=100 -> 5999, which +6 for
// "[p.1]\n" is 6005 and OVERSHOOTS; against 6000-6=5994 it is k=99 -> 5939,
// which fits. So this check fails if the marker length is not subtracted.
const packSentence = (n: number) => `S${String(n).padStart(3, "0")} ${"x".repeat(53)}.`;
const packedPara = Array.from({ length: 200 }, (_, i) => packSentence(i + 1)).join(" ");
check("packing fixture is built to the boundary", packSentence(1).length === 59 && packedPara.length > DEFAULT_TARGET_CHARS,
  `${packSentence(1).length} / ${packedPara.length}`);
const packedBlocks = buildTextFromPages([[packedPara]]).split("\n\n");
check("an oversized paragraph is split into several marked blocks", packedBlocks.length > 1, `got ${packedBlocks.length}`);
check("every block keeps its own [p.1] marker", packedBlocks.every((b) => b.startsWith("[p.1]\n")));
check(
  "no block exceeds the chunker's target ONCE THE MARKER IS COUNTED",
  packedBlocks.every((b) => b.length <= DEFAULT_TARGET_CHARS),
  `max ${Math.max(...packedBlocks.map((b) => b.length))}`,
);

// --- groupItemsIntoParagraphs: geometry -------------------------------------
// transform is a 6-element matrix; [0]/[3] are font-size scale, [4] is x,
// [5] is y. Larger y = higher on page. `width` is the run's advance width, so
// its right edge is transform[4] + width — pdf.js populates it on every item.
// The helpers below estimate it as 0.5 em per character, close enough to a
// real Helvetica advance for the geometry these fixtures exercise.
const advance = (str: string, fontSize: number) => str.length * fontSize * 0.5;
const item = (str: string, y: number, x = 50) => ({ str, width: advance(str, 1), transform: [1, 0, 0, 1, x, y] });
// Same as `item`, but with a real font-size scale, for tests that exercise
// the one-gap font-size fallback (which reads transform[3]).
const itemSized = (str: string, y: number, fontSize: number, x = 50) => ({
  str,
  width: advance(str, fontSize),
  transform: [fontSize, 0, 0, fontSize, x, y],
});
// Explicit geometry, for the column and word-spacing fixtures where the exact
// left and right edges are the thing under test.
const run = (str: string, x: number, y: number, width: number, fontSize = 12) => ({
  str,
  width,
  transform: [fontSize, 0, 0, fontSize, x, y],
});

// Three lines 12pt apart, then a 40pt gap, then two more: two paragraphs.
const paras = groupItemsIntoParagraphs([
  item("Line one", 700), item("Line two", 688), item("Line three", 676),
  item("Second para", 636), item("still second", 624),
]);
check("large vertical gap starts a new paragraph", paras.length === 2, `got ${paras.length}`);
check("first paragraph joins its lines", paras[0] === "Line one\nLine two\nLine three", JSON.stringify(paras[0]));
check("second paragraph joins its lines", paras[1] === "Second para\nstill second", JSON.stringify(paras[1]));

// Items sharing a y are one line, joined left-to-right by x.
const oneLine = groupItemsIntoParagraphs([item("world", 700, 90), item("Hello", 700, 50)]);
check("same-y items form one line ordered by x", oneLine[0] === "Hello world", JSON.stringify(oneLine[0]));

// Uniform spacing = a single paragraph.
const uniform = groupItemsIntoParagraphs([item("a", 700), item("b", 688), item("c", 676), item("d", 664)]);
check("uniform line spacing stays one paragraph", uniform.length === 1, `got ${uniform.length}`);

// A 3-line page has exactly TWO gaps — the specific size where an earlier
// version of the threshold (upper median = sorted[Math.floor(2/2)] =
// sorted[1] = the LARGER of the two gaps) picked the outlier gap itself as
// the baseline, inflating the threshold past the very gap meant to trigger a
// split. Lower-quartile (== minimum for only 2 gaps) fixes it: the baseline
// is the tight, same-paragraph spacing, not the break itself.
const threeUniform = groupItemsIntoParagraphs([item("First", 700), item("Second", 688), item("Third", 676)]);
check("3-line page, uniform spacing, stays one paragraph", threeUniform.length === 1, `got ${threeUniform.length}`);

const threeWithBreak = groupItemsIntoParagraphs([item("First", 700), item("Second", 688), item("Third", 636)]);
check("3-line page, one large gap, splits into two paragraphs", threeWithBreak.length === 2, `got ${threeWithBreak.length}`);
check(
  "3-line split keeps the two close lines together",
  threeWithBreak[0] === "First\nSecond" && threeWithBreak[1] === "Third",
  JSON.stringify(threeWithBreak),
);

// A single near-duplicate-baseline outlier (a superscript footnote marker, a
// shifted table cell — anything sitting just outside SAME_LINE_EPSILON of its
// neighbor) must not become the WHOLE page's baseline gap. Six real lines,
// 14pt leading, one genuine 28pt paragraph break -> 2 paragraphs; plain
// MINIMUM gap would seize on the outlier's ~3pt gap to itself, drop the
// threshold below every ordinary 14pt gap, and fragment the page into 5
// one-line pieces. Lower-quartile is robust to exactly one such outlier.
const superscriptOutlier = groupItemsIntoParagraphs([
  item("First", 700),
  item("Second", 686),
  item("Third", 672),
  item("2", 661), // footnote-marker-style outlier: 3pt off the next real line
  item("Fourth", 658),
  item("Fifth", 630), // 28pt break -> genuine second paragraph
  item("Sixth", 616),
]);
check(
  "a single near-duplicate-baseline outlier does not fragment the page",
  superscriptOutlier.length === 2,
  `got ${superscriptOutlier.length}`,
);

check("no items yields no paragraphs", groupItemsIntoParagraphs([]).length === 0);

// --- groupItemsIntoParagraphs: the one-gap (2-line page) font-size fallback -
// Ordinary single/1.5-spaced text must NOT split just because a page only has
// two lines. 12pt font, 20pt leading (~1.67x, a common "1.5 spacing" render)
// is normal wrapped-paragraph spacing, not a paragraph break.
const wrappedTwoLine = groupItemsIntoParagraphs([itemSized("This wraps onto", 700, 12), itemSized("a second line.", 680, 12)]);
check("12pt text on 20pt leading (ordinary spacing) stays one paragraph", wrappedTwoLine.length === 1, `got ${wrappedTwoLine.length}`);

// But a genuinely large gap on that same 2-line page must still be caught.
const genuineTwoLineBreak = groupItemsIntoParagraphs([itemSized("Closing line one.", 700, 12), itemSized("Closing line two.", 660, 12)]);
check("a genuinely large gap on a two-line page still splits", genuineTwoLineBreak.length === 2, `got ${genuineTwoLineBreak.length}`);

// A larger glyph sharing a baseline with normal text (e.g. a drop cap, an
// inline heading fragment) must not inflate the one-gap threshold and
// swallow a real break.
const mixedGlyphSizeLine = groupItemsIntoParagraphs([
  itemSized("BIG", 700, 24),
  itemSized("text", 700, 12, 90),
  itemSized("Body text on its own paragraph.", 670, 12),
]);
check(
  "a large glyph sharing a baseline doesn't inflate the threshold past a real break",
  mixedGlyphSizeLine.length === 2,
  `got ${mixedGlyphSizeLine.length}`,
);

// --- glyph runs: a run boundary is not automatically a space ----------------
// InDesign-class producers emit a kerned or tracked word as several separately
// positioned runs with NO space character between them. Joining every run with
// " " turned "Reconciliation" into "Recon ciliation", which then fails
// validate.ts's verbatim quote check for a reason that has nothing to do with
// the model. Abutting runs (gap ~0) are one word; a real word space is ~0.28em.
const abutting = groupItemsIntoParagraphs([
  run("Recon", 50, 700, 34.68),
  run("ciliation", 84.68, 700, 40.01), // starts exactly where "Recon" ends
]);
check("abutting glyph runs form ONE word", abutting[0] === "Reconciliation", JSON.stringify(abutting[0]));

const spaced = groupItemsIntoParagraphs([
  run("Action", 50, 700, 36),
  run("Plan", 89.34, 700, 24), // 3.34pt gap on a 12pt font: a real space (0.278em)
]);
check("runs separated by a real space gap form TWO words", spaced[0] === "Action Plan", JSON.stringify(spaced[0]));

// --- multi-column pages: COLUMN_REORDERING_ENABLED is true ------------------
// Reordering was previously shipped OFF because no gutter-WIDTH threshold
// separates a genuine two-column body page from a commitment TABLE. It is now
// on, because the discriminator moved: detectColumnGutters is pure geometry,
// and columnsLookLikeProse is a separate guard that refuses a table's
// geometry. The tests below exercise all three layers — the geometry, the
// guard, and their composition — because it is the SPLIT between them, not
// either half alone, that makes re-enabling safe.

// Text block runs x=50..550 (500pt wide); the gutter is 230..330 (100pt),
// clear of the 15%-of-text-width floor.
const twoColumnItems = [0, 1, 2, 3].flatMap((i) => [
  run(`Left column line ${i + 1}`, 50, 700 - i * 14, 180),
  run(`Right col line ${i + 1}`, 330, 700 - i * 14, 220),
]);
// The same geometry, pre-bucketed into lines the way bucketIntoLines would —
// the detection functions operate on already-bucketed input, so the fixtures
// below build that shape directly rather than relying on the (unexported)
// bucketing helper.
const twoColumnLines = [0, 1, 2, 3].map((i) => ({
  y: 700 - i * 14,
  items: [
    run(`Left column line ${i + 1}`, 50, 700 - i * 14, 180),
    run(`Right col line ${i + 1}`, 330, 700 - i * 14, 220),
  ],
}));
const twoColumnGutters = detectColumnBoundaries(twoColumnLines);
check("detectColumnBoundaries finds the gutter on a genuine two-column page",
  twoColumnGutters.length === 1 && twoColumnGutters[0].lo === 230 && twoColumnGutters[0].hi === 330,
  JSON.stringify(twoColumnGutters));
const twoColSplit = splitLineIntoColumns(twoColumnLines[0].items, twoColumnGutters);
check("splitLineIntoColumns puts each side of a two-column line in its own band",
  !twoColSplit.spans && twoColSplit.cols.length === 2 &&
    twoColSplit.cols[0][0].str === "Left column line 1" && twoColSplit.cols[1][0].str === "Right col line 1",
  JSON.stringify(twoColSplit));

// A full-width heading crosses the gutter, so it belongs to NO column — that
// is the geometric fact groupItemsIntoParagraphs's section-splitting relies
// on to keep a spanning heading out of both columns. Note this is decided per
// RUN, not per gap: a heading whose words pdf.js emits as separate runs is
// still caught, because one of those runs must straddle the gutter band.
const advanceHeading = (str: string, fontSize: number) => str.length * fontSize * 0.5;
let headingX = 50;
const headingRuns = "Our commitments for the coming year".split(" ").map((w) => {
  const r = run(w, headingX, 730, advanceHeading(w, 12));
  headingX += advanceHeading(w, 12) + 3.34;
  return r;
});
check("a full-width heading spans the gutter and is assigned to no column",
  splitLineIntoColumns(headingRuns, twoColumnGutters).spans === true);

// THE failure the gutter-WIDTH approach could not fix, in miniature. This is
// the real Bank of Canada shape: ONE left-column line very nearly fills its
// band, leaving a gap to the right column far narrower than the page's
// typical inter-column gap — 52pt here, against a 60pt threshold; as little
// as 15pt against 64pt on the real document. A gap-threshold splitter reads
// exactly that line as full-width and concatenates the two columns
// mid-sentence, which is what cost the real document 8 of its 22 commitments.
// Membership in a refined band does not care how wide the gap is.
const tightLines = [0, 1, 2, 3].map((i) => ({
  y: 700 - i * 14,
  items: [
    i === 3
      ? run("Left column line that nearly fills its band", 50, 700 - i * 14, 228)
      : run(`Left column line ${i + 1}`, 50, 700 - i * 14, 180),
    run(`Right col line ${i + 1}`, 330, 700 - i * 14, 220),
  ],
}));
const tightGutters = detectColumnBoundaries(tightLines);
check("the gutter is refined to where the columns ACTUALLY are, not to the mean of ragged line ends",
  tightGutters.length === 1 && tightGutters[0].lo === 278 && tightGutters[0].hi === 330,
  JSON.stringify(tightGutters));
const tightSplit = splitLineIntoColumns(tightLines[3].items, tightGutters);
check("a line whose columns nearly touch is STILL split by band, not by gap width",
  !tightSplit.spans && tightSplit.cols.length === 2 &&
    tightSplit.cols[0][0].str === "Left column line that nearly fills its band" &&
    tightSplit.cols[1][0].str === "Right col line 4",
  JSON.stringify(tightSplit));

// --- refineGutter: MIN_GUTTER_BAND_PT rejects a degenerate sub-point band --
// Pushing the "nearly fills its band" shape above (52pt) all the way to a
// SUB-POINT gap reproduces the real Bank of Canada page 11 failure: four
// lines establish a genuine, wide, recurring gutter (so rough detection and
// the hi-alignment cluster both fire normally), and a fifth line's left
// column reaches to within 0.1pt of that same hi. `lo < hi` alone is still
// true — refineGutter would return a band — but 0.1pt is not a real column
// gap, it's where this line's glyphs happened to end. That is exactly what
// happened on the real page 11 (measured band: 347.838..347.940, 0.102pt),
// which fragmented 4 sentences mid-phrase. See MIN_GUTTER_BAND_PT.
const nearTouchingLines = [
  ...twoColumnLines,
  {
    y: 700 - 4 * 14,
    items: [
      run("Left column line that nearly touches the gutter", 50, 700 - 4 * 14, 279.9), // right edge 329.9, 0.1pt short of hi=330
      run("Right col line 5", 330, 700 - 4 * 14, 220),
    ],
  },
];
check("a degenerate sub-point band is REJECTED (MIN_GUTTER_BAND_PT guard)",
  detectColumnGutters(nearTouchingLines).length === 0,
  JSON.stringify(detectColumnGutters(nearTouchingLines)));

// Companion: a genuine narrow band — sized to 15pt, the width of the
// narrowest GENUINE gutter measured on this document (real page 13, refined
// band 299.99..315.00, see the real-geometry section below) — must still be
// ACCEPTED at the same 1pt floor. Built the same way as nearTouchingLines
// (four lines establish the rough gutter, a fifth supplies the tight edge)
// so the only variable between the two tests is the band width itself.
const genuineNarrowLines = [
  ...twoColumnLines,
  {
    y: 700 - 4 * 14,
    items: [
      run("Left column line that nearly fills a genuine band", 50, 700 - 4 * 14, 265), // right edge 315, 15pt short of hi=330
      run("Right col line 5", 330, 700 - 4 * 14, 220),
    ],
  },
];
const genuineNarrowGutters = detectColumnGutters(genuineNarrowLines);
check("a genuine ~15pt band clears MIN_GUTTER_BAND_PT and is still accepted",
  genuineNarrowGutters.length === 1 &&
    genuineNarrowGutters[0].lo === 315 &&
    genuineNarrowGutters[0].hi === 330,
  JSON.stringify(genuineNarrowGutters));

// One wide gap on one or two lines is a right-aligned page number or a
// header/footer pair, not a column structure. The gutter must recur on at
// least three lines before it is believed — if that floor were 2, this page
// would be reordered.
const rightAlignedLines = [0, 1, 2, 3].map((i) => ({
  y: 700 - i * 14,
  items: [run(`Body text line ${i + 1}`, 50, 700 - i * 14, 200)],
}));
rightAlignedLines[0].items.push(run("RAP 2026", 480, 700, 60)); // header, far right
rightAlignedLines[1].items.push(run("12", 540, 686, 12)); // footer page number, far right
check("a right-aligned header/footer pair is not mistaken for a column (MIN_COLUMN_ROWS guard)",
  detectColumnBoundaries(rightAlignedLines).length === 0);

// A SINGLE-COLUMN page must be completely unaffected: same lines, same order,
// one paragraph. Each line here carries several runs with ordinary word gaps,
// the shape a real body page has.
const singleColumnLines = ["Reconciliation is a shared", "responsibility across every", "part of the organisation."];
const singleColumn = groupItemsIntoParagraphs(
  singleColumnLines.flatMap((line, i) => {
    let x = 50;
    return line.split(" ").map((w) => {
      const r = run(w, x, 700 - i * 14, advance(w, 12));
      x += advance(w, 12) + 3.34; // ordinary 0.278em word space
      return r;
    });
  }),
);
check("a single-column page is one paragraph in reading order",
  singleColumn.length === 1 && singleColumn[0] === singleColumnLines.join("\n"), JSON.stringify(singleColumn));

// --- groupItemsIntoParagraphs on a two-column page --------------------------
// The capability this whole exercise exists to restore: a genuine two-column
// page comes back COLUMN-MAJOR, so no sentence is interleaved with its
// neighbour's. Before this it came back as "Left column line 1 Right col
// line 1", i.e. every line welded to the wrong continuation.
const twoColumn = groupItemsIntoParagraphs(twoColumnItems);
check("a two-column page is emitted column-major, not baseline-interleaved",
  twoColumn.length === 2 &&
    twoColumn[0] === "Left column line 1\nLeft column line 2\nLeft column line 3\nLeft column line 4" &&
    twoColumn[1] === "Right col line 1\nRight col line 2\nRight col line 3\nRight col line 4",
  JSON.stringify(twoColumn));

// --- groupItemsIntoParagraphs on a three-column commitment table -----------
// THE regression the earlier revert existed to lock down, now re-run with
// reordering ON. Shaped like a real RAP commitment table: three rows, each
// with an Action / Timeline / Owner cell, gaps between cells (~90-100pt)
// comfortably inside the "wide gutter" band. Each row's action, timeline and
// owner must stay together, in reading order, in the SAME paragraph — not
// scattered into separate column-major blocks that let a model attach the
// wrong owner or timeline to the wrong action, with a quote that still passes
// validate.ts's quote_not_found check.
const tableItems = [0, 1, 2].flatMap((i) => [
  run(`Action ${i + 1}: complete the review`, 50, 700 - i * 60, 200),
  run(`2026 Q${i + 1}`, 340, 700 - i * 60, 60),
  run(["CPO", "CHRO", "CEO"][i], 500, 700 - i * 60, 50),
]);
const tableParas = groupItemsIntoParagraphs(tableItems);
check("a three-column commitment table is NOT torn apart (regression lock)",
  tableParas.length === 1 &&
    tableParas[0] ===
      "Action 1: complete the review 2026 Q1 CPO\n" +
        "Action 2: complete the review 2026 Q2 CHRO\n" +
        "Action 3: complete the review 2026 Q3 CEO",
  JSON.stringify(tableParas));

// Prove the table survives because the PROSE GUARD refuses it, not because it
// happens to dodge geometric detection. detectColumnGutters — pure geometry —
// finds both gutters in this exact shape; columnsLookLikeProse is what says
// no. Delete the guard and the check above fails loudly.
const tableLines = [0, 1, 2].map((i) => ({
  y: 700 - i * 60,
  items: [
    run(`Action ${i + 1}: complete the review`, 50, 700 - i * 60, 200),
    run(`2026 Q${i + 1}`, 340, 700 - i * 60, 60),
    run(["CPO", "CHRO", "CEO"][i], 500, 700 - i * 60, 50),
  ],
}));
const tableGutters = detectColumnGutters(tableLines);
check("a commitment table's GEOMETRY is genuinely two-gutter (the danger is real)",
  tableGutters.length === 2, JSON.stringify(tableGutters));
check("the prose guard REFUSES a table's short label bands",
  columnsLookLikeProse(tableLines, tableGutters) === false);
check("so detectColumnBoundaries reports no columns for a table",
  detectColumnBoundaries(tableLines).length === 0);
// ...and the same guard must ACCEPT a real two-column page, or it would just
// be an elaborate way of disabling the feature.
check("the prose guard ACCEPTS a genuine two-column body page",
  columnsLookLikeProse(twoColumnLines, detectColumnGutters(twoColumnLines)) === true);

// --- REAL geometry: Bank of Canada RAP pages 13 and 15 ----------------------
// Every constant above is a heuristic, and heuristics tuned against synthetic
// fixtures have twice been measured wrong on this branch. This section drives
// the SAME function the pipeline calls with the ACTUAL glyph runs pdf.js
// emits for the two pages of the Bank of Canada RAP that carry its
// commitments — the corpus every earlier round lacked. The PDF itself is not
// committed (no binary blobs); the geometry is, in
// scripts/fixtures/textlayer-geometry-bankofcanada-p13-p15.json, dumped from
// pageData.getTextContent() with {normalizeWhitespace: false,
// disableCombineTextItems: false}, exactly as extractPagesFromPdf calls it.
//
// These pages are a two-COLUMN BULLETED LIST, not a table. With reordering
// off, the columns interleave mid-sentence and only 4 of the document's 22
// gold commitments survive intact; the assertions below are what stops that
// regressing. They assert on OUTPUT — that each action is recoverable as
// contiguous text — never on restatements of the fixture's own coordinates.
const realGeometry = JSON.parse(
  readFileSync(new URL("./fixtures/textlayer-geometry-bankofcanada-p13-p15.json", import.meta.url), "utf8"),
) as Record<string, TextItem[]>;
const goldCommitments = JSON.parse(
  readFileSync(new URL("./fixtures/gold-commitments-bankofcanada.json", import.meta.url), "utf8"),
) as { page: number; action: string }[];

check("real-geometry fixture carries both commitment pages",
  realGeometry["13"]?.length > 0 && realGeometry["15"]?.length > 0,
  `p13 ${realGeometry["13"]?.length} runs / p15 ${realGeometry["15"]?.length} runs`);

// A paragraph keeps the line breaks the PDF wrapped at, so "contiguous" means
// contiguous after whitespace normalisation — not "on one line".
const flatten = (s: string) => s.replace(/\s+/g, " ").trim();
// Straight-vs-curly apostrophe: the PDF uses U+2019, the hand-transcribed gold
// set uses U+0027. validate.ts's quote rule already folds both away (it
// compares on [a-z0-9] runs only, for exactly this reason), so folding here
// keeps this test measuring EXTRACTION rather than transcription.
const foldQuotes = (s: string) => flatten(s).replace(/[‘’]/g, "'");

for (const page of ["13", "15"] as const) {
  const paragraphs = groupItemsIntoParagraphs(realGeometry[page]);
  const flat = paragraphs.map(foldQuotes);
  const expected = goldCommitments.filter((g) => g.page === Number(page));
  const missing = expected.filter((g) => !flat.some((p) => p.includes(foldQuotes(g.action))));
  check(`every gold commitment on real page ${page} survives as contiguous text (${expected.length})`,
    missing.length === 0,
    missing.length ? `missing: ${missing.map((m) => m.action.slice(0, 45)).join(" | ")}` : "");

  // Each action must be its OWN paragraph, not merely present somewhere in a
  // page-sized blob: a paragraph welding two actions together is what the
  // model turns into one commitment with the wrong scope.
  const welded = expected.filter((g) => {
    const host = flat.find((p) => p.includes(foldQuotes(g.action)));
    return host !== undefined && expected.some((o) => o !== g && host.includes(foldQuotes(o.action)));
  });
  check(`no two gold commitments on real page ${page} are welded into one paragraph`,
    welded.length === 0, welded.map((w) => w.action.slice(0, 40)).join(" | "));
}

// The specific mechanism, on real coordinates: p13's left column runs out to
// x=299.99 and its right column starts at x=315.00, so the two are only
// 15.01pt apart on the page's longest lines — far under any gutter-width
// threshold that also has to reject tables. Asserting the refined gutter here
// pins the behaviour that recovered the 8 commitments a threshold lost.
const realLines13 = bucketIntoLines(realGeometry["13"].filter((i) => i.str.trim() !== ""));
const realGutters13 = detectColumnBoundaries(realLines13);
check("the real page 13 gutter is refined to the columns' true edges",
  realGutters13.length === 1 && Math.abs(realGutters13[0].lo - 299.99) < 0.05 && Math.abs(realGutters13[0].hi - 315) < 0.05,
  JSON.stringify(realGutters13));
check("the real two-column commitment page passes the prose guard",
  columnsLookLikeProse(realLines13, detectColumnGutters(realLines13)) === true);

// The interleaving this replaces, demonstrated rather than described: read the
// same real page WITHOUT column resolution and the first commitment is welded
// to the one beside it.
const interleaved = flatten(
  realLines13
    .map((l) => [...l.items].sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(" "))
    .join("\n"),
);
check("without column resolution the same real page welds the two columns together",
  interleaved.includes("Invest in the CBNII to share") &&
    !interleaved.includes(flatten("Invest in the CBNII to share work and learn best practices in")),
);

// --- end-to-end over a synthesised PDF --------------------------------------
async function makePdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    let y = 700;
    for (const line of lines) {
      if (line === "") { y -= 40; continue; } // blank marker = paragraph gap
      page.drawText(line, { x: 50, y, size: 12, font });
      y -= 14;
    }
  }
  return doc.save();
}

// A hand-built, UNCOMPRESSED one-page PDF. Needed only for the damaged-glyph
// fixture: pdf-lib refuses to encode a control character ("WinAnsi cannot
// encode "), and it Flate-compresses its content streams, so there is no
// way to get a chosen raw glyph byte into a pdf-lib document. Byte 0x01 under
// WinAnsiEncoding is what this bundled pdf.js hands back as U+0001 (verified
// 2026-07-27) — the same class of unmapped-glyph damage measured on the real
// TMX RAP, where every "fi" ligature came back as a NUL.
function rawPdfWithText(body: string): Uint8Array {
  const stream = `BT /F1 12 Tf 50 700 Td (${body}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(out, "latin1"));
}

async function throwsAsync(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

async function main() {
  const pdf = await makePdf([["Page one para"], ["Page two first", "", "Page two second"]]);
  // Pass the Uint8Array pdf-lib gives us straight through — NOT wrapped in
  // Buffer.from(). That wrapping used to be exactly what made this line
  // deterministically fail on a fresh process (see textlayer.ts).
  const extracted = await extractPagesFromPdf(pdf);
  check("extracts one entry per page", extracted.length === 2, `got ${extracted.length}`);
  check("page 1 text recovered", extracted[0].join(" ").includes("Page one para"));
  check("page 2 split into two paragraphs", extracted[1].length === 2, `got ${extracted[1].length}`);

  // --- loadFromBytes: the COMPOSITION, not the pieces -----------------------
  // Every check above drives one pure function in isolation. The loader's own
  // wiring — the extension guard, the fidelity scan, the text-layer gate, the
  // coverage measurement, and the order they run in — is a separate seam, and
  // deleting any of those calls used to break no test at all.
  const bodyLine = "Reconciliation Action Plan commitments for the coming reporting year and beyond.";
  const goodPdf = await makePdf([
    [bodyLine, bodyLine, bodyLine],
    [bodyLine, bodyLine, bodyLine],
  ]);

  const unsupported = await throwsAsync(() => loadFromBytes(goodPdf, "commitments.docx"));
  check("a non-PDF filename is refused with UnsupportedDocumentError",
    unsupported instanceof UnsupportedDocumentError, String(unsupported));

  // A 3-page PDF carrying a single stray glyph is what a scan looks like once
  // the text layer is read: almost nothing, spread over real pages.
  const scannedLooking = await makePdf([["7"], [], []]);
  const scannedErr = await throwsAsync(() => loadFromBytes(scannedLooking, "scan.pdf"));
  check("a PDF with no usable text layer throws ScannedDocumentError",
    scannedErr instanceof ScannedDocumentError, String(scannedErr));

  const good = await loadFromBytes(goodPdf, "rap.pdf");
  check("a good PDF comes back as marked-up text", good.text.startsWith("[p.1]\n") && good.text.includes("[p.2]\n"),
    JSON.stringify(good.text.slice(0, 60)));
  check("a good PDF is not flagged as damaged", good.fidelityDamaged === false && good.damagedOffsets.length === 0);
  check("a good PDF reports no coverage problem", good.lowPageCoverage === null, JSON.stringify(good.lowPageCoverage));

  // Damaged glyphs: the loader must SET the flag, not throw, so the pipeline
  // can raise one document-level issue explaining the quote mismatches.
  const damagedPdf = rawPdfWithText(
    `Reconciliation Action Plan ${String.fromCharCode(1)} commitments text repeated to clear the text-layer floor. ` +
      "Reconciliation Action Plan commitments text repeated to clear the text-layer floor. " +
      "Reconciliation Action Plan commitments text repeated to clear the text-layer floor.",
  );
  const damaged = await loadFromBytes(damagedPdf, "damaged.pdf");
  check("a damaged-font PDF sets the fidelity flag rather than throwing",
    damaged.fidelityDamaged === true && damaged.damagedOffsets.length === 1,
    JSON.stringify(damaged.damagedOffsets));
  check("the damaged glyph is rendered visibly as U+FFFD", damaged.text.includes("�"));

  // Low coverage is an ISSUE, not a rejection: page 2 here is a full-page
  // image (no text at all), which is 1 of 2 pages covered — under the ratio.
  const halfBlank = await makePdf([[bodyLine, bodyLine, bodyLine, bodyLine, bodyLine], []]);
  const sparse = await loadFromBytes(halfBlank, "photo-heavy.pdf");
  check("a page that carried no text is reported as low coverage, not thrown",
    sparse.lowPageCoverage?.coveredPages === 1 && sparse.lowPageCoverage?.pageCount === 2,
    JSON.stringify(sparse.lowPageCoverage));
  check("the low-coverage document still returns its usable text", sparse.text.includes("[p.1]\n"));

  console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

// Without this, an async rejection escapes as an unhandled promise rejection
// AFTER every synchronous check above has already printed a ✅ — a partial run
// that reads exactly like a pass.
main().catch((e) => {
  console.error(e);
  console.log(`\n${fail + 1} failed (suite aborted before completing)`);
  process.exit(1);
});
