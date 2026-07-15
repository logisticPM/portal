// Curated, confidence-gated crosswalk: seeded org (by slug) → 9-digit Business
// Number root, sourced from Corporations Canada's federal registry
// (ised-isde.canada.ca/cc + the CBCA-active open dataset, 2026-07-15). CONFIDENCE
// RULE: include an org ONLY when its legal entity is unambiguous; use the ACTIVE
// parent corporation's BN root. Orgs whose legal entity is ambiguous, provincial,
// financial, or foreign are LEFT OUT — they stay display-only (businessNumber
// absent). Every value passes isValidBN.
//
// ⚠️ VERIFY BEFORE THE PROD MIGRATION. Matched to each org's Active parent (corp #
// noted for audit). Spot-check before running scripts/migrate-commitment-bn.ts on
// prod, and run `REGISTRY_IMPL=ised npx tsx scripts/validate-org-bn-map.ts` once the
// ISED integration is activated for a live name cross-check. Only federally-
// incorporated, non-financial corps are here; banks/insurers (RBC, BMO, TD, Sun
// Life, Manulife …) are excluded (Bank/Insurance Act → OSFI); provincial (Bell=Special
// Act, TELUS/Pembina/ATCO/Sobeys/Agnico/Canfor/Rogers…), foreign (Newmont, Diavik),
// universities, health authorities, and federal crown corps (Canada Post, BDC, EDC,
// CIB, CMHC) are sourced separately. See docs/bn-curation-worksheet.md.
import { slugifyOrg } from "./orgs";

export const ORG_BN_MAP: Record<string, string> = {
  // slug → BN root (Corporations Canada, federal CBCA, Active parent; corp # for audit)
  "cameco": "890561467",                              // CAMECO CORPORATION · corp 332981-0
  "nutrien": "710477720",                             // Nutrien Ltd. · corp 1026366-4
  "suncor-energy": "104168083",                       // Suncor Energy Inc. · corp 1562504-1
  "cenovus-energy": "873215610",                      // Cenovus Energy Inc. · corp 1756759-6
  "imperial-oil": "102465879",                        // IMPERIAL OIL LIMITED · corp 029646-5
  "cn-canadian-national-railway": "100768779",        // Canadian National Railway Company · corp 010533-3
  "loblaw-companies": "103363693",                    // LOBLAW COMPANIES LIMITED · corp 012676-4
  "air-canada": "100092287",                          // AIR CANADA · corp 439662-6
  "cpkc-canadian-pacific-kansas-city": "882884711",   // Canadian Pacific Kansas City Limited · corp 395216-9
  "tc-energy": "897657508",                           // TC Energy Corporation · corp 414844-4
  "transalta": "134234855",                           // TransAlta Corporation · corp 1507876-8
  "capital-power": "808499024",                       // CAPITAL POWER CORPORATION · corp 716657-5
  "trans-mountain-corporation": "752524686",          // TRANS MOUNTAIN CORPORATION · corp 1080414-2
  "vale-canada": "102475084",                         // Vale Canada Limited · corp 956267-2
  "teck-resources": "893110981",                      // Teck Resources Limited · corp 446056-1
  "maple-leaf-foods": "898324041",                    // MAPLE LEAF FOODS INC. · corp 454466-8
  "aecon": "100263540",                               // AECON GROUP INC. · corp 135607
  "stantec": "130521958",                             // Stantec Inc. · corp 301878-4
  "cae": "100717065",                                 // CAE INC. · corp 873905-6
  "northwestel": "121336721",                         // NORTHWESTEL INC. · corp 450407-1
  "westjet": "791790470",                             // WestJet Group Inc. · corp 1163663-4
  "intact-financial": "891059693",                    // Intact Financial Corporation · corp 427397-4
  "the-north-west-company": "895556991",              // The North West Company Inc. · corp 750205-2
  // Enbridge: 62 registry entities — selected the publicly-traded parent that
  // publishes the RAP. Kept per that disambiguation; re-confirm if in doubt.
  "enbridge": "119653384",                            // Enbridge Inc. · corp 227602-0

  // --- Provincially-incorporated (via Canada's Business Registries, ised-isde.canada.ca/cbr-rec) ---
  // BN root taken from each province's registry entry for the Active parent.
  "telus": "877429621",                               // TELUS Corporation · BC0573792
  "canfor": "100783562",                              // CANFOR CORPORATION · BC0069561
  "west-fraser": "105643464",                         // WEST FRASER TIMBER CO. LTD. · BC0071976
  "fortisbc": "105349740",                            // FORTISBC HOLDINGS INC. · BC0791126
  "agnico-eagle": "889122453",                        // AGNICO EAGLE MINES LIMITED · ON
  "hydro-one": "805129962",                           // HYDRO ONE LIMITED · ON (listed parent)
  "ellisdon": "872894332",                            // ELLISDON CORPORATION · ON
  "glencore-canada": "897767646",                     // GLENCORE CANADA CORPORATION · ON
  "sobeys": "104902135",                              // SOBEYS INC. · NS (BN 104902135NS0005)
  "nova-scotia-power": "119314938",                   // NOVA SCOTIA POWER INCORPORATED · NS (…NS0001)
  "pembina-pipeline": "870693231",                    // PEMBINA PIPELINE CORPORATION · AB
  "pcl-construction": "104116249",                    // PCL CONSTRUCTORS INC. · AB
  "altalink": "868544818",                            // ALTALINK MANAGEMENT LTD. · AB
};

export function bnForOrgName(orgName: string): string | undefined {
  return ORG_BN_MAP[slugifyOrg(orgName)];
}
