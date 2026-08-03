// Corpus coverage by jurisdiction — including the jurisdictions we have NOTHING from.
//
// Why this exists: `LegalCase.jurisdiction` is "Canada" for every record, so the stored
// field carries no provincial signal at all. The court code does: BCSC is British
// Columbia, ONCA is Ontario, FC is federal. This maps codes to jurisdictions and reports
// against the FULL list of Canadian jurisdictions, so a province we hold nothing from
// shows as an explicit 0 rather than being absent from the table.
//
// A count can only ever demonstrate presence. Showing absence requires a denominator that
// does not come from the data, and that is what CANADIAN_JURISDICTIONS is.
import type { LegalCase } from "./types";

export type Jurisdiction =
  | "Federal" | "British Columbia" | "Alberta" | "Saskatchewan" | "Manitoba"
  | "Ontario" | "Quebec" | "New Brunswick" | "Nova Scotia" | "Prince Edward Island"
  | "Newfoundland and Labrador" | "Yukon" | "Northwest Territories" | "Nunavut";

// Ordered west-to-east, federal first — the order a Canadian reader expects.
export const CANADIAN_JURISDICTIONS: Jurisdiction[] = [
  "Federal", "British Columbia", "Alberta", "Saskatchewan", "Manitoba", "Ontario",
  "Quebec", "New Brunswick", "Nova Scotia", "Prince Edward Island",
  "Newfoundland and Labrador", "Yukon", "Northwest Territories", "Nunavut",
];

// Court code → jurisdiction. Only codes actually observed in the corpus plus the obvious
// siblings for jurisdictions we hope to add; anything unrecognised is reported separately
// rather than silently bucketed, because a silent default would turn a coverage gap into
// a coverage claim.
const COURT_JURISDICTION: Record<string, Jurisdiction> = {
  // Federal courts and tribunals
  SCC: "Federal", FC: "Federal", FCA: "Federal", TCC: "Federal", CITT: "Federal",
  CHRT: "Federal", SST: "Federal", OHSTC: "Federal", CT: "Federal", FPSLREB: "Federal",
  OIC: "Federal", RAD: "Federal", RPD: "Federal", CACT: "Federal", SCTC: "Federal",
  // British Columbia
  BCSC: "British Columbia", BCCA: "British Columbia", BCPC: "British Columbia",
  BCHRT: "British Columbia", BCEST: "British Columbia",
  // Alberta
  ABKB: "Alberta", ABQB: "Alberta", ABCA: "Alberta", ABPC: "Alberta",
  // Saskatchewan
  SKKB: "Saskatchewan", SKQB: "Saskatchewan", SKCA: "Saskatchewan", SKPC: "Saskatchewan",
  // Manitoba
  MBKB: "Manitoba", MBQB: "Manitoba", MBCA: "Manitoba", MBPC: "Manitoba",
  // Ontario
  ONSC: "Ontario", ONCA: "Ontario", ONCJ: "Ontario", ONSCDC: "Ontario",
  // Quebec
  QCCA: "Quebec", QCCS: "Quebec", QCCQ: "Quebec",
  // Atlantic
  NBCA: "New Brunswick", NBKB: "New Brunswick", NBQB: "New Brunswick",
  NSCA: "Nova Scotia", NSSC: "Nova Scotia", NSPC: "Nova Scotia", NSSM: "Nova Scotia",
  PESC: "Prince Edward Island", PECA: "Prince Edward Island",
  NLCA: "Newfoundland and Labrador", NLSC: "Newfoundland and Labrador",
  // Territories
  YKSC: "Yukon", YKCA: "Yukon", YKTC: "Yukon",
  NWTSC: "Northwest Territories", NWTCA: "Northwest Territories",
  NUCJ: "Nunavut", NUCA: "Nunavut",
};

export interface JurisdictionCoverage {
  jurisdiction: Jurisdiction;
  total: number;
  core: number;
  fullText: number;
  courts: string[];      // the specific court codes held, so "Ontario 468" is readable as "appeal only"
}

export interface CoverageReport {
  rows: JurisdictionCoverage[];          // ALL jurisdictions, including zeros
  covered: number;                       // how many jurisdictions have at least one case
  unmapped: Record<string, number>;      // court codes this module does not recognise
}

export function jurisdictionOf(court: string): Jurisdiction | null {
  return COURT_JURISDICTION[court?.trim().toUpperCase()] ?? null;
}

export function buildCoverage(cases: LegalCase[]): CoverageReport {
  const acc = new Map<Jurisdiction, { total: number; core: number; fullText: number; courts: Set<string> }>();
  for (const j of CANADIAN_JURISDICTIONS) acc.set(j, { total: 0, core: 0, fullText: 0, courts: new Set() });
  const unmapped: Record<string, number> = {};

  for (const c of cases) {
    const j = jurisdictionOf(c.court);
    if (!j) { unmapped[c.court || "(blank)"] = (unmapped[c.court || "(blank)"] ?? 0) + 1; continue; }
    const a = acc.get(j)!;
    a.total++;
    if (c.corpusTier === "core") a.core++;
    if (c.fullTextAvailable) a.fullText++;
    a.courts.add(c.court);
  }

  const rows = CANADIAN_JURISDICTIONS.map((jurisdiction) => {
    const a = acc.get(jurisdiction)!;
    return { jurisdiction, total: a.total, core: a.core, fullText: a.fullText, courts: [...a.courts].sort() };
  });
  return { rows, covered: rows.filter((r) => r.total > 0).length, unmapped };
}
