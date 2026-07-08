import type { OpportunityRepo } from "./types";
import { mockAlignmentRepo } from "./repo.mock";
import { dynamoAlignmentRepo } from "./repo.dynamo";

export const alignmentRepo: OpportunityRepo =
  process.env.REPO_IMPL === "dynamo" ? dynamoAlignmentRepo : mockAlignmentRepo;

export type { Opportunity, OpportunityRepo, OpportunityStatus } from "./types";
export { opportunityId } from "./types";
