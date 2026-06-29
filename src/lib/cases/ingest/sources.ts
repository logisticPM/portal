// The methodology surface: which queries/seeds define the corpus (spec §3).
// Versioned on purpose — changing these changes the corpus boundary.
import type { Theme } from "../types";

export const THEME_QUERIES: Record<Theme, string[]> = {
  land_rights: ["aboriginal title", "land claim"],
  resource_revenue: ["revenue sharing", "resource revenue"],
  duty_to_consult: ["duty to consult", "honour of the crown"],
  treaty: ["treaty rights", "treaty annuity"],
  fiduciary: ["fiduciary duty"],
  self_determination: ["self-government", "self-determination"],
};

// Flagship landmark seeds (fetched directly; promoted to core via enrichment).
export const SEED_CITATIONS: string[] = [
  "2014 SCC 44", "2004 SCC 73", "2004 SCC 74", "2005 SCC 69", "2017 SCC 40",
  "2017 SCC 58", "2014 SCC 48", "2016 SCC 12", "2018 FCA 153",
  "[1973] SCR 313", "[1984] 2 SCR 335", "[1990] 1 SCR 1075", "[1997] 3 SCR 1010",
  "2024 SCC 27",
];

// Known provincial-gap cases to attempt (may be absent from A2AJ → index-level stub).
export const GAP_CITATIONS: string[] = ["2020 ABCA 163"];

// Harvest bounds.
export const DATE_FROM = "1970-01-01";
export const DATE_TO = "2026-12-31";
export const WINDOW_YEARS = 5; // date-window width for paging around the size<=50 cap
