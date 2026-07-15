import { mockCommitmentsRepo } from "../src/lib/commitments/repo.mock";
import type { Commitment } from "../src/lib/commitments/types";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); ok ? pass++ : fail++; };

function make(id: string, bn?: string): Commitment {
  return {
    id, orgName: "Test Org", sector: "finance", orgSize: "large", type: "procurement",
    title: id, targetYear: 2027, status: "committed", progressPct: 0,
    history: [{ period: "2026", status: "committed", progressPct: 0 }],
    createdAt: "2026-01-01T00:00:00.000Z", businessNumber: bn,
  };
}

async function main() {
  await mockCommitmentsRepo.createCommitment(make("cm-a", "123456782"));
  await mockCommitmentsRepo.createCommitment(make("cm-b", "100000009"));
  await mockCommitmentsRepo.createCommitment(make("cm-c")); // no BN

  const byBn = await mockCommitmentsRepo.listCommitments({ businessNumber: "123456782" });
  check("filters by businessNumber", byBn.length === 1 && byBn[0].id === "cm-a");

  const all = await mockCommitmentsRepo.listCommitments();
  check("no filter returns all (incl. BN-less)", all.some((c) => c.id === "cm-c") && all.length >= 3);

  process.exit(fail ? 1 : 0);
}
main();
