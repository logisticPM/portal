import type { CaseRepo } from "./types";
import { mockCaseRepo } from "./repo.mock";
import { dynamoCaseRepo } from "./repo.dynamo";

export const casesRepo: CaseRepo =
  process.env.REPO_IMPL === "dynamo" ? dynamoCaseRepo : mockCaseRepo;

export type {
  LegalCase, CaseRepo, CaseFilter, Facets, ActivationSummary,
  CitationGraph, CaseExportBundle, Theme, CourtLevel, WinType, CorpusTier, RealizationStatus,
  CaseChunk, SituationInput, SimilarityBreakdown, ScoredCase,
} from "./types";
