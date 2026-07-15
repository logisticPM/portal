// Pure situation→case similarity (spec 2026-07-14). Deterministic, explainable, NOT learned.
// The scoring lives here; the repo embeds/loads and calls scoreSituation.
import type { LegalCase, Theme, SituationInput, SimilarityBreakdown, ScoredCase } from "./types";
import { dot } from "./search/hybrid";

// Heuristic weights + strength thresholds — documented constants, tunable by the post-merge
// mini-eval. NOT learned (we have no situation↔case similarity labels).
const WEIGHTS = { semantic: 0.6, theme: 0.3, jurisdiction: 0.1 };
const STRONG_MIN = 0.55;
const MODERATE_MIN = 0.40;

// Deterministic profile text for the case-level embedding: what this case is ABOUT.
export function assembleProfileText(c: LegalCase): string {
  return [
    c.styleOfCause,
    c.themes.map((t) => t.replace(/_/g, " ")).join(", "),
    c.outcome?.holding ?? "",
    (c.summary?.claims ?? []).map((cl) => cl.text).join(" "),
  ].filter(Boolean).join(". ").replace(/\s+/g, " ").trim();
}

export function strengthLabel(composite: number): "strong" | "moderate" | "weak" {
  if (composite >= STRONG_MIN) return "strong";
  if (composite >= MODERATE_MIN) return "moderate";
  return "weak";
}

export function scoreSituation(
  input: SituationInput,
  cases: LegalCase[],
  situationVec: Float32Array | null,
  caseVecs: Map<string, Float32Array>,
  topN = 10,
): ScoredCase[] {
  const selThemes = new Set<Theme>(input.themes);
  const activeTheme = selThemes.size > 0;
  const activeJuris = !!input.level;
  const totalW =
    WEIGHTS.semantic + (activeTheme ? WEIGHTS.theme : 0) + (activeJuris ? WEIGHTS.jurisdiction : 0);

  const scored: ScoredCase[] = cases.map((c) => {
    const cv = caseVecs.get(c.id);
    const semantic = situationVec && cv ? Math.max(0, dot(situationVec, cv)) : 0;
    const matchedThemes = c.themes.filter((t) => selThemes.has(t));
    const themeOverlap = activeTheme ? matchedThemes.length / selThemes.size : 0;
    const sameJurisdiction = activeJuris && c.level === input.level;
    const jurisdictionMatch = sameJurisdiction ? 1 : 0;
    const composite =
      (WEIGHTS.semantic * semantic +
        (activeTheme ? WEIGHTS.theme * themeOverlap : 0) +
        (activeJuris ? WEIGHTS.jurisdiction * jurisdictionMatch : 0)) / totalW;
    const breakdown: SimilarityBreakdown = {
      semantic, themeOverlap, jurisdictionMatch, composite,
      strength: strengthLabel(composite), matchedThemes, sameJurisdiction,
    };
    return { case: c, breakdown };
  });

  scored.sort((a, b) =>
    b.breakdown.composite - a.breakdown.composite ||
    b.case.citingCount - a.case.citingCount ||
    b.case.year - a.case.year ||
    a.case.id.localeCompare(b.case.id));
  return scored.slice(0, topN);
}
