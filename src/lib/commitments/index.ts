import type { CommitmentRepo } from "./types";
import { mockCommitmentsRepo } from "./repo.mock";
import { dynamoCommitmentsRepo } from "./repo.dynamo";

export const commitmentsRepo: CommitmentRepo =
  process.env.REPO_IMPL === "dynamo" ? dynamoCommitmentsRepo : mockCommitmentsRepo;

export { computeRisk, buildInsights } from "./insights";
export type { RiskFlag, RiskReport } from "./insights";

export type {
  Commitment,
  CommitmentRepo,
  CommitmentFilter,
  CommitmentSummary,
  Sector,
  OrgSize,
  CommitmentType,
  CommitmentStatus,
  RapType,
} from "./types";
