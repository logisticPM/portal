// ===========================================================================
// Deterministic normalization of freeform supplier sector/region onto the
// Commitments-module Sector enum + province codes. Covers the demo supplier set
// without an LLM (unit-testable). LLM fallback for unknowns is future work.
// ===========================================================================
import type { Sector } from "../commitments/types";

// keyword (lowercased substring) -> Sector. First hit wins; order = specificity.
const SECTOR_MAP: [string, Sector][] = [
  ["construction", "construction"],
  ["logistics", "transport"],
  ["freight", "transport"],
  ["transport", "transport"],
  ["catering", "retail"],
  ["food", "retail"],
  ["retail", "retail"],
  ["it ", "consulting"],
  ["information technology", "consulting"],
  ["software", "consulting"],
  ["consulting", "consulting"],
  ["office", "retail"],
  ["energy", "energy"],
  ["mining", "mining"],
  ["finance", "finance"],
  ["bank", "finance"],
  ["health", "health"],
  ["forestry", "forestry"],
  ["telecom", "telecom"],
  ["education", "education"],
  ["aerospace", "aerospace"],
  ["agri", "agriculture"],
  ["government", "government"],
  ["media", "media"],
];

export function normalizeSector(freeform?: string): Sector | undefined {
  if (!freeform) return undefined;
  const s = freeform.toLowerCase();
  for (const [kw, sector] of SECTOR_MAP) if (s.includes(kw)) return sector;
  return undefined;
}

const REGION_MAP: Record<string, string> = {
  "british columbia": "BC",
  bc: "BC",
  alberta: "AB",
  ab: "AB",
  saskatchewan: "SK",
  sk: "SK",
  manitoba: "MB",
  mb: "MB",
  ontario: "ON",
  on: "ON",
  quebec: "QC",
  qc: "QC",
  "nova scotia": "NS",
  ns: "NS",
  "new brunswick": "NB",
  nb: "NB",
  "newfoundland and labrador": "NL",
  nl: "NL",
  "prince edward island": "PE",
  pe: "PE",
  yukon: "YT",
  yt: "YT",
  "northwest territories": "NT",
  nt: "NT",
  nunavut: "NU",
  nu: "NU",
};

export function normalizeRegion(freeform?: string): string | undefined {
  if (!freeform) return undefined;
  return REGION_MAP[freeform.trim().toLowerCase()] ?? undefined;
}
