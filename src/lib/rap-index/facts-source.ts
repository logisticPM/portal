import type { Fact } from "@/lib/rap/analytics";
import { buildFacts } from "@/lib/rap/analytics";
import { commitmentsToFacts } from "./commitments-to-facts";
import { commitmentsRepo } from "@/lib/commitments";
import { rapRepo } from "@/lib/rap";
import type { Sector } from "@/lib/rap";

const RAP_SECTORS: Sector[] = [
  "mining_extractive", "finance_banking", "telecom", "energy", "government", "retail", "transport", "other",
];

// Explore reads its facts through this seam; the Table page (/commitments/page.tsx)
// reads the commitments domain directly today. Both show the same domain now — the
// flag default keeps Explore on the seeded commitments domain — and
// RAP_INDEX_SOURCE governs Explore's source; flip it to "rap" at the
// corpus-plan cutover (docs/rap-index-grounded-corpus-plan.md). A full cutover
// will also need the Table page to move onto this seam.
export async function getIndexFacts(): Promise<Fact[]> {
  if (process.env.RAP_INDEX_SOURCE === "rap") {
    const perSector = await Promise.all(RAP_SECTORS.map((s) => rapRepo.listCommitmentsBySector(s)));
    const commitments = perSector.flat();
    const orgIds = [...new Set(commitments.map((c) => c.orgId))];
    const rapIds = [...new Set(commitments.map((c) => c.rapId))];
    const [orgs, raps, rollups] = await Promise.all([
      Promise.all(orgIds.map((id) => rapRepo.getOrganization(id))),
      Promise.all(rapIds.map((id) => rapRepo.getRap(id))),
      Promise.all(commitments.map((c) => rapRepo.getRollup(c.id))),
    ]);
    const orgById = new Map(orgs.filter(Boolean).map((o) => [o!.id, o!]));
    const rapById = new Map(raps.filter(Boolean).map((r) => [r!.id, r!]));
    const rollupById = new Map(rollups.filter(Boolean).map((r) => [r!.commitId, r!]));
    return buildFacts(commitments, orgById, rapById, rollupById);
  }
  return commitmentsToFacts(await commitmentsRepo.listCommitments());
}
