import type { CommitmentRepo } from "./types";
import { mockCommitmentsRepo } from "./repo.mock";
import { dynamoCommitmentsRepo } from "./repo.dynamo";

export const commitmentsRepo: CommitmentRepo =
  process.env.REPO_IMPL === "dynamo" ? dynamoCommitmentsRepo : mockCommitmentsRepo;

export { computeRisk, buildInsights, confirmationIntegrity } from "./insights";
export type { RiskFlag, RiskReport, Integrity } from "./insights";
export { rollupOrgs, orgScorecard, slugifyOrg } from "./orgs";
export type { OrgRollup } from "./orgs";

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
