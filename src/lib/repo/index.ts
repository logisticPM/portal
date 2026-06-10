import type { PortalRepo } from "./types";
import { mockRepo } from "./repo.mock";
import { dynamoRepo } from "./repo.dynamo";

// Flip the backend with REPO_IMPL=dynamo (default = in-memory mock).
// The UI imports `repo` and never knows which implementation is live.
export const repo: PortalRepo = process.env.REPO_IMPL === "dynamo" ? dynamoRepo : mockRepo;
