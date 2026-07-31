// Gold labels for outcome classification.
//
// Every label MUST carry a verbatim quote naming the moving party, verified against the
// case's own chunks. This is not ceremony: the first hand-labelled set was wrong because
// the labeller read party roles off the style of cause instead of finding the moving
// party in the text ("fnnnd v yukon" puts the nation first, but Yukon was the applicant).
// An unaided inference produces no quote, so this rule makes that error unrecordable.
import type { CaseChunk, OutcomeDerivation, WinType } from "../types";
import { ALL_GRANTED, ALL_WINTYPES, contradictsDerivation } from "../ingest/outcome-rubric";

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

const MIN_QUOTE_WORDS = 6;

// Returns null when the label is sound, otherwise a human-readable reason. EVERY reason
// is fatal — the caller is right to drop the label. A quote must be long enough and
// unique enough to actually establish who moved: "the applicant" matches and proves
// nothing, and a quote appearing in several paragraphs (judgments restate the posture in
// their opening summary) identifies no particular one.
export function verifyGoldLabel(g: GoldLabel, chunks: CaseChunk[]): string | null {
  if (!g.movingPartyQuote.trim()) return "movingPartyQuote is empty — every label must carry evidence";

  // Closed values, validated before anything reads them: impliedDirection treats an
  // unrecognized `granted` as not-granted, which would silently invert the expected
  // polarity rather than fail.
  if (!(ALL_GRANTED as readonly string[]).includes(g.granted)) {
    return `granted "${g.granted}" is not one of ${ALL_GRANTED.join(" | ")}`;
  }
  if (!(ALL_WINTYPES as readonly string[]).includes(g.winType)) {
    return `winType "${g.winType}" is not a recognized WinType`;
  }

  const words = g.movingPartyQuote.trim().split(/\s+/);
  if (words.length < MIN_QUOTE_WORDS) {
    return `movingPartyQuote is ${words.length} words — too short to establish who moved (need ${MIN_QUOTE_WORDS}+)`;
  }

  const der: OutcomeDerivation = { movingPartyIsIndigenous: g.movingPartyIsIndigenous, granted: g.granted };
  if (contradictsDerivation(g.winType, der)) {
    return `winType "${g.winType}" contradicts the label's own derivation (moving=${g.movingPartyIsIndigenous}, ${g.granted})`;
  }

  const q = norm(g.movingPartyQuote);
  const hits = chunks.filter((c) => norm(c.text).includes(q));
  if (hits.length === 0) return "movingPartyQuote not found in the case text — cannot verify who moved";
  if (hits.length > 1) {
    return `movingPartyQuote matches ${hits.length} paragraphs — not specific enough to establish who moved`;
  }
  if (hits[0].paragraph !== g.citedPara) return `quote found in ${hits[0].paragraph}, not the cited ${g.citedPara}`;
  return null;
}
