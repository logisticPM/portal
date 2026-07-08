// THE RAP SEAM — what the frontend / server actions import. Callers use
// `extractionRepo` (Idea 1 pipeline + review queue) and `rapRepo` (Idea 2
// canonical entities/dashboard) and never see DynamoDB or Bedrock. Flip the
// backend with REPO_IMPL=dynamo (default = in-memory mocks, so the upload UI,
// review UI, and dashboard can all be built without a database or live AI).
import type { ExtractionRepo, RapRepo } from "./types";
import { mockExtractionRepo, mockRapRepo } from "./repo.mock";
import { dynamoExtractionRepo, dynamoRapRepo } from "./repo.dynamo";

const useDynamo = process.env.REPO_IMPL === "dynamo";

export const extractionRepo: ExtractionRepo = useDynamo ? dynamoExtractionRepo : mockExtractionRepo;
export const rapRepo: RapRepo = useDynamo ? dynamoRapRepo : mockRapRepo;

// re-export the types the frontend will need for props/state
export type {
  // extraction (Idea 1)
  ExtractionJob,
  ExtractionStatus,
  ExtractionResult,
  ExtractedRap,
  ExtractedCommitment,
  Grounded,
  RapClassification,
  ValidationIssue,
  FieldVerdict,
  // canonical (Idea 2)
  RapOrganization,
  RapDocument,
  Commitment,
  Observation,
  CommitmentRollup,
  ProgressStatus,
  ClaimBasis,
  Provenance,
  // enums
  Sector,
  Pillar,
  CommitmentType,
  RapType,
  Jurisdiction,
} from "./types";
export { RAP_SCHEMA_VERSION } from "./types";
