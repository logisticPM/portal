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
const MIN_TERM_ALNUM = 4;

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

/**
 * Fill quote + page on one grounded free-text field by locating its value in
 * the per-page text. Returns the field unchanged if it has no value, already
 * has a quote, has no usable search terms (e.g. a bare year), or isn't found.
 *
 * Page precedence: if BDA supplied a geometry `page` and a term is found on it,
 * keep it; otherwise the first page (document order) where a term is found.
 */
function located(field: Grounded<string>, pages: string[][]): Grounded<string> {
  if (field.value == null || field.quote !== null) return field;
  const terms = searchTermsFor(String(field.value))
    .map((t) => normalizeForQuoteMatch(t))
    // Require a distinctive locator. A normalized term with fewer than
    // MIN_TERM_ALNUM alphanumeric chars ("5" from "5%", "ceo" from "CEO")
    // matches unrelated text and would cite the wrong span, so skip the field
    // entirely (quote AND page stay null) — generalizes searchTermsFor's
    // bare-year skip.
    .filter((t) => t.replace(/ /g, "").length >= MIN_TERM_ALNUM);
  if (terms.length === 0) return field;

  const matchOnPage = (idx: number): string | null => {
    for (const para of pages[idx] ?? []) {
      const nPara = normalizeForQuoteMatch(para);
      if (terms.some((t) => nPara.includes(t))) return para;
    }
    return null;
  };

  // geometry page first (1-indexed → 0-indexed), then every other page in order.
  const geom = field.page != null && field.page >= 1 && field.page <= pages.length ? field.page - 1 : -1;
  const order: number[] = [];
  if (geom >= 0) order.push(geom);
  for (let i = 0; i < pages.length; i++) if (i !== geom) order.push(i);

  for (const idx of order) {
    const para = matchOnPage(idx);
    if (para) {
      const trimmed = para.trim();
      const quote =
        trimmed.length > MAX_QUOTE_CHARS ? `${trimmed.slice(0, MAX_QUOTE_CHARS).trimEnd()}…` : trimmed;
      return { ...field, quote, page: idx + 1 };
    }
  }
  return field;
}

/**
 * Recover verbatim quotes + reliable pages for a BDA extraction by locating its
 * free-text values in the document's own text layer. Canonical enums, derived,
 * and structured fields (sector, jurisdiction, commitmentType, rapType,
 * pairLevel, frameworkRefs, periodCovered, pillars) are left untouched — their
 * values are not literal document text.
 */
export function locateQuotes(extracted: ExtractedRap, pages: string[][]): ExtractedRap {
  const loc = (field: Grounded<string>) => located(field, pages);
  return {
    ...extracted,
    orgName: loc(extracted.orgName),
    rapTitle: loc(extracted.rapTitle),
    publicationDate: loc(extracted.publicationDate),
    governanceBody: loc(extracted.governanceBody),
    reviewCycle: loc(extracted.reviewCycle),
    endorsementStatus: loc(extracted.endorsementStatus),
    commitments: extracted.commitments.map((c) => ({
      ...c,
      pillarRaw: loc(c.pillarRaw),
      action: loc(c.action),
      deliverable: loc(c.deliverable),
      timeline: loc(c.timeline),
      owner: loc(c.owner),
      metric: loc(c.metric),
    })),
  };
}
