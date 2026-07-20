// Generic direct-court harvest core. Pure: shortlist Indigenous/economic candidates and map a
// fetched decision PDF to a substrate LegalCase. Per-court parsing/keywords live in the adapters
// (court-adapters.ts); the runner (cases-harvest-court.ts) does the robots-compliant fetching.
import type { LegalCase, CourtLevel } from "../types";
import { slugCitation, chunkText } from "./a2aj";

export interface CourtListingRow { citation: string; court: string; pdfUrl: string; fileName: string; }

export interface CourtAdapter {
  id: string;                 // "yukon" | "nb" | "mb"
  baseUrl: string;            // e.g. "https://www.yukoncourts.ca"
  indexUrls: string[];        // absolute top listing pages to start crawling
  // Parse ONE listing/index page → decision PDF rows here + sub-index pages to also crawl.
  parseListing(html: string, pageUrl: string): { rows: CourtListingRow[]; subIndexUrls: string[] };
  level(court: string): CourtLevel;
  regionSignal: RegExp;       // region First-Nation names (+ any court-specific gov party)
}

// Shared Indigenous + economic keyword signal (generic across courts). The generic half of what
// the old Yukon signal matched; region-specific nation names are in each adapter's regionSignal.
export const SHARED_SIGNAL =
  /\b(first nations?|aboriginal|indigenous|m[ée]tis|treaty|land title|self-government|duty to consult|mineral|resource|royalt|expropriat|compensation)\b/i;

// List-level shortlist. Normalize `_`→space first: filenames use `_` separators and `_` is a regex
// word char, so `\b` would not fire between `_` and a party name.
export function isCandidate(row: CourtListingRow, adapter: CourtAdapter): boolean {
  const hay = `${row.citation} ${row.fileName}`.replace(/_/g, " ");
  return SHARED_SIGNAL.test(hay) || adapter.regionSignal.test(hay);
}

// Best-effort display name from filename (party names live there); feeds includeCandidate's text.
// Strips a leading citation-ish prefix (Yukon filenames start with the citation) — generalized to
// a 2–5-char court token so Yukon output is unchanged; cosmetic for date-prefixed courts.
export function styleFromFileName(fileName: string, citation: string): string {
  const s = fileName
    .replace(/\.pdf$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/^\s*\d{4}[-\s]\w{2,5}[-\s]?\d+\s*/i, "")
    .replace(/\s+corr\d*$/i, "")
    .trim();
  return s || citation;
}

// Map a fetched decision → substrate LegalCase (mirrors a2ajToCase's field set so the object is a
// valid LegalCase). Promotion/enrichment fill nations/themes/outcome later.
export function courtToCase(row: CourtListingRow, text: string, adapter: CourtAdapter): LegalCase {
  return {
    id: slugCitation(row.citation),
    citation: row.citation,
    styleOfCause: styleFromFileName(row.fileName, row.citation),
    court: row.court,
    level: adapter.level(row.court),
    year: Number(row.citation.slice(0, 4)),
    jurisdiction: "Canada",
    nations: [],
    themes: [],
    outcome: { outcomeType: "unclassified", winType: "unclassified", whoWon: "", holding: "" },
    chunks: text ? chunkText(text) : undefined,
    casesCited: [],
    casesCiting: [],
    citingCount: 0,
    enrichmentLevel: "index",
    corpusTier: "substrate",
    fullTextAvailable: !!text,
    provenance: {
      source: "official_court", sourceUrl: row.pdfUrl,
      upstreamLicense: "unknown", ingestedAt: new Date().toISOString(), unofficial: true,
    },
  };
}
