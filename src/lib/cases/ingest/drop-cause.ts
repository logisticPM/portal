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
  | "transcription"       // a real passage, garbled
  | "unseen";             // absent from what the model was shown

export interface DropVerdict {
  cause: DropCause;
  bestOverlap: number;
  bestPara: string | null;
  divergenceAt: number | null; // offset into the quote where the matched run ends
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

  // 5. A real passage, garbled.
  if (base.bestOverlap >= 0.5) return { cause: "transcription", ...base };

  // 6. The model was never shown this.
  return { cause: "unseen", ...base };
}
