// Dedup by neutral citation. Multi-level judgments (trial/appeal/SCC) have DISTINCT
// citations, so they survive — we only collapse exact-citation repeats (spec §QC).
import type { A2ajRecord } from "./a2aj";

export function normalizeCitation(c: string): string {
  return c.trim().replace(/\s+/g, " ").toLowerCase();
}

export function dedupeByCitation(records: A2ajRecord[]): A2ajRecord[] {
  const seen = new Set<string>();
  const out: A2ajRecord[] = [];
  for (const rec of records) {
    const key = normalizeCitation(rec.citation_en);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}
