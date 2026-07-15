import { resolveOrgForParty, listCommitmentsForBNs } from "../src/lib/identity";
import type { ClaimReader } from "../src/lib/identity/claim-reader";
import { mockCommitmentsRepo } from "../src/lib/commitments/repo.mock";
import type { Commitment } from "../src/lib/commitments/types";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); ok ? pass++ : fail++; };

const fakeReader: ClaimReader = {
  async listGrantedBNs(partyId) { return partyId === "c-northway" ? ["123456782"] : []; },
};

function make(id: string, bn?: string): Commitment {
  return { id, orgName: "Northway", sector: "finance", orgSize: "large", type: "procurement",
    title: id, targetYear: 2027, status: "committed", progressPct: 0,
    history: [{ period: "2026", status: "committed", progressPct: 0 }],
    createdAt: "2026-01-01T00:00:00.000Z", businessNumber: bn };
}

async function main() {
  const r1 = await resolveOrgForParty("c-northway", fakeReader);
  check("resolves granted BNs", r1.bns.length === 1 && r1.bns[0] === "123456782");
  const r2 = await resolveOrgForParty("c-nobody", fakeReader);
  check("no claim ⇒ empty", r2.bns.length === 0);

  await mockCommitmentsRepo.createCommitment(make("cm-x", "123456782"));
  await mockCommitmentsRepo.createCommitment(make("cm-y")); // no BN
  const rows = await listCommitmentsForBNs(["123456782"], mockCommitmentsRepo);
  check("fans out commitments by BN", rows.length === 1 && rows[0].id === "cm-x");
  const none = await listCommitmentsForBNs([], mockCommitmentsRepo);
  check("empty BN list ⇒ no reads, empty result", none.length === 0);

  process.exit(fail ? 1 : 0);
}
main();
