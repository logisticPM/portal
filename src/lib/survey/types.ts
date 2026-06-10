// ===========================================================================
// RAP Impact Survey — data model for the 2025 survey's 41 questions.
//
// This is a SEPARATE data layer from the report→confirm portal (src/lib/repo).
// It stores annual self-reported survey responses (what Australia's RAP Impact
// Survey collects). Two entities: Organization (demographics, Q1–7) and
// SurveyResponse (the answers, Q8–41, one per org per reporting year).
//
// Each question is annotated with its survey number for traceability.
// ===========================================================================

// --- shared enums ----------------------------------------------------------
export type Likert = "strongly_disagree" | "disagree" | "neutral" | "agree" | "strongly_agree";
export type Rating1to5 = 1 | 2 | 3 | 4 | 5;
export type YesNoUnsure = "yes" | "no" | "unsure";
export type RapType = "reflect" | "innovate" | "stretch" | "elevate";

// Q2 — the 23 industries in the survey
export type Industry =
  | "architecture"
  | "arts_culture"
  | "consulting"
  | "community_dev"
  | "construction"
  | "education"
  | "environment"
  | "finance_insurance"
  | "governance"
  | "health"
  | "legal"
  | "marketing"
  | "media"
  | "mining"
  | "property"
  | "recruitment"
  | "retail"
  | "safety_security"
  | "science_tech_eng"
  | "social_services"
  | "sport"
  | "tourism"
  | "transport";

// Q17 — NRW participation (multi-select)
export type NrwParticipation =
  | "hosted_internal"
  | "hosted_external"
  | "supported_employees"
  | "did_not_participate";

// Q30 — procurement spend buckets
export type ProcurementRange =
  | "0-5k"
  | "5k-100k"
  | "100k-1m"
  | "1m-5m"
  | "5m-10m"
  | "10m+"
  | "20m+"
  | "50m+"
  | "100m+";

// Q38 — governance structures (multi-select)
export type GovernanceStructure =
  | "internal_employee_group"
  | "external_advisory"
  | "consulted"
  | "formal_evaluation"
  | "none"
  | "other";

// Q40 — top strategy
export type TopStrategy =
  | "cultural_learning"
  | "employment"
  | "procurement"
  | "anti_racism"
  | "other";

// --- Organization (demographics, Q1–Q7) ------------------------------------
export interface Organization {
  id: string;
  contactName: string; // Q1
  contactEmail: string; // Q1
  industry: Industry; // Q2
  latestRapType: RapType; // Q3
  asx200: boolean; // Q4
  totalEmployees: number; // Q5 (Australian-based)
  members: { organisations: number; individuals: number }; // Q6 (peak bodies)
  totalStudents: number; // Q7 (education institutions)
  createdAt: string; // ISO 8601
}

// --- SurveyResponse (the answers, Q8–Q41) — one per org per reporting year --
export interface SurveyResponse {
  orgId: string;
  year: string; // reporting year, e.g. "2025"
  reportingPeriod: string; // e.g. "2024-07-01..2025-06-30"

  // Engagement with Reconciliation Australia (Q8–Q13)
  raSupportDevelop: Likert; // Q8
  raSupportImplement: Likert; // Q9
  rapStage: "implementing" | "developing" | "both"; // Q10
  raEngagementRating: Rating1to5; // Q11
  raEventsAttended: "0" | "1" | "2" | "3" | "4" | "4+"; // Q12
  firstRapInLast12Months: "yes" | "no" | "no_full_survey"; // Q13

  // Relationships (Q14–Q20)
  hasEngagementStrategy: boolean; // Q14
  partnerships: { formal: number; informal: number }; // Q15
  partneredWith: string[]; // Q16 (CareerTrackers / Supply Nation / Jawun / "Other: …")
  nrwParticipation: NrwParticipation[]; // Q17
  nrwEventsHosted: { internal: number; external: number }; // Q18
  staffEngagementStrategy: YesNoUnsure; // Q19
  antiDiscrimination: "dedicated" | "under_other_policy" | "none" | "unsure"; // Q20

  // Respect (Q21–Q25)
  culturalLearningStrategy: YesNoUnsure; // Q21
  culturalLearning: { elearning: number; faceToFace: number; immersion: number }; // Q22
  hasCulturalProtocolsDoc: boolean; // Q23
  changedExternalPractices: boolean; // Q24
  changedInternalPractices: boolean; // Q25

  // Opportunities (Q26–Q37)
  hasEmploymentStrategy: boolean; // Q26
  employmentTarget: { hasTarget: boolean; overall: number; leadership: number }; // Q27
  indigenousStaff: {
    // Q28
    total: number | null; // null = "we do not collect this data"
    breakdown: {
      permanent: number;
      nonOngoing: number;
      casual: number;
      apprenticeships: number;
      traineeships: number;
      contractors: number;
    };
  };
  indigenousStaffByLevel: {
    // Q29
    board: number;
    councillors: number;
    seniorExec: number;
    middleManagement: number;
    entryLevel: number;
  };
  procurementRange: ProcurementRange; // Q30
  procurementTotal: number; // Q31 (exact $)
  procurementSupplyNationCertified: number; // Q32 ($)
  businessesContracted: number; // Q33
  supplyNationMember: boolean; // Q34
  donations: number; // Q35 ($)
  education: { scholarships: number; contributions: number }; // Q36 ($)
  proBono: { hours: number; dollarValue: number }; // Q37 (0/0 = N/A)

  // Governance (Q38–Q39)
  governanceStructures: GovernanceStructure[]; // Q38
  seniorLeaderEngagement: Rating1to5; // Q39

  // Outcome (Q40–Q41, optional)
  topStrategy?: TopStrategy; // Q40
  outcomeDescription?: string; // Q41 (≤500 words)

  submittedAt: string; // ISO 8601
}

// minimal repo surface for the survey data layer
export interface SurveyRepo {
  putOrganization(org: Organization): Promise<Organization>;
  getOrganization(id: string): Promise<Organization | null>;
  putResponse(response: SurveyResponse): Promise<SurveyResponse>;
  getResponse(orgId: string, year: string): Promise<SurveyResponse | null>;
  listResponsesByYear(year: string): Promise<SurveyResponse[]>;
}
