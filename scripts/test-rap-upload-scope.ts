// Verifies uploadBNForSession: a company session with exactly one granted
// OrgClaim gets its BN auto-tagged on upload (so it isn't re-resolved at
// review); staff sessions, claim-less companies, and companies with multiple
// claims (ambiguous) all leave the BN null (resolved at review as before).
//
// Run: npx tsx scripts/test-rap-upload-scope.ts   (mock repo, no AWS needed)
import assert from "node:assert/strict";
import { rapRepo } from "../src/lib/rap/index";
import { uploadBNForSession } from "../src/lib/rap/actions-core";
import type { Session } from "../src/lib/auth";

(async () => {
  // Company session, exactly one granted claim → auto-tag.
  await rapRepo.putClaim({ businessNumber: "119653384", partyId: "p-one-claim", status: "granted", attestedAt: "t", grantedBy: "test" });
  const oneClaimSession: Session = { kind: "company", partyId: "p-one-claim" };
  const tagged = await uploadBNForSession(oneClaimSession);
  assert.deepEqual(tagged, { businessNumber: "119653384", businessNumberSource: "ised" }, "single granted claim auto-tags BN");

  // Staff session → null (resolved at review as before).
  const staffSession: Session = { kind: "indigenomics" };
  assert.equal(await uploadBNForSession(staffSession), null, "staff session leaves BN null");

  // Company session, no claim → null.
  const noClaimSession: Session = { kind: "company", partyId: "p-no-claim" };
  assert.equal(await uploadBNForSession(noClaimSession), null, "claim-less company leaves BN null");

  // Company session, TWO granted claims → ambiguous → null.
  await rapRepo.putClaim({ businessNumber: "119653384", partyId: "p-two-claims", status: "granted", attestedAt: "t", grantedBy: "test" });
  await rapRepo.putClaim({ businessNumber: "204770458", partyId: "p-two-claims", status: "granted", attestedAt: "t", grantedBy: "test" });
  const twoClaimSession: Session = { kind: "company", partyId: "p-two-claims" };
  assert.equal(await uploadBNForSession(twoClaimSession), null, "ambiguous (multiple claims) leaves BN null");

  // No session → null.
  assert.equal(await uploadBNForSession(null), null, "no session leaves BN null");

  console.log("OK test-rap-upload-scope");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
