// ===========================================================================
// Validate src/lib/commitments/org-bn-map.ts before the prod BN backfill.
//
// Curation is a HUMAN step (name → BN, sourced from the registry). This script
// does NOT fill the map — it guards what a human curated, in three tiers:
//
//   1. FORMAT   (hard)  every BN passes isValidBN (Luhn-valid 9 digits).
//   2. KEY      (hard)  each key is already slugified AND matches a real seeded
//                       org (catches typos / stale keys that would migrate 0 rows).
//   3. REGISTRY (soft)  verifyBN(bn) → the returned legalName plausibly matches
//                       the seeded org name (catches WRONG-ENTITY attribution).
//
// Registry checks need the real ISED provider — run with REGISTRY_IMPL=ised once
// that integration is activated (src/lib/rap/registry.ts). Under the default stub
// they report "unverified" (not a failure). NOTE: ISED's endpoint covers
// FEDERALLY-incorporated corps only, so provincial crown corps (BC Hydro,
// Hydro-Québec, SaskPower, …) legitimately come back not-found — treat those as
// "verify by hand", not as errors.
//
//   npx tsx scripts/validate-org-bn-map.ts                 # format + key checks (stub)
//   REGISTRY_IMPL=ised npx tsx scripts/validate-org-bn-map.ts   # + live registry cross-check
// ===========================================================================
import { ORG_BN_MAP } from "../src/lib/commitments/org-bn-map";
import { commitmentFixtures } from "../src/lib/commitments/fixtures";
import { slugifyOrg } from "../src/lib/commitments/orgs";
import { isValidBN } from "../src/lib/rap/bn";
import { getRegistryProvider } from "../src/lib/rap/registry";

// slug → the seeded org's display name (for the registry name cross-check)
const seededNameBySlug = new Map<string, string>();
for (const c of commitmentFixtures) seededNameBySlug.set(slugifyOrg(c.orgName), c.orgName);

// Loose name match: lowercase, drop punctuation + common corporate suffixes,
// then require meaningful token overlap. Deliberately lenient — it flags a BN
// pointing at an obviously different entity, not every phrasing difference.
function looseNameMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b(inc|incorporated|corp|corporation|ltd|limited|llc|llp|lp|ulc|co|company|the|of|canada)\b/g, " ")
      .split(/\s+/).filter((t) => t.length > 2);
  const ta = new Set(norm(a));
  const tb = norm(b);
  if (ta.size === 0 || tb.length === 0) return false;
  return tb.some((t) => ta.has(t));
}

async function main() {
  const provider = getRegistryProvider();
  const usingIsed = process.env.REGISTRY_IMPL === "ised";
  const entries = Object.entries(ORG_BN_MAP);
  let hardErrors = 0, warnings = 0, verified = 0, unverified = 0;

  console.log(`Validating ${entries.length} ORG_BN_MAP entr${entries.length === 1 ? "y" : "ies"} `
    + `(registry: ${usingIsed ? "ISED live" : "stub — registry checks are soft"})\n`);

  for (const [slug, bn] of entries) {
    const problems: string[] = [];

    // 1. FORMAT (hard)
    if (!isValidBN(bn)) problems.push(`❌ FORMAT: "${bn}" is not a Luhn-valid 9-digit BN`);

    // 2. KEY (hard)
    if (slugifyOrg(slug) !== slug) problems.push(`❌ KEY: "${slug}" is not already slugified (want "${slugifyOrg(slug)}")`);
    const seededName = seededNameBySlug.get(slug);
    if (!seededName) problems.push(`❌ KEY: "${slug}" matches no seeded org — migration would touch 0 rows (typo/stale?)`);

    // 3. REGISTRY (soft)
    let registryNote = "";
    if (isValidBN(bn)) {
      const entity = await provider.verifyBN(isValidBN(bn)!.bn9);
      if (!entity) {
        unverified++;
        registryNote = usingIsed
          ? `⚠️  unverified: registry has no federal corp for ${bn} (provincial/not-federal? verify by hand)`
          : `·  unverified (stub) — re-run with REGISTRY_IMPL=ised`;
      } else if (seededName && !looseNameMatch(entity.legalName, seededName)) {
        warnings++;
        registryNote = `⚠️  NAME MISMATCH: registry "${entity.legalName}" vs seeded "${seededName}" — possible WRONG ENTITY`;
      } else {
        verified++;
        registryNote = `✅ registry "${entity.legalName}"`;
      }
    }

    if (problems.length) { hardErrors += problems.length; console.log(`${slug} → ${bn}`); problems.forEach((p) => console.log(`   ${p}`)); if (registryNote) console.log(`   ${registryNote}`); }
    else console.log(`${slug} → ${bn}   ${registryNote}`);
  }

  console.log(`\n${hardErrors} hard error(s), ${warnings} name-mismatch warning(s); `
    + `registry: ${verified} verified, ${unverified} unverified.`);
  if (hardErrors > 0) { console.log("FAIL — fix hard errors before running the migration."); process.exit(1); }
  if (warnings > 0) { console.log("REVIEW — resolve name mismatches (wrong-entity risk) before the migration."); process.exit(1); }
  console.log(usingIsed ? "PASS." : "PASS (format + keys). Re-run with REGISTRY_IMPL=ised for the registry cross-check.");
}

main();
