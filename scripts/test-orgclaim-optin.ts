import { rapRepo } from "../src/lib/rap";
import { toClaimItem, itemToClaim } from "../src/lib/dynamo/rap-table";
import type { OrgClaim } from "../src/lib/rap/types";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); ok ? pass++ : fail++; };

const claim = (over: Partial<OrgClaim> = {}): OrgClaim => ({
  businessNumber: "890561467", partyId: "c-acme", status: "granted",
  attestedAt: "2026-07-15T00:00:00.000Z", grantedBy: "system:bn-verify", ...over,
});

async function main() {
  // round-trip: showcaseOptIn survives the Dynamo item mapping (strip-based)
  const rt = itemToClaim(toClaimItem(claim({ showcaseOptIn: true, showcaseOptInAt: "2026-07-15T01:00:00.000Z" })));
  check("showcaseOptIn round-trips", rt.showcaseOptIn === true && rt.showcaseOptInAt === "2026-07-15T01:00:00.000Z");

  // listClaimsByBN returns granted claims on that BN (mock repo)
  await rapRepo.putClaim(claim({ partyId: "c-acme", businessNumber: "890561467", showcaseOptIn: true }));
  await rapRepo.putClaim(claim({ partyId: "c-other", businessNumber: "890561467" }));
  await rapRepo.putClaim(claim({ partyId: "c-acme", businessNumber: "710477720" }));
  const byBn = await rapRepo.listClaimsByBN("890561467");
  check("listClaimsByBN returns both parties on the BN", byBn.length === 2 && byBn.every((c) => c.businessNumber === "890561467"));
  check("listClaimsByBN excludes other BNs", (await rapRepo.listClaimsByBN("710477720")).length === 1);
  process.exit(fail ? 1 : 0);
}
main();
