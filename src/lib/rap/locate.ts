// ===========================================================================
// Quote-locate for the BDA extraction path. BDA returns clean field values +
// confidence + sparse bounding-box geometry, but NO verbatim text span, so the
// review queue's evidence cards / jump-to-PDF have nothing to cite (see
// docs/superpowers/specs/2026-08-02-bda-quote-locate-design.md). This module
// finds each value in the document's own per-page text layer and fills in a
// verbatim quote + reliable page. Pure: exact-normalized match only, and the
// stored quote is always verbatim source text, so it can never mis-cite.
// ===========================================================================
import { normalizeForQuoteMatch } from "./validate";
import type { ExtractedRap, Grounded } from "./types";

export const MAX_QUOTE_CHARS = 240;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// YYYY, YYYY-MM, or YYYY-MM-DD (the shape validate.ts calls "isoish").
const ISO_DATE_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/**
 * The exact strings to search the text for, given a field value.
 *
 *  • non-date            → [value]                 (unchanged for free text)
 *  • YYYY-MM-DD / YYYY-MM → ISO + human spellings   (so an ISO publicationDate
 *                                                    matches "September 25, 2025")
 *  • bare YYYY           → []                       (too weak to cite)
 *
 * Every term is still matched by exact-normalized substring downstream; these
 * are alternate exact spellings of ONE date, not fuzzy matching.
 */
export function searchTermsFor(value: string): string[] {
  const v = value.trim();
  const m = ISO_DATE_RE.exec(v);
  if (!m) return [v]; // not date-like → search the value as-is
  const [, year, mm, dd] = m;
  if (!mm) return []; // bare YYYY — too weak to cite
  const monthIdx = parseInt(mm, 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return [v];
  const full = MONTHS[monthIdx];
  const abbr = full.slice(0, 3); // Jan, Feb, … Sep, …
  const terms: string[] = [v];
  if (dd) {
    const day = String(parseInt(dd, 10)); // un-padded: "5", not "05"
    terms.push(`${full} ${day}, ${year}`, `${day} ${full} ${year}`, `${abbr} ${day}, ${year}`);
    if (full === "September") terms.push(`Sept ${day}, ${year}`);
  } else {
    terms.push(`${full} ${year}`, `${abbr} ${year}`);
    if (full === "September") terms.push(`Sept ${year}`);
  }
  // de-duplicate by normalized form (e.g. May's full name and 3-letter abbrev
  // collapse), keeping the first raw spelling of each.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const n = normalizeForQuoteMatch(t);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(t);
    }
  }
  return out;
}
