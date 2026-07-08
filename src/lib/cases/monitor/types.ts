// A single scheduled-scan report (spec 2026-07-07).
export interface ScanReport {
  ts: string;             // ISO timestamp of the scan
  windowDays: number;     // recency window scanned
  scanned: number;        // candidate records seen (deduped)
  added: number;          // genuinely-new cases written to substrate
  newCitations: string[]; // citations of the added cases (capped at 50)
}
