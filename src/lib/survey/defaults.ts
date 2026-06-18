// Neutral default objects for create-on-save: when a company has no survey
// Organization / SurveyResponse yet, the editable context form builds one from
// these and overlays the typed slice. Every required Q8–Q41 field is populated so
// a future Option-B form only overwrites fields it owns. `now` is passed in for
// deterministic tests.
import type { Organization, SurveyResponse } from "./types";

export function blankOrganization(id: string, now: string): Organization {
  return {
    id,
    contactName: "",
    contactEmail: "",
    industry: "unspecified",
    latestRapType: "reflect",
    asx200: false,
    totalEmployees: 0,
    members: { organisations: 0, individuals: 0 },
    totalStudents: 0,
    createdAt: now,
  };
}

export function blankResponse(orgId: string, year: string, now: string): SurveyResponse {
  const startYear = Number(year) - 1;
  return {
    orgId,
    year,
    reportingPeriod: `${startYear}-07-01..${year}-06-30`,

    // Engagement with Reconciliation Australia (Q8–Q13)
    raSupportDevelop: "neutral",
    raSupportImplement: "neutral",
    rapStage: "developing",
    raEngagementRating: 1,
    raEventsAttended: "0",
    firstRapInLast12Months: "no",

    // Relationships (Q14–Q20)
    hasEngagementStrategy: false,
    partnerships: { formal: 0, informal: 0 },
    partneredWith: [],
    nrwParticipation: [],
    nrwEventsHosted: { internal: 0, external: 0 },
    staffEngagementStrategy: "unsure",
    antiDiscrimination: "unsure",

    // Respect (Q21–Q25)
    culturalLearningStrategy: "unsure",
    culturalLearning: { elearning: 0, faceToFace: 0, immersion: 0 },
    hasCulturalProtocolsDoc: false,
    changedExternalPractices: false,
    changedInternalPractices: false,

    // Opportunities (Q26–Q37)
    hasEmploymentStrategy: false,
    employmentTarget: { hasTarget: false, overall: 0, leadership: 0 },
    indigenousStaff: {
      total: null,
      breakdown: {
        permanent: 0,
        nonOngoing: 0,
        casual: 0,
        apprenticeships: 0,
        traineeships: 0,
        contractors: 0,
      },
    },
    indigenousStaffByLevel: {
      board: 0,
      councillors: 0,
      seniorExec: 0,
      middleManagement: 0,
      entryLevel: 0,
    },
    procurementRange: "0-5k",
    procurementTotal: 0,
    procurementSupplyNationCertified: 0,
    businessesContracted: 0,
    supplyNationMember: false,
    donations: 0,
    education: { scholarships: 0, contributions: 0 },
    proBono: { hours: 0, dollarValue: 0 },

    // Governance (Q38–Q39)
    governanceStructures: ["none"],
    seniorLeaderEngagement: 1,

    submittedAt: now,
  };
}
