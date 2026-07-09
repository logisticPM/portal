import type { Commitment } from "@/lib/commitments";
import type { Fact } from "@/lib/rap/analytics";

// Map a commitments-domain Commitment onto the Explore Fact shape. Sector/type
// are already canonical (verbatim). Status + org size stay the NATIVE commitments
// vocabulary (Fact.status is CommitmentStatus, Fact.sizeBand is the canonical
// org-size union). Pillar/claimBasis/region/jurisdiction the commitments domain
// doesn't carry take honest constants and are hidden as degenerate dimensions
// in Explore (Task 7).
export function commitmentsToFacts(commitments: Commitment[]): Fact[] {
  return commitments.map((c) => ({
    commitId: c.id,
    action: c.title,
    deliverable: c.detail ?? "",
    orgId: c.orgId ?? c.orgName,
    orgName: c.orgName,
    sector: c.sector,
    sizeBand: c.orgSize,
    region: "—",
    jurisdiction: "CA",
    rapId: c.id,
    rapTitle: c.title,
    pillar: "other",
    commitmentType: c.type,
    claimBasis: "self_reported",
    status: c.status,
    percentComplete: c.progressPct,
    targetText: c.targetText ?? null,
    targetValue: null,
    targetUnit: "none",
    dueDate: c.targetYear ? `${c.targetYear}-12-31` : null,
    confidence: 1,
  }));
}
