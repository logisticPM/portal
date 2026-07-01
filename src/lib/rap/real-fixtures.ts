// ===========================================================================
// REAL seed data — verified public figures from real Canadian Reconciliation
// Action Plans and Indigenous economic disclosures. Sourced from the team's
// research workbook (Indigenomics_Data_Portal_Research_v1_EN.xlsx) and the
// fact-checked master source list in Week 7/Data_Verification_and_Sources.md.
// Every figure here traces to a primary public source (company ESG/RAP reports,
// the ISC 5% procurement dataset on open.canada.ca, CER, NRCan ESTMA, CCIB PAIR).
//
// This is NOT fabricated demo data — used to seed the us-east-1 stack (real-only).
// Where a figure is a reported achievement it is marked status "met"; where it is
// a forward target it is "on_track". Provenance.sourceS3Key carries the primary
// source URL (or the local sample PDF path) for traceability.
// ===========================================================================
import type {
  ClaimBasis, Commitment, CommitmentRollup, ExtractionJob, Observation,
  ProgressStatus, RapDocument, RapOrganization,
} from "./types";

// --- organizations ---------------------------------------------------------
export const orgs: RapOrganization[] = [
  { id: "org-boc", name: "Bank of Canada", sector: "finance_banking", sizeBand: "1000_plus", region: "ON", createdAt: "2024-09-01T00:00:00.000Z" },
  { id: "org-rbc", name: "Royal Bank of Canada", sector: "finance_banking", sizeBand: "1000_plus", region: "ON", createdAt: "2025-06-20T00:00:00.000Z" },
  { id: "org-telus", name: "TELUS Communications", sector: "telecom", sizeBand: "1000_plus", region: "BC", createdAt: "2021-11-29T00:00:00.000Z" },
  { id: "org-agnico", name: "Agnico Eagle Mines", sector: "mining_extractive", sizeBand: "1000_plus", region: "ON", createdAt: "2024-07-10T00:00:00.000Z" },
  { id: "org-enbridge", name: "Enbridge", sector: "energy", sizeBand: "1000_plus", region: "AB", createdAt: "2022-01-01T00:00:00.000Z" },
  { id: "org-suncor", name: "Suncor Energy", sector: "energy", sizeBand: "1000_plus", region: "AB", createdAt: "2023-01-01T00:00:00.000Z" },
  { id: "org-tcenergy", name: "TC Energy", sector: "energy", sizeBand: "1000_plus", region: "AB", createdAt: "2023-01-01T00:00:00.000Z" },
  { id: "org-cnq", name: "Canadian Natural Resources", sector: "energy", sizeBand: "1000_plus", region: "AB", createdAt: "2024-01-01T00:00:00.000Z" },
  { id: "org-teck", name: "Teck Resources", sector: "mining_extractive", sizeBand: "1000_plus", region: "BC", createdAt: "2024-01-01T00:00:00.000Z" },
  { id: "org-gc", name: "Government of Canada", sector: "government", sizeBand: "1000_plus", region: "CA", createdAt: "2024-01-01T00:00:00.000Z" },
];

// --- RAP documents ---------------------------------------------------------
// sourceS3Key = primary public source (URL) or local sample path.
export const raps: RapDocument[] = [
  { id: "rap-boc-2024", orgId: "org-boc", title: "Reconciliation Action Plan", jurisdiction: "CA", rapType: null, publicationDate: "2024-09-01", periodStart: "2024-01-01", periodEnd: "2027-12-31", sourceS3Key: "https://www.bankofcanada.ca/wp-content/uploads/2024/09/reconciliation-action-plan.pdf", extractionId: "real-boc", claimBasis: "self_reported", status: "active", createdAt: "2024-09-01T00:00:00.000Z" },
  { id: "rap-rbc-2025", orgId: "org-rbc", title: "Pathways to Economic Prosperity (inaugural RAP)", jurisdiction: "CA", rapType: null, publicationDate: "2025-06-20", periodStart: "2025-01-01", periodEnd: "2028-12-31", sourceS3Key: "https://www.rbc.com/indigenous/_assets-custom/pdfs/reconciliation-action-plan-EN.pdf", extractionId: "real-rbc", claimBasis: "self_reported", status: "active", createdAt: "2025-06-20T00:00:00.000Z" },
  { id: "rap-telus-2025", orgId: "org-telus", title: "Indigenous Reconciliation & Connectivity Report (7th ed.)", jurisdiction: "CA", rapType: null, publicationDate: "2025-11-19", periodStart: "2025-01-01", periodEnd: "2026-12-31", sourceS3Key: "https://www.telus.com/en/social-impact/indigenous-reconciliation", extractionId: "real-telus", claimBasis: "independently_verified", status: "active", createdAt: "2025-11-19T00:00:00.000Z" },
  { id: "rap-agnico-2024", orgId: "org-agnico", title: "Reconciliation Action Plan 2024", jurisdiction: "CA", rapType: null, publicationDate: "2024-07-10", periodStart: "2024-01-01", periodEnd: "2027-12-31", sourceS3Key: "https://www.agnicoeagle.com/English/sustainability/Reconciliation-Action-Plan/default.aspx", extractionId: "real-agnico", claimBasis: "self_reported", status: "active", createdAt: "2024-07-10T00:00:00.000Z" },
  { id: "rap-enbridge-2022", orgId: "org-enbridge", title: "Indigenous Reconciliation Action Plan (2022; 2025 refresh)", jurisdiction: "CA", rapType: null, publicationDate: "2022-01-01", periodStart: "2022-01-01", periodEnd: "2030-12-31", sourceS3Key: "https://www.enbridge.com/reports/2025-indigenous-reconciliation-action-plan-refresh", extractionId: "real-enbridge", claimBasis: "self_reported", status: "active", createdAt: "2022-01-01T00:00:00.000Z" },
  { id: "rap-suncor-2023", orgId: "org-suncor", title: "2023 Report on Sustainability — Indigenous Relations", jurisdiction: "CA", rapType: null, publicationDate: "2023-01-01", periodStart: "2023-01-01", periodEnd: "2023-12-31", sourceS3Key: "https://www.suncor.com/en-ca/sustainability", extractionId: "real-suncor", claimBasis: "self_reported", status: "active", createdAt: "2023-01-01T00:00:00.000Z" },
  { id: "rap-tcenergy-2023", orgId: "org-tcenergy", title: "Indigenous Relations & Reconciliation (2023)", jurisdiction: "CA", rapType: null, publicationDate: "2023-01-01", periodStart: "2023-01-01", periodEnd: "2023-12-31", sourceS3Key: "https://www.tcenergy.com/sustainability/indigenous/", extractionId: "real-tcenergy", claimBasis: "self_reported", status: "active", createdAt: "2023-01-01T00:00:00.000Z" },
  { id: "rap-cnq-2024", orgId: "org-cnq", title: "Indigenous Relations (2024)", jurisdiction: "CA", rapType: null, publicationDate: "2024-01-01", periodStart: "2024-01-01", periodEnd: "2024-12-31", sourceS3Key: "https://www.cnrl.com/sustainability/communities/indigenous-relations/", extractionId: "real-cnq", claimBasis: "self_reported", status: "active", createdAt: "2024-01-01T00:00:00.000Z" },
  { id: "rap-teck-2024", orgId: "org-teck", title: "Sustainability Report — Indigenous Peoples (RAP in development)", jurisdiction: "CA", rapType: null, publicationDate: "2024-01-01", periodStart: "2023-01-01", periodEnd: "2023-12-31", sourceS3Key: "https://www.teck.com/sustainability/", extractionId: "real-teck", claimBasis: "self_reported", status: "active", createdAt: "2024-01-01T00:00:00.000Z" },
  { id: "rap-gc-2024", orgId: "org-gc", title: "Mandatory Minimum 5% Indigenous Procurement Target — FY2023-24 Results", jurisdiction: "CA", rapType: null, publicationDate: "2024-01-01", periodStart: "2023-04-01", periodEnd: "2024-03-31", sourceS3Key: "https://open.canada.ca/data/en/dataset/5d27d152-09d8-4303-adc4-0c46b4a9733b", extractionId: "real-gc", claimBasis: "statutory", status: "active", createdAt: "2024-01-01T00:00:00.000Z" },
];

const src = (quote: string, page: number | null = null) => ({ quote, page });
const prov = (sourceUrl: string, basis: ClaimBasis = "self_reported") => ({
  claimBasis: basis, reviewedBy: "research:verified", reviewedAt: "2026-06-29T00:00:00.000Z",
  sourceS3Key: sourceUrl, extractionConfidence: 0.99,
});

// --- commitments (real, verified figures) ----------------------------------
export const commitments: Commitment[] = [
  // Bank of Canada — RAP (qualitative pathways; no headline $ targets)
  { id: "rc-boc-workforce", rapId: "rap-boc-2024", orgId: "org-boc", sector: "finance_banking", pillar: "employment", commitmentType: "employment", action: "Grow Indigenous representation in the workforce", deliverable: "Recruitment, retention and advancement of Indigenous employees", targetText: null, targetValue: null, dueDate: "2027-12-31", owner: "Bank of Canada", source: src("Reconciliation Action Plan — People pathway", null), provenance: prov("https://www.bankofcanada.ca/wp-content/uploads/2024/09/reconciliation-action-plan.pdf") },
  { id: "rc-boc-culture", rapId: "rap-boc-2024", orgId: "org-boc", sector: "finance_banking", pillar: "respect", commitmentType: "cultural_awareness", action: "Build cultural competency across the Bank", deliverable: "Indigenous cultural learning for staff", targetText: null, targetValue: null, dueDate: "2027-12-31", owner: "Bank of Canada", source: src("Reconciliation Action Plan — Learning pathway", null), provenance: prov("https://www.bankofcanada.ca/wp-content/uploads/2024/09/reconciliation-action-plan.pdf") },

  // RBC — inaugural RAP (Jun 2025)
  { id: "rc-rbc-rap", rapId: "rap-rbc-2025", orgId: "org-rbc", sector: "finance_banking", pillar: "governance", commitmentType: "governance", action: "Launch inaugural Reconciliation Action Plan", deliverable: "“Pathways to Economic Prosperity” RAP published Jun 2025 (first for RBC)", targetText: null, targetValue: null, dueDate: "2028-12-31", owner: "RBC", source: src("RBC launches inaugural Reconciliation Action Plan, National Indigenous History Month 2025"), provenance: prov("https://www.rbc.com/indigenous/_assets-custom/pdfs/reconciliation-action-plan-EN.pdf") },

  // TELUS — RAP + PAIR + land
  { id: "rc-telus-rap", rapId: "rap-telus-2025", orgId: "org-telus", sector: "telecom", pillar: "governance", commitmentType: "governance", action: "Maintain a public Indigenous reconciliation action plan", deliverable: "First technology company in Canada to publicly commit to a RAP (2021); 7th annual report (2025)", targetText: null, targetValue: null, dueDate: null, owner: "TELUS", source: src("TELUS becomes first technology company in Canada to publicly commit to a RAP (Nov 2021)"), provenance: prov("https://www.telus.com/en/social-impact/indigenous-reconciliation") },
  { id: "rc-telus-pair", rapId: "rap-telus-2025", orgId: "org-telus", sector: "telecom", pillar: "governance", commitmentType: "governance", action: "Achieve third-party reconciliation certification", deliverable: "CCIB PAIR Silver certification", targetText: "PAIR Silver (2025)", targetValue: null, dueDate: "2025-12-31", owner: "TELUS", source: src("First tech company in Canada to achieve PAIR Silver (CCIB-verified)"), provenance: prov("https://www.ccib.ca/main/member/telus-communications-inc/", "independently_verified") },
  { id: "rc-telus-land", rapId: "rap-telus-2025", orgId: "org-telus", sector: "telecom", pillar: "environment", commitmentType: "environmental", action: "Restore traditional lands", deliverable: "Land restoration with Piikani + Blood Tribe", targetText: "500 ha", targetValue: 500, dueDate: "2025-12-31", owner: "TELUS", source: src("500 hectares restored (Piikani + Blood Tribe), 2025 report"), provenance: prov("https://www.newswire.ca/news-releases/telus-launches-2025-indigenous-reconciliation-and-connectivity-report-827437817.html") },

  // Agnico Eagle — RAP + procurement + community + training + ESTMA(statutory)
  { id: "rc-agnico-rap", rapId: "rap-agnico-2024", orgId: "org-agnico", sector: "mining_extractive", pillar: "governance", commitmentType: "governance", action: "Publish a Reconciliation Action Plan", deliverable: "First Canadian-based-and-led miner to publish a RAP (self-asserted, Jul 2024)", targetText: null, targetValue: null, dueDate: null, owner: "Agnico Eagle", source: src("Reconciliation Action Plan (Jul 2024)"), provenance: prov("https://www.agnicoeagle.com/English/sustainability/Reconciliation-Action-Plan/default.aspx") },
  { id: "rc-agnico-proc", rapId: "rap-agnico-2024", orgId: "org-agnico", sector: "mining_extractive", pillar: "economy", commitmentType: "procurement", action: "Sustain Indigenous procurement", deliverable: "~$1B Indigenous procurement (within $1.9B local total)", targetText: "~$1B (2023)", targetValue: 1_000_000_000, dueDate: "2023-12-31", owner: "Agnico Eagle", source: src("~$1 billion Indigenous procurement, 2023"), provenance: prov("https://www.prnewswire.com/news-releases/agnico-eagle-reports-first-quarter-2024-results-302127907.html") },
  { id: "rc-agnico-comm", rapId: "rap-agnico-2024", orgId: "org-agnico", sector: "mining_extractive", pillar: "community", commitmentType: "community_investment", action: "Invest in Indigenous communities", deliverable: "Donations + sponsorships", targetText: "$16M (2023)", targetValue: 16_000_000, dueDate: "2023-12-31", owner: "Agnico Eagle", source: src("$16M community donations & sponsorships, 2023"), provenance: prov("https://www.prnewswire.com/news-releases/agnico-eagle-reports-first-quarter-2024-results-302127907.html") },
  { id: "rc-agnico-train", rapId: "rap-agnico-2024", orgId: "org-agnico", sector: "mining_extractive", pillar: "education", commitmentType: "education_training", action: "Fund Inuit training", deliverable: "Annual Inuit training investment", targetText: "$4.6M (2025)", targetValue: 4_600_000, dueDate: "2025-12-31", owner: "Agnico Eagle", source: src("$4.6M Inuit training, 2025"), provenance: prov("https://www.agnicoeagle.com/English/sustainability/Reconciliation-Action-Plan/default.aspx") },
  { id: "rc-agnico-estma", rapId: "rap-agnico-2024", orgId: "org-agnico", sector: "mining_extractive", pillar: "economy", commitmentType: "other", action: "Report statutory payments to Indigenous governments", deliverable: "ESTMA payments to Nunavut Inuit associations + GN", targetText: "$90M+ (2024)", targetValue: 90_000_000, dueDate: "2024-12-31", owner: "Agnico Eagle", source: src("ESTMA 2024: $90M+ to Nunavut Inuit orgs"), provenance: prov("https://s205.q4cdn.com/243646470/files/doc_downloads/estma/AEM-ESTMA-2024.pdf", "statutory") },

  // Enbridge — IRAP goals + $1B procurement target + equity
  { id: "rc-enbridge-rap", rapId: "rap-enbridge-2022", orgId: "org-enbridge", sector: "energy", pillar: "governance", commitmentType: "governance", action: "Deliver the Indigenous Reconciliation Action Plan", deliverable: "22-goal IRAP (2022); 12 of 22 met by end-2024; 2025 refresh adds 20 new commitments", targetText: "22 goals", targetValue: 22, dueDate: "2030-12-31", owner: "Enbridge", source: src("2022 inaugural IRAP — 22 commitments"), provenance: prov("https://www.enbridge.com/reports/2022-indigenous-reconciliation-action-plan/about-this-irap") },
  { id: "rc-enbridge-proc", rapId: "rap-enbridge-2022", orgId: "org-enbridge", sector: "energy", pillar: "economy", commitmentType: "procurement", action: "Grow Indigenous & diverse procurement", deliverable: "Target $1B by 2030; $2.757B cumulative ($757M new) to date", targetText: "$1B by 2030", targetValue: 1_000_000_000, dueDate: "2030-12-31", owner: "Enbridge", source: src("IRAP Pillar 3: $1B target by 2030; $2.757B cumulative"), provenance: prov("https://www.enbridge.com/reports/2025-indigenous-reconciliation-action-plan-refresh/pillar-3-economic-inclusion-partnerships") },
  { id: "rc-enbridge-equity", rapId: "rap-enbridge-2022", orgId: "org-enbridge", sector: "energy", pillar: "opportunities", commitmentType: "partnership", action: "Enable Indigenous equity ownership", deliverable: "Athabasca Indigenous Investments — 23 communities, 11.57% of 7 oilsands lines", targetText: "$1.12B (2022)", targetValue: 1_120_000_000, dueDate: "2022-12-31", owner: "Enbridge", source: src("Athabasca Indigenous Investments: 23 communities, 11.57%, $1.12B (2022)"), provenance: prov("https://www.enbridge.com/media-center/news/details?id=123735") },

  // Suncor — procurement + equity
  { id: "rc-suncor-proc", rapId: "rap-suncor-2023", orgId: "org-suncor", sector: "energy", pillar: "economy", commitmentType: "procurement", action: "Sustain Indigenous procurement", deliverable: "$3.1B Indigenous procurement (20% of total spend)", targetText: "$3.1B / 20% (2023)", targetValue: 3_100_000_000, dueDate: "2023-12-31", owner: "Suncor", source: src("2023 Report on Sustainability: $3.1B Indigenous procurement, 20% of total"), provenance: prov("https://www.3blmedia.com/news/indigenous-relations-suncor-2023-report-sustainability") },
  { id: "rc-suncor-equity", rapId: "rap-suncor-2023", orgId: "org-suncor", sector: "energy", pillar: "opportunities", commitmentType: "partnership", action: "Enable Indigenous equity ownership", deliverable: "Astisiy LP — 8 communities, 14.25% of Northern Courier Pipeline", targetText: "14.25% stake", targetValue: 14.25, dueDate: "2021-12-31", owner: "Suncor", source: src("Astisiy LP: 8 communities acquired 14.25% of Northern Courier (2021)"), provenance: prov("https://www.globenewswire.com/news-release/2021/09/16/2298240/0/en/Suncor-and-eight-Indigenous-communities-announce-the-acquisition-of-the-Northern-Courier-Pipeline.html") },

  // TC Energy — procurement + training
  { id: "rc-tce-proc", rapId: "rap-tcenergy-2023", orgId: "org-tcenergy", sector: "energy", pillar: "economy", commitmentType: "procurement", action: "Sustain Indigenous procurement", deliverable: "$1.8B Indigenous & Native American procurement", targetText: "$1.8B (2023)", targetValue: 1_800_000_000, dueDate: "2023-12-31", owner: "TC Energy", source: src("TC Energy Indigenous page: $1.8B (2023)"), provenance: prov("https://www.tcenergy.com/sustainability/indigenous/") },
  { id: "rc-tce-train", rapId: "rap-tcenergy-2023", orgId: "org-tcenergy", sector: "energy", pillar: "respect", commitmentType: "cultural_awareness", action: "Complete Indigenous awareness training", deliverable: "Mandatory cultural awareness training module", targetText: "92% completion (2023)", targetValue: 92, dueDate: "2023-12-31", owner: "TC Energy", source: src("92% training completion, 2023"), provenance: prov("https://www.tcenergy.com/sustainability/indigenous/") },

  // Canadian Natural — procurement + relationships
  { id: "rc-cnq-proc", rapId: "rap-cnq-2024", orgId: "org-cnq", sector: "energy", pillar: "economy", commitmentType: "procurement", action: "Grow Indigenous procurement", deliverable: "$855M+ with 212 Indigenous businesses", targetText: "$855M+ (2024)", targetValue: 855_000_000, dueDate: "2024-12-31", owner: "Canadian Natural", source: src("$855M+ Indigenous procurement, 212 businesses (2024)"), provenance: prov("https://www.cnrl.com/sustainability/communities/indigenous-relations/") },
  { id: "rc-cnq-rel", rapId: "rap-cnq-2024", orgId: "org-cnq", sector: "energy", pillar: "relationships", commitmentType: "partnership", action: "Maintain Indigenous community relationships", deliverable: "80+ active community relationships", targetText: "80+ communities", targetValue: 80, dueDate: "2024-12-31", owner: "Canadian Natural", source: src("80+ community relationships (2024)"), provenance: prov("https://www.cnrl.com/sustainability/communities/indigenous-relations/") },

  // Teck — procurement + community
  { id: "rc-teck-proc", rapId: "rap-teck-2024", orgId: "org-teck", sector: "mining_extractive", pillar: "economy", commitmentType: "procurement", action: "Grow Indigenous procurement", deliverable: "Indigenous procurement spend", targetText: "$388M (2023)", targetValue: 388_000_000, dueDate: "2023-12-31", owner: "Teck", source: src("2023 sustainability performance: $388M (2023)"), provenance: prov("https://www.globenewswire.com/news-release/2024/03/14/2846753/0/en/teck-reports-2023-sustainability-performance.html") },
  { id: "rc-teck-comm", rapId: "rap-teck-2024", orgId: "org-teck", sector: "mining_extractive", pillar: "community", commitmentType: "community_investment", action: "Invest in communities", deliverable: "Community + Indigenous investment (combined)", targetText: "$32M+ (2023)", targetValue: 32_000_000, dueDate: "2023-12-31", owner: "Teck", source: src("$32M+ community + Indigenous investment (2023)"), provenance: prov("https://www.globenewswire.com/news-release/2024/03/14/2846753/0/en/teck-reports-2023-sustainability-performance.html") },

  // Government of Canada — statutory 5% procurement target
  { id: "rc-gc-5pct", rapId: "rap-gc-2024", orgId: "org-gc", sector: "government", pillar: "economy", commitmentType: "procurement", action: "Meet the mandatory minimum 5% Indigenous procurement target", deliverable: "Government-wide 5% of contract value to Indigenous business", targetText: "5% target — achieved 6.11%", targetValue: 6.11, dueDate: "2024-03-31", owner: "Indigenous Services Canada", source: src("FY2023-24: $1.241B to Indigenous business = 6.11% government-wide (exceeded 5%)"), provenance: prov("https://open.canada.ca/data/en/dataset/5d27d152-09d8-4303-adc4-0c46b4a9733b", "statutory") },
  { id: "rc-gc-nrcan", rapId: "rap-gc-2024", orgId: "org-gc", sector: "government", pillar: "economy", commitmentType: "procurement", action: "Departmental Indigenous procurement (NRCan)", deliverable: "Natural Resources Canada Indigenous contract value", targetText: "17.0% ($65.8M)", targetValue: 17.0, dueDate: "2024-03-31", owner: "Natural Resources Canada", source: src("ISC 5% dataset FY2023-24: NRCan 16.99%"), provenance: prov("https://open.canada.ca/data/dataset/5d27d152-09d8-4303-adc4-0c46b4a9733b/resource/a0dec98d-de1e-49b9-ad7f-ef61461b56e5", "statutory") },
];

// status for each commitment: reported achievements = met; forward targets = on_track
const STATUS: Record<string, ProgressStatus> = {
  "rc-boc-workforce": "on_track", "rc-boc-culture": "on_track",
  "rc-rbc-rap": "met",
  "rc-telus-rap": "met", "rc-telus-pair": "met", "rc-telus-land": "met",
  "rc-agnico-rap": "met", "rc-agnico-proc": "met", "rc-agnico-comm": "met", "rc-agnico-train": "met", "rc-agnico-estma": "met",
  "rc-enbridge-rap": "on_track", "rc-enbridge-proc": "on_track", "rc-enbridge-equity": "met",
  "rc-suncor-proc": "met", "rc-suncor-equity": "met",
  "rc-tce-proc": "met", "rc-tce-train": "met",
  "rc-cnq-proc": "met", "rc-cnq-rel": "met",
  "rc-teck-proc": "met", "rc-teck-comm": "met",
  "rc-gc-5pct": "met", "rc-gc-nrcan": "met",
};
const PCT: Record<ProgressStatus, number> = { not_started: 0, on_track: 60, delayed: 25, met: 100, missed: 0 };

export const rollups: CommitmentRollup[] = commitments.map((c) => {
  const s = STATUS[c.id] ?? "not_started";
  return { commitId: c.id, latestStatus: s, percentComplete: PCT[s], observationCount: 1, updatedAt: "2026-06-29T00:00:00.000Z" };
});

export const observations: Observation[] = [];
export const jobs: ExtractionJob[] = [];
