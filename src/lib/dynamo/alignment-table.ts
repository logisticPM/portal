// ===========================================================================
// Single-table marshalling for Opportunity (its own `Alignment` table).
//   AP-company:  PK=OPPORTUNITY#<orgId>  SK=OPP#<id>            (a company's, stable)
//   AP-radar:    GSI1PK=OPPORTUNITY      GSI1SK=SCORE#<pad>#<id> (global, ranked)
// Score is zero-padded so lexicographic GSI1SK order == descending score.
// Main SK is score-independent so upsert (PutItem) overwrites idempotently.
// ===========================================================================
import type { Opportunity } from "../alignment/types";

export const ALIGNMENT_TABLE = process.env.ALIGNMENT_TABLE ?? "Alignment";
export const ALIGNMENT_GSI1 = "GSI1"; // global ranked radar (index name on the Alignment table)

// e.g. 0.823 -> "08230" so lexicographic order tracks numeric; query descending.
const padScore = (score: number) => String(Math.round(score * 10000)).padStart(5, "0");

export const opportunityKeys = {
  profile: (orgId: string, id: string) => ({
    PK: `OPPORTUNITY#${orgId}`,
    SK: `OPP#${id}`,
  }),
};

export function toOpportunityItem(o: Opportunity) {
  return {
    ...opportunityKeys.profile(o.orgId, o.id),
    et: "Opportunity",
    GSI1PK: "OPPORTUNITY",
    GSI1SK: `SCORE#${padScore(o.score)}#${o.id}`,
    data: o, // store the full domain object
  };
}

// Reconstruct field-by-field (DynamoDB doesn't preserve map-key order) so
// JSON.stringify equality holds vs. the in-memory mock / test fixtures.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
