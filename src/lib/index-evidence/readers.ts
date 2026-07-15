// Concrete EvidenceDeps: fans out by BN across the RAP domain (claims + projection)
// and the economic-flow repo (Coverage). Deps point UP into this module; the
// commitments and RAP domains never import each other. `makeEvidenceDeps` takes the
// repo functions injected so it's unit-testable; `evidenceDeps` wires the real repos.
import { rapRepo } from "@/lib/rap";
import { orgIdForBN } from "@/lib/rap/stage-extraction";
import { repo } from "@/lib/repo";
import type { EvidenceDeps } from "./resolver";
import type { OrgClaim } from "@/lib/rap/types";
import type { Coverage } from "@/lib/repo/types";

export interface EvidenceRepos {
  listClaimsByBN(bn: string): Promise<OrgClaim[]>;
  getCoverage(companyId: string): Promise<Coverage>;
  listRapsByOrg(orgId: string): Promise<{ id: string }[]>;
  listCommitmentsByRap(rapId: string): Promise<{ id: string }[]>;
  getRollup(commitId: string): Promise<{ latestStatus: import("@/lib/rap/types").ProgressStatus } | null>;
}

export function makeEvidenceDeps(r: EvidenceRepos): EvidenceDeps {
  return {
    async optedInBN(bn) {
      return (await r.listClaimsByBN(bn)).some((c) => c.status === "granted" && c.showcaseOptIn === true);
    },
    async confirmedProcurement(bn) {
      const parties = await r.listClaimsByBN(bn);
      let sum = 0;
      for (const c of parties) sum += (await r.getCoverage(c.partyId)).byFlow.procurement.confirmed;
      return sum;
    },
    async projectedRows(bn) {
      const raps = await r.listRapsByOrg(orgIdForBN(bn));
      const rows: { commitmentId: string; latestStatus: import("@/lib/rap/types").ProgressStatus }[] = [];
      for (const rap of raps) {
        for (const c of await r.listCommitmentsByRap(rap.id)) {
          const roll = await r.getRollup(c.id);
          rows.push({ commitmentId: c.id, latestStatus: roll?.latestStatus ?? "not_started" });
        }
      }
      return rows;
    },
  };
}

export const evidenceDeps: EvidenceDeps = makeEvidenceDeps({
  listClaimsByBN: (bn) => rapRepo.listClaimsByBN(bn),
  getCoverage: (id) => repo.getCoverage(id),
  listRapsByOrg: (orgId) => rapRepo.listRapsByOrg(orgId),
  listCommitmentsByRap: (rapId) => rapRepo.listCommitmentsByRap(rapId),
  getRollup: (commitId) => rapRepo.getRollup(commitId),
});
