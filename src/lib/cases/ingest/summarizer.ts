// AI plain-language case summaries (spec 2026-07-03). Pure + injectable: the
// model is passed in (tests use fakes; the batch runner wraps in the disk cache).
// Governance: every displayed claim is anchored to a verbatim quote that is
// mechanically verified against the judgment text; unverifiable claims are
// dropped; <2 surviving claims → no summary at all (宁缺毋滥).
import type { CaseChunk, CitationAnchor, CitationAnchored, SummaryMeta } from "../types";
// Note: `LegalCase` is not yet used here — Task 3 adds `summarizeCase`, which
// will need it. Left unimported for now so `npm run typecheck` stays clean.

export interface RawClaim { text: string; quote: string; paragraph: string }
export type SummarizeStatus =
  | "generated" | "skipped_curated" | "skipped_not_core" | "skipped_no_fulltext" | "failed";
export interface SummarizeResult {
  status: SummarizeStatus;
  summary?: CitationAnchored;
  meta?: SummaryMeta;
  claimsDropped: number; // claims returned by the model but not kept (failed verification or past the 6 cap)
}

// Fold typographic punctuation the model may ASCII-fy when emitting JSON.
// Applied symmetrically to quote and source, so it can never admit a quote
// whose letters/digits differ — it only rescues honest punctuation drops.
export const normWs = (s: string) =>
  s.replace(/[‘’‛]/g, "'")
   .replace(/[“”]/g, '"')
   .replace(/[‐-―−]/g, "-")
   .replace(/\s+/g, " ").trim();

// Parse the model's response: first "{" to last "}", strict shape check.
// Returns null on any malformation (caller retries once with a corrective suffix).
export function parseClaims(raw: string): RawClaim[] | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    const arr = (obj as { claims?: unknown })?.claims;
    if (!Array.isArray(arr)) return null;
    // Non-object entries become empty claims so they flow into verifyClaims,
    // fail verification there, and get counted in `dropped`.
    return arr.map((c) => {
      if (!c || typeof c !== "object") return { text: "", quote: "", paragraph: "" };
      const r = c as Record<string, unknown>;
      return { text: String(r.text ?? ""), quote: String(r.quote ?? ""), paragraph: String(r.paragraph ?? "") };
    });
  } catch { return null; }
}

// Mechanical verification: the quote must appear verbatim (whitespace-normalized)
// in the chunk whose paragraph id the claim cites. Quotes are guaranteed real;
// paraphrase fidelity is human-spot-checked (spec Q3).
export function verifyClaims(
  claims: RawClaim[], chunks: CaseChunk[], sourceUrl: string,
): { anchors: CitationAnchor[]; dropped: number } {
  // Precondition: chunk paragraph ids are unique (chunkText assigns para-${i+1}); duplicates would last-win.
  const byPara = new Map(chunks.map((ch) => [String(ch.paragraph), normWs(ch.text)]));
  const anchors: CitationAnchor[] = [];
  for (const cl of claims) {
    if (anchors.length >= 6) break; // keep the first 6 in model output order
    const para = String(cl.paragraph ?? "");
    const body = byPara.get(para);
    const quote = normWs(cl.quote ?? "");
    const text = (cl.text ?? "").trim();
    if (body && text && quote.length >= 15 && body.includes(quote)) {
      anchors.push({ text, sourceParagraph: para, sourceUrl });
    }
  }
  return { anchors, dropped: claims.length - anchors.length };
}
