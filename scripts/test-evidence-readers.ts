import { makeEvidenceDeps } from "../src/lib/index-evidence/readers";
let pass = 0, fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); ok ? pass++ : fail++; };

async function main() {
  const deps = makeEvidenceDeps({
    listClaimsByBN: async (bn) => bn === "890561467"
      ? [{ businessNumber: bn, partyId: "c-a", status: "granted", attestedAt: "", grantedBy: "", showcaseOptIn: true },
         { businessNumber: bn, partyId: "c-b", status: "granted", attestedAt: "", grantedBy: "" }]
      : [],
    getCoverage: async (pid) => ({ companyId: pid, byFlow: { procurement: { reported: 0, confirmed: pid === "c-a" ? 1_000_000 : 500_000 }, capital: { reported: 0, confirmed: 0 } }, totalReported: 0, totalConfirmed: 0, confirmedPct: 0 }),
    listRapsByOrg: async () => [{ id: "rap-1" } as any],
    listCommitmentsByRap: async () => [{ id: "rc-1" } as any],
    getRollup: async () => ({ commitId: "rc-1", latestStatus: "on_track", percentComplete: 40 } as any),
  });

  check("optedInBN true when any granted claim opted in", (await deps.optedInBN("890561467")) === true);
  check("optedInBN false for unclaimed BN", (await deps.optedInBN("000000000")) === false);
  check("confirmedProcurement sums across parties on the BN", (await deps.confirmedProcurement("890561467")) === 1_500_000);
  const proj = await deps.projectedRows("890561467");
  check("projectedRows maps RapData commit → {commitmentId, latestStatus}", proj.length === 1 && proj[0].commitmentId === "rc-1" && proj[0].latestStatus === "on_track");
  process.exit(fail ? 1 : 0);
}
main();
