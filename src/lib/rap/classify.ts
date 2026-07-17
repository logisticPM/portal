// Derive a RapClassification from the grounded core fields — no extra API call.
// Pure leaf: no AWS, no I/O, no env. Shared by BOTH engines (pipeline.bda.ts and
// pipeline.bedrock.ts), which each carried a byte-identical private copy until
// the confidence bug below had to be fixed in two places at once.
import { PILLARS } from "./extraction-schema";
import type { ExtractedCommitment, ExtractedRap, Pillar, RapClassification } from "./types";

// confidence = the least confident signal that actually asserts something.
//
// The subtlety is an asymmetry between the three fields. `jurisdiction` and
// `sector` FALL BACK to "other" when the document doesn't state them — a
// fallback is still an assertion, so a low-confidence one must drag the result
// down. `rapType` has no fallback: it is the AUSTRALIAN reflect/innovate/
// stretch/elevate maturity tier (types.ts: "AU maturity tier; null when not an
// AU-style RAP") and stays null for anything else. A null rapType asserts
// nothing, so it must not drag.
//
// It used to. Both engines did Math.min over all three unconditionally, so
// EVERY Canadian RAP scored confidence 0 — rapType is legitimately null there,
// which rule 2 (no quote ⇒ no value) correctly reports at confidence 0.
// Measured live on the real Bank of Canada RAP (2026-07-16): a clean extraction
// with jurisdiction=CA @0.99 and sector=finance @0.9 derived
// {"jurisdiction":"CA","sector":"finance","rapType":null,"confidence":0}.
// Nothing gates on this yet, which is the only reason it wasn't visible — an
// Australian-only field must not zero the confidence of every Canadian document.
// The document's pillar set is DERIVED from its commitments — it is never asked
// of the model. "Which canonical themes does this RAP touch?" is a summary, and
// EXTRACTION_SYSTEM rule 1 is explicit that the model transcribes rather than
// summarizes: no sentence in a RAP says "this plan is about employment", so
// there is no span to quote and the field could not satisfy its own grounding
// contract. Asked for one anyway, the model did the only honest thing left and
// welded several bullets together with an ellipsis, then hung ONE page and ONE
// confidence on six independent claims (measured live on the real Bank of Canada
// RAP: six pillars at page=5, though "education" and "community" come from p15).
// See docs/rap-extraction-findings.md §4b.
//
// The commitments are the single source of truth. Each already carries a grounded
// pillarRaw plus a normalized pillarNormalized, and publish.ts builds the
// published row from c.pillarNormalized — so this is a projection of data that is
// already properly grounded one level down, not a second, worse-grounded copy.
//
// Canonical PILLARS order, not commitment order: the same RAP must derive the
// same array however its chunks happened to come back, or two runs of the same
// document aren't comparable.
export function derivePillars(commitments: ExtractedCommitment[]): Pillar[] {
  const present = new Set<Pillar>();
  for (const c of commitments) {
    if (c.pillarNormalized !== null && c.pillarNormalized !== undefined) present.add(c.pillarNormalized);
  }
  return PILLARS.filter((p) => present.has(p));
}

export function deriveClassification(e: ExtractedRap): RapClassification {
  const signals = [e.jurisdiction.confidence, e.sector.confidence];
  if (e.rapType.value !== null) signals.push(e.rapType.confidence);

  return {
    jurisdiction: e.jurisdiction.value ?? "other",
    sector: e.sector.value ?? "other",
    rapType: e.rapType.value,
    confidence: Math.min(...signals),
  };
}
