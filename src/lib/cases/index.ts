// THE CASES SEAM — what the frontend imports. Flip to DynamoDB with REPO_IMPL=dynamo
// (the dynamo branch is wired in Task 6; default = in-memory mock).
import type { CaseRepo } from "./types";
import { mockCaseRepo } from "./repo.mock";

export const casesRepo: CaseRepo = mockCaseRepo;

export type {
  LegalCase, CaseRepo, CaseFilter, Facets, ActivationSummary,
  CitationGraph, CaseExportBundle, Theme, CourtLevel, WinType, RealizationStatus,
} from "./types";
