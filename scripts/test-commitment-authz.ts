import { updateCommitmentCore } from "../src/lib/commitments/actions-core";
import type { Commitment } from "../src/lib/commitments/types";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); ok ? pass++ : fail++; };

function seed(over: Partial<Commitment> = {}): Commitment {
  return { id: "cm-1", orgName: "Northway", sector: "finance", orgSize: "large", type: "procurement",
    title: "seeded", targetYear: 2027, status: "committed", progressPct: 0,
    history: [{ period: "2025", status: "committed", progressPct: 0, authoredBy: "public-research" }],
    createdAt: "2026-01-01T00:00:00.000Z", businessNumber: "123456782", ...over };
}

function deps(cur: Commitment | null, orgId: string, claimedBNs: string[]) {
  let saved: { id: string; patch: any } | null = null;
  return {
    d: {
      getCommitment: async (_id: string) => cur,
      updateCommitment: async (id: string, patch: any) => { saved = { id, patch }; return { ...(cur as Commitment), ...patch }; },
      orgId, claimedBNs: new Set(claimedBNs), now: "2026-07-15T00:00:00.000Z",
    },
    saved: () => saved,
  };
}

async function main() {
  // 1. claimed-BN owner may update a seeded row (orgId mismatch, BN match)
  const a = deps(seed(), "c-northway", ["123456782"]);
  const r1 = await updateCommitmentCore(a.d, { id: "cm-1", status: "reported", progressPct: 40 });
  check("claimed-BN owner may update seeded row", r1.ok === true);
  check("stamps authoredBy = partyId on the new point",
    a.saved()?.patch.history.at(-1).authoredBy === "c-northway");
  check("appends a fresh point for the current year",
    a.saved()?.patch.history.length === 2 && a.saved()?.patch.history.at(-1).period === "2026");

  // 2. party without a claim on the BN is rejected
  const b = deps(seed(), "c-someoneelse", []);
  const r2 = await updateCommitmentCore(b.d, { id: "cm-1", status: "reported", progressPct: 90 });
  check("no claim on the BN ⇒ rejected", r2.ok === false && b.saved() === null);

  // 3. self-created row owned by partyId (no BN) still works
  const c = deps(seed({ businessNumber: undefined, orgId: "c-self" }), "c-self", []);
  const r3 = await updateCommitmentCore(c.d, { id: "cm-1", status: "in_progress", progressPct: 10 });
  check("partyId owner still works", r3.ok === true);

  // 4. status above the submittable cap is rejected
  const d = deps(seed(), "c-northway", ["123456782"]);
  const r4 = await updateCommitmentCore(d.d, { id: "cm-1", status: "confirmed" as any, progressPct: 100 });
  check("status past 'reported' cap rejected", r4.ok === false && d.saved() === null);

  process.exit(fail ? 1 : 0);
}
main();
