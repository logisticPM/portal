import { resolveOrgEvidence, type EvidenceDeps } from "../src/lib/index-evidence";
import type { Commitment } from "../src/lib/commitments/types";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); ok ? pass++ : fail++; };
const row = (id: string, o: Partial<Commitment> = {}): Commitment => ({
  id, orgName: "Acme", businessNumber: "890561467", sector: "mining", orgSize: "large",
  type: "procurement", title: id, targetYear: 2027, status: "reported", progressPct: 50,
  history: [{ period: "2026", status: "reported", progressPct: 50 }], createdAt: "2026-01-01T00:00:00.000Z", ...o,
});
const deps = (o: Partial<EvidenceDeps> = {}): EvidenceDeps => ({
  optedInBN: async () => false, confirmedProcurement: async () => 0, projectedRows: async () => [], ...o,
});

async function main() {
  // research baseline
  const base = await resolveOrgEvidence([row("c1")], deps());
  check("research tier, ranks, provenance", base.length === 1 && base[0].tier === "research" && base[0].ranks && base[0].provenance === "research");

  // confirmation bridge: procurement + confirmed spend → confirmed tier, carries $
  const conf = await resolveOrgEvidence([row("c1")], deps({ confirmedProcurement: async () => 3_000_000 }));
  check("procurement + confirmed spend → confirmed tier w/ amount", conf[0].tier === "confirmed" && conf[0].displayStatus === "confirmed" && conf[0].confirmedAmount === 3_000_000 && conf[0].ranks);

  // non-procurement never confirmed by the bridge
  const emp = await resolveOrgEvidence([row("c2", { type: "employment" })], deps({ confirmedProcurement: async () => 3_000_000 }));
  check("non-procurement stays research despite confirmed spend", emp[0].tier === "research");

  // opted-in projection → self-reported, non-ranking, badged
  const proj = await resolveOrgEvidence([row("c1")], deps({ optedInBN: async () => true, projectedRows: async () => [{ commitmentId: "rap-x", latestStatus: "on_track" }] }));
  const self = proj.find((r) => r.commitmentId === "rap-x")!;
  check("projected row is self_reported + non-ranking + company_uploaded", self.tier === "self_reported" && self.ranks === false && self.provenance === "company_uploaded");
  check("projected displayStatus mapped (on_track→in_progress)", self.displayStatus === "in_progress");
  check("opted-out org emits no projected rows", (await resolveOrgEvidence([row("c1")], deps({ optedInBN: async () => false, projectedRows: async () => [{ commitmentId: "rap-x", latestStatus: "on_track" }] }))).every((r) => r.tier !== "self_reported"));

  // no BN on the org → no confirmed, no projection
  const noBn = await resolveOrgEvidence([row("c1", { businessNumber: undefined })], deps({ confirmedProcurement: async () => 9, optedInBN: async () => true, projectedRows: async () => [{ commitmentId: "rap-x", latestStatus: "met" }] }));
  check("no BN ⇒ research-only, no bridge, no projection", noBn.length === 1 && noBn[0].tier === "research");
  process.exit(fail ? 1 : 0);
}
main();
