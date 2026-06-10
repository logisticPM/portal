// ===========================================================================
// Synthetic test data: 2 organizations + their 2025 RAP Impact Survey responses.
// Org A (McKinsey) draws plausible figures from the Innovate RAP brochure we have;
// Org B is fictional. Edit freely — this is fabricated demo data.
// ===========================================================================
import type { Organization, SurveyResponse } from "./types";

const T = "2025-09-30T00:00:00.000Z";
const PERIOD = "2024-07-01..2025-06-30";

export const organizations: Organization[] = [
  {
    id: "org-mckinsey",
    contactName: "Julian Carrigan",
    contactEmail: "rap@example-mckinsey.com",
    industry: "consulting",
    latestRapType: "innovate",
    asx200: false,
    totalEmployees: 600,
    members: { organisations: 0, individuals: 0 },
    totalStudents: 0,
    createdAt: T,
  },
  {
    id: "org-cedartrust",
    contactName: "Dana Whitefeather",
    contactEmail: "reconciliation@example-cedartrust.com",
    industry: "finance_insurance",
    latestRapType: "stretch",
    asx200: true,
    totalEmployees: 12000,
    members: { organisations: 0, individuals: 0 },
    totalStudents: 0,
    createdAt: T,
  },
];

export const responses: SurveyResponse[] = [
  {
    orgId: "org-mckinsey",
    year: "2025",
    reportingPeriod: PERIOD,
    // engagement
    raSupportDevelop: "agree",
    raSupportImplement: "agree",
    rapStage: "implementing",
    raEngagementRating: 4,
    raEventsAttended: "2",
    firstRapInLast12Months: "no",
    // relationships
    hasEngagementStrategy: true,
    partnerships: { formal: 2, informal: 3 },
    partneredWith: ["Supply Nation", "Other: Cape York Partnership"],
    nrwParticipation: ["hosted_internal", "supported_employees"],
    nrwEventsHosted: { internal: 1, external: 0 },
    staffEngagementStrategy: "yes",
    antiDiscrimination: "under_other_policy",
    // respect
    culturalLearningStrategy: "yes",
    culturalLearning: { elearning: 120, faceToFace: 80, immersion: 12 },
    hasCulturalProtocolsDoc: true,
    changedExternalPractices: true,
    changedInternalPractices: true,
    // opportunities
    hasEmploymentStrategy: true,
    employmentTarget: { hasTarget: true, overall: 6, leadership: 1 },
    indigenousStaff: {
      total: 6,
      breakdown: { permanent: 2, nonOngoing: 0, casual: 0, apprenticeships: 0, traineeships: 3, contractors: 1 },
    },
    indigenousStaffByLevel: { board: 0, councillors: 0, seniorExec: 0, middleManagement: 1, entryLevel: 5 },
    procurementRange: "5k-100k",
    procurementTotal: 100000,
    procurementSupplyNationCertified: 60000,
    businessesContracted: 5,
    supplyNationMember: true,
    donations: 25000,
    education: { scholarships: 40000, contributions: 15000 },
    proBono: { hours: 200, dollarValue: 0 },
    // governance
    governanceStructures: ["internal_employee_group", "external_advisory"],
    seniorLeaderEngagement: 4,
    // outcome
    topStrategy: "cultural_learning",
    outcomeDescription:
      "Cultural learning (Garma attendance, cultural competency workshops) was the highest-leverage strategy, deepening staff understanding and supporting our supplier relationships.",
    submittedAt: T,
  },
  {
    orgId: "org-cedartrust",
    year: "2025",
    reportingPeriod: PERIOD,
    raSupportDevelop: "strongly_agree",
    raSupportImplement: "agree",
    rapStage: "both",
    raEngagementRating: 5,
    raEventsAttended: "4+",
    firstRapInLast12Months: "no",
    hasEngagementStrategy: true,
    partnerships: { formal: 4, informal: 2 },
    partneredWith: ["Supply Nation", "CareerTrackers", "Jawun"],
    nrwParticipation: ["hosted_internal", "hosted_external", "supported_employees"],
    nrwEventsHosted: { internal: 3, external: 1 },
    staffEngagementStrategy: "yes",
    antiDiscrimination: "dedicated",
    culturalLearningStrategy: "yes",
    culturalLearning: { elearning: 8000, faceToFace: 1500, immersion: 40 },
    hasCulturalProtocolsDoc: true,
    changedExternalPractices: true,
    changedInternalPractices: true,
    hasEmploymentStrategy: true,
    employmentTarget: { hasTarget: true, overall: 300, leadership: 25 },
    indigenousStaff: {
      total: 210,
      breakdown: { permanent: 160, nonOngoing: 10, casual: 20, apprenticeships: 5, traineeships: 10, contractors: 5 },
    },
    indigenousStaffByLevel: { board: 1, councillors: 0, seniorExec: 4, middleManagement: 35, entryLevel: 170 },
    procurementRange: "5m-10m",
    procurementTotal: 7400000,
    procurementSupplyNationCertified: 5200000,
    businessesContracted: 64,
    supplyNationMember: true,
    donations: 350000,
    education: { scholarships: 180000, contributions: 90000 },
    proBono: { hours: 1200, dollarValue: 450000 },
    governanceStructures: ["internal_employee_group", "external_advisory", "formal_evaluation"],
    seniorLeaderEngagement: 5,
    topStrategy: "procurement",
    outcomeDescription:
      "Procurement was our strongest lever: $7.4M spent with First Nations businesses, $5.2M Supply-Nation-certified, via a refreshed procurement strategy and Supply Nation partnership.",
    submittedAt: T,
  },
];
