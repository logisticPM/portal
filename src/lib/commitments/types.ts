// THE COMMITMENTS SEAM — the frontend imports `commitmentsRepo` + these types,
// never DynamoDB. A "commitment" is a RAP commitment an organization has made;
// each carries its own sector / org-size / type (denormalized) so the dashboard
// is pure scan-and-reduce, and a `history` of period snapshots for progress over time.

export type Sector =
  | "finance"
  | "mining"
  | "energy"
  | "consulting"
  | "retail"
  | "health"
  | "government"
  | "education"
  | "transport";

export type OrgSize = "small" | "medium" | "large" | "enterprise"; // bucketed from employee count

export type CommitmentType =
  | "employment"
  | "procurement"
  | "cultural_learning"
  | "governance"
  | "relationships"
  | "anti_racism";

export type CommitmentStatus = "committed" | "in_progress" | "reported" | "confirmed" | "stalled";

export type RapType = "reflect" | "innovate" | "stretch" | "elevate";

export interface ProgressPoint {
  period: string; // reporting period, e.g. "2024"
  status: CommitmentStatus;
  progressPct: number; // 0–100
}

export interface Commitment {
  id: string;
  orgName: string;
  orgId?: string; // optional link to a survey Organization
  sector: Sector;
  orgSize: OrgSize;
  type: CommitmentType;
  title: string;
  targetYear: number;
  rapType?: RapType;
  status: CommitmentStatus; // current snapshot (= last history point)
  progressPct: number; // current %
  history: ProgressPoint[]; // chronological progress over time
  createdAt: string;
  // Provenance for externally-sourced commitments (e.g. a company's public
  // ESG / reconciliation report). Present ⇒ self-reported, not portal-confirmed.
  source?: { label: string; url: string };
}

export interface CommitmentFilter {
  sector?: Sector;
  orgSize?: OrgSize;
  type?: CommitmentType;
  status?: CommitmentStatus;
  orgId?: string; // a company's own commitments (portal-submitted)
}

// Fields a company edits on an existing commitment (self-report, capped at
// "reported" in the UI — never "confirmed", which is the portal's layer).
export type CommitmentPatch = Partial<
  Pick<Commitment, "title" | "targetYear" | "status" | "progressPct" | "history">
>;

export interface GroupStat {
  count: number;
  avgProgress: number;
}

export interface PeriodStat {
  period: string;
  byStatus: Record<CommitmentStatus, number>;
  avgProgress: number;
}

export interface CommitmentSummary {
  total: number;
  orgCount: number;
  avgProgress: number;
  confirmedPct: number; // % of commitments currently confirmed
  bySector: Record<string, GroupStat>;
  bySize: Record<string, GroupStat>;
  byType: Record<string, GroupStat>;
  byRapType: Record<string, GroupStat>; // by RAP maturity (reflect/innovate/stretch/elevate)
  matrix: Record<string, Record<string, number>>; // sector → type → count (heatmap)
  overTime: PeriodStat[]; // progress tracking over time
}

export interface CommitmentRepo {
  listCommitments(filter?: CommitmentFilter): Promise<Commitment[]>;
  getCommitment(id: string): Promise<Commitment | null>;
  getSummary(filter?: CommitmentFilter): Promise<CommitmentSummary>;
  // writes (company self-submission)
  createCommitment(c: Commitment): Promise<Commitment>;
  updateCommitment(id: string, patch: CommitmentPatch): Promise<Commitment | null>;
  deleteCommitment(id: string): Promise<void>;
}
