// Human-readable display labels for enum codes (spec 2026-07-14). The stored/matched values
// stay the enum; only what the user SEES changes. Non-lawyer readers can't parse scc/fca/fc.
import type { CourtLevel } from "./types";

const COURT_LEVEL_LABELS: Record<string, string> = {
  scc: "Supreme Court of Canada (SCC)",
  fca: "Federal Court of Appeal (FCA)",
  fc: "Federal Court (FC)",
  provincial_appeal: "Provincial Court of Appeal",
  provincial_superior: "Provincial Superior Court",
  tribunal: "Tribunal (administrative)",
};

// Canonical order for the filter dropdowns (single source; was copied in two pages).
export const COURT_LEVELS: CourtLevel[] = ["scc", "fca", "fc", "provincial_appeal", "provincial_superior", "tribunal"];

// Accepts a CourtLevel (dropdowns) or any string (methodology's Object.entries keys);
// unknown values fall back to underscore→space so nothing ever renders blank.
export function courtLevelLabel(level: string): string {
  return COURT_LEVEL_LABELS[level] ?? level.replace(/_/g, " ");
}
