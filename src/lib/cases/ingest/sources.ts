// The methodology surface: which queries/seeds define the corpus (spec §3).
// Versioned on purpose — changing these changes the corpus boundary.
import type { Theme } from "../types";

export const THEME_QUERIES: Record<Theme, string[]> = {
  land_rights: ["aboriginal title", "land claim"],
  resource_revenue: [
    "revenue sharing", "resource revenue", "impact benefit agreement",
    "resource royalties", "equity stake", "equitable compensation",
    "expropriation compensation", "economic loss",
  ],
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

// CANDIDATE economic seeds — pending Kay/expert validation. Fetched like any
// harvested case (deliberately NOT added to enrichment.ts, so they carry no
// curated authority); subject to the inclusion filter + dual-LLM consensus gate
// like everything else. A candidate that does not earn cross-model consensus
// stays substrate. Neutral citations verified against public court records
// (CanLII / SCC) on 2026-07-06.
export const ECON_CANDIDATE_SEEDS: string[] = [
  "2009 SCC 9",     // Ermineskin Indian Band and Nation v. Canada — oil/gas royalties
  "2021 SCC 28",    // Southwind v. Canada — equitable compensation for taken/flooded reserve land
  "2001 SCC 85",    // Osoyoos Indian Band v. Oliver (Town) — reserve land taken for canal; expropriation/tax
  "2007 ONCA 744",  // Whitefish Lake Band of Indians v. Canada (AG) — equitable compensation, undervalued timber lease
];

// Known provincial-gap cases to attempt (may be absent from A2AJ → index-level stub).
export const GAP_CITATIONS: string[] = ["2020 ABCA 163"];

// Harvest bounds.
export const DATE_FROM = "1970-01-01";
export const DATE_TO = "2026-12-31";
export const WINDOW_YEARS = 5; // date-window width for paging around the size<=50 cap
