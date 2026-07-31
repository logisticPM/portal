// Gold labels for outcome classification.
//
// Every label MUST carry a verbatim quote naming the moving party, verified against the
// case's own chunks. This is not ceremony: the first hand-labelled set was wrong because
// the labeller read party roles off the style of cause instead of finding the moving
// party in the text ("fnnnd v yukon" puts the nation first, but Yukon was the applicant).
// An unaided inference produces no quote, so this rule makes that error unrecordable.
import type { CaseChunk, OutcomeDerivation, WinType } from "../types";
import { contradictsDerivation } from "../ingest/outcome-rubric";

export interface GoldLabel {
  caseId: string;
  movingPartyIsIndigenous: boolean;
  granted: OutcomeDerivation["granted"];
  winType: WinType;
  movingPartyQuote: string;   // verbatim, must appear in the case text
  citedPara: string;          // where the labeller says it is
  labeller: string;           // "consensus-4" | "claude" | "user"
  confidence: "high" | "low";
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// Returns null when the label is sound, otherwise a human-readable reason. A quote found
// in a different paragraph than cited is NOT fatal — the label stands, but the drift is
// reported so the citation can be corrected.
export function verifyGoldLabel(g: GoldLabel, chunks: CaseChunk[]): string | null {
  if (!g.movingPartyQuote.trim()) return "movingPartyQuote is empty — every label must carry evidence";

  const der: OutcomeDerivation = { movingPartyIsIndigenous: g.movingPartyIsIndigenous, granted: g.granted };
  if (contradictsDerivation(g.winType, der)) {
    return `winType "${g.winType}" contradicts the label's own derivation (moving=${g.movingPartyIsIndigenous}, ${g.granted})`;
  }

  const q = norm(g.movingPartyQuote);
  const hit = chunks.find((c) => norm(c.text).includes(q));
  if (!hit) return `movingPartyQuote not found in the case text — cannot verify who moved`;
  if (hit.paragraph !== g.citedPara) return `quote found in ${hit.paragraph}, not the cited ${g.citedPara}`;
  return null;
}
