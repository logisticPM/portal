// A2AJ ingestion — maps the open api.a2aj.ca record shape to a LegalCase.
// Raw A2AJ gives the skeleton (citation/name/court/year + full text + citation
// graph); editorial deep fields (themes/outcome/economic/value-realization/
// summary) are layered separately via enrichment.ts. So a raw map = index level.
import type { LegalCase, CaseChunk, CourtLevel } from "../types";

export interface A2ajRecord {
  dataset: string;
  citation_en: string;
  citation2_en?: string;
  name_en: string;
  document_date_en: string;
  url_en: string;
  unofficial_text_en?: string;
  cases_cited_en?: string[];
  cases_citing_en?: string[];
  citing_cases_count?: number;
  upstream_license?: string;
}

const LEVEL: Record<string, CourtLevel> = {
  SCC: "scc", FCA: "fca", FC: "fc", TCC: "tribunal",
  BCCA: "provincial_appeal", ONCA: "provincial_appeal", NSCA: "provincial_appeal", YKCA: "provincial_appeal",
  BCSC: "provincial_superior", NSSC: "provincial_superior", NSFC: "provincial_superior",
  CHRT: "tribunal", CIRB: "tribunal", CITT: "tribunal", CMAC: "tribunal", CT: "tribunal",
  FPSLREB: "tribunal", OHSTC: "tribunal", RAD: "tribunal", RPD: "tribunal", SST: "tribunal",
};

export function slugCitation(citation: string): string {
  return citation.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Retrieval-sized chunking. TARGET keeps each chunk embeddable as one meaningful
// vector (~500 tokens); the 256 KB MAX is the absolute DynamoDB-item backstop for a
// pathological single sentence. No overlap → concatenating a case's chunks still
// reproduces the source (the fidelity property include.ts + getCase rely on).
export const TARGET_CHUNK_BYTES = 2048;   // ~500 tokens, retrieval-sized
const MAX_CHUNK_BYTES = 262144;           // 256 KB hard backstop

// Split a paragraph to ≤ TARGET on sentence boundaries; a single sentence over the
// 256 KB hard cap is char-split as a last resort (avoids ValidationException).
function splitLarge(para: string): string[] {
  if (Buffer.byteLength(para, "utf8") <= TARGET_CHUNK_BYTES) return [para];
  const sentences = para.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = "";
  for (const s of sentences) {
    const candidate = current ? `${current} ${s}` : s;
    if (Buffer.byteLength(candidate, "utf8") > TARGET_CHUNK_BYTES) {
      if (current) { parts.push(current); current = ""; }
      if (Buffer.byteLength(s, "utf8") > MAX_CHUNK_BYTES) {
        // single sentence over the hard cap: char-split (UTF-8 worst case 4 B/char)
        let remaining = s;
        const step = Math.floor(MAX_CHUNK_BYTES / 4);
        while (Buffer.byteLength(remaining, "utf8") > MAX_CHUNK_BYTES) {
          parts.push(remaining.slice(0, step));
          remaining = remaining.slice(step);
        }
        current = remaining;
      } else {
        current = s; // a long-ish sentence (over target, under cap) becomes its own chunk
      }
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts.filter(Boolean);
}

export function chunkText(text: string): CaseChunk[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .flatMap(splitLarge);
  return paragraphs.map((t, i) => ({ paragraph: `para-${i + 1}`, text: t }));
}

export function a2ajToCase(r: A2ajRecord): LegalCase {
  const text = r.unofficial_text_en ?? "";
  return {
    id: slugCitation(r.citation_en),
    citation: r.citation_en,
    citation2: r.citation2_en,
    styleOfCause: r.name_en,
    court: r.dataset,
    level: LEVEL[r.dataset] ?? "tribunal",
    year: new Date(r.document_date_en).getUTCFullYear(),
    jurisdiction: "Canada",
    nations: [], // enrichment fills this
    themes: [],  // enrichment fills this
    outcome: { outcomeType: "unclassified", winType: "unclassified", whoWon: "", holding: "" },
    chunks: text ? chunkText(text) : undefined,
    casesCited: r.cases_cited_en ?? [],
    casesCiting: r.cases_citing_en ?? [],
    citingCount: r.citing_cases_count ?? 0,
    enrichmentLevel: "index",
    corpusTier: "substrate",
    fullTextAvailable: !!text,
    provenance: {
      source: "a2aj", sourceUrl: r.url_en,
      upstreamLicense: r.upstream_license ?? "unknown",
      ingestedAt: new Date().toISOString(), unofficial: true,
    },
  };
}

// thin live fetch — used by seed-cases.ts, NOT by tests (keeps tests offline).
export async function fetchA2aj(citation: string): Promise<A2ajRecord | null> {
  const url = `https://api.a2aj.ca/fetch?citation=${encodeURIComponent(citation)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: A2ajRecord[] };
  return data.results?.[0] ?? null;
}
