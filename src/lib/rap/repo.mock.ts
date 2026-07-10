// ===========================================================================
// rapRepo + extractionRepo — in-memory mocks. Let the frontend build the
// upload/review UI and the RAP Index dashboard WITHOUT running DynamoDB or
// calling Bedrock. Default impl (REPO_IMPL unset). Same interfaces as the
// DynamoDB versions.
//
// Store pinned to globalThis (same reason as survey/repo.mock.ts): a server
// action and an RSC render can load this module in separate bundle layers; a
// shared store keeps a write from the action visible to the next render.
// ===========================================================================
import type {
  Commitment,
  CommitmentRollup,
  ExtractedRap,
  ExtractionJob,
  ExtractionRepo,
  ExtractionResult,
  ExtractionStatus,
  NewExtractionJob,
  Observation,
  RapDocument,
  RapOrganization,
  RapRepo,
  Sector,
} from "./types";
import { RAP_SCHEMA_VERSION } from "./types";
import * as seed from "./fixtures";

type RapStore = {
  jobs: ExtractionJob[];
  orgs: RapOrganization[];
  raps: RapDocument[];
  commitments: Commitment[];
  observations: Observation[];
  rollups: CommitmentRollup[];
};

const g = globalThis as typeof globalThis & { __rapStore?: RapStore };
const store: RapStore =
  g.__rapStore ??
  (g.__rapStore = {
    jobs: seed.jobs.map((j) => ({ ...j })),
    orgs: seed.orgs.map((o) => ({ ...o })),
    raps: seed.raps.map((r) => ({ ...r })),
    commitments: seed.commitments.map((c) => ({ ...c })),
    observations: seed.observations.map((o) => ({ ...o })),
    rollups: seed.rollups.map((r) => ({ ...r })),
  });

const now = () => new Date().toISOString();

function findJob(id: string): ExtractionJob {
  const job = store.jobs.find((j) => j.id === id);
  if (!job) throw new Error(`ExtractionJob ${id} not found`);
  return job;
}

// --- extractionRepo --------------------------------------------------------
export const mockExtractionRepo: ExtractionRepo = {
  async createJob(input: NewExtractionJob) {
    const job: ExtractionJob = {
      id: input.id,
      fileName: input.fileName,
      sourceS3Key: input.sourceS3Key,
      status: "PENDING",
      schemaVersion: RAP_SCHEMA_VERSION,
      engine: null,
      classification: null,
      extracted: null,
      validationIssues: [],
      verdicts: [],
      reviewedBy: null,
      reviewNote: null,
      rapId: null,
      createdAt: now(),
      updatedAt: now(),
      businessNumber: null,
      businessNumberSource: null,
      registryLegalName: null,
      registryStatus: null,
    };
    store.jobs.push(job);
    return job;
  },

  async getJob(id) {
    return store.jobs.find((j) => j.id === id) ?? null;
  },

  async markExtracting(id) {
    const job = findJob(id);
    job.status = "EXTRACTING";
    job.updatedAt = now();
    return job;
  },

  async saveResult(id, result: ExtractionResult) {
    const job = findJob(id);
    job.status = "PENDING_REVIEW";
    job.engine = result.engine;
    job.schemaVersion = result.schemaVersion;
    job.classification = result.classification;
    job.extracted = result.extracted;
    job.validationIssues = result.validationIssues;
    job.verdicts = result.verdicts;
    job.updatedAt = now();
    return job;
  },

  async markFailed(id, error) {
    const job = findJob(id);
    job.status = "FAILED";
    job.reviewNote = error;
    job.updatedAt = now();
    return job;
  },

  async listByStatus(status: ExtractionStatus) {
    return store.jobs.filter((j) => j.status === status);
  },

  async confirmJob(id, reviewedBy, edited: ExtractedRap, rapId) {
    const job = findJob(id);
    job.status = "CONFIRMED";
    job.extracted = edited; // reviewer-corrected payload wins
    job.reviewedBy = reviewedBy;
    job.rapId = rapId;
    job.updatedAt = now();
    return job;
  },

  async rejectJob(id, reviewedBy, reason) {
    const job = findJob(id);
    job.status = "REJECTED";
    job.reviewedBy = reviewedBy;
    job.reviewNote = reason;
    job.updatedAt = now();
    return job;
  },

  async setJobOrg(id, org) {
    const job = findJob(id);
    job.businessNumber = org?.businessNumber ?? null;
    job.businessNumberSource = org?.businessNumberSource ?? null;
    job.registryLegalName = org?.registryLegalName ?? null;
    job.registryStatus = org?.registryStatus ?? null;
    job.updatedAt = now();
    return job;
  },
};

// --- rapRepo (canonical entities) ------------------------------------------
export const mockRapRepo: RapRepo = {
  async putOrganization(org) {
    const i = store.orgs.findIndex((o) => o.id === org.id);
    if (i >= 0) store.orgs[i] = org;
    else store.orgs.push(org);
    return org;
  },

  async getOrganization(id) {
    return store.orgs.find((o) => o.id === id) ?? null;
  },

  async putRap(rap) {
    const i = store.raps.findIndex((r) => r.id === rap.id);
    if (i >= 0) store.raps[i] = rap;
    else store.raps.push(rap);
    return rap;
  },

  async getRap(id) {
    return store.raps.find((r) => r.id === id) ?? null;
  },

  async listRapsByOrg(orgId) {
    return store.raps.filter((r) => r.orgId === orgId);
  },

  async putCommitment(c) {
    const i = store.commitments.findIndex((x) => x.id === c.id);
    if (i >= 0) store.commitments[i] = c;
    else store.commitments.push(c);
    return c;
  },

  async listCommitmentsByRap(rapId) {
    return store.commitments.filter((c) => c.rapId === rapId);
  },

  async listCommitmentsBySector(sector: Sector) {
    return store.commitments.filter((c) => c.sector === sector);
  },

  async deleteRapGraph(_orgId, rapId) {
    const doomed = new Set(store.commitments.filter((c) => c.rapId === rapId).map((c) => c.id));
    store.commitments = store.commitments.filter((c) => c.rapId !== rapId);
    store.rollups = store.rollups.filter((r) => !doomed.has(r.commitId));
    store.observations = store.observations.filter((o) => !doomed.has(o.commitId));
    store.raps = store.raps.filter((r) => r.id !== rapId);
  },

  async putObservation(o) {
    const i = store.observations.findIndex(
      (x) => x.commitId === o.commitId && x.observedAt === o.observedAt,
    );
    if (i >= 0) store.observations[i] = o;
    else store.observations.push(o);
    return o;
  },

  async listObservations(commitId, from, to) {
    return store.observations
      .filter((o) => o.commitId === commitId)
      .filter((o) => (from ? o.observedAt >= from : true) && (to ? o.observedAt <= to : true))
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  },

  async putRollup(r) {
    const i = store.rollups.findIndex((x) => x.commitId === r.commitId);
    if (i >= 0) store.rollups[i] = r;
    else store.rollups.push(r);
    return r;
  },

  async getRollup(commitId) {
    return store.rollups.find((r) => r.commitId === commitId) ?? null;
  },

  async hasCompanyProgress(rapId) {
    const ids = new Set(store.commitments.filter((c) => c.rapId === rapId).map((c) => c.id));
    return store.observations.some((o) => ids.has(o.commitId) && o.recordedBy !== "system");
  },
};
