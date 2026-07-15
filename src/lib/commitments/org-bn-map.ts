// Curated, confidence-gated crosswalk: seeded org (by slug) → 9-digit Business
// Number root, sourced from Corporations Canada's federal registry
// (ised-isde.canada.ca/cc). CONFIDENCE RULE: include an org ONLY when its legal
// entity is unambiguous; use the ACTIVE parent corporation's BN root. Orgs whose
// legal entity is ambiguous, provincial, financial, or foreign are LEFT OUT —
// they stay display-only (businessNumber absent). Every value passes isValidBN.
//
// ⚠️ VERIFY BEFORE THE PROD MIGRATION. The BNs below were read from the public
// federal registry on 2026-07-15 and matched to the Active parent entity (corp #
// noted for audit). Spot-check each against the registry before running
// scripts/migrate-commitment-bn.ts on prod — and run
// `REGISTRY_IMPL=ised npx tsx scripts/validate-org-bn-map.ts` once the ISED
// integration is activated for a live name cross-check. Only federally-incorporated,
// non-financial corps are here; banks/insurers (RBC, BMO, TD, …) are excluded from
// this registry (Bank/Insurance Act → OSFI), and provincial/foreign entities (Teck,
// Agnico Eagle, Newmont, crown utilities) must be sourced separately. See
// docs/bn-curation-worksheet.md.
import { slugifyOrg } from "./orgs";

export const ORG_BN_MAP: Record<string, string> = {
  // slug → BN root (Corporations Canada, federal, Active parent; corp # for audit)
  "cameco": "890561467",                        // CAMECO CORPORATION · corp 332981-0
  "nutrien": "710477720",                       // Nutrien Ltd. · corp 1026366-4
  "suncor-energy": "104168083",                 // Suncor Energy Inc. · corp 1562504-1
  "cenovus-energy": "873215610",                // Cenovus Energy Inc. · corp 1756759-6
  "imperial-oil": "102465879",                  // IMPERIAL OIL LIMITED · corp 029646-5
  "cn-canadian-national-railway": "100768779",  // Canadian National Railway Company · corp 010533-3
  "loblaw-companies": "103363693",              // LOBLAW COMPANIES LIMITED · corp 012676-4
  // Enbridge: 62 registry entities — selected the publicly-traded parent that
  // publishes the RAP. Kept per that disambiguation; re-confirm if in doubt.
  "enbridge": "119653384",                      // Enbridge Inc. · corp 227602-0
};

export function bnForOrgName(orgName: string): string | undefined {
  return ORG_BN_MAP[slugifyOrg(orgName)];
}
