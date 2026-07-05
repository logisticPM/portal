// AI plain-language case summaries (spec 2026-07-03). Pure + injectable: the
// model is passed in (tests use fakes; the batch runner wraps in the disk cache).
// Governance: every displayed claim is anchored to a verbatim quote that is
// mechanically verified against the judgment text; unverifiable claims are
// dropped; <2 surviving claims → no summary at all (宁缺毋滥).
import type { CaseChunk, CitationAnchor, CitationAnchored } from "../types";
// Note: `LegalCase` and `SummaryMeta` are not yet used here — Task 3 adds
// `summarizeCase`, which will need both. Left out for now so `npm run
// typecheck` stays clean (no-unused-vars on unused type imports).

export interface RawClaim { text: string; quote: string; paragraph: string }
export type SummarizeStatus =
  | "generated" | "skipped_curated" | "skipped_not_core" | "skipped_no_fulltext" | "failed";
export interface SummarizeResult {
  status: SummarizeStatus;
  summary?: CitationAnchored;
  meta?: import("../types").SummaryMeta;
  claimsDropped: number; // claims returned by the model but not kept (failed verification or past the 6 cap)
}

export const normWs = (s: string) => s.replace(/\s+/g, " ").trim();

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
    return arr
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c) => ({ text: String(c.text ?? ""), quote: String(c.quote ?? ""), paragraph: String(c.paragraph ?? "") }));
  } catch { return null; }
}

// Mechanical verification: the quote must appear verbatim (whitespace-normalized)
// in the chunk whose paragraph id the claim cites. Quotes are guaranteed real;
// paraphrase fidelity is human-spot-checked (spec Q3).
export function verifyClaims(
  claims: RawClaim[], chunks: CaseChunk[], sourceUrl: string,
): { anchors: CitationAnchor[]; dropped: number } {
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
