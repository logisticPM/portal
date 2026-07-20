// Pure citation-treatment (spec 2026-07-19): find the verbatim passage where a CITING case
// references this decision. Extractive + anchored; no classification, no LLM.
import type { CaseChunk } from "./types";

export interface CitingPassage { text: string; paragraph: string; truncated: boolean }
export interface CiteTarget { citation: string; citation2?: string; styleOfCause: string }

const WINDOW = 200;

// Lead party (appellant/plaintiff): the token before " v." — usually the distinctive name,
// e.g. "Haida Nation v. British Columbia…" → "Haida Nation". No " v." → the whole string.
export function leadParty(styleOfCause: string): string {
  return styleOfCause.split(/\s+v\.?\s+/i)[0].trim();
}

// Search chunks for a reference to `target`, in precedence order (citation, citation2, lead
// party — the last only if ≥4 chars, to avoid noise like "R."). Returns a windowed verbatim
// excerpt (±WINDOW chars, "…"-marked when trimmed) from the first matching chunk, or null.
export function findCitingPassage(chunks: CaseChunk[], target: CiteTarget): CitingPassage | null {
  const needles = [target.citation, target.citation2 ?? ""].filter((s) => s.length >= 3);
  const lp = leadParty(target.styleOfCause);
  if (lp.length >= 4) needles.push(lp);

  for (const n of needles) {
    const nl = n.toLowerCase();
    for (const ch of chunks) {
      const i = ch.text.toLowerCase().indexOf(nl);
      if (i < 0) continue;
      const start = Math.max(0, i - WINDOW);
      const end = Math.min(ch.text.length, i + n.length + WINDOW);
      let text = ch.text.slice(start, end);
      const truncated = start > 0 || end < ch.text.length;
      if (start > 0) text = "…" + text;
      if (end < ch.text.length) text = text + "…";
      return { text, paragraph: ch.paragraph, truncated };
    }
  }
  return null;
}
