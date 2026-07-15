import { orgConfirmedPct } from "../src/lib/commitments/orgs";
import type { EvidenceRow } from "../src/lib/index-evidence";
let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); ok ? pass++ : fail++; };
const rows = (...t: [string, EvidenceRow["tier"], string][]): EvidenceRow[] =>
  t.map(([id, tier, type]) => ({ commitmentId: id, tier, displayStatus: "reported", ranks: tier !== "self_reported", provenance: "research", _type: type } as any));

async function main() {
  // confirmable denominator = procurement rows among ranking rows
  const procTypes = new Set(["p1", "p2"]);
  const evidence = rows(["p1", "confirmed", "procurement"], ["p2", "research", "procurement"], ["e1", "research", "employment"]);
  check("confirmedPct = confirmed / confirmable(procurement)", orgConfirmedPct(evidence, procTypes) === 50);
  check("no confirmable procurement ⇒ 0 (not NaN)", orgConfirmedPct(rows(["e1", "research", "employment"]), new Set()) === 0);
  check("self-reported rows never count", orgConfirmedPct(rows(["s1", "self_reported", "procurement"]), new Set()) === 0);
  process.exit(fail ? 1 : 0);
}
main();
