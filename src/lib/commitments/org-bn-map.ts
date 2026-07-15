// Curated, confidence-gated crosswalk: seeded org (by slug) → 9-digit Business
// Number root, sourced from Corporations Canada. CONFIDENCE RULE: include an org
// ONLY when its legal entity is unambiguous. Ambiguous / multi-entity brands
// (e.g. "Enbridge") are LEFT OUT — they stay display-only (businessNumber absent).
// Every value MUST pass isValidBN (Luhn-valid 9 digits).
//
// ⚠️ CURATION IS A HUMAN STEP. The entries below are placeholders using
// Luhn-valid synthetic BNs for the demo orgs. Replace each with the real
// Corporations Canada BN before running the prod migration; expand top-N over time.
import { slugifyOrg } from "./orgs";

export const ORG_BN_MAP: Record<string, string> = {
  // Starter entry — a REAL seeded org (Cameco Corporation, cm-cameco-proc) with a
  // synthetic Luhn-valid BN standing in until curated. Cameco is an unambiguous
  // single legal entity, so it satisfies the confidence rule.
  "cameco": "123456782",
  // add ~15–25 high-confidence seeded orgs here, slug: realBN9
};

export function bnForOrgName(orgName: string): string | undefined {
  return ORG_BN_MAP[slugifyOrg(orgName)];
}
