import { ORG_BN_MAP, bnForOrgName } from "../src/lib/commitments/org-bn-map";
import { isValidBN } from "../src/lib/rap/bn";
import { slugifyOrg } from "../src/lib/commitments/orgs";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); ok ? pass++ : fail++; };

async function main() {
  check("every mapped BN is Luhn-valid",
    Object.values(ORG_BN_MAP).every((bn) => isValidBN(bn) !== null));
  check("keys are already slugified",
    Object.keys(ORG_BN_MAP).every((k) => slugifyOrg(k) === k));
  // lookup goes through slugifyOrg, so a raw org name resolves
  const [firstSlug, firstBn] = Object.entries(ORG_BN_MAP)[0] ?? [];
  if (firstSlug) check("bnForOrgName resolves a mapped org", bnForOrgName(firstSlug) === firstBn);
  check("unmapped org ⇒ undefined", bnForOrgName("Definitely Not A Real Seeded Org 9Z") === undefined);
  process.exit(fail ? 1 : 0);
}
main();
