import type { Commitment, CommitmentStatus, OrgSize } from "@/lib/commitments";
import type { Fact } from "@/lib/rap/analytics";

const SIZE_BAND: Record<OrgSize, Fact["sizeBand"]> = {
  small: "lt_50", medium: "50_249", large: "250_999", enterprise: "1000_plus",
};
const STATUS: Record<CommitmentStatus, Fact["status"]> = {
  committed: "not_started", in_progress: "on_track", reported: "met", confirmed: "met", stalled: "delayed",
};

// Map a commitments-domain Commitment onto the Explore Fact shape. Fields the
// commitments domain doesn't carry (pillar, claimBasis, region, jurisdiction)
// take honest defaults and read as degenerate dimensions in Explore until the
// RAP_INDEX_SOURCE flag flips to the (grounded) rap domain.
export function commitmentsToFacts(commitments: Commitment[]): Fact[] {
  return commitments.map((c) => ({
    commitId: c.id,
    action: c.title,
    deliverable: c.detail ?? "",
    orgId: c.orgId ?? c.orgName,
    orgName: c.orgName,
    sector: c.sector as Fact["sector"],
    sizeBand: SIZE_BAND[c.orgSize] ?? "unknown",
    region: "—",
    jurisdiction: "CA" as Fact["jurisdiction"],
    rapId: c.id,
    rapTitle: c.title,
    pillar: "other" as Fact["pillar"],
    commitmentType: c.type as Fact["commitmentType"],
    claimBasis: "self_reported",
    status: STATUS[c.status] ?? "not_started",
    percentComplete: c.progressPct,
    targetText: c.targetText ?? null,
    targetValue: null,
    targetUnit: "none",
    dueDate: c.targetYear ? `${c.targetYear}-12-31` : null,
    confidence: 1,
  }));
}
