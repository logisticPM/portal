// Exercises the shared union helper the page calls directly (no duplicated
// logic in the test) — a real RED/GREEN gate, not a self-fulfilling mirror.
import { listCommitmentsForCompany } from "../src/lib/identity";
import { mockCommitmentsRepo } from "../src/lib/commitments/repo.mock";
import type { Commitment } from "../src/lib/commitments/types";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); ok ? pass++ : fail++; };

function make(id: string, over: Partial<Commitment>): Commitment {
  return { id, orgName: "Northway", sector: "finance", orgSize: "large", type: "procurement",
    title: id, targetYear: 2027, status: "committed", progressPct: 0,
    history: [{ period: "2026", status: "committed", progressPct: 0 }],
    createdAt: "2026-01-01T00:00:00.000Z", ...over };
}

async function main() {
  await mockCommitmentsRepo.createCommitment(make("own-1", { orgId: "c-northway" }));
  await mockCommitmentsRepo.createCommitment(make("seed-1", { businessNumber: "123456782" }));
  const rows = await listCommitmentsForCompany("c-northway", ["123456782"], mockCommitmentsRepo);
  check("union includes own + BN-matched seeded", rows.some((c) => c.id === "own-1") && rows.some((c) => c.id === "seed-1"));
  check("de-duplicates by id", new Set(rows.map((c) => c.id)).size === rows.length);

  // additive regression: no claims ⇒ own rows only, no seeded leakage in
  // (fixtures seed unrelated orgs, so use a fresh partyId not present in fixtures)
  await mockCommitmentsRepo.createCommitment(make("lonely-own-1", { orgId: "c-lonely" }));
  const noClaims = await listCommitmentsForCompany("c-lonely", [], mockCommitmentsRepo);
  check("no claims ⇒ own rows only (no regression)", noClaims.length === 1 && noClaims[0].id === "lonely-own-1");

  process.exit(fail ? 1 : 0);
}
main();
