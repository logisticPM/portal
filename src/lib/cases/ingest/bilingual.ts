// SCC judgments are published as the bilingual Supreme Court Reports edition. Measured
// against the real Tsilhqot'in PDF (2014 SCC 44) on 2026-08-03: French and English sit
// SIDE BY SIDE IN TWO COLUMNS ON EVERY PAGE — parallel translations of the same passage.
// pdf.js reads the full left column, then the full right, so a page's text is French then
// English rather than one language.
//
// An earlier version of this module assumed facing pages and split page-by-page. It passed
// eight unit tests and was wrong: the fixtures were written from the same mistaken model as
// the code. On the real PDF it kept 7 of 66 pages and its output began in French. The
// acceptance gate is now cases-verify-bilingual.ts, against the actual judgment.
//
// Why this matters at all: the bilingual text is 265,148 characters, over assembleInput's
// 240,000 budget, so the judgment would be summarized from a non-contiguous subset of two
// languages. English-only is 127,123.
export interface PageItem { str: string; x: number; y: number }
export type Lang = "en" | "fr" | "unknown";

// Function words, not legal vocabulary: legal terms are cognate across the two languages
// ("appellant"/"appelant") and would not discriminate.
const FR_WORDS = /\b(que|qui|dans|pour|est|les|des|une|par|sur|aux|cette|selon|ainsi|avec|sont|leur|plus)\b/gi;
const EN_WORDS = /\b(the|that|which|with|from|this|were|been|shall|upon|whether|have|would|there|their)\b/gi;

const MIN_EVIDENCE = 8;    // fewer hits than this is not evidence of a language
const RATIO = 1.3;         // one side must lead by this much to win
const MIN_COLUMN_GAP = 40; // narrower than this and there is only one column

export function classifyText(text: string): Lang {
  const fr = (text.match(FR_WORDS) ?? []).length;
  const en = (text.match(EN_WORDS) ?? []).length;
  if (fr + en < MIN_EVIDENCE) return "unknown";
  if (en > fr * RATIO) return "en";
  if (fr > en * RATIO) return "fr";
  return "unknown";
}

// Reassemble text from items exactly the way pdf-parse's own render_page does
// (lib/pdf-parse.js:3): same y → concatenate with NO separator, y change → "\n".
//
// Both details are load-bearing. pdf.js splits a word across runs — this repo's
// pdf-parse.d.ts records "Recon" + "ciliation" abutting — so any separator breaks words
// apart. And cleanupPdfText's hyphen rejoin matches "-\n", so dropping the newline leaves a
// stray hyphen inside every line-broken word. Every published claim is verified by locating
// its quote verbatim in this text.
export function renderItems(items: PageItem[]): string {
  let lastY: number | undefined, text = "";
  for (const it of items) {
    text += lastY === it.y || !lastY ? it.str : "\n" + it.str;
    lastY = it.y;
  }
  return text;
}

// Split a page at the midpoint of its own x range.
//
// Chosen by measurement across all 66 pages of the real judgment: midpoint gives 64/66 clean
// bilingual splits and 127,123 English characters — identical to a fixed x=290 threshold and
// better than two-means clustering (122,966). Midpoint is preferred over the constant
// because it adapts to a different page geometry.
//
// A "widest gap between distinct x values" heuristic was tried and DISCARDED: it put the cut
// at the far right edge on 5 of the pages sampled (one page: 5,165 characters left, 3
// right). Recorded so nobody re-derives it.
export function splitColumns(items: PageItem[]): { left: PageItem[]; right: PageItem[]; twoColumn: boolean } {
  if (!items.length) return { left: [], right: [], twoColumn: false };
  const xs = items.map((i) => i.x);
  const min = Math.min(...xs), max = Math.max(...xs);
  const cut = (min + max) / 2;
  const left = items.filter((i) => i.x < cut);
  const right = items.filter((i) => i.x >= cut);
  return { left, right, twoColumn: max - min >= MIN_COLUMN_GAP && left.length > 0 && right.length > 0 };
}

export interface EnglishColumns {
  text: string;
  kept: number;               // pages that contributed English
  dropped: number;            // pages that contributed nothing
  wholePageFallbacks: number; // pages kept without a clean two-column split
}

// Keep the English column of each page, in document order.
//
// The side is CLASSIFIED, never assumed. English was the left column on every cleanly-split
// page of the one judgment measured, but a corpus-wide rule cannot rest on one document.
//
// When a page does not split cleanly into one English and one French column — a cover page,
// an index, a genuinely monolingual judgment from another court — the whole page is
// classified instead and kept if English. That fallback is counted, not silent, because a
// document that is ALL fallbacks is a document this splitter is not helping with.
export function keepEnglishColumns(pages: PageItem[][]): EnglishColumns {
  const out: string[] = [];
  let kept = 0, dropped = 0, wholePageFallbacks = 0;
  for (const items of pages) {
    const { left, right, twoColumn } = splitColumns(items);
    let picked: string | null = null;
    if (twoColumn) {
      const lt = renderItems(left), rt = renderItems(right);
      const ll = classifyText(lt), rl = classifyText(rt);
      if (ll === "en" && rl === "fr") picked = lt;
      else if (rl === "en" && ll === "fr") picked = rt;
    }
    if (picked === null) {
      const whole = renderItems(items);
      if (classifyText(whole) === "en") { picked = whole; wholePageFallbacks++; }
    }
    if (picked !== null && picked.length > 0) { out.push(picked); kept++; } else dropped++;
  }
  return { text: out.join("\n"), kept, dropped, wholePageFallbacks };
}
