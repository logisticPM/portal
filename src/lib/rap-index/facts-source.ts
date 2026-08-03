import type { Fact } from "@/lib/rap/analytics";
import { buildFacts } from "@/lib/rap/analytics";
import { commitmentsToFacts } from "./commitments-to-facts";
import { commitmentsRepo } from "@/lib/commitments";
import { rapRepo } from "@/lib/rap";
import type { Sector } from "@/lib/rap";
import { CANONICAL_SECTORS } from "@/lib/taxonomy";

const RAP_SECTORS: Sector[] = CANONICAL_SECTORS;

// Explore reads its facts through this seam; the Table page (/commitments/page.tsx)
// reads the commitments domain directly today. RAP_INDEX_SOURCE governs Explore's
// source:
//   unset / anything else → seeded commitments demo domain only (default)
//   "rap"                  → published RAP extractions only (full cutover)
//   "merge"                → BOTH, unioned and deduped (ca + production today)
// "merge" is what ships on the real-extraction stages: it keeps the seeded
// showcase data rich while approved extractions appear as they're confirmed, so
// Explore never empties even when few RAPs have been reviewed. See
// docs/rap-index-grounded-corpus-plan.md. A full "rap" cutover would also need
// the Table page to move onto this seam.
export async function getIndexFacts(): Promise<Fact[]> {
  const source = process.env.RAP_INDEX_SOURCE;

  const seeded = source === "rap" ? [] : commitmentsToFacts(await commitmentsRepo.listCommitments());
  const extracted = source === "rap" || source === "merge" ? await getRapFacts() : [];

  if (extracted.length === 0) return seeded;
  if (seeded.length === 0) return extracted;

  // Union, deduped by commitId. The two domains use disjoint id namespaces
  // (COMMIT#… vs the seeded ids) so collisions are not expected, but dedup
  // defensively; a real published extraction wins over a seeded row.
  const byId = new Map<string, Fact>();
  for (const f of seeded) byId.set(f.commitId, f);
  for (const f of extracted) byId.set(f.commitId, f);
  return [...byId.values()];
}

// The published-extraction facts: every canonical Commitment (queried per sector
// off GSI2), joined with its org, RAP header, and rollup. Extracted from the
// former "rap" branch so both "rap" and "merge" reuse it.
async function getRapFacts(): Promise<Fact[]> {
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
