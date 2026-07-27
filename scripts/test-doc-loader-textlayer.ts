// The text-layer loader replaces Textract OCR with the PDF's own embedded text.
// Its two load-bearing behaviours are (a) attaching the correct "[p.N]" marker
// to each paragraph — page grounding is the whole reason this pipeline beats a
// plain summariser — and (b) recovering paragraph boundaries from glyph
// geometry, because a flat line join makes chunkDocument split on the size
// budget and cut through commitments.
// Fixtures are synthesised with pdf-lib so no binary blobs are committed.
// Run: npx tsx scripts/test-doc-loader-textlayer.ts
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildTextFromPages, extractPagesFromPdf, groupItemsIntoParagraphs } from "../src/lib/rap/doc-loader/textlayer";

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

// --- groupItemsIntoParagraphs: geometry -------------------------------------
// transform is a 6-element matrix; [0]/[3] are font-size scale, [4] is x,
// [5] is y. Larger y = higher on page.
const item = (str: string, y: number, x = 50) => ({ str, transform: [1, 0, 0, 1, x, y] });
// Same as `item`, but with a real font-size scale, for tests that exercise
// the one-gap font-size fallback (which reads transform[3]).
const itemSized = (str: string, y: number, fontSize: number, x = 50) => ({ str, transform: [fontSize, 0, 0, fontSize, x, y] });

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

async function main() {
  const pdf = await makePdf([["Page one para"], ["Page two first", "", "Page two second"]]);
  // Pass the Uint8Array pdf-lib gives us straight through — NOT wrapped in
  // Buffer.from(). That wrapping used to be exactly what made this line
  // deterministically fail on a fresh process (see textlayer.ts).
  const extracted = await extractPagesFromPdf(pdf);
  check("extracts one entry per page", extracted.length === 2, `got ${extracted.length}`);
  check("page 1 text recovered", extracted[0].join(" ").includes("Page one para"));
  check("page 2 split into two paragraphs", extracted[1].length === 2, `got ${extracted[1].length}`);

  console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
