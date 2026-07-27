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
// that baseline is derived — page-local minimum gap, or font size as a
// fallback when a page is too sparse to have one). Relative, not absolute, so
// it holds across font sizes. 1.5 is the usual typographic paragraph lead;
// tune only with a measurement, never by feel.
const PARAGRAPH_GAP_RATIO = 1.5;
// Two glyph runs within this many points of the same baseline are one line.
const SAME_LINE_EPSILON = 2;

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
    fontSize: Math.max(...l.items.map(approxFontSize)),
    text: [...l.items].sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(" ").replace(/\s+/g, " ").trim(),
  }));

  if (rendered.length === 1) return [rendered[0].text];

  // 2. paragraphs: split where the gap exceeds a "typical single-line gap"
  // times PARAGRAPH_GAP_RATIO.
  //
  // With >=2 gaps (>=3 lines), the baseline is the page's own MINIMUM gap —
  // i.e. its tightest, most-likely-same-paragraph line spacing. Reviewed
  // 2026-07-27: an earlier version used the page's UPPER median instead
  // (`sorted[Math.floor(n/2)]`), which for exactly 2 gaps (a 3-line page)
  // picks the LARGER of the two gaps as the baseline — inflating the
  // threshold past the very gap meant to trigger the split, so a genuine
  // paragraph break on a 3-line page silently failed to split (reproduced:
  // gaps [12, 40] -> old threshold 40*1.5=60, so even the 40pt break gap
  // didn't clear it). Minimum-gap fixes this: threshold 12*1.5=18, so the
  // 40pt gap correctly splits while the 12pt one doesn't.
  //
  // With exactly ONE gap (a 2-line page) there is no OTHER gap on the page to
  // build ANY page-local baseline from — min, median, or mean of a
  // single-element set all equal that element itself, so "gap > 1.5x
  // baseline" is unsatisfiable no matter which aggregate is used; this is an
  // arithmetic fact, not a choice of statistic. Left unhandled, every 2-line
  // page — cover pages, short closing pages, anything sparse, all common in
  // real RAPs — would silently collapse into a single paragraph no matter how
  // large the gap actually was (caught 2026-07-27 via this module's own
  // two-paragraph fixture: a 54pt gap between two 12pt-font lines was not
  // detected). Fall back to the line's own font size as the baseline instead
  // — sized so the same 12pt-font fixture still splits (54 > 12*1.5) while
  // ordinary same-paragraph leading does not (14 < 18).
  const gaps = rendered.slice(1).map((l, i) => rendered[i].y - l.y);
  const threshold =
    gaps.length === 1
      ? Math.max(rendered[0].fontSize, rendered[1].fontSize) * PARAGRAPH_GAP_RATIO
      : Math.min(...gaps) * PARAGRAPH_GAP_RATIO;

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

// pdf-parse bundles an ancient (2017-era) pdf.js and, since Node has no real
// Worker for it to hand off to, emulates one via a LoopbackPort whose
// postMessage "transfers" typed arrays by aliasing the SAME underlying
// ArrayBuffer instead of truly detaching it the way a real Worker would (see
// node_modules/pdf-parse/lib/pdf.js/*/build/pdf.js, the PDFWorker/LoopbackPort
// closure — postMessage clones onto a deferred microtask but never neuters
// the source buffer). On a cold process this races: the deferred delivery
// can read a buffer whose backing bytes were already reused for something
// else, and pdf.js throws a structural parse error (InvalidPDFException /
// "bad XRef entry") — measured empirically against THIS module's own fixture
// (2026-07-27, this repo, Node 24, pdf-lib's default useObjectStreams:true
// output): it always fails LOUD, never returns wrong-but-unflagged text,
// converges within <=4 consecutive failures per process, and once past that
// warm-up stays reliable for the rest of the process's life.
//
// Tried and rejected: allocating the input as a non-pooled, exact-size buffer
// (Buffer.allocUnsafeSlow + copy, avoiding Node's <4096-byte Buffer-pool
// aliasing) does NOT fix this — measured 15/15 single-attempt failures on
// this exact fixture with a fully unpooled buffer, and even combined with
// retry it still needed 2-4 attempts every time, no fewer than plain pooled
// buffers. So pool aliasing is a real, separate, secondary hazard (worth
// knowing about) but is not what causes the failures this retry loop guards
// against; the retry is the load-bearing fix, not the allocation strategy.
//
// Retrying is safe (a failure here is always an exception we can observe,
// never silent corruption — confirmed above) and cheap (pure CPU, no
// repeated I/O). It also matters less for Lambda than the raw retry count
// suggests: only the first invocation on a fresh (cold) container pays this
// cost, since a warm container reuses the same process — and therefore the
// same already-warmed pdf.js — for every later invocation.
// PARSE_RETRY_LIMIT carries 2x headroom over the observed worst case.
const PARSE_RETRY_LIMIT = 8;

async function parseOnce(buf: Buffer): Promise<{ pages: string[][]; numpages: number }> {
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
      // "[p.N]" marker off by one with no exception for the retry loop above
      // to even see. Assigning by pageIndex means a failed page leaves a
      // hole (undefined) at its OWN index instead of shifting anything else.
      pages[pageData.pageIndex] = paras;
      return paras.join("\n\n");
    },
  });
  return { pages, numpages: result.numpages };
}

/** Per-page paragraph arrays, page order preserved. */
export async function extractPagesFromPdf(buf: Buffer): Promise<string[][]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < PARSE_RETRY_LIMIT; attempt++) {
    try {
      const { pages, numpages } = await parseOnce(buf);
      // Backfill any hole left by a page whose pagerender threw (see the
      // comment above) with an empty paragraph list, up to the document's
      // real page count — not just `pages.length`, since a hole on the LAST
      // page would otherwise shrink the array instead of leaving a gap.
      // buildTextFromPages emits nothing for an empty page and simply moves
      // on, so later pages keep their true "[p.N]".
      for (let i = 0; i < numpages; i++) {
        if (!pages[i]) pages[i] = [];
      }
      return pages;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
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

export const textlayerLoader: DocLoader = {
  name: "textlayer",
  async load({ sourceS3Key, fileName }): Promise<LoadResult> {
    if (!/\.pdf$/i.test(fileName)) throw new UnsupportedDocumentError(fileName);
    const bytes = await getDocumentBytes(sourceS3Key);
    const pages = await extractPagesFromPdf(Buffer.from(bytes));
    const text = buildTextFromPages(pages);
    // Fidelity and scanned gates are added in Tasks 3 and 4.
    return { text, fidelityDamaged: false, damagedOffsets: [] };
  },
};
