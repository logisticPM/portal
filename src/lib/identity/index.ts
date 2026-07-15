// Shared identity crosswalk. Resolves a party's granted Business Numbers and
// fans out reads by BN into each domain's own repo. Deps point UP into here;
// the commitments and RAP domains never import each other.
import { commitmentsRepo } from "@/lib/commitments";
import type { Commitment, CommitmentRepo } from "@/lib/commitments/types";
import { rapClaimReader, type ClaimReader } from "./claim-reader";

export type { ClaimReader } from "./claim-reader";
export { rapClaimReader } from "./claim-reader";

export async function resolveOrgForParty(
  partyId: string,
  reader: ClaimReader = rapClaimReader,
): Promise<{ bns: string[] }> {
  return { bns: await reader.listGrantedBNs(partyId) };
}

export async function listCommitmentsForBNs(
  bns: string[],
  repo: CommitmentRepo = commitmentsRepo,
): Promise<Commitment[]> {
  if (bns.length === 0) return [];
  const batches = await Promise.all(bns.map((bn) => repo.listCommitments({ businessNumber: bn })));
  return batches.flat();
}

// Unified company view (Task 6): a company's own self-created rows PLUS the
// seeded public commitments matching its granted Business Numbers, de-duplicated
// by id (own rows win on collision — first into the map). No claims ⇒ own rows
// only, so a company with no BN claims sees exactly what it saw before.
export async function listCommitmentsForCompany(
  partyId: string,
  bns: string[],
  repo: CommitmentRepo = commitmentsRepo,
): Promise<Commitment[]> {
  const own = (await repo.listCommitments()).filter((c) => c.orgId === partyId);
  const seeded = await listCommitmentsForBNs(bns, repo);
  const byId = new Map<string, Commitment>();
  for (const c of [...own, ...seeded]) byId.set(c.id, c);
  return [...byId.values()];
}
