// The shared identity seam's read boundary. The OrgClaim store stays in the RAP
// repo (v1); this narrow interface is what both domains depend on, so neither
// imports the other directly.
import { rapRepo } from "@/lib/rap";

export interface ClaimReader {
  listGrantedBNs(partyId: string): Promise<string[]>;
}

export const rapClaimReader: ClaimReader = {
  async listGrantedBNs(partyId: string): Promise<string[]> {
    const claims = await rapRepo.listClaimsByParty(partyId);
    return claims.filter((c) => c.status === "granted").map((c) => c.businessNumber);
  },
};
