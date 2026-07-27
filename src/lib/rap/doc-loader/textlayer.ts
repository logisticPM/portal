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

// A new paragraph starts when the vertical gap exceeds this multiple of the
// page's own median line gap. Relative, not absolute, so it holds across font
// sizes. 1.5 is the usual typographic paragraph lead; tune only with a
// measurement, never by feel.
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
  // With >=2 gaps (>=3 lines), the baseline is this page's own median gap —
  // self-adapting to whatever font size and leading the page happens to use.
  //
  // With exactly ONE gap (a 2-line page) there is no OTHER gap on the page to
  // build a median from: "median" of a single value degenerates to that
  // value itself, and a gap can never be > 1.5x itself. Left as-is, every
  // 2-line page — cover pages, short closing pages, anything sparse, all
  // common in real RAPs — would silently collapse into a single paragraph no
  // matter how large the gap actually was (caught 2026-07-27 via this
  // module's own two-paragraph fixture: a 54pt gap between two 12pt-font
  // lines was not detected). Fall back to the line's own font size as the
  // baseline instead — sized so the same 12pt-font fixture still splits
  // (54 > 12*1.5) while ordinary same-paragraph leading does not (14 < 18).
  const gaps = rendered.slice(1).map((l, i) => rendered[i].y - l.y);
  const threshold =
    gaps.length === 1
      ? Math.max(rendered[0].fontSize, rendered[1].fontSize) * PARAGRAPH_GAP_RATIO
      : (() => {
          const sorted = [...gaps].sort((a, b) => a - b);
          return (sorted[Math.floor(sorted.length / 2)] || 0) * PARAGRAPH_GAP_RATIO;
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

// pdf-parse bundles an ancient (2017-era) pdf.js and, since Node has no real
// Worker for it to hand off to, emulates one via a LoopbackPort whose
// postMessage "transfers" typed arrays by aliasing the SAME underlying
// ArrayBuffer instead of truly detaching it the way a real Worker would (see
// node_modules/pdf-parse/lib/pdf.js/*/build/pdf.js, the PDFWorker/LoopbackPort
// closure — postMessage clones onto a deferred microtask but never neuters
// the source buffer). On a cold process this races: the deferred delivery
// can read a buffer whose backing bytes were already reused for something
// else, and pdf.js throws a structural parse error (InvalidPDFException /
// "bad XRef entry") — measured empirically against pdf-lib fixtures
// (2026-07-27, this repo, Node 24): it always fails LOUD, never returns
// wrong-but-unflagged text, converges within <=4 consecutive failures per
// process, and once past that warm-up stays reliable for the rest of the
// process's life. That last property matters for Lambda: only the first
// invocation on a fresh (cold) container pays this cost, since a warm
// container reuses the same process for later invocations. Retrying here is
// therefore safe (a failure is always an exception we can observe, never
// silent corruption) and cheap (pure CPU, no repeated I/O) — the alternative
// would be a document loader that spuriously fails ~1 time in 3 on every cold
// start. PARSE_RETRY_LIMIT carries 2x headroom over the observed worst case.
const PARSE_RETRY_LIMIT = 8;

async function parseOnce(buf: Buffer): Promise<string[][]> {
  const pages: string[][] = [];
  await pdfParse(buf, {
    pagerender: async (pageData) => {
      const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      const paras = groupItemsIntoParagraphs(content.items);
      pages.push(paras);
      return paras.join("\n\n");
    },
  });
  return pages;
}

/** Per-page paragraph arrays, page order preserved. */
export async function extractPagesFromPdf(buf: Buffer): Promise<string[][]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < PARSE_RETRY_LIMIT; attempt++) {
    try {
      return await parseOnce(buf);
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
