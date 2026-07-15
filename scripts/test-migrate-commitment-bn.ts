import { planCommitmentBN } from "./migrate-commitment-bn";
import type { Commitment } from "../src/lib/commitments/types";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); ok ? pass++ : fail++; };

function make(over: Partial<Commitment>): Commitment {
  return { id: "cm", orgName: "Cameco", sector: "mining", orgSize: "large",
    type: "procurement", title: "t", targetYear: 2027, status: "committed", progressPct: 0,
    history: [{ period: "2026", status: "committed", progressPct: 0 }],
    createdAt: "2026-01-01T00:00:00.000Z", ...over };
}

async function main() {
  // Cameco's real curated BN (Corporations Canada, CAMECO CORPORATION corp 332981-0)
  const CAMECO_BN = "890561467";
  const mapped = planCommitmentBN(make({}));
  check("sets BN for a mapped org", mapped?.businessNumber === CAMECO_BN);
  check("stamps public-research authorship on existing history",
    mapped?.history.every((h) => h.authoredBy === "public-research") === true);

  const already = planCommitmentBN(make({ businessNumber: CAMECO_BN,
    history: [{ period: "2026", status: "committed", progressPct: 0, authoredBy: "public-research" }] }));
  check("idempotent: already-migrated row ⇒ null", already === null);

  const unmapped = planCommitmentBN(make({ orgName: "Totally Unmapped Org 9Z" }));
  check("unmapped org ⇒ null (untouched)", unmapped === null);

  process.exit(fail ? 1 : 0);
}
main();
