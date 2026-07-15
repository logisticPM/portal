import type { Commitment, CommitmentStatus } from "@/lib/commitments/types";
import type { ProgressStatus } from "@/lib/rap/types";
import { rapStatusToDisplay } from "./status-map";

export type EvidenceTier = "confirmed" | "research" | "self_reported";

export interface EvidenceRow {
  commitmentId: string;
  tier: EvidenceTier;
  displayStatus: CommitmentStatus;
  ranks: boolean;                          // counts toward headline avgProgress + leaderboard
  provenance: "research" | "company_uploaded";
  confirmedAmount?: number;                // org confirmed procurement $ (confirmed tier only)
}

export interface EvidenceDeps {
  optedInBN(bn: string): Promise<boolean>;                                        // any granted claim on bn has showcaseOptIn
  confirmedProcurement(bn: string): Promise<number>;                             // Σ Coverage.byFlow.procurement.confirmed over parties claiming bn
  projectedRows(bn: string): Promise<{ commitmentId: string; latestStatus: ProgressStatus }[]>; // RapData commitments for org-bn-<bn>
}

// Resolve one org's commitments-domain rows into evidence rows, plus (when opted in)
// its projected self-reported RapData rows. Pure: all I/O is injected.
export async function resolveOrgEvidence(orgRows: Commitment[], deps: EvidenceDeps): Promise<EvidenceRow[]> {
  const bn = orgRows.find((r) => r.businessNumber)?.businessNumber;
  const confirmedSpend = bn ? await deps.confirmedProcurement(bn) : 0;

  const out: EvidenceRow[] = orgRows.map((r) => {
    const confirmed = r.type === "procurement" && confirmedSpend > 0;
    return {
      commitmentId: r.id,
      tier: confirmed ? "confirmed" : "research",
      displayStatus: confirmed ? ("confirmed" as CommitmentStatus) : r.status,
      ranks: true,
      provenance: "research",
      ...(confirmed ? { confirmedAmount: confirmedSpend } : {}),
    };
  });

  if (bn && (await deps.optedInBN(bn))) {
    for (const p of await deps.projectedRows(bn)) {
      out.push({
        commitmentId: p.commitmentId,
        tier: "self_reported",
        displayStatus: rapStatusToDisplay(p.latestStatus),
        ranks: false,
        provenance: "company_uploaded",
      });
    }
  }
  return out;
}
