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
  /**
   * Advance width of this glyph run, in the same user-space points as
   * transform[4]. pdf.js populates it on every text item, so `transform[4] +
   * width` is the run's right edge — which is what makes both the intra-word
   * join and the column detection below possible. Treated defensively at
   * every use site: a non-finite width degrades to the older, geometry-free
   * behaviour rather than producing a confident wrong answer.
   */
  width: number;
}

const runLeft = (i: TextItem): number => i.transform[4];
const runRight = (i: TextItem): number => i.transform[4] + i.width;

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

// Two glyph runs on the same baseline are the SAME WORD unless the horizontal
// gap between them exceeds this multiple of the left run's font size. PDF
// producers (InDesign in particular) routinely emit a kerned or tracked word
// as several separately-positioned runs with no space character between them;
// joining every run with " " turns "Reconciliation" into "Recon ciliation",
// which then fails validate.ts's verbatim quote check for a reason that has
// nothing to do with the model. A real inter-word space is ~0.25-0.33x font
// size in the standard fonts (Helvetica's space glyph is 0.278 em), and a
// kerning adjustment is well under 0.05 em, so 0.2 sits comfortably between
// the two bands.
const WORD_SPACE_RATIO = 0.2;

// --- multi-column pages ----------------------------------------------------
// Bucketing purely by baseline y merges a two-column page's two columns into
// one line each ("Left col line one Right col line one"), because both
// columns share baselines. That is silent: the page number stays correct and
// validate.ts's quote_not_found still passes, because the interleaved text
// genuinely IS what the model was shown. The Textract LAYOUT path this loader
// replaces resolved columns for us (see textract.ts); this is the replacement.
//
// A gutter is only accepted as a column boundary when ALL of the following
// hold. Each guard exists because the failure mode of OVER-detecting is worse
// than the failure mode of under-detecting: RAPs commonly TABLE their
// commitments, and reading a table column-major separates every action from
// its timeline and owner. Under-detection leaves a page exactly as it is
// today; over-detection actively scrambles the rows commitments live in.
//
//  1. The horizontal gap exceeds COLUMN_GUTTER_RATIO of the page's own text
//     width (max right edge - min left edge, i.e. margins excluded). 0.15 is
//     deliberately generous: on a 500pt text block that is a 75pt gutter, far
//     wider than any table's cell padding and wider than a tight two-column
//     gutter. Consequence, stated plainly: a two-column layout with a narrow
//     (~20-40pt) gutter is NOT resolved by this and still interleaves. That
//     is the conservative side of the trade, chosen because we have no
//     document corpus to measure the real distribution against — the same
//     posture as every other constant in this file. Tighten it only against
//     measured documents.
//  2. The SAME gutter x appears on at least MIN_COLUMN_ROWS lines. One line
//     with a wide gap is a right-aligned page number, a dot-leaderless table
//     of contents entry, or a header/footer pair — not a layout structure. A
//     header plus a footer gives two such lines, so the floor is three.
//  3. The result is at most MAX_COLUMNS bands, each at least
//     MIN_COLUMN_WIDTH_RATIO of the text width. Real body columns are wide;
//     many narrow bands mean a table.
//
// When no boundary survives, groupItemsIntoParagraphs takes a single-column
// path that is byte-identical to its pre-column behaviour.
const COLUMN_GUTTER_RATIO = 0.15;
const MIN_COLUMN_ROWS = 3;
const MAX_COLUMNS = 3;
const MIN_COLUMN_WIDTH_RATIO = 0.15;

// Column reordering is OFF. Measured on real RAPs (review, 2026-07-27): the
// gutter heuristic above does not distinguish a genuine two-column body from
// a commitment TABLE. A three-column Action / Timeline / Owner table emits
// "Owner\nCPO\nCHRO\nCEO\nBoard" as its own paragraph, torn away from the
// actions it belongs to — downstream, the model attaches a plausible but
// WRONG owner/timeline to an action, and the resulting quote still passes
// validate.ts's quote_not_found check, because it genuinely is a substring of
// what the model was shown. Confident, wrong provenance is the one failure
// mode this project cannot ship, worse than the interleaved-column nonsense
// this code was written to fix.
//
// No threshold value repairs this. COLUMN_GUTTER_RATIO gates on inter-run
// whitespace, not on the PDF's design gutter, and the two populations are
// inverted: ragged table cells (numbers, short owner names, uneven padding)
// produce gaps of roughly 60-100pt, while real two-column body gutters are
// only 20-40pt. Lowering the ratio to finally catch a real body column makes
// table-shredding fire MORE often, not less; raising it to spare tables
// abandons the tight-gutter body-column case entirely. That target case — the
// one this fix was written for — is STILL interleaved with reordering off,
// exactly as it was before this code existed; that is the accepted,
// conservative failure mode, not a regression introduced by this flag.
//
// Re-enabling this requires BOTH: (1) a real document corpus measurement of
// gutter widths across genuine multi-column body pages versus table cell gaps
// on real RAPs, wide enough to place a threshold that separates the two
// populations instead of a made-up constant, and (2) a prose-likeness guard
// on candidate columns (e.g. average words per band, punctuation density) so
// short, table-cell-shaped bands cannot qualify as a column no matter what
// their gap width is. Do not flip this back to `true` without both.
export const COLUMN_REORDERING_ENABLED = false;

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

/**
 * Join one line's glyph runs (already sorted left-to-right) into text,
 * inserting a space ONLY where the geometry shows a real gap. See
 * WORD_SPACE_RATIO. If a run's width is missing or non-finite we cannot
 * measure the gap, so we fall back to the older unconditional " " — an extra
 * space is a recoverable nuisance, a missing word boundary is not.
 */
function joinRuns(sorted: TextItem[]): string {
  let out = "";
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prev = sorted[i - 1];
      const gap = runLeft(sorted[i]) - runRight(prev);
      if (!Number.isFinite(gap) || gap > approxFontSize(prev) * WORD_SPACE_RATIO) out += " ";
    }
    out += sorted[i].str;
  }
  return out.replace(/\s+/g, " ").trim();
}

interface RenderedLine {
  y: number;
  fontSize: number;
  text: string;
}

function renderLine(y: number, sorted: TextItem[]): RenderedLine {
  return {
    y,
    // MIN, not max, across a line's own glyphs: a single larger glyph
    // sharing a baseline with normal body text (a drop cap, an inline
    // heading fragment, a table cell with a bigger font) must not inflate
    // this line's font-size reading — that reading feeds the one-gap
    // fallback threshold below, and an inflated threshold silently swallows
    // a genuine paragraph break (reproduced 2026-07-27: a 24pt glyph sharing
    // a line with 12pt text raised a max-based threshold to 36, missing a
    // real 30pt break; min-based gives 12*2=24, correctly catching it).
    fontSize: Math.min(...sorted.map(approxFontSize)),
    text: joinRuns(sorted),
  };
}

/** Bucket glyph runs into baseline lines (descending y — PDF origin is bottom-left). */
function bucketIntoLines(printable: TextItem[]): { y: number; items: TextItem[] }[] {
  const lines: { y: number; items: TextItem[] }[] = [];
  for (const it of [...printable].sort((a, b) => b.transform[5] - a.transform[5])) {
    const y = it.transform[5];
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) <= SAME_LINE_EPSILON) last.items.push(it);
    else lines.push({ y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => runLeft(a) - runLeft(b));
  return lines;
}

/** Split one line's runs wherever the horizontal gap exceeds `minGutter`. */
export function fragmentLine(sorted: TextItem[], minGutter: number): TextItem[][] {
  const frags: TextItem[][] = [[sorted[0]]];
  // Against the running MAX right edge, not just the previous run's: runs are
  // sorted by left edge, and a short run nested inside a wider one (a
  // superscript, an overlapping underline glyph) would otherwise report a
  // false gap to whatever follows it.
  let reach = runRight(sorted[0]);
  for (let i = 1; i < sorted.length; i++) {
    if (runLeft(sorted[i]) - reach > minGutter) frags.push([sorted[i]]);
    else frags[frags.length - 1].push(sorted[i]);
    reach = Math.max(reach, runRight(sorted[i]));
  }
  return frags;
}

/**
 * Column boundary x-positions for this page, or [] when the page is
 * single-column (the overwhelmingly common case, and the one that must stay
 * bit-for-bit unchanged). See the COLUMN_GUTTER_RATIO comment block for why
 * each guard is here.
 *
 * Exported for direct testing as a pure function — see
 * COLUMN_REORDERING_ENABLED: its result is no longer consulted on the live
 * path, but the geometry logic itself stays exercised.
 */
export function detectColumnBoundaries(lines: { y: number; items: TextItem[] }[]): number[] {
  const all = lines.flatMap((l) => l.items);
  // Column geometry is unavailable without run widths — degrade to single
  // column rather than guess.
  if (!all.every((i) => Number.isFinite(i.width) && i.width >= 0)) return [];
  const left = Math.min(...all.map(runLeft));
  const right = Math.max(...all.map(runRight));
  const textWidth = right - left;
  if (!(textWidth > 0)) return [];
  const minGutter = textWidth * COLUMN_GUTTER_RATIO;

  // Every wide same-baseline gap on the page is a candidate gutter.
  const candidates: { lo: number; hi: number }[] = [];
  for (const l of lines) {
    // Running max right edge, for the same reason fragmentLine uses one.
    let reach = l.items.length > 0 ? runRight(l.items[0]) : 0;
    for (let i = 1; i < l.items.length; i++) {
      const hi = runLeft(l.items[i]);
      if (hi - reach > minGutter) candidates.push({ lo: reach, hi });
      reach = Math.max(reach, runRight(l.items[i]));
    }
  }
  if (candidates.length < MIN_COLUMN_ROWS) return [];

  // An x is a boundary when at least MIN_COLUMN_ROWS candidate gutters
  // straddle it — i.e. the same gutter recurs down the page.
  const scored = candidates
    .map((c) => {
      const mid = (c.lo + c.hi) / 2;
      return { mid, count: candidates.filter((o) => o.lo < mid && mid < o.hi).length };
    })
    .filter((s) => s.count >= MIN_COLUMN_ROWS)
    .sort((a, b) => b.count - a.count || a.mid - b.mid);

  const boundaries: number[] = [];
  for (const s of scored) {
    if (boundaries.some((b) => Math.abs(b - s.mid) < minGutter)) continue; // same gutter, already taken
    boundaries.push(s.mid);
  }
  boundaries.sort((a, b) => a - b);
  if (boundaries.length === 0 || boundaries.length + 1 > MAX_COLUMNS) return [];

  const edges = [left, ...boundaries, right];
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] - edges[i - 1] < textWidth * MIN_COLUMN_WIDTH_RATIO) return []; // too narrow to be a body column
  }
  return boundaries;
}

/** Which column band an x falls in, given ascending boundary positions. */
function columnOf(x: number, boundaries: number[]): number {
  let c = 0;
  for (const b of boundaries) if (x > b) c++;
  return c;
}

/** Split a page's rendered lines into paragraphs on vertical gaps. */
function groupLinesIntoParagraphs(rendered: RenderedLine[]): string[] {
  if (rendered.length === 0) return [];
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

/**
 * Group a page's glyph runs into paragraphs, in reading order.
 *
 * Single-column pages (the common case) take the early-return path below and
 * behave EXACTLY as they did before column support existed: bucket by
 * baseline, render each line, split on vertical gaps.
 *
 * COLUMN_REORDERING_ENABLED is currently false (see its comment), so EVERY
 * page — including a genuine multi-column one — takes that single-column
 * path unconditionally right now: `detectColumnBoundaries` is not even
 * called. The column-major logic below is kept, and stays reachable the
 * moment the flag flips, but it is dead on the live path today.
 *
 * Multi-column pages, when this is enabled, are emitted COLUMN-MAJOR — all of
 * column 1, then all of column 2 — because that, not the interleaved baseline
 * order, is how the page is read. Vertically, the page is first cut into
 * SECTIONS at every full-width line: a heading that spans the gutter belongs
 * to neither column, so it is emitted on its own, in document order, ahead of
 * the columns it introduces. Paragraph grouping then runs INDEPENDENTLY per
 * column, so one column's line spacing cannot set the other's paragraph
 * threshold.
 */
export function groupItemsIntoParagraphs(items: TextItem[]): string[] {
  const printable = items.filter((i) => i.str.trim() !== "");
  if (printable.length === 0) return [];

  const lines = bucketIntoLines(printable);
  const boundaries = COLUMN_REORDERING_ENABLED ? detectColumnBoundaries(lines) : [];
  if (boundaries.length === 0) {
    return groupLinesIntoParagraphs(lines.map((l) => renderLine(l.y, l.items)));
  }

  // Recompute the gutter width on the same basis detectColumnBoundaries used,
  // so a line fragments at exactly the gaps that produced the boundaries.
  const all = lines.flatMap((l) => l.items);
  const minGutter = (Math.max(...all.map(runRight)) - Math.min(...all.map(runLeft))) * COLUMN_GUTTER_RATIO;

  // A section is either a run of full-width lines or a run of columnar ones.
  type Section = { full: true; lines: RenderedLine[] } | { full: false; cols: RenderedLine[][] };
  const sections: Section[] = [];
  for (const line of lines) {
    const frags = fragmentLine(line.items, minGutter);
    // A fragment straddling a boundary is full-width text (a spanning
    // heading, a rule, a full-width caption) — it cannot be assigned to one
    // column without lying about where it belongs.
    const spans = frags.some((f) =>
      boundaries.some((b) => runLeft(f[0]) < b && Math.max(...f.map(runRight)) > b),
    );
    const last = sections[sections.length - 1];
    if (spans) {
      // Rejoin the whole line: a spanning heading is one line, not fragments.
      const rl = renderLine(line.y, line.items);
      if (last && last.full) last.lines.push(rl);
      else sections.push({ full: true, lines: [rl] });
      continue;
    }
    const target: Section = last && !last.full ? last : { full: false, cols: [] };
    if (target !== last) sections.push(target);
    for (const f of frags) {
      const c = columnOf(runLeft(f[0]), boundaries);
      (target as { full: false; cols: RenderedLine[][] }).cols[c] ??= [];
      (target as { full: false; cols: RenderedLine[][] }).cols[c].push(renderLine(line.y, f));
    }
  }

  const paragraphs: string[] = [];
  for (const s of sections) {
    if (s.full) paragraphs.push(...groupLinesIntoParagraphs(s.lines));
    else for (const col of s.cols) if (col?.length) paragraphs.push(...groupLinesIntoParagraphs(col));
  }
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
      // Split against the target MINUS the marker we are about to prepend.
      // Splitting against the full target and then prepending produces a block
      // of up to target + marker chars, which chunkDocument's own
      // splitLargeParagraph then re-splits — and it keeps the "[p.N]" line only
      // on the FIRST piece, leaving the rest marker-less. That is precisely the
      // failure this pre-split exists to prevent.
      const marker = `[p.${idx + 1}]\n`;
      for (const piece of splitOversizedBlockText(trimmed, DEFAULT_TARGET_CHARS - marker.length)) {
        out.push(`${marker}${piece}`);
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

// The share of pages that must clear MIN_PAGE_CHARS before the extraction is
// treated as covering the whole document. A strict per-page minimum would
// flag a legitimate RAP that has an ordinary sparse divider page or a
// full-page figure, so this gates a PROPORTION of pages, not every page
// individually.
//
// REVIEWED 2026-07-27 (final whole-branch review), decided with our human
// partner: falling below this ratio is NOT a scan verdict and no longer
// throws. It cannot be one. On a 17-page RAP the ratio demands 11 text-
// bearing pages, so six full-bleed photo pages or sparse section dividers —
// all ordinary in a designed RAP — would have refused the entire document
// with a message asserting it "appears to be scanned": confident, plausible,
// and wrong. At pageCount 2 the ratio silently degenerates into "every page
// must clear 50 chars", and we already have a real 2-page RAP.
//
// So low coverage is now surfaced as a ValidationIssue instead (see
// LoadResult.lowPageCoverage and pipeline.bedrock.ts). isClean() then returns
// false, the document routes to human review, and the reviewer sees the
// sparse extraction alongside an explanation of why it may be incomplete —
// which is the honest outcome, since we cannot tell a photo-heavy RAP from a
// partly-scanned one from the text layer alone. The genuine no-text-layer
// signals (MIN_TOTAL_CHARS, MIN_CHARS_PER_PAGE) still throw.
const MIN_PAGE_COVERAGE_RATIO = 0.6;

/**
 * Throw ScannedDocumentError when the document carries no usable text layer at
 * all. Coverage is deliberately NOT checked here — see measurePageCoverage.
 */
export function assertHasTextLayer(text: string, pages: string[][], fileName: string): void {
  const pageCount = pages.length;
  // Page markers are ours, not the document's — exclude them so a 40-page scan
  // does not look content-rich purely because it has 40 "[p.N]" lines.
  const body = text.replace(/^\[p\.[^\]]*\]$/gm, "").trim();
  if (body.length < MIN_TOTAL_CHARS) throw new ScannedDocumentError(fileName);
  if (pageCount > 0 && body.length / pageCount < MIN_CHARS_PER_PAGE) throw new ScannedDocumentError(fileName);
}

/**
 * How many pages individually carried meaningful text. A document-wide
 * average cannot see a document that is mostly blank scanned pages plus one
 * content-rich outlier (a 20-page doc with one ~1,000-char cover and 19 image
 * pages clears both floors above), so this counts pages, not characters.
 *
 * Measured from the raw per-page paragraph arrays — never from the joined,
 * "[p.N]"-carrying text — so a page's count can never be inflated by a marker
 * that isn't real content in the first place.
 *
 * `low` is advisory, not a verdict: it raises a ValidationIssue, it does not
 * reject the document. See MIN_PAGE_COVERAGE_RATIO.
 */
export function measurePageCoverage(pages: string[][]): { coveredPages: number; pageCount: number; low: boolean } {
  const pageCount = pages.length;
  const coveredPages = pages.filter(
    (paragraphs) => paragraphs.reduce((sum, p) => sum + p.trim().length, 0) >= MIN_PAGE_CHARS,
  ).length;
  return { coveredPages, pageCount, low: pageCount > 0 && coveredPages / pageCount < MIN_PAGE_COVERAGE_RATIO };
}

/**
 * Everything this loader does once the bytes are in hand: parse → paragraphs →
 * "[p.N]" text → fidelity scan → text-layer gate → coverage measurement.
 *
 * Split out from `load` deliberately: this composition — that the extension
 * guard runs, that the fidelity scan runs BEFORE the text-layer gate (U+FFFD
 * substitution is 1-for-1 so it cannot change the measured lengths, but the
 * order is still a contract), and that the gate is called at all — is where
 * every part of this module meets, and it was the one thing no test could
 * reach while it lived inside an S3-fetching method. Pure apart from the PDF
 * parse, so scripts/test-doc-loader-textlayer.ts can drive it with synthesised
 * pdf-lib fixtures.
 */
export async function loadFromBytes(bytes: Uint8Array, fileName: string): Promise<LoadResult> {
  if (!/\.pdf$/i.test(fileName)) throw new UnsupportedDocumentError(fileName);
  const pages = await extractPagesFromPdf(bytes);
  const scanned = scanFidelity(buildTextFromPages(pages));
  assertHasTextLayer(scanned.text, pages, fileName);
  const coverage = measurePageCoverage(pages);
  return {
    ...scanned,
    lowPageCoverage: coverage.low ? { coveredPages: coverage.coveredPages, pageCount: coverage.pageCount } : null,
  };
}

export const textlayerLoader: DocLoader = {
  name: "textlayer",
  async load({ sourceS3Key, fileName }): Promise<LoadResult> {
    // Checked here as well as in loadFromBytes so an unsupported file fails
    // BEFORE we pull its bytes out of S3. loadFromBytes repeats it because the
    // guard is part of its own contract, not this method's.
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
    return loadFromBytes(await getDocumentBytes(sourceS3Key), fileName);
  },
};
