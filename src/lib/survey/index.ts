// THE SURVEY SEAM — what the frontend imports. Frontend calls `surveyRepo`
// methods and never sees DynamoDB. Flip the backend with REPO_IMPL=dynamo
// (default = in-memory mock, so survey pages can be built without a database).
import type { SurveyRepo } from "./types";
import { mockSurveyRepo } from "./repo.mock";
import { dynamoSurveyRepo } from "./repo.dynamo";

export const surveyRepo: SurveyRepo =
  process.env.REPO_IMPL === "dynamo" ? dynamoSurveyRepo : mockSurveyRepo;

// re-export the types frontend will need for props/state
export type {
  Organization,
  SurveyResponse,
  SurveyRepo,
  Industry,
  RapType,
  Likert,
  Rating1to5,
} from "./types";
