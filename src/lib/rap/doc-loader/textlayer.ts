// Textract-free document loading: read the PDF's OWN embedded text layer.
// Viable because RAPs are digitally produced, not scanned (measured 2026-07-27:
// Bank of Canada 17pp -> 21,994 chars, TMX 2pp -> 3,805 chars). Necessary
// because an org SCP denies Textract to this account's service roles
// (docs/ca-extraction-textract-scp.md).
//
// The hard part is NOT getting text — pdf-parse does that in one call. It is
// getting the SAME output shape the LAYOUT path produces: paragraphs, each
// carrying its own "[p.N]" marker. pdf-parse's default output is one flat blob
// with no page boundaries and no paragraph breaks, which loses page grounding
// entirely (measured: the model then guesses pages, ~1/10 correct) and makes
// chunkDocument split on the size budget instead of at paragraph edges.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { DEFAULT_TARGET_CHARS } from "../chunk";
import { getDocumentBytes } from "../storage";
import { splitOversizedBlockText } from "./textract";
import { type DocLoader, type LoadResult, ScannedDocumentError, UnsupportedDocumentError } from "./types";

export interface TextItem {
  str: string;
  transform: number[];
}

// A new paragraph starts when the vertical gap exceeds this multiple of a
// "typical single-line gap" baseline (see groupItemsIntoParagraphs for how
// that baseline is derived — page-local lower-quartile gap, or font size as a
// fallback when a page is too sparse to have one). Relative, not absolute, so
// it holds across font sizes. 1.5 is the usual typographic paragraph lead;
// tune only with a measurement, never by feel.
const PARAGRAPH_GAP_RATIO = 1.5;
// Two glyph runs within this many points of the same baseline are one line.
const SAME_LINE_EPSILON = 2;

// Font-size multiplier for the one-gap (2-line page) fallback threshold —
// see the comment at its use site for why this needs its own, larger ratio
// than PARAGRAPH_GAP_RATIO.
const SPARSE_PAGE_GAP_RATIO = 2;

// A glyph run's font size, read straight off its own transform (for
// unrotated text — the only kind a digitally-produced RAP PDF has —
// transform = [size, 0, 0, size, x, y], so transform[3] is the size in user
// space points; transform[0] covers the degenerate vertical-scale-0 case).
// Used only as the paragraph-gap fallback below; verified against real
// pdf.js output (2026-07-27): a 12pt drawText call round-trips as
// transform[3] === 12 exactly.
function approxFontSize(item: TextItem): number {
  return Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12;
}

/** Group a page's glyph runs into paragraphs, in reading order. */
export function groupItemsIntoParagraphs(items: TextItem[]): string[] {
  const printable = items.filter((i) => i.str.trim() !== "");
  if (printable.length === 0) return [];

  // 1. lines: bucket by baseline y (descending — PDF origin is bottom-left)
  const lines: { y: number; items: TextItem[] }[] = [];
  for (const it of [...printable].sort((a, b) => b.transform[5] - a.transform[5])) {
    const y = it.transform[5];
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) <= SAME_LINE_EPSILON) last.items.push(it);
    else lines.push({ y, items: [it] });
  }
  const rendered = lines.map((l) => ({
    y: l.y,
    // MIN, not max, across a line's own glyphs: a single larger glyph
    // sharing a baseline with normal body text (a drop cap, an inline
    // heading fragment, a table cell with a bigger font) must not inflate
    // this line's font-size reading — that reading feeds the one-gap
    // fallback threshold below, and an inflated threshold silently swallows
    // a genuine paragraph break (reproduced 2026-07-27: a 24pt glyph sharing
    // a line with 12pt text raised a max-based threshold to 36, missing a
    // real 30pt break; min-based gives 12*2=24, correctly catching it).
    fontSize: Math.min(...l.items.map(approxFontSize)),
    text: [...l.items].sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(" ").replace(/\s+/g, " ").trim(),
  }));

  if (rendered.length === 1) return [rendered[0].text];

  // 2. paragraphs: split where the gap exceeds a "typical single-line gap"
  // baseline times a ratio.
  //
  // With >=2 gaps (>=3 lines), the baseline is the page's own LOWER-QUARTILE
  // gap (approximated as sorted[floor(n/4)] — degenerates to the minimum for
  // n<4, which is fine: too few gaps to usefully quartile anyway).
  //
  // Reviewed 2026-07-27, round 2: an earlier version used the page's UPPER
  // MEDIAN (`sorted[Math.floor(n/2)]`), which for exactly 2 gaps (a 3-line
  // page) picks the LARGER of the two gaps as the baseline — inflating the
  // threshold past the very gap meant to trigger the split (gaps [12, 40] ->
  // threshold 40*1.5=60, so even the break gap didn't clear it).
  //
  // Reviewed 2026-07-27, round 3: switching straight to the plain MINIMUM
  // (not lower-quartile) turned out to be maximally sensitive to a SINGLE
  // outlier in the other direction: a superscript, footnote marker, or
  // shifted table cell sitting 3-4pt off its neighbor's baseline (just
  // outside SAME_LINE_EPSILON) becomes its own "line" with a tiny gap, and
  // that tiny gap becomes the whole page's baseline — collapsing a normal
  // 6-line, 2-paragraph page into several one-line fragments (reproduced with
  // this module's own test fixture: plain minimum gives 6 fragments instead
  // of 2, because min gap drops to ~3, threshold ~4.5, and every ordinary
  // 14pt line gap now "exceeds" it). Lower-quartile is robust to exactly one such outlier
  // (it's not the minimum unless outliers are >25% of the gaps) while still
  // resolving the 3-line case (gaps [12,40], n=2: floor(2/4)=0, same as
  // min, so it still gives 12 -> threshold 18 -> splits correctly). This is
  // the "minimum or lower-quartile" fallback our human partner approved as a
  // deviation from the brief's original median wording.
  //
  // With exactly ONE gap (a 2-line page) there is no OTHER gap on the page to
  // build ANY page-local baseline from — min, median, or any quantile of a
  // single-element set all equal that element itself, so "gap > ratio x
  // baseline" is unsatisfiable no matter which statistic is used; this is an
  // arithmetic fact, not a choice of statistic. Left unhandled, every 2-line
  // page — cover pages, short closing pages, anything sparse, all common in
  // real RAPs — would silently collapse into a single paragraph no matter how
  // large the gap actually was. Fall back to the line's own font size as the
  // baseline instead.
  //
  // Reviewed 2026-07-27, round 3: the fallback's ORIGINAL ratio (reusing
  // PARAGRAPH_GAP_RATIO=1.5) was too tight and fired on ordinary single-
  // spaced text. Typical single-line leading runs ~1.2x font size; RAP-style
  // "1.5 line spacing" commonly renders as leading well above that (e.g.
  // 12pt font / 20pt leading = 1.67x) and is NOT a paragraph break, but
  // 1.67 > 1.5 tripped the old threshold every time. A genuine paragraph
  // break is normally at least double the single-spaced baseline (>= ~2.4x
  // font size). SPARSE_PAGE_GAP_RATIO=2 sits between those two bands: above
  // ordinary single/1.5-spaced leading (so normal wrapped 2-line paragraphs
  // stay merged: 20 < 12*2=24) and below a genuine break's floor (so a real
  // gap still clears it: this module's own two-paragraph fixture, 54pt gap
  // over 12pt font, gives 54 > 12*2=24).
  const gaps = rendered.slice(1).map((l, i) => rendered[i].y - l.y);
  const threshold =
    gaps.length === 1
      ? Math.max(rendered[0].fontSize, rendered[1].fontSize) * SPARSE_PAGE_GAP_RATIO
      : (() => {
          const sorted = [...gaps].sort((a, b) => a - b);
          return sorted[Math.floor(sorted.length / 4)] * PARAGRAPH_GAP_RATIO;
        })();

  const paragraphs: string[] = [];
  let current = [rendered[0].text];
  for (let i = 1; i < rendered.length; i++) {
    if (threshold > 0 && rendered[i - 1].y - rendered[i].y > threshold) {
      paragraphs.push(current.join("\n"));
      current = [rendered[i].text];
    } else {
      current.push(rendered[i].text);
    }
  }
  paragraphs.push(current.join("\n"));
  return paragraphs.filter((p) => p.trim() !== "");
}

/** Per-page paragraph arrays, page order preserved. */
export async function extractPagesFromPdf(buf: Uint8Array): Promise<string[][]> {
  const pages: string[][] = [];
  const result = await pdfParse(buf, {
    pagerender: async (pageData) => {
      const paras = groupItemsIntoParagraphs((await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })).items);
      // Index by pdf.js's own pageIndex, NOT push order. pdf-parse's page
      // loop is `doc.getPage(i).then(pagerender).catch(() => "")` (see
      // node_modules/pdf-parse/lib/pdf-parse.js) — it SWALLOWS any exception
      // this callback throws (a getTextContent rejection, or a bug in
      // groupItemsIntoParagraphs) and moves on to the next page. Pushing
      // would silently skip that page's slot, shifting every later page's
      // "[p.N]" marker off by one with no exception visible to the caller.
      // Assigning by pageIndex means a failed page leaves a hole (undefined)
      // at its OWN index instead of shifting anything else.
      pages[pageData.pageIndex] = paras;
      return paras.join("\n\n");
    },
  });
  // Backfill any hole left by a page whose pagerender threw (see above) with
  // an empty paragraph list, up to the document's real page count — not just
  // `pages.length`, since a hole on the LAST page would otherwise shrink the
  // array instead of leaving a gap. buildTextFromPages emits nothing for an
  // empty page and simply moves on, so later pages keep their true "[p.N]".
  for (let i = 0; i < result.numpages; i++) {
    if (!pages[i]) pages[i] = [];
  }
  return pages;
}

/**
 * Emit the "[p.N]" contract. Every paragraph carries its OWN marker — a
 * marker emitted only on page change is lost once a chunk starts mid-page,
 * and the model then attributes that text to whatever page preceded it:
 * in-range, non-null, and wrong. Oversized paragraphs are pre-split here so
 * no marker-less piece can exist downstream.
 */
export function buildTextFromPages(pages: string[][]): string {
  const out: string[] = [];
  pages.forEach((paras, idx) => {
    for (const para of paras) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      for (const piece of splitOversizedBlockText(trimmed, DEFAULT_TARGET_CHARS)) {
        out.push(`[p.${idx + 1}]\n${piece}`);
      }
    }
  });
  return out.join("\n\n");
}

// Control characters that indicate a glyph failed to map to Unicode. \n, \r and
// \t are deliberately excluded — they are the structure the "[p.N]" format is
// built from. U+FFFD counts as damage whether we introduced it or pdf-parse did.
const DAMAGE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g;

/**
 * Render unmappable glyphs VISIBLY and report where they were. Detection of the
 * downstream consequence (a quote that no longer matches the source) is already
 * handled by validate.ts's quote_not_found; this exists so a reviewer can tell
 * a damaged source from a hallucinating model.
 */
export function scanFidelity(text: string): { text: string; fidelityDamaged: boolean; damagedOffsets: number[] } {
  const damagedOffsets: number[] = [];
  let m: RegExpExecArray | null;
  DAMAGE_RE.lastIndex = 0;
  while ((m = DAMAGE_RE.exec(text)) !== null) damagedOffsets.push(m.index);
  if (damagedOffsets.length === 0) return { text, fidelityDamaged: false, damagedOffsets: [] };
  return { text: text.replace(DAMAGE_RE, "�"), fidelityDamaged: true, damagedOffsets };
}

// Heuristics, not laws — tuned against the two real RAPs we have (BoC 17pp /
// 21,994 chars ~= 1,294 per page; TMX 2pp / 3,805 ~= 1,902 per page) with wide
// margin so a genuinely terse document is not mistaken for a scan. Change these
// only against a measured document, never by feel.
const MIN_TOTAL_CHARS = 200;
const MIN_CHARS_PER_PAGE = 50;

// A page "carries meaningful text" when its OWN paragraphs total at least
// this many characters. Deliberately separate from MIN_CHARS_PER_PAGE above,
// which is a document-wide AVERAGE and can be satisfied by a single
// content-rich page (a cover, a title page) while every other page is a
// blank scanned image — that gap is exactly what let a 20-page document with
// one ~1,000-char page and 19 image-only pages pass undetected. Same
// heuristic basis as its neighbours; change only against a measured
// document.
const MIN_PAGE_CHARS = 50;

// The share of pages that must clear MIN_PAGE_CHARS. A strict per-page
// minimum would reject a legitimate RAP that has an ordinary sparse divider
// page or a full-page figure, so this gates a PROPORTION of pages, not every
// page individually. 0.6 leaves comfortable room for a handful of such pages
// in an otherwise genuine document while still catching one that is mostly
// scanned images. Heuristic, tuned with the same wide margin as the floors
// above — change only against a measured document.
const MIN_PAGE_COVERAGE_RATIO = 0.6;

/** Throw ScannedDocumentError when the document carries no usable text layer. */
export function assertHasTextLayer(text: string, pages: string[][], fileName: string): void {
  const pageCount = pages.length;
  // Page markers are ours, not the document's — exclude them so a 40-page scan
  // does not look content-rich purely because it has 40 "[p.N]" lines.
  const body = text.replace(/^\[p\.[^\]]*\]$/gm, "").trim();
  if (body.length < MIN_TOTAL_CHARS) throw new ScannedDocumentError(fileName);
  if (pageCount > 0 && body.length / pageCount < MIN_CHARS_PER_PAGE) throw new ScannedDocumentError(fileName);

  // A document-wide average cannot see a document that is mostly blank
  // scanned pages plus one content-rich outlier — require most pages to
  // individually carry text, not just the document on average. Measured
  // from the raw per-page paragraph arrays (never from the joined, "[p.N]"-
  // carrying `text`), so a page's count can never be inflated by a marker
  // that isn't real content in the first place.
  if (pageCount > 0) {
    const coveredPages = pages.filter(
      (paragraphs) => paragraphs.reduce((sum, p) => sum + p.trim().length, 0) >= MIN_PAGE_CHARS,
    ).length;
    if (coveredPages / pageCount < MIN_PAGE_COVERAGE_RATIO) throw new ScannedDocumentError(fileName);
  }
}

export const textlayerLoader: DocLoader = {
  name: "textlayer",
  async load({ sourceS3Key, fileName }): Promise<LoadResult> {
    if (!/\.pdf$/i.test(fileName)) throw new UnsupportedDocumentError(fileName);
    // Pass the Uint8Array straight through — do NOT wrap it in Buffer.from().
    // getDocumentBytes already returns a Uint8Array. Converting it to a Node
    // Buffer here used to be necessary-looking (pdf-parse's old type only
    // declared a Buffer param) but is actually what caused every "Invalid PDF
    // structure" failure this loader ever hit: pdf-parse's bundled pdf.js
    // mishandles a Buffer's prototype in its Node fake-worker clone path for
    // small inputs, deterministically, at exactly the sizes this module's own
    // test fixtures happen to be (~1.1KB). A plain Uint8Array over the same
    // bytes is unaffected — see the type declaration in pdf-parse.d.ts for the
    // measurement. (An earlier version of this function retried pdfParse up
    // to 8 times to work around what looked like a flaky race; it wasn't one
    // — it was this deterministic, size-dependent Buffer bug, and it doesn't
    // reproduce at all once the input stays a Uint8Array. The retry is gone.)
    const bytes = await getDocumentBytes(sourceS3Key);
    const pages = await extractPagesFromPdf(bytes);
    const scanned = scanFidelity(buildTextFromPages(pages));
    assertHasTextLayer(scanned.text, pages, fileName);
    return scanned;
  },
};
