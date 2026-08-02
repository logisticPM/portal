// Filters that arrive by URL from the activation dashboard or the coverage table and
// have no <select> of their own on /cases.
//
// They need a visible, removable chip for one reason: a filter the reader cannot see is a
// filter they cannot trust. Landing on "12 results" with no indication that a hidden
// predicate is in force reads as a broken corpus, not as a successful drill-in.
import type { FigureKind, RealizationStatus } from "./types";

export interface DrillIn { key: string; label: string; without: string }

const REALIZATION_LABEL: Record<RealizationStatus, string> = {
  declared: "Declared",
  negotiating: "Negotiating",
  realized: "Value realized",
  stalled: "Stalled",
  unknown: "Realization unknown",
};

const FIGURE_LABEL: Record<FigureKind, string> = {
  settlement: "Has a settlement figure",
  compensation: "Has a compensation figure",
  damages: "Has a damages figure",
  resource_revenue: "Has a resource-revenue figure",
  equity: "Has an equity figure",
  other: "Has a recorded figure",
};

const FULLTEXT_LABEL: Record<"yes" | "no", string> = {
  yes: "Full text available",
  no: "No full text",
};

// Rebuild the query string without `drop`, preserving everything else (including page-less
// state — dropping a filter must return to page 1, or the reader lands past the end of a
// now-shorter list and sees an empty page).
function urlWithout(params: Record<string, string | undefined>, drop: string): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === drop || k === "page" || v === undefined || v === "") continue;
    qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `/cases?${s}` : "/cases";
}

export function describeDrillIns(params: Record<string, string | undefined>): DrillIn[] {
  const out: DrillIn[] = [];
  const r = params.realization as RealizationStatus | undefined;
  if (r && r in REALIZATION_LABEL) {
    out.push({ key: "realization", label: REALIZATION_LABEL[r], without: urlWithout(params, "realization") });
  }
  const f = params.figureKind as FigureKind | undefined;
  if (f && f in FIGURE_LABEL) {
    out.push({ key: "figureKind", label: FIGURE_LABEL[f], without: urlWithout(params, "figureKind") });
  }
  const t = params.fullText;
  if (t === "yes" || t === "no") {
    out.push({ key: "fullText", label: FULLTEXT_LABEL[t], without: urlWithout(params, "fullText") });
  }
  return out;
}
