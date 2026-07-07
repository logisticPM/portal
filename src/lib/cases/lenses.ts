// Audience lens (spec 2026-07-06, client idea #5). A relevance lens over the SAME
// corpus: reorders + reframes per audience, never filters or hides (governance:
// reads open to all). All functions pure.
import type { CourtLevel, LegalCase, Theme } from "./types";
import type { Session } from "@/lib/auth";

export type Lens = "indigenous_gov" | "legal_advisor" | "corporate";
export const LENSES: Lens[] = ["indigenous_gov", "legal_advisor", "corporate"];

export interface LensConfig {
  label: string;
  tagline: string;
  emphasisThemes: Theme[];
  sortByStrength: boolean; // legal_advisor: order by court level then citingCount
}

const CONFIGS: Record<Lens, LensConfig> = {
  indigenous_gov: {
    label: "Indigenous government",
    tagline: "Precedents affirming your community's economic rights and self-determination.",
    emphasisThemes: ["self_determination", "land_rights", "resource_revenue"],
    sortByStrength: false,
  },
  legal_advisor: {
    label: "Legal advisor",
    tagline: "Precedent strength and citation lineage — highest courts and most-cited first.",
    emphasisThemes: [],
    sortByStrength: true,
  },
  corporate: {
    label: "Corporate / advisory",
    tagline: "What consultation, accommodation and treaty obligations look like in practice.",
    emphasisThemes: ["duty_to_consult", "treaty", "fiduciary"],
    sortByStrength: false,
  },
};

export function lensConfig(lens: Lens): LensConfig { return CONFIGS[lens]; }

function isLens(v: string | undefined): v is Lens {
  return v === "indigenous_gov" || v === "legal_advisor" || v === "corporate";
}

// URL param wins; else map from the logged-in persona; else corporate (neutral,
// most general). legal_advisor has no persona → reachable only via the switcher.
export function resolveLens(param: string | undefined, session: Session | null): Lens {
  if (isLens(param)) return param;
  if (session?.kind === "indigenomics") return "indigenous_gov";
  return "corporate"; // company / supplier / logged-out
}

// Court-level strength rank (higher = stronger); unknown levels sort last.
const LEVEL_RANK: Record<CourtLevel, number> = {
  scc: 6, fca: 5, provincial_appeal: 4, fc: 3, provincial_superior: 2, tribunal: 1,
};

// Pure, STABLE, SET-PRESERVING reorder (output is a permutation of input — never
// drops a case). Emphasis lenses: (# of case.themes in emphasisThemes, citingCount)
// descending. Strength lens: (court-level rank, citingCount) descending.
export function applyLens(cases: LegalCase[], lens: Lens): LegalCase[] {
  const cfg = CONFIGS[lens];
  const key = (c: LegalCase): [number, number] => {
    if (cfg.sortByStrength) return [LEVEL_RANK[c.level] ?? 0, c.citingCount];
    const emphasis = c.themes.filter((t) => cfg.emphasisThemes.includes(t)).length;
    return [emphasis, c.citingCount];
  };
  return cases
    .map((c, i) => ({ c, i, k: key(c) }))
    .sort((a, b) => (b.k[0] - a.k[0]) || (b.k[1] - a.k[1]) || (a.i - b.i))
    .map((x) => x.c);
}

// Build a /cases href preserving current params, setting lens, dropping empties.
export function lensHref(current: Record<string, string | undefined>, lens: Lens): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (k === "lens") continue;
    if (v != null && v !== "") params.set(k, v);
  }
  params.set("lens", lens);
  return `/cases?${params.toString()}`;
}
