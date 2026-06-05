import type { PortalRepo } from "./types";
import { mockRepo } from "./repo.mock";
// Data group: add repo.dynamo.ts and flip via REPO_IMPL=dynamo.
// import { dynamoRepo } from "./repo.dynamo";

export const repo: PortalRepo =
  // process.env.REPO_IMPL === "dynamo" ? dynamoRepo :
  mockRepo;
