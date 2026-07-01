// THE CASES SEAM — the ONLY file the frontend shares with the data layer.
// Frontend imports `casesRepo` + these types; never DynamoDB, never A2AJ.
export type Theme =
  | "land_rights" | "resource_revenue" | "duty_to_consult"
  | "treaty" | "fiduciary" | "self_determination";

export type CourtLevel =
  | "scc" | "fca" | "fc" | "provincial_appeal" | "provincial_superior" | "tribunal";

export type OutcomeType = "precedent" | "procedural" | "remand" | "regulatory" | "settlement" | "unclassified";
export type WinType = "doctrine_win" | "party_win" | "mixed" | "loss" | "unclassified";
export type CorpusTier = "substrate" | "core";

export interface ThemeLabelMeta {
  method: "curated" | "dual_llm";
  models?: string[];
  agreement?: "full" | "partial" | "none";
  confidence: "high" | "low";
  needsReview: boolean;
}

export interface CaseOutcome {
  outcomeType: OutcomeType;
  winType: WinType;
  whoWon: string;
  holding: string; // 1–3 sentences, extractive
}

export interface EconomicDimension {
  valueType: "settlement" | "resource_revenue" | "equity" | "other";
  settlementAmount?: number; // CAD
  resourceRevenue?: number;
  equityStake?: number; // %
  economicSummary: string;
}

export type RealizationStatus = "declared" | "negotiating" | "realized" | "stalled" | "unknown";
export interface ValueRealization { status: RealizationStatus; note: string; asOf: string; }

export interface CitationAnchor { text: string; sourceParagraph: string; sourceUrl: string; }
export interface CitationAnchored { claims: CitationAnchor[]; }
export interface CaseChunk { paragraph: string; text: string; }

export type EnrichmentLevel = "index" | "deep";

export interface Provenance {
  source: "a2aj" | "official_court" | "summary_site" | "manual";
  sourceUrl: string;
  upstreamLicense: string;
  ingestedAt: string;
  unofficial: boolean;
}

export interface LegalCase {
  id: string;
  citation: string;
  citation2?: string;
  styleOfCause: string;
  court: string;
  level: CourtLevel;
  year: number;
  jurisdiction: string;
  nations: string[];
  themes: Theme[];
  outcome: CaseOutcome;
  economic?: EconomicDimension;
  valueRealization?: ValueRealization;
  summary?: CitationAnchored;
  chunks?: CaseChunk[];
  casesCited: string[];   // citation strings
  casesCiting: string[];  // citation strings
  citingCount: number;
  enrichmentLevel: EnrichmentLevel;
  corpusTier: CorpusTier;
  labelMeta?: ThemeLabelMeta;
  fullTextAvailable: boolean;
  provenance: Provenance;
  sensitivity?: string;
}

export interface CaseFilter {
  themes?: Theme[]; level?: CourtLevel; winType?: WinType;
  nation?: string; yearFrom?: number; yearTo?: number;
  tier?: CorpusTier | "all";
}
export interface Facets {
  byTheme: Partial<Record<Theme, number>>;
  byLevel: Partial<Record<CourtLevel, number>>;
  byWinType: Partial<Record<WinType, number>>;
  byNation: Record<string, number>;
}
export interface ActivationSummary {
  totalCases: number;
  byTheme: Partial<Record<Theme, number>>;
  economicValue: { settlement: number; resourceRevenue: number; equity: number };
  valueRealization: Partial<Record<RealizationStatus, number>>;
  landmarkCases: { id: string; styleOfCause: string; citingCount: number }[];
}
export interface CorpusStats {
  total: number; core: number; substrate: number; fullText: number;
  byLevel: Partial<Record<CourtLevel, number>>;
  byDecade: Record<string, number>;
}
export interface CitationGraph { cited: LegalCase[]; citing: LegalCase[]; }
export interface CaseExportBundle { cases: LegalCase[]; asOf: string; }

export interface CaseRepo {
  listCases(filter?: CaseFilter): Promise<LegalCase[]>;
  getCase(id: string): Promise<LegalCase | null>;
  searchCases(query: string, filter?: CaseFilter): Promise<LegalCase[]>;
  hybridSearch(query: string, filter?: CaseFilter): Promise<LegalCase[]>;
  listFacets(filter?: CaseFilter): Promise<Facets>;
  getActivationSummary(): Promise<ActivationSummary>;
  getCorpusStats(): Promise<CorpusStats>;
  getCitationGraph(id: string): Promise<CitationGraph>;
  exportCases(filter?: CaseFilter): Promise<CaseExportBundle>;
}
