// Regression test for the Dynamo read path: itemToCommitment must reconstruct
// every field toCommitmentItem stored, including businessNumber and
// history[].authoredBy. The in-memory mock repo never exercises this
// serialize/deserialize step, so a schema field can round-trip fine in the
// mock repo test (test-commitment-schema.ts) while being silently dropped by
// the real Dynamo item mapping. This test drives toCommitmentItem +
// itemToCommitment directly to catch that class of bug.
import { toCommitmentItem, itemToCommitment } from "../src/lib/dynamo/commitments-table";
import type { Commitment } from "../src/lib/commitments/types";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); ok ? pass++ : fail++; };

function make(): Commitment {
  return {
    id: "cm-roundtrip", orgName: "Test Org", sector: "finance", orgSize: "large", type: "procurement",
    title: "cm-roundtrip", targetYear: 2027, status: "committed", progressPct: 0,
    history: [{ period: "2026", status: "committed", progressPct: 0, authoredBy: "public-research" }],
    createdAt: "2026-01-01T00:00:00.000Z", businessNumber: "123456782",
  };
}

async function main() {
  const original = make();
  const item = toCommitmentItem(original);
  const roundTripped = itemToCommitment(item);

  check("businessNumber survives the Dynamo item round-trip", roundTripped.businessNumber === "123456782");
  check("history[0].authoredBy survives the Dynamo item round-trip", roundTripped.history[0].authoredBy === "public-research");

  process.exit(fail ? 1 : 0);
}
main();
