// scripts/test-rap-claim.ts
import assert from "node:assert/strict";
import { rapRepo } from "../src/lib/rap/index";
import { claimOrgForParty } from "../src/lib/rap/actions-core";
import { StubRegistryProvider } from "../src/lib/rap/registry";

async function main() {
  const reg = new StubRegistryProvider({
    "119653384": {
      businessNumber: "119653384",
      legalName: "ENBRIDGE INC.",
      status: "Active",
      jurisdiction: "CA-federal",
      officeLocation: null,
      source: "ised",
    },
  });

  assert.equal(
    (await claimOrgForParty(reg, { partyId: "p1", bnRaw: "119653384", attested: false })).ok,
    false,
    "must attest",
  );
  const ok = await claimOrgForParty(reg, { partyId: "p1", bnRaw: "119653384RC0001", attested: true });
  assert.equal(ok.ok, true);
  const claim = await rapRepo.getClaim("119653384", "p1");
  assert.equal(claim?.status, "granted");
  assert.deepEqual(
    (await rapRepo.listClaimsByParty("p1")).map((c) => c.businessNumber),
    ["119653384"],
  );
  console.log("OK test-rap-claim");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
