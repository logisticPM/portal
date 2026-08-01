// Forensics for claims that failed verification. MEASUREMENT ONLY — nothing here runs
// in the summarize path and nothing here changes what survives verification.
//
// The buckets are ordered, and the order is load-bearing (see classifyDrop).
import type { CaseChunk } from "../types";
import { normWs } from "./summarizer";

export type DropCause =
  | "locate_bug"          // present verbatim — locate() should have found it
  | "marker_bleed"        // the quote swept up a "[para N]" prompt marker
  | "assembly_boundary"   // spans a seam that exists only in the assembled prompt
  | "normalization"       // matches after a fold normWs does not perform
  | "elision"             // legitimate quoting with the middle omitted
  | "transcription"       // a real passage, garbled
  | "unseen";             // absent from what the model was shown

// Why a quote that CONTAINED an ellipsis nonetheless failed the strict test. Never set when
// the quote has no ellipsis, and never set when the elision bucket was earned. Without these
// the bucket count is uninterpretable: it cannot separate "the rest are fabrications" from
// "the rest are elisions that fell under MIN_FRAGMENT".
export type ElisionDiag =
  | "cross_chunk_only"     // resolves in document order across chunks, not within one
  | "fragment_too_short"   // a fragment below MIN_FRAGMENT, which matches incidentally
  | "fragment_not_found"   // some fragment appears in no chunk
  | "out_of_order";        // every fragment present, but not in the quoted sequence

export interface DropVerdict {
  cause: DropCause;
  bestOverlap: number;
  bestPara: string | null;
  divergenceAt: number | null; // offset into the quote where the matched run ends
  elisionDiag?: ElisionDiag;
}

// Longest common substring, returning WHERE the run starts in `a`.
//
// Deliberately separate from summarizer.ts's longestCommonSubstringLen, which swaps its
// arguments so the DP row tracks the shorter string. That swap makes the offset
// meaningless, and this module needs the offset. The shipped function is reviewed and
// measured code on the summarize path; duplicating ~12 lines is cheaper than perturbing
// it for a diagnostic. Rows are sized to the quote, which is a few hundred chars.
export function lcsSpan(a: string, b: string): { len: number; quoteStart: number } {
  if (!a || !b) return { len: 0, quoteStart: 0 };
  let prev = new Uint32Array(a.length + 1);
  let cur = new Uint32Array(a.length + 1);
  let bestLen = 0, bestEnd = 0;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      cur[i] = a[i - 1] === b[j - 1] ? prev[i - 1] + 1 : 0;
      if (cur[i] > bestLen) { bestLen = cur[i]; bestEnd = i; }
    }
    const swap = prev; prev = cur; cur = swap;
    cur.fill(0);
  }
  return { len: bestLen, quoteStart: bestEnd - bestLen };
}

// normWs plus the folds it does not do. Each is a real artifact of court-document
// extraction, not a hypothetical. NOTE: JS \s already covers NBSP and friends, so
// normWs handles those; what remains are non-space invisibles and glyph variants.
export const widenFold = (s: string) =>
  normWs(s)
    .replace(/\u00ad/g, "")                              // soft hyphen
    .replace(/\u2026/g, "...")                           // ellipsis glyph
    .replace(/\ufb01/g, "fi").replace(/\ufb02/g, "fl")   // ligatures
    .replace(/\s+([.,;:!?)\]])/g, "$1")                  // space BEFORE punctuation
    .replace(/([(\[])\s+/g, "$1")                        // space AFTER an opener
    .replace(/\s+/g, " ").trim();

// Below this, a fragment matches incidentally almost anywhere in a paragraph, and admitting
// those would inflate the bucket in exactly the direction that flatters us.
export const MIN_FRAGMENT = 20;

// widenFold has already collapsed "…", ". . ." and "[ ... ]" into ASCII dots, so one pattern
// covers every spelling instead of five.
const ELLIPSIS = /\s*[\[(]?\.{3,4}[\])]?\s*/;

// Leftmost match, no backtracking. If a fragment occurs twice and only the LATER occurrence
// leaves room for the next one, this returns false. With a 20-char floor that is rare, and
// the direction is the safe one: it makes the elision bucket a LOWER bound, which is what a
// number used to bound a fabrication rate should be.
const resolveInOrder = (fragments: string[], text: string): boolean => {
  let cursor = 0;
  for (const f of fragments) {
    const at = text.indexOf(f, cursor);
    if (at < 0) return false;
    cursor = at + f.length;
  }
  return true;
};

// Same scan, but the cursor may advance into later chunks. Each fragment must sit entirely
// within one chunk, so a join cannot manufacture a match that the document does not contain.
const resolveAcrossChunks = (fragments: string[], wide: string[]): boolean => {
  let ci = 0, cursor = 0;
  for (const f of fragments) {
    let placed = false;
    while (ci < wide.length) {
      const at = wide[ci].indexOf(f, cursor);
      if (at >= 0) { cursor = at + f.length; placed = true; break; }
      ci++; cursor = 0;
    }
    if (!placed) return false;
  }
  return true;
};

export interface ElisionResult {
  isElision: boolean;     // strict: every fragment inside ONE chunk, in order, non-overlapping
  diag?: ElisionDiag;
}

// null means "this quote is not elided at all" — distinct from "elided but did not qualify",
// which returns { isElision: false, diag }.
export function classifyElision(rawQuote: string, chunks: CaseChunk[]): ElisionResult | null {
  const fragments = widenFold(rawQuote).split(ELLIPSIS).map((f) => f.trim()).filter(Boolean);
  if (fragments.length < 2) return null;

  if (fragments.some((f) => f.length < MIN_FRAGMENT)) {
    return { isElision: false, diag: "fragment_too_short" };
  }
  const wide = chunks.map((c) => widenFold(c.text));
  if (wide.some((t) => resolveInOrder(fragments, t))) return { isElision: true };
  if (resolveAcrossChunks(fragments, wide)) return { isElision: false, diag: "cross_chunk_only" };
  if (fragments.every((f) => wide.some((t) => t.includes(f)))) {
    return { isElision: false, diag: "out_of_order" };
  }
  return { isElision: false, diag: "fragment_not_found" };
}

const pairsOf = (texts: string[]) => texts.slice(0, -1).map((t, i) => t + " " + texts[i + 1]);

// `assembled` must be what the model was actually shown — assembleInput's output for
// this case, which over budget is a NON-CONTIGUOUS subset joined with "\n".
export function classifyDrop(rawQuote: string, chunks: CaseChunk[], assembled: string): DropVerdict {
  const q = normWs(rawQuote);
  const norm = chunks.map((c) => ({ para: c.paragraph, text: normWs(c.text) }));

  let bestLen = 0, bestStart = 0, bestPara: string | null = null;
  for (const n of norm) {
    const r = lcsSpan(q, n.text);
    if (r.len > bestLen) { bestLen = r.len; bestStart = r.quoteStart; bestPara = n.para; }
  }
  const base = {
    bestOverlap: q.length ? bestLen / q.length : 0,
    bestPara,
    divergenceAt: bestLen && bestLen < q.length ? bestStart + bestLen : null,
  };

  // 1. locate() searches exactly these two windows. A hit here means the claim was not
  //    actually droppable — in production that is a bug, in the runner it means "kept".
  const texts = norm.map((n) => n.text);
  if (texts.some((t) => t.includes(q)) || pairsOf(texts).some((t) => t.includes(q))) {
    return { cause: "locate_bug", ...base };
  }

  // 2. BEFORE assembly_boundary, and this ordering is not cosmetic: the markers live in
  //    the assembled text, so a marker-bearing quote is definitionally found there and
  //    assembly_boundary would absorb every marker_bleed case.
  if (q.includes("[para ")) return { cause: "marker_bleed", ...base };

  // 3. In the prompt but not the document — our seam, faithfully transcribed.
  if (normWs(assembled).includes(q)) return { cause: "assembly_boundary", ...base };

  // 4. A fold normWs misses.
  const w = widenFold(rawQuote);
  const wide = chunks.map((c) => widenFold(c.text));
  if (wide.some((t) => t.includes(w)) || pairsOf(wide).some((t) => t.includes(w))) {
    return { cause: "normalization", ...base };
  }

  // 5. Legitimate quoting with the middle omitted, MISFILED by the six-bucket taxonomy.
  //    Must be tested BEFORE transcription: an elided quote whose longest fragment exceeds
  //    half the quote clears LCS >= 0.5, so transcription would absorb it and the
  //    contamination inside that bucket would stay invisible however often it happened.
  const el = classifyElision(rawQuote, chunks);
  if (el?.isElision) return { cause: "elision", ...base };
  const elisionDiag = el?.diag;

  // 6. A real passage, garbled.
  if (base.bestOverlap >= 0.5) return { cause: "transcription", ...base, elisionDiag };

  // 7. The model was never shown this.
  return { cause: "unseen", ...base, elisionDiag };
}
