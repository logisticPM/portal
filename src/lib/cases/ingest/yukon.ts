// Direct-court harvest for www.yukoncourts.ca (pilot). Pure: parse a court's judgment
// index page into decision rows, shortlist Indigenous/economic candidates by keyword,
// and map a fetched PDF to a substrate LegalCase. No network here — the runner does the
// robots-compliant fetching. A2AJ does not index the Yukon Supreme Court, so this is how
// those decisions enter the corpus.
import type { LegalCase, CourtLevel } from "../types";
import { slugCitation, chunkText } from "./a2aj";

// Court index slug → citation court code. Pilot = these two only.
export const YUKON_COURTS = { "court-appeal": "YKCA", "supreme-court": "YKSC" } as const;
export type YukonCourtCode = "YKCA" | "YKSC";

const YUKON_LEVEL: Record<YukonCourtCode, CourtLevel> = {
  YKCA: "provincial_appeal",
  YKSC: "provincial_superior",
};

export interface YukonListingRow { citation: string; court: YukonCourtCode; pdfUrl: string; fileName: string; }

// Any href to a /sites/default/files/…​.pdf whose filename encodes a YK citation.
const PDF_HREF_RE = /href="([^"]*\/sites\/default\/files\/[^"]*\.pdf)"/gi;
const CITATION_RE = /(\d{4})[-_]yk(sc|ca)[-_]?(\d+)/i;

// Parse a Yukon judgment index page → one row per decision PDF. Deterministic: absolutize
// the URL against baseUrl, decode the filename, derive the canonical citation + court from
// the filename (robust to the visible-text variations), de-dup correction re-uploads.
export function parseYukonListing(html: string, baseUrl: string): YukonListingRow[] {
  const rows: YukonListingRow[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = PDF_HREF_RE.exec(html))) {
    let pdfUrl: string;
    try { pdfUrl = new URL(m[1], baseUrl).toString(); } catch { continue; }
    const fileName = decodeURIComponent(pdfUrl.split("/").pop() ?? "");
    const c = CITATION_RE.exec(fileName);
    if (!c) continue; // not a decision PDF (form, notice, …)
    const court: YukonCourtCode = c[2].toLowerCase() === "ca" ? "YKCA" : "YKSC";
    const citation = `${c[1]} ${court} ${c[3]}`;
    if (seen.has(citation)) continue;
    seen.add(citation);
    rows.push({ citation, court, pdfUrl, fileName });
  }
  return rows;
}

// List-level shortlist (recall-conservative, documented). An Indigenous-party OR
// economic/land signal in citation+filename; party names live in the filename. Anonymized
// captions ("ABC v XYZ") and criminal/family files are correctly excluded.
const YUKON_SIGNAL = /\b(first nations?|nacho nyak dun|fnnnd|kwanlin|champagne|aishihik|little salmon|carmacks|ross river|teslin|tlingit|vuntut|gwitchin|tr'?ond|carcross|tagish|selkirk|kluane|white river|liard|ta'?an|aboriginal|indigenous|m[ée]tis|treaty|land title|self-government|mineral|resource|royalt|expropriat|compensation)\b/i;
const GOV_PARTY = /yukon\s*\(government of\)/i;

export function isIndigenousEconomicCandidate(row: YukonListingRow): boolean {
  // Normalize `_` → space: filenames use underscores as separators ("1_Ross River"),
  // and `_` is a regex word char so `\b` would not fire between `_` and a party name.
  const hay = `${row.citation} ${row.fileName}`.replace(/_/g, " ");
  return YUKON_SIGNAL.test(hay) || GOV_PARTY.test(hay);
}

// Best-effort display name from the filename (party names live there); feeds includeCandidate's
// text. Retrieval/labelling use the chunks, so exactness here is not critical.
function styleFromFileName(fileName: string, citation: string): string {
  const s = fileName
    .replace(/\.pdf$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/^\s*\d{4}[-\s]yk(sc|ca)[-\s]?\d+\s*/i, "")
    .replace(/\s+corr\d*$/i, "")
    .trim();
  return s || citation;
}

// Map a fetched decision → substrate LegalCase (mirrors a2ajToCase's field set so the object
// is a valid LegalCase). Promotion/enrichment fill nations/themes/outcome later.
export function yukonToCase(row: YukonListingRow, text: string): LegalCase {
  return {
    id: slugCitation(row.citation),
    citation: row.citation,
    styleOfCause: styleFromFileName(row.fileName, row.citation),
    court: row.court,
    level: YUKON_LEVEL[row.court],
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
