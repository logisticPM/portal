// Per-court adapters for the generic harvest. Each provides where to look (indexUrls), how to
// parse a listing page (parseListing), the court→level map, and the region's First-Nation keywords.
import type { CourtLevel } from "../types";
import type { CourtAdapter, CourtListingRow } from "./court-harvest";

// Shared: scan a page for decision-PDF <a href>s; parseRow(fileName) yields {citation,court} or null
// (non-decision PDFs — forms/notices — have no citation and are dropped). De-dups by citation.
function extractPdfRows(
  html: string, pageUrl: string,
  parseRow: (fileName: string) => { citation: string; court: string } | null,
): CourtListingRow[] {
  const rows: CourtListingRow[] = [];
  const seen = new Set<string>();
  const re = /href="([^"]*\.pdf)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let pdfUrl: string;
    try { pdfUrl = new URL(m[1], pageUrl).toString(); } catch { continue; }
    const fileName = decodeURIComponent(pdfUrl.split("/").pop() ?? "");
    const parsed = parseRow(fileName);
    if (!parsed) continue;
    if (seen.has(parsed.citation)) continue;
    seen.add(parsed.citation);
    rows.push({ citation: parsed.citation, court: parsed.court, pdfUrl, fileName });
  }
  return rows;
}

// Extract sub-index page links matching a regex (absolutized), de-duped.
function extractSubIndex(html: string, pageUrl: string, hrefRe: RegExp): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(hrefRe.source, "gi");
  while ((m = re.exec(html))) {
    try { out.add(new URL(m[1], pageUrl).toString()); } catch { /* skip */ }
  }
  return [...out];
}

// ---- Yukon (YKCA + YKSC): single page per court; behavior-preserving refactor of yukon.ts ----
const YK_RE = /(\d{4})[-_]yk(sc|ca)[-_]?(\d+)/i;
export const yukonAdapter: CourtAdapter = {
  id: "yukon",
  baseUrl: "https://www.yukoncourts.ca",
  indexUrls: [
    "https://www.yukoncourts.ca/en/court-appeal/judgments",
    "https://www.yukoncourts.ca/en/supreme-court/judgments",
  ],
  parseListing(html, pageUrl) {
    const rows = extractPdfRows(html, pageUrl, (fn) => {
      const c = YK_RE.exec(fn);
      if (!c) return null;
      const court = c[2].toLowerCase() === "ca" ? "YKCA" : "YKSC";
      return { citation: `${c[1]} ${court} ${c[3]}`, court };
    });
    return { rows, subIndexUrls: [] };
  },
  level: (court) => (court === "YKCA" ? "provincial_appeal" : "provincial_superior") as CourtLevel,
  regionSignal:
    /\b(nacho nyak dun|fnnnd|kwanlin|champagne|aishihik|little salmon|carmacks|ross river|teslin|tlingit|vuntut|gwitchin|tr'?ond|carcross|tagish|selkirk|kluane|white river|liard|ta'?an)\b|yukon\s*\(government of\)/i,
};

// ---- New Brunswick CoA (NBCA): landing → monthly index pages → PDFs ----
const NB_RE = /(\d{4})-nbca-(\d+)/i;
const NB_MONTH_RE = /href="([^"]*\/appeal\/content\/decisions\/\d{4}\/[a-z]+\.html)"/i;
export const nbAdapter: CourtAdapter = {
  id: "nb",
  baseUrl: "https://www.courtsnb-coursnb.ca",
  indexUrls: ["https://www.courtsnb-coursnb.ca/content/cour/en/appeal/content/decisions.html"],
  parseListing(html, pageUrl) {
    const rows = extractPdfRows(html, pageUrl, (fn) => {
      const c = NB_RE.exec(fn);
      return c ? { citation: `${c[1]} NBCA ${c[2]}`, court: "NBCA" } : null;
    });
    return { rows, subIndexUrls: extractSubIndex(html, pageUrl, NB_MONTH_RE) };
  },
  level: () => "provincial_appeal" as CourtLevel,
  regionSignal:
    /\b(mi'?k?maq|mi'?gmaq|wolastoqiyik|wolastoqey|maliseet|passamaquoddy|peskotomuhkati|elsipogtog|madawaska|tobique|neqotkuk|esgeno[oô]petitj|woodstock|oromocto|kingsclear|saint mary'?s)\b/i,
};

// ---- Manitoba CoA (MBCA): single "recent judgments" page (recent-only) ----
const MB_RE = /(\d{4})[-_]mbca[-_](\d+)/i;
export const mbAdapter: CourtAdapter = {
  id: "mb",
  baseUrl: "https://www.manitobacourts.mb.ca",
  indexUrls: ["https://www.manitobacourts.mb.ca/court-of-appeal/recent-judgments/"],
  parseListing(html, pageUrl) {
    const rows = extractPdfRows(html, pageUrl, (fn) => {
      const c = MB_RE.exec(fn);
      return c ? { citation: `${c[1]} MBCA ${c[2]}`, court: "MBCA" } : null;
    });
    return { rows, subIndexUrls: [] };
  },
  level: () => "provincial_appeal" as CourtLevel,
  regionSignal:
    /\b(cree|ojibw|anishinaab?e|saulteaux|dakota|oji-cree|dene|peguis|sagkeeng|norway house|pimicikamak|cross lake|roseau river|long plain|swan lake|sioux valley|treaty land entitlement)\b/i,
};

export const ADAPTERS: Record<string, CourtAdapter> = {
  yukon: yukonAdapter, nb: nbAdapter, mb: mbAdapter,
};
