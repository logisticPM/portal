// Derive a RapClassification from the grounded core fields — no extra API call.
// Pure leaf: no AWS, no I/O, no env. Shared by BOTH engines (pipeline.bda.ts and
// pipeline.bedrock.ts), which each carried a byte-identical private copy until
// the confidence bug below had to be fixed in two places at once.
import type { ExtractedRap, RapClassification } from "./types";

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
