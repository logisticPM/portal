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

// registry fields default to null across all seed orgs — none of the demo data
// has been BN-verified; they're name-keyed exactly like a real self-asserted org.
const noRegistry = {
  businessNumber: null,
  legalName: null,
  registryStatus: null,
  registrySource: null,
  verifiedAt: null,
} as const;

export const orgs: RapOrganization[] = [
  { id: "org-rbc", name: "Royal Bank of Canada", sector: "finance", sizeBand: "1000_plus", region: "CA", createdAt: "2025-06-20T00:00:00.000Z", ...noRegistry, dataClass: "org_submitted" },
  { id: "org-agnico", name: "Agnico Eagle Mines", sector: "mining", sizeBand: "1000_plus", region: "CA", createdAt: "2024-07-10T00:00:00.000Z", ...noRegistry, dataClass: "org_submitted" },
  { id: "org-telus", name: "TELUS Communications", sector: "telecom", sizeBand: "1000_plus", region: "CA", createdAt: "2021-11-29T00:00:00.000Z", ...noRegistry, dataClass: "org_submitted" },
  // --- additional demo orgs (fabricated; broaden sectors / size bands / claim basis for the exploratory dashboard) ---
  { id: "org-td", name: "TD Bank Group", sector: "finance", sizeBand: "1000_plus", region: "ON", createdAt: "2024-03-04T00:00:00.000Z", ...noRegistry, dataClass: "org_submitted" },
  { id: "org-vancity", name: "Vancity Credit Union", sector: "finance", sizeBand: "250_999", region: "BC", createdAt: "2024-05-14T00:00:00.000Z", ...noRegistry, dataClass: "org_submitted" },
  { id: "org-suncor", name: "Suncor Energy", sector: "energy", sizeBand: "1000_plus", region: "AB", createdAt: "2024-02-20T00:00:00.000Z", ...noRegistry, dataClass: "org_submitted" },
  { id: "org-gc", name: "Government of Canada (PSPC)", sector: "government", sizeBand: "1000_plus", region: "CA", createdAt: "2024-01-15T00:00:00.000Z", ...noRegistry, dataClass: "org_submitted" },
  { id: "org-cn", name: "Canadian National Railway", sector: "transport", sizeBand: "1000_plus", region: "QC", createdAt: "2024-04-09T00:00:00.000Z", ...noRegistry, dataClass: "org_submitted" },
  { id: "org-ctc", name: "Canadian Tire Corporation", sector: "retail", sizeBand: "1000_plus", region: "ON", createdAt: "2025-01-22T00:00:00.000Z", ...noRegistry, dataClass: "org_submitted" },
  { id: "org-teck", name: "Teck Resources", sector: "mining", sizeBand: "1000_plus", region: "BC", createdAt: "2024-06-30T00:00:00.000Z", ...noRegistry, dataClass: "org_submitted" },
];

export const raps: RapDocument[] = [
  { id: "rap-rbc-2025", orgId: "org-rbc", title: "Pathways to Economic Prosperity", jurisdiction: "CA", rapType: null, publicationDate: "2025-06-20", periodStart: "2025-01-01", periodEnd: "2027-12-31", sourceS3Key: "uploads/seed/rbc.pdf", extractionId: "seed-rbc", claimBasis: "self_reported", status: "active", createdAt: "2025-06-20T00:00:00.000Z", dataClass: "org_submitted" },
  { id: "rap-agnico-2024", orgId: "org-agnico", title: "Reconciliation Action Plan 2024", jurisdiction: "CA", rapType: null, publicationDate: "2024-07-10", periodStart: "2024-01-01", periodEnd: "2027-12-31", sourceS3Key: "uploads/seed/agnico.pdf", extractionId: "seed-agnico", claimBasis: "self_reported", status: "active", createdAt: "2024-07-10T00:00:00.000Z", dataClass: "org_submitted" },
  { id: "rap-telus-2024", orgId: "org-telus", title: "Indigenous Reconciliation & Connectivity Report", jurisdiction: "CA", rapType: null, publicationDate: "2024-11-19", periodStart: "2024-01-01", periodEnd: "2026-12-31", sourceS3Key: "uploads/seed/telus.pdf", extractionId: "seed-telus", claimBasis: "self_reported", status: "active", createdAt: "2024-11-19T00:00:00.000Z", dataClass: "org_submitted" },
  { id: "rap-td-2024", orgId: "org-td", title: "Indigenous Reconciliation Action Plan", jurisdiction: "CA", rapType: null, publicationDate: "2024-03-04", periodStart: "2024-01-01", periodEnd: "2027-12-31", sourceS3Key: "uploads/seed/td.pdf", extractionId: "seed-td", claimBasis: "self_reported", status: "active", createdAt: "2024-03-04T00:00:00.000Z", dataClass: "org_submitted" },
  { id: "rap-vancity-2024", orgId: "org-vancity", title: "Reconciliation & Economic Inclusion Plan", jurisdiction: "CA", rapType: null, publicationDate: "2024-05-14", periodStart: "2024-01-01", periodEnd: "2026-12-31", sourceS3Key: "uploads/seed/vancity.pdf", extractionId: "seed-vancity", claimBasis: "independently_verified", status: "active", createdAt: "2024-05-14T00:00:00.000Z", dataClass: "org_submitted" },
  { id: "rap-suncor-2024", orgId: "org-suncor", title: "Journey of Reconciliation", jurisdiction: "CA", rapType: null, publicationDate: "2024-02-20", periodStart: "2024-01-01", periodEnd: "2028-12-31", sourceS3Key: "uploads/seed/suncor.pdf", extractionId: "seed-suncor", claimBasis: "self_reported", status: "active", createdAt: "2024-02-20T00:00:00.000Z", dataClass: "org_submitted" },
  { id: "rap-gc-2024", orgId: "org-gc", title: "Indigenous Procurement & Employment Commitments", jurisdiction: "CA", rapType: null, publicationDate: "2024-01-15", periodStart: "2024-01-01", periodEnd: "2027-12-31", sourceS3Key: "uploads/seed/gc.pdf", extractionId: "seed-gc", claimBasis: "statutory", status: "active", createdAt: "2024-01-15T00:00:00.000Z", dataClass: "org_submitted" },
  { id: "rap-cn-2024", orgId: "org-cn", title: "Reconciliation Action Plan", jurisdiction: "CA", rapType: null, publicationDate: "2024-04-09", periodStart: "2024-01-01", periodEnd: "2026-12-31", sourceS3Key: "uploads/seed/cn.pdf", extractionId: "seed-cn", claimBasis: "self_reported", status: "active", createdAt: "2024-04-09T00:00:00.000Z", dataClass: "org_submitted" },
  { id: "rap-ctc-2025", orgId: "org-ctc", title: "Indigenous Relations Strategy", jurisdiction: "CA", rapType: null, publicationDate: "2025-01-22", periodStart: "2025-01-01", periodEnd: "2027-12-31", sourceS3Key: "uploads/seed/ctc.pdf", extractionId: "seed-ctc", claimBasis: "self_reported", status: "active", createdAt: "2025-01-22T00:00:00.000Z", dataClass: "org_submitted" },
  { id: "rap-teck-2024", orgId: "org-teck", title: "Reconciliation Action Plan", jurisdiction: "CA", rapType: null, publicationDate: "2024-06-30", periodStart: "2024-01-01", periodEnd: "2027-12-31", sourceS3Key: "uploads/seed/teck.pdf", extractionId: "seed-teck", claimBasis: "self_reported", status: "active", createdAt: "2024-06-30T00:00:00.000Z", dataClass: "org_submitted" },
];

const src = (quote: string, page: number) => ({ quote, page });
const prov = (s3: string, conf: number, basis: ClaimBasis = "self_reported"): Provenance => ({
  claimBasis: basis, reviewedBy: "system:seed", reviewedAt: "2025-06-20T00:00:00.000Z", sourceS3Key: s3, extractionConfidence: conf,
});

export const commitments: Commitment[] = [
  { id: "c-rbc-proc", rapId: "rap-rbc-2025", orgId: "org-rbc", sector: "finance", pillar: "economy", commitmentType: "procurement", action: "Grow Indigenous procurement spend", deliverable: "Reach $100M annual Indigenous procurement", targetText: "$100M", targetValue: 100_000_000, dueDate: "2027-12-31", owner: "Chief Procurement Officer", source: src("$100 million annually", 7), provenance: prov("uploads/seed/rbc.pdf", 0.9), dataClass: "org_submitted" },
  { id: "c-rbc-emp", rapId: "rap-rbc-2025", orgId: "org-rbc", sector: "finance", pillar: "employment", commitmentType: "employment", action: "Increase Indigenous representation", deliverable: "Indigenous talent hiring program", targetText: "1.5% of workforce", targetValue: 1.5, dueDate: "2027-12-31", owner: "CHRO", source: src("1.5% Indigenous representation", 9), provenance: prov("uploads/seed/rbc.pdf", 0.88), dataClass: "org_submitted" },
  { id: "c-agnico-train", rapId: "rap-agnico-2024", orgId: "org-agnico", sector: "mining", pillar: "education", commitmentType: "education_training", action: "Fund Inuit training", deliverable: "Annual Inuit training investment", targetText: "$4.6M", targetValue: 4_600_000, dueDate: "2025-12-31", owner: "VP Sustainability", source: src("$4.6 million Inuit training", 12), provenance: prov("uploads/seed/agnico.pdf", 0.91), dataClass: "org_submitted" },
  { id: "c-agnico-proc", rapId: "rap-agnico-2024", orgId: "org-agnico", sector: "mining", pillar: "opportunities", commitmentType: "procurement", action: "Source from Inuit businesses", deliverable: "Maintain Indigenous procurement spend", targetText: "$1B", targetValue: 1_000_000_000, dueDate: "2026-12-31", owner: "Supply Chain Lead", source: src("~$1 billion to Indigenous businesses", 14), provenance: prov("uploads/seed/agnico.pdf", 0.87), dataClass: "org_submitted" },
  { id: "c-telus-conn", rapId: "rap-telus-2024", orgId: "org-telus", sector: "telecom", pillar: "opportunities", commitmentType: "partnership", action: "Connect Indigenous communities", deliverable: "Bring broadband to Indigenous lands", targetText: "85 communities", targetValue: 85, dueDate: "2026-12-31", owner: "VP Connectivity", source: src("85 communities connected", 7), provenance: prov("uploads/seed/telus.pdf", 0.86), dataClass: "org_submitted" },
  { id: "c-telus-land", rapId: "rap-telus-2024", orgId: "org-telus", sector: "telecom", pillar: "environment", commitmentType: "environmental", action: "Restore traditional lands", deliverable: "Land restoration with Piikani + Blood Tribe", targetText: "500 ha", targetValue: 500, dueDate: "2026-12-31", owner: "Sustainability Lead", source: src("500 hectares restored", 9), provenance: prov("uploads/seed/telus.pdf", 0.84), dataClass: "org_submitted" },
  // --- additional demo commitments (fabricated) ---
  { id: "c-td-proc", rapId: "rap-td-2024", orgId: "org-td", sector: "finance", pillar: "economy", commitmentType: "procurement", action: "Expand Indigenous supplier spend", deliverable: "Double Indigenous procurement", targetText: "$50M", targetValue: 50_000_000, dueDate: "2026-12-31", owner: "Chief Procurement Officer", source: src("$50 million annually", 5), provenance: prov("uploads/seed/td.pdf", 0.9), dataClass: "org_submitted" },
  { id: "c-td-comm", rapId: "rap-td-2024", orgId: "org-td", sector: "finance", pillar: "community", commitmentType: "community_investment", action: "Invest in Indigenous communities", deliverable: "Community grants program", targetText: "$25M", targetValue: 25_000_000, dueDate: "2027-12-31", owner: "Head of Sustainability", source: src("$25 million in grants", 8), provenance: prov("uploads/seed/td.pdf", 0.88, "independently_verified"), dataClass: "org_submitted" },
  { id: "c-vancity-fin", rapId: "rap-vancity-2024", orgId: "org-vancity", sector: "finance", pillar: "economy", commitmentType: "community_investment", action: "Indigenous lending fund", deliverable: "Low-interest capital for Indigenous business", targetText: "$15M", targetValue: 15_000_000, dueDate: "2026-12-31", owner: "Chief Impact Officer", source: src("$15 million lending fund", 4), provenance: prov("uploads/seed/vancity.pdf", 0.87, "independently_verified"), dataClass: "org_submitted" },
  { id: "c-vancity-gov", rapId: "rap-vancity-2024", orgId: "org-vancity", sector: "finance", pillar: "governance", commitmentType: "governance", action: "Indigenous advisory council", deliverable: "Establish advisory governance body", targetText: "1 council", targetValue: 1, dueDate: "2025-12-31", owner: "CEO Office", source: src("Indigenous advisory council", 6), provenance: prov("uploads/seed/vancity.pdf", 0.86), dataClass: "org_submitted" },
  { id: "c-suncor-emp", rapId: "rap-suncor-2024", orgId: "org-suncor", sector: "energy", pillar: "employment", commitmentType: "employment", action: "Grow Indigenous workforce", deliverable: "Indigenous hiring and retention program", targetText: "8% of workforce", targetValue: 8, dueDate: "2027-12-31", owner: "VP Human Resources", source: src("8% Indigenous representation", 11), provenance: prov("uploads/seed/suncor.pdf", 0.85), dataClass: "org_submitted" },
  { id: "c-suncor-part", rapId: "rap-suncor-2024", orgId: "org-suncor", sector: "energy", pillar: "opportunities", commitmentType: "partnership", action: "Equity partnerships with Nations", deliverable: "Co-ownership on energy projects", targetText: "$300M", targetValue: 300_000_000, dueDate: "2028-12-31", owner: "VP Indigenous Relations", source: src("$300 million equity", 14), provenance: prov("uploads/seed/suncor.pdf", 0.83), dataClass: "org_submitted" },
  { id: "c-gc-proc", rapId: "rap-gc-2024", orgId: "org-gc", sector: "government", pillar: "economy", commitmentType: "procurement", action: "Meet 5% Indigenous procurement target", deliverable: "Mandatory minimum federal procurement", targetText: "5% of contracts", targetValue: 5, dueDate: "2025-12-31", owner: "PSPC", source: src("minimum 5% of the total value of contracts", 3), provenance: prov("uploads/seed/gc.pdf", 0.95, "statutory"), dataClass: "org_submitted" },
  { id: "c-gc-emp", rapId: "rap-gc-2024", orgId: "org-gc", sector: "government", pillar: "employment", commitmentType: "employment", action: "Increase Indigenous public service representation", deliverable: "Representation in the federal workforce", targetText: "4% of employees", targetValue: 4, dueDate: "2027-12-31", owner: "Treasury Board", source: src("4% representation", 6), provenance: prov("uploads/seed/gc.pdf", 0.9, "statutory"), dataClass: "org_submitted" },
  { id: "c-cn-train", rapId: "rap-cn-2024", orgId: "org-cn", sector: "transport", pillar: "education", commitmentType: "education_training", action: "Indigenous skills training", deliverable: "Apprenticeship partnerships", targetText: "$5M", targetValue: 5_000_000, dueDate: "2026-12-31", owner: "Chief HR Officer", source: src("$5 million training", 9), provenance: prov("uploads/seed/cn.pdf", 0.84), dataClass: "org_submitted" },
  { id: "c-cn-culture", rapId: "rap-cn-2024", orgId: "org-cn", sector: "transport", pillar: "respect", commitmentType: "cultural_learning", action: "Cultural competency training", deliverable: "All-employee cultural training", targetText: "20,000 employees", targetValue: 20000, dueDate: "2026-12-31", owner: "Head of Inclusion", source: src("20,000 employees trained", 10), provenance: prov("uploads/seed/cn.pdf", 0.82), dataClass: "org_submitted" },
  { id: "c-ctc-proc", rapId: "rap-ctc-2025", orgId: "org-ctc", sector: "retail", pillar: "economy", commitmentType: "procurement", action: "Indigenous vendor program", deliverable: "Onboard Indigenous suppliers", targetText: "$10M", targetValue: 10_000_000, dueDate: "2027-12-31", owner: "VP Merchandising", source: src("$10 million with Indigenous vendors", 7), provenance: prov("uploads/seed/ctc.pdf", 0.8), dataClass: "org_submitted" },
  { id: "c-ctc-comm", rapId: "rap-ctc-2025", orgId: "org-ctc", sector: "retail", pillar: "community", commitmentType: "community_investment", action: "Support Indigenous youth", deliverable: "Jumpstart Indigenous programs", targetText: "$3M", targetValue: 3_000_000, dueDate: "2026-12-31", owner: "Foundation Director", source: src("$3 million youth programs", 12), provenance: prov("uploads/seed/ctc.pdf", 0.81), dataClass: "org_submitted" },
  { id: "c-teck-proc", rapId: "rap-teck-2024", orgId: "org-teck", sector: "mining", pillar: "opportunities", commitmentType: "procurement", action: "Indigenous procurement growth", deliverable: "Contracts to Indigenous businesses", targetText: "$200M", targetValue: 200_000_000, dueDate: "2027-12-31", owner: "Supply Chain VP", source: src("$200 million", 15), provenance: prov("uploads/seed/teck.pdf", 0.85), dataClass: "org_submitted" },
  { id: "c-teck-env", rapId: "rap-teck-2024", orgId: "org-teck", sector: "mining", pillar: "environment", commitmentType: "environmental", action: "Protect traditional lands", deliverable: "Habitat restoration with Nations", targetText: "1200 ha", targetValue: 1200, dueDate: "2027-12-31", owner: "VP Environment", source: src("1,200 hectares", 13), provenance: prov("uploads/seed/teck.pdf", 0.83), dataClass: "org_submitted" },
];

// time-series: a few period-stamped observations per commitment → trend lines
export const observations: Observation[] = [
  { commitId: "c-rbc-proc", observedAt: "2025-06-20T00:00:00.000Z", status: "not_started", observedValue: 0, note: "Baseline", recordedBy: "system", dataClass: "org_submitted" },
  { commitId: "c-rbc-proc", observedAt: "2025-12-31T00:00:00.000Z", status: "on_track", observedValue: 42_000_000, note: "Q4 update", recordedBy: "admin", dataClass: "org_submitted" },
  { commitId: "c-rbc-proc", observedAt: "2026-06-30T00:00:00.000Z", status: "on_track", observedValue: 61_000_000, note: "Mid-year", recordedBy: "admin", dataClass: "org_submitted" },
  { commitId: "c-agnico-train", observedAt: "2024-07-10T00:00:00.000Z", status: "not_started", observedValue: 0, note: "Baseline", recordedBy: "system", dataClass: "org_submitted" },
  { commitId: "c-agnico-train", observedAt: "2025-12-31T00:00:00.000Z", status: "met", observedValue: 4_600_000, note: "Target met", recordedBy: "admin", dataClass: "org_submitted" },
  { commitId: "c-telus-conn", observedAt: "2024-11-19T00:00:00.000Z", status: "not_started", observedValue: 0, note: "Baseline", recordedBy: "system", dataClass: "org_submitted" },
  { commitId: "c-telus-conn", observedAt: "2025-11-19T00:00:00.000Z", status: "delayed", observedValue: 38, note: "Behind schedule", recordedBy: "admin", dataClass: "org_submitted" },
];

export const rollups: CommitmentRollup[] = [
  { commitId: "c-rbc-proc", latestStatus: "on_track", percentComplete: 61, observationCount: 3, updatedAt: "2026-06-30T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-rbc-emp", latestStatus: "not_started", percentComplete: 0, observationCount: 0, updatedAt: "2025-06-20T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-agnico-train", latestStatus: "met", percentComplete: 100, observationCount: 2, updatedAt: "2025-12-31T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-agnico-proc", latestStatus: "not_started", percentComplete: 0, observationCount: 0, updatedAt: "2024-07-10T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-telus-conn", latestStatus: "delayed", percentComplete: 45, observationCount: 2, updatedAt: "2025-11-19T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-telus-land", latestStatus: "not_started", percentComplete: 0, observationCount: 0, updatedAt: "2024-11-19T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-td-proc", latestStatus: "on_track", percentComplete: 50, observationCount: 1, updatedAt: "2026-03-31T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-td-comm", latestStatus: "met", percentComplete: 100, observationCount: 1, updatedAt: "2026-06-30T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-vancity-fin", latestStatus: "met", percentComplete: 100, observationCount: 1, updatedAt: "2026-05-31T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-vancity-gov", latestStatus: "on_track", percentComplete: 50, observationCount: 1, updatedAt: "2026-01-31T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-suncor-emp", latestStatus: "on_track", percentComplete: 50, observationCount: 1, updatedAt: "2026-03-31T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-suncor-part", latestStatus: "not_started", percentComplete: 0, observationCount: 0, updatedAt: "2024-02-20T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-gc-proc", latestStatus: "met", percentComplete: 100, observationCount: 1, updatedAt: "2026-03-31T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-gc-emp", latestStatus: "delayed", percentComplete: 25, observationCount: 1, updatedAt: "2026-03-31T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-cn-train", latestStatus: "on_track", percentComplete: 50, observationCount: 1, updatedAt: "2026-04-30T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-cn-culture", latestStatus: "on_track", percentComplete: 50, observationCount: 1, updatedAt: "2026-04-30T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-ctc-proc", latestStatus: "not_started", percentComplete: 0, observationCount: 0, updatedAt: "2025-01-22T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-ctc-comm", latestStatus: "on_track", percentComplete: 50, observationCount: 1, updatedAt: "2026-06-30T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-teck-proc", latestStatus: "on_track", percentComplete: 50, observationCount: 1, updatedAt: "2026-06-30T00:00:00.000Z", dataClass: "org_submitted" },
  { commitId: "c-teck-env", latestStatus: "delayed", percentComplete: 25, observationCount: 1, updatedAt: "2026-06-30T00:00:00.000Z", dataClass: "org_submitted" },
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
      pillars: ["relationships", "respect", "opportunities", "governance"], // derived from commitments
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
    businessNumber: null,
    businessNumberSource: null,
    registryLegalName: null,
    registryStatus: null,
    dataClass: "org_submitted",
  },
];
