import type { CommitmentRepo } from "./types";
import { mockCommitmentsRepo } from "./repo.mock";
import { dynamoCommitmentsRepo } from "./repo.dynamo";

export const commitmentsRepo: CommitmentRepo =
  process.env.REPO_IMPL === "dynamo" ? dynamoCommitmentsRepo : mockCommitmentsRepo;

export type {
  Commitment,
  CommitmentRepo,
  CommitmentFilter,
  CommitmentSummary,
  Sector,
  OrgSize,
  CommitmentType,
  CommitmentStatus,
} from "./types";
