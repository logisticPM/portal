// ===========================================================================
// Synthetic seed data for the RAP layer — lets the dashboard + review UI render
// immediately on the mock (no DynamoDB, no Bedrock). Fabricated demo data drawn
// loosely from real public RAPs; edit freely.
//   • canonical entities (orgs → RAPs → commitments → observations) feed /rap
//   • one PENDING_REVIEW job feeds /rap/review
// ===========================================================================
import type {
  ClaimBasis,
  Commitment,
  CommitmentRollup,
  ExtractionJob,
  Grounded,
  Observation,
  Provenance,
  RapDocument,
  RapOrganization,
  RapType,
} from "./types";
import { RAP_SCHEMA_VERSION } from "./types";

const g = <T>(value: T | null, quote: string | null, page: number | null, confidence: number): Grounded<T> => ({
  value, quote, page, confidence, flagged: confidence < 0.85 || (value !== null && quote === null),
});

export const orgs: RapOrganization[] = [
  { id: "org-rbc", name: "Royal Bank of Canada", sector: "finance_banking", sizeBand: "1000_plus", region: "CA", createdAt: "2025-06-20T00:00:00.000Z" },
  { id: "org-agnico", name: "Agnico Eagle Mines", sector: "mining_extractive", sizeBand: "1000_plus", region: "CA", createdAt: "2024-07-10T00:00:00.000Z" },
  { id: "org-telus", name: "TELUS Communications", sector: "telecom", sizeBand: "1000_plus", region: "CA", createdAt: "2021-11-29T00:00:00.000Z" },
];

export const raps: RapDocument[] = [
  { id: "rap-rbc-2025", orgId: "org-rbc", title: "Pathways to Economic Prosperity", jurisdiction: "CA", rapType: null, publicationDate: "2025-06-20", periodStart: "2025-01-01", periodEnd: "2027-12-31", sourceS3Key: "uploads/seed/rbc.pdf", extractionId: "seed-rbc", claimBasis: "self_reported", status: "active", createdAt: "2025-06-20T00:00:00.000Z" },
  { id: "rap-agnico-2024", orgId: "org-agnico", title: "Reconciliation Action Plan 2024", jurisdiction: "CA", rapType: null, publicationDate: "2024-07-10", periodStart: "2024-01-01", periodEnd: "2027-12-31", sourceS3Key: "uploads/seed/agnico.pdf", extractionId: "seed-agnico", claimBasis: "self_reported", status: "active", createdAt: "2024-07-10T00:00:00.000Z" },
  { id: "rap-telus-2024", orgId: "org-telus", title: "Indigenous Reconciliation & Connectivity Report", jurisdiction: "CA", rapType: null, publicationDate: "2024-11-19", periodStart: "2024-01-01", periodEnd: "2026-12-31", sourceS3Key: "uploads/seed/telus.pdf", extractionId: "seed-telus", claimBasis: "self_reported", status: "active", createdAt: "2024-11-19T00:00:00.000Z" },
];

const src = (quote: string, page: number) => ({ quote, page });
const prov = (s3: string, conf: number, basis: ClaimBasis = "self_reported"): Provenance => ({
  claimBasis: basis, reviewedBy: "system:seed", reviewedAt: "2025-06-20T00:00:00.000Z", sourceS3Key: s3, extractionConfidence: conf,
});

export const commitments: Commitment[] = [
  { id: "c-rbc-proc", rapId: "rap-rbc-2025", orgId: "org-rbc", sector: "finance_banking", pillar: "economy", commitmentType: "procurement", action: "Grow Indigenous procurement spend", deliverable: "Reach $100M annual Indigenous procurement", targetText: "$100M", targetValue: 100_000_000, dueDate: "2027-12-31", owner: "Chief Procurement Officer", source: src("$100 million annually", 7), provenance: prov("uploads/seed/rbc.pdf", 0.9) },
  { id: "c-rbc-emp", rapId: "rap-rbc-2025", orgId: "org-rbc", sector: "finance_banking", pillar: "employment", commitmentType: "employment", action: "Increase Indigenous representation", deliverable: "Indigenous talent hiring program", targetText: "1.5% of workforce", targetValue: 1.5, dueDate: "2027-12-31", owner: "CHRO", source: src("1.5% Indigenous representation", 9), provenance: prov("uploads/seed/rbc.pdf", 0.88) },
  { id: "c-agnico-train", rapId: "rap-agnico-2024", orgId: "org-agnico", sector: "mining_extractive", pillar: "education", commitmentType: "education_training", action: "Fund Inuit training", deliverable: "Annual Inuit training investment", targetText: "$4.6M", targetValue: 4_600_000, dueDate: "2025-12-31", owner: "VP Sustainability", source: src("$4.6 million Inuit training", 12), provenance: prov("uploads/seed/agnico.pdf", 0.91) },
  { id: "c-agnico-proc", rapId: "rap-agnico-2024", orgId: "org-agnico", sector: "mining_extractive", pillar: "opportunities", commitmentType: "procurement", action: "Source from Inuit businesses", deliverable: "Maintain Indigenous procurement spend", targetText: "$1B", targetValue: 1_000_000_000, dueDate: "2026-12-31", owner: "Supply Chain Lead", source: src("~$1 billion to Indigenous businesses", 14), provenance: prov("uploads/seed/agnico.pdf", 0.87) },
  { id: "c-telus-conn", rapId: "rap-telus-2024", orgId: "org-telus", sector: "telecom", pillar: "opportunities", commitmentType: "partnership", action: "Connect Indigenous communities", deliverable: "Bring broadband to Indigenous lands", targetText: "85 communities", targetValue: 85, dueDate: "2026-12-31", owner: "VP Connectivity", source: src("85 communities connected", 7), provenance: prov("uploads/seed/telus.pdf", 0.86) },
  { id: "c-telus-land", rapId: "rap-telus-2024", orgId: "org-telus", sector: "telecom", pillar: "environment", commitmentType: "environmental", action: "Restore traditional lands", deliverable: "Land restoration with Piikani + Blood Tribe", targetText: "500 ha", targetValue: 500, dueDate: "2026-12-31", owner: "Sustainability Lead", source: src("500 hectares restored", 9), provenance: prov("uploads/seed/telus.pdf", 0.84) },
];

// time-series: a few period-stamped observations per commitment → trend lines
export const observations: Observation[] = [
  { commitId: "c-rbc-proc", observedAt: "2025-06-20T00:00:00.000Z", status: "not_started", observedValue: 0, note: "Baseline", recordedBy: "system" },
  { commitId: "c-rbc-proc", observedAt: "2025-12-31T00:00:00.000Z", status: "on_track", observedValue: 42_000_000, note: "Q4 update", recordedBy: "admin" },
  { commitId: "c-rbc-proc", observedAt: "2026-06-30T00:00:00.000Z", status: "on_track", observedValue: 61_000_000, note: "Mid-year", recordedBy: "admin" },
  { commitId: "c-agnico-train", observedAt: "2024-07-10T00:00:00.000Z", status: "not_started", observedValue: 0, note: "Baseline", recordedBy: "system" },
  { commitId: "c-agnico-train", observedAt: "2025-12-31T00:00:00.000Z", status: "met", observedValue: 4_600_000, note: "Target met", recordedBy: "admin" },
  { commitId: "c-telus-conn", observedAt: "2024-11-19T00:00:00.000Z", status: "not_started", observedValue: 0, note: "Baseline", recordedBy: "system" },
  { commitId: "c-telus-conn", observedAt: "2025-11-19T00:00:00.000Z", status: "delayed", observedValue: 38, note: "Behind schedule", recordedBy: "admin" },
];

export const rollups: CommitmentRollup[] = [
  { commitId: "c-rbc-proc", latestStatus: "on_track", percentComplete: 61, observationCount: 3, updatedAt: "2026-06-30T00:00:00.000Z" },
  { commitId: "c-rbc-emp", latestStatus: "not_started", percentComplete: 0, observationCount: 0, updatedAt: "2025-06-20T00:00:00.000Z" },
  { commitId: "c-agnico-train", latestStatus: "met", percentComplete: 100, observationCount: 2, updatedAt: "2025-12-31T00:00:00.000Z" },
  { commitId: "c-agnico-proc", latestStatus: "not_started", percentComplete: 0, observationCount: 0, updatedAt: "2024-07-10T00:00:00.000Z" },
  { commitId: "c-telus-conn", latestStatus: "delayed", percentComplete: 45, observationCount: 2, updatedAt: "2025-11-19T00:00:00.000Z" },
  { commitId: "c-telus-land", latestStatus: "not_started", percentComplete: 0, observationCount: 0, updatedAt: "2024-11-19T00:00:00.000Z" },
];

// one flagged extraction awaiting QA → populates /rap/review
export const jobs: ExtractionJob[] = [
  {
    id: "job-telus-2025",
    fileName: "TELUS_2025_RAP_for_review.pdf",
    sourceS3Key: "uploads/job-telus-2025/TELUS_2025_RAP.pdf",
    status: "PENDING_REVIEW",
    schemaVersion: RAP_SCHEMA_VERSION,
    engine: "textract+claude",
    classification: { jurisdiction: "CA", sector: "telecom", rapType: null, confidence: 0.81 },
    extracted: {
      orgName: g("TELUS Communications Inc.", "TELUS", 1, 0.97),
      sector: g("telecom", "telecommunications", 1, 0.95),
      jurisdiction: g("CA", "Canada", 1, 0.98),
      rapTitle: g("Indigenous Reconciliation & Connectivity Report", "Indigenous Reconciliation and Connectivity Report", 1, 0.9),
      publicationDate: g("2025-11-19", "November 2025", 1, 0.86),
      periodCovered: g({ start: "2025-01-01", end: "2025-12-31" }, "2025", 2, 0.84),
      frameworkRefs: g(["trc_cta_92"], "Call to Action 92", 3, 0.88),
      pillars: g(["relationships", "respect", "opportunities", "governance"], "four pillars", 4, 0.9),
      governanceBody: g("Indigenous Reconciliation team", "Indigenous Reconciliation team", 5, 0.82),
      reviewCycle: g("annual", "annual report", 5, 0.9),
      rapType: g<RapType>(null, null, null, 0.5),
      pairLevel: g("silver", "PAIR Silver", 6, 0.93),
      endorsementStatus: g<string>(null, null, null, 0.5),
      commitments: [
        {
          pillarRaw: g("Opportunities", "Opportunities", 7, 0.92),
          pillarNormalized: "opportunities",
          action: g("Connect Indigenous communities to high-speed internet", "connect Indigenous lands to broadband", 7, 0.9),
          deliverable: g("Bring connectivity to Indigenous communities", "connect remaining communities", 7, 0.83),
          timeline: g("2026", "by 2026", 7, 0.88),
          owner: g<string>(null, null, null, 0.4),
          metric: g("85 communities", "85 communities", 7, 0.86),
          commitmentType: g("partnership", "connectivity partnership", 7, 0.8),
        },
      ],
      sectorFields: {
        telecom: {
          connectivityTarget: g("Indigenous lands connected to broadband", "broadband to Indigenous lands", 8, 0.87),
          communitiesConnected: g(85, "85 communities", 8, 0.86),
        },
      },
      extras: [{ label: "land restoration", value: "500 ha (Piikani + Blood Tribe)", quote: "500 hectares restored", page: 9 }],
    },
    validationIssues: [{ path: "commitments[0].owner", rule: "no_quote", message: "owner value present but no source span" }],
    verdicts: [{ path: "governanceBody", quoteSupportsValue: true, note: null }],
    reviewedBy: null,
    reviewNote: null,
    rapId: null,
    createdAt: "2025-11-20T00:00:00.000Z",
    updatedAt: "2025-11-20T00:00:00.000Z",
  },
];
