// ===========================================================================
// Single-table marshalling for Opportunity (its own `Alignment` table).
//   AP-company:  PK=OPPORTUNITY#<orgId>  SK=SCORE#<pad>#<id>   (a company's, ranked)
//   AP-radar:    GSI1PK=OPPORTUNITY      GSI1SK=SCORE#<pad>#<id> (global, ranked)
// Score is zero-padded so lexicographic SK order == descending score.
// ===========================================================================
import type { Opportunity } from "../alignment/types";

export const ALIGNMENT_TABLE = process.env.ALIGNMENT_TABLE ?? "Alignment";
export const GSI1 = "GSI1"; // global ranked radar

// e.g. 0.823 -> "08230" so lexicographic order tracks numeric; query descending.
const padScore = (score: number) => String(Math.round(score * 10000)).padStart(5, "0");

export const opportunityKeys = {
  profile: (orgId: string, score: number, id: string) => ({
    PK: `OPPORTUNITY#${orgId}`,
    SK: `SCORE#${padScore(score)}#${id}`,
  }),
};

export function toOpportunityItem(o: Opportunity) {
  return {
    ...opportunityKeys.profile(o.orgId, o.score, o.id),
    et: "Opportunity",
    GSI1PK: "OPPORTUNITY",
    GSI1SK: `SCORE#${padScore(o.score)}#${o.id}`,
    data: o, // store the full domain object
  };
}

export function itemToOpportunity(it: any): Opportunity {
  const d = it.data as Opportunity;
  return {
    id: d.id,
    commitmentId: d.commitmentId,
    orgId: d.orgId,
    supplierId: d.supplierId,
    supplierName: d.supplierName,
    commitmentTitle: d.commitmentTitle,
    score: d.score,
    reasons: {
      sectorMatch: d.reasons.sectorMatch,
      regionMatch: d.reasons.regionMatch,
      identityTier: d.reasons.identityTier,
      semantic: d.reasons.semantic,
    },
    ...(d.rationale !== undefined ? { rationale: d.rationale } : {}),
    status: d.status,
    createdAt: d.createdAt,
  };
}
