// ===========================================================================
// RAP layer — submission portal (Idea 1) + RAP Index (Idea 2) data model.
//
// SEPARATE data layer from the report→confirm portal (src/lib/repo, deprecated
// in the pivot) and the RAP Impact Survey (src/lib/survey). It stores:
//   • the AI EXTRACTION pipeline's staged output (ExtractionJob), and
//   • the CANONICAL entities a human-approved extraction writes
//     (RapDocument → Commitment → Observation) that power the dashboard.
//
// DESIGN STANCE (see Week 7/RAP_Ideas_Implementation_Plan.md):
//   - The LLM's job is to LOCATE and QUOTE, never to KNOW or COMPUTE. Every
//     extracted field is wrapped in Grounded<T>: a value is only trusted if the
//     model returns the verbatim `quote` it came from. No quote ⇒ value = null.
//   - A fixed COMMON CORE + per-sector EXTENSION + an open `extras` bucket, so
//     novel fields surface instead of being force-fit or hallucinated.
//   - Nothing reaches a canonical entity until a human flips PENDING_REVIEW →
//     CONFIRMED. Aggregation/percentages are computed in code, not by the LLM.
// ===========================================================================

import type { CanonicalSector, CanonicalCommitmentType } from "@/lib/taxonomy";

// Bump when the extraction schema changes; stored on every job for traceability
// so re-runs and schema-evolution diffs are auditable.
export const RAP_SCHEMA_VERSION = "1.0.0";

// --- shared enums ----------------------------------------------------------
export type Jurisdiction = "AU" | "CA" | "other";

// RAP maturity tier — reliably present for Australian RAPs, rare for Canadian
export type RapType = "reflect" | "innovate" | "stretch" | "elevate";

export type Sector = CanonicalSector;

// Normalized pillar/theme set. Each document's idiosyncratic theme names are
// mapped onto this canonical list; the raw name is also retained per commitment.
export type Pillar =
  | "relationships"
  | "respect"
  | "opportunities"
  | "governance"
  | "employment"
  | "community"
  | "environment"
  | "economy"
  | "education"
  | "other";

export type CommitmentType = CanonicalCommitmentType;

// Canadian framing instruments / accreditations the extractor flags
export type FrameworkRef = "undrip" | "trc_cta_92" | "ocap" | "pair" | "other";
export type PairLevel = "committed" | "bronze" | "silver" | "gold";

// ===========================================================================
// GROUNDING — the core anti-hallucination primitive.
// Every extracted field is a Grounded<T>. The model MUST return the verbatim
// source span (`quote`) + page it pulled the value from. If it cannot cite a
// span, `quote` is null and `value` MUST be null — an ungrounded value is
// treated as a miss, not a guess. `flagged` is set by the validation/judge
// gates (low confidence, failed format/range check, or quote-doesn't-support).
// ===========================================================================
export interface Grounded<T> {
  value: T | null;
  quote: string | null; // verbatim text span from the source document
  page: number | null; // 1-indexed page the quote was found on
  confidence: number; // 0..1 (engine-reported; a hint, not proof)
  flagged: boolean; // true ⇒ must be human-reviewed before trust
}

// ===========================================================================
// STAGE 1 — classification. Routes the document to the right schema profile.
// ===========================================================================
export interface RapClassification {
  jurisdiction: Jurisdiction;
  sector: Sector;
  rapType: RapType | null; // AU maturity tier; null when not an AU-style RAP
  confidence: number; // 0..1
}

// ===========================================================================
// STAGE 2 — extraction. Common core + commitments + sector extension + extras.
// ===========================================================================
export interface ExtractedCommitment {
  pillarRaw: Grounded<string>; // the document's own pillar/theme wording
  pillarNormalized: Pillar | null; // mapped onto the canonical set (code-side)
  action: Grounded<string>; // high-level commitment ("what")
  deliverable: Grounded<string>; // concrete step ("how")
  timeline: Grounded<string>; // due date / quarter ("when")
  owner: Grounded<string>; // accountable role ("who")
  metric: Grounded<string>; // target / KPI (Stretch/Elevate & CA leaders)
  commitmentType: Grounded<CommitmentType>;
}

// Per-sector extension fields. Only the matching sector's block is populated;
// absence is meaningful (a finance RAP has no `mining` block).
export interface SectorFields {
  mining?: {
    ibaCount: Grounded<number>; // active Impact & Benefit Agreements
    estmaPayments: Grounded<number>; // CAD $ to Indigenous govts (ESTMA)
    tsmRating: Grounded<string>; // Towards Sustainable Mining protocol rating
  };
  finance?: {
    capitalCommitment: Grounded<number>; // CAD $ lending/capital pledged
    financialLiteracyPrograms: Grounded<string>;
  };
  telecom?: {
    connectivityTarget: Grounded<string>; // e.g. "Indigenous lands connected"
    communitiesConnected: Grounded<number>;
  };
  government?: {
    procurementTargetPct: Grounded<number>; // e.g. federal 5%
    procurementActualPct: Grounded<number>;
  };
}

// Open bucket: anything the model finds that doesn't map to a schema field.
// Drives controlled schema evolution — recurring extras get promoted to
// first-class fields in the next RAP_SCHEMA_VERSION (offline, human-approved).
export interface ExtractedExtra {
  label: string; // model's name for the field
  value: string;
  quote: string; // grounding is still mandatory for extras
  page: number | null;
}

export interface ExtractedRap {
  // --- common core (reliably present across AU + CA) ---
  orgName: Grounded<string>;
  sector: Grounded<Sector>;
  jurisdiction: Grounded<Jurisdiction>;
  rapTitle: Grounded<string>;
  publicationDate: Grounded<string>; // ISO 8601
  periodCovered: Grounded<{ start: string; end: string }>;
  frameworkRefs: Grounded<FrameworkRef[]>;
  pillars: Grounded<Pillar[]>; // normalized theme set for the whole doc
  governanceBody: Grounded<string>; // RAP Working Group / board sponsor
  reviewCycle: Grounded<string>; // annual / biennial / 3-year

  // --- optional / jurisdiction- or sector-dependent ---
  rapType: Grounded<RapType>; // AU maturity tier
  pairLevel: Grounded<PairLevel>; // CA — CCIB PAIR accreditation
  endorsementStatus: Grounded<string>; // AU only — RA-endorsed vs draft

  // --- the substance ---
  commitments: ExtractedCommitment[];
  sectorFields: SectorFields;
  extras: ExtractedExtra[];
}

// ===========================================================================
// VERIFICATION GATES — produced between extraction and human review.
//   ValidationIssue: deterministic checks (format/range/cross-field/no-quote).
//   FieldVerdict:    LLM-as-judge — "does this quote actually support this
//                    value?" run by a SECOND, independent model call.
// A field with any issue or a non-supporting verdict is force-flagged so the
// reviewer can't miss it.
// ===========================================================================
export type ValidationRule =
  | "no_quote" // value present but ungrounded
  | "date_format"
  | "currency_format"
  | "out_of_range"
  | "cross_field"; // e.g. timeline outside periodCovered

export interface ValidationIssue {
  path: string; // dotted path, e.g. "commitments[2].timeline"
  rule: ValidationRule;
  message: string;
}

export interface FieldVerdict {
  path: string;
  quoteSupportsValue: boolean; // judge result
  note: string | null;
}

// ===========================================================================
// EXTRACTION JOB — the staged record (single-table item EXTRACT#<id>).
// Lifecycle: PENDING → EXTRACTING → PENDING_REVIEW → CONFIRMED | REJECTED
//                                              └────────────→ FAILED (on error)
// ===========================================================================
export type ExtractionStatus =
  | "PENDING" // uploaded, not yet processed
  | "EXTRACTING" // pipeline running
  | "PENDING_REVIEW" // extracted + validated, awaiting human
  | "CONFIRMED" // human-approved; canonical entities written
  | "REJECTED" // human-rejected
  | "FAILED"; // pipeline error

export type ExtractionEngine = "bda" | "claude" | "textract+claude";

export interface ExtractionJob {
  id: string; // docId
  fileName: string;
  sourceS3Key: string; // raw document in the S3 upload bucket
  status: ExtractionStatus;
  schemaVersion: string; // RAP_SCHEMA_VERSION at extraction time
  engine: ExtractionEngine | null; // which extractor produced the result
  classification: RapClassification | null; // stage 1
  extracted: ExtractedRap | null; // stage 2 (edited in place on confirm)
  validationIssues: ValidationIssue[]; // deterministic gate
  verdicts: FieldVerdict[]; // judge gate
  reviewedBy: string | null; // reviewer id once actioned
  reviewNote: string | null; // edit/reject rationale
  rapId: string | null; // set once confirmed → links to RapDocument
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601

  // --- BN-keyed identity resolution (set at review, before publish) ---
  businessNumber: string | null; // 9-digit BN root, once resolved
  businessNumberSource: "ised" | "self_asserted" | null;
  registryLegalName: string | null; // registry-confirmed legal name
  registryStatus: string | null; // e.g. "Active"
}

// input to start a job (pre-extraction)
export interface NewExtractionJob {
  id: string;
  fileName: string;
  sourceS3Key: string;
}

// what the pipeline hands back to be staged for review
export interface ExtractionResult {
  engine: ExtractionEngine;
  schemaVersion: string;
  classification: RapClassification;
  extracted: ExtractedRap;
  validationIssues: ValidationIssue[];
  verdicts: FieldVerdict[];
}

// ===========================================================================
// CANONICAL ENTITIES — written only on CONFIRM. Power the RAP Index dashboard.
// Keys (see dynamo/rap-table.ts):
//   ORG#<orgId>      META               organization profile
//   ORG#<orgId>      RAP#<rapId>         RAP header
//   RAP#<rapId>      COMMIT#<commitId>   commitment
//   COMMIT#<commitId> OBS#<ISO ts>       time-stamped progress observation
//   COMMIT#<commitId> META               rollup (latest status, %complete)
// ===========================================================================
// How trustworthy is the underlying claim — distinct from extraction QA (did the
// AI read the doc right). A RAP is self-published, so its claims are
// self_reported by default; statutory/independently_verified mark the rarer
// cases where the number is backed by public/third-party data. This is the
// honest heir to the legacy 3-party identity tier — a SOURCE label, not a
// second-party confirmation — and lets the dashboard distinguish voluntary RAP
// claims from hard public data (the disclosure-gap thesis, without the 3 parties).
export type ClaimBasis =
  | "self_reported" // from the org's own published RAP (the default)
  | "statutory" // legally-mandated public data (federal 5%, ESTMA)
  | "independently_verified"; // a registry/third party corroborates (e.g. CCIB PAIR)

export interface Provenance {
  claimBasis: ClaimBasis;
  reviewedBy: string | null; // extraction QA: "system:auto" | an Indigenomics reviewer id
  reviewedAt: string | null;
  sourceS3Key: string; // the document the value came from
  extractionConfidence: number; // 0..1, min grounded confidence across the commitment
}

export type SizeBand = "lt_50" | "50_249" | "250_999" | "1000_plus" | "unknown";

export interface RapOrganization {
  id: string;
  name: string;
  sector: Sector;
  sizeBand: SizeBand;
  region: string; // province/state or country
  createdAt: string;

  // --- registry-backed identity (null until BN-verified) ---
  businessNumber: string | null; // 9-digit BN root
  legalName: string | null; // registry-confirmed legal name (may differ from `name`)
  registryStatus: string | null; // e.g. "Active"
  registrySource: "ised" | "self_asserted" | null;
  verifiedAt: string | null; // ISO 8601 — when the registry match was recorded
}

export interface RapDocument {
  id: string; // rapId
  orgId: string;
  title: string;
  jurisdiction: Jurisdiction;
  rapType: RapType | null;
  publicationDate: string; // ISO 8601
  periodStart: string;
  periodEnd: string;
  sourceS3Key: string; // provenance back to the uploaded document
  extractionId: string; // provenance back to the ExtractionJob
  claimBasis: ClaimBasis; // doc-level default for its commitments
  status: "active" | "superseded";
  createdAt: string;
}

export interface Commitment {
  id: string; // commitId
  rapId: string;
  orgId: string; // denormalized for sector/size GSI slicing
  sector: Sector; // denormalized for GSI
  pillar: Pillar;
  commitmentType: CommitmentType;
  action: string;
  deliverable: string;
  targetText: string | null;
  targetValue: number | null; // parsed in code, never by the LLM
  dueDate: string | null; // ISO 8601
  owner: string | null;
  // grounding: this commitment's value traces to a quote + page in the source doc
  source: { quote: string; page: number | null };
  // claim provenance: self-reported vs verified, and who QA'd the extraction
  provenance: Provenance;
}

export type ProgressStatus = "not_started" | "on_track" | "delayed" | "met" | "missed";

export interface Observation {
  commitId: string;
  observedAt: string; // ISO 8601 — the time-series sort key
  status: ProgressStatus;
  observedValue: number | null;
  note: string | null;
  recordedBy: string; // reviewer/system id
}

// commitment rollup (COMMIT#<id> / META) for O(1) current-state reads
export interface CommitmentRollup {
  commitId: string;
  latestStatus: ProgressStatus;
  percentComplete: number; // computed in code
  observationCount: number;
  updatedAt: string;
}

// ===========================================================================
// REPO INTERFACES — the seam the frontend/actions import. Implemented by an
// in-memory mock (default) and a DynamoDB version (REPO_IMPL=dynamo).
// ===========================================================================

// Staging-table lifecycle for the extraction pipeline (Idea 1).
export interface ExtractionRepo {
  // ingestion
  createJob(input: NewExtractionJob): Promise<ExtractionJob>; // → PENDING
  getJob(id: string): Promise<ExtractionJob | null>;

  // pipeline writes
  markExtracting(id: string): Promise<ExtractionJob>; // → EXTRACTING
  saveResult(id: string, result: ExtractionResult): Promise<ExtractionJob>; // → PENDING_REVIEW
  markFailed(id: string, error: string): Promise<ExtractionJob>; // → FAILED

  // review queue
  listByStatus(status: ExtractionStatus): Promise<ExtractionJob[]>;

  // human-in-the-loop gate. `edited` is the reviewer-corrected payload; confirm
  // flips the job to CONFIRMED and stamps rapId. The actual canonical writes are
  // orchestrated by an action that calls confirm() then rapRepo.* (single
  // responsibility: this repo owns the staging table only).
  confirmJob(id: string, reviewedBy: string, edited: ExtractedRap, rapId: string): Promise<ExtractionJob>;
  rejectJob(id: string, reviewedBy: string, reason: string): Promise<ExtractionJob>;

  // resolve (or clear) the job's BN-backed org identity ahead of publish (Task 4
  // sets this at review time). `null` clears back to self-asserted/name-keyed.
  setJobOrg(
    id: string,
    org: {
      businessNumber: string;
      businessNumberSource: "ised" | "self_asserted";
      registryLegalName: string | null;
      registryStatus: string | null;
    } | null,
  ): Promise<ExtractionJob>;
}

// Canonical RAP/commitment/observation store (Idea 2 dashboard).
export interface RapRepo {
  putOrganization(org: RapOrganization): Promise<RapOrganization>;
  getOrganization(id: string): Promise<RapOrganization | null>;

  putRap(rap: RapDocument): Promise<RapDocument>;
  getRap(id: string): Promise<RapDocument | null>;
  listRapsByOrg(orgId: string): Promise<RapDocument[]>;

  putCommitment(c: Commitment): Promise<Commitment>;
  listCommitmentsByRap(rapId: string): Promise<Commitment[]>;
  listCommitmentsBySector(sector: Sector): Promise<Commitment[]>; // GSI slice

  // cascade-delete a RAP header + its commitments, rollups and observations.
  // Used to make re-publishing the same document a clean REPLACE (dedup) rather
  // than appending a duplicate RAP + duplicate commitments.
  deleteRapGraph(orgId: string, rapId: string): Promise<void>;

  // append-only time-series; `between` powers progress-over-time
  putObservation(o: Observation): Promise<Observation>;
  listObservations(commitId: string, from?: string, to?: string): Promise<Observation[]>;

  putRollup(r: CommitmentRollup): Promise<CommitmentRollup>;
  getRollup(commitId: string): Promise<CommitmentRollup | null>;

  // Option-A re-extraction lock: true iff any Observation on this RAP's
  // commitments was recorded by a party OTHER than the pipeline's baseline
  // writer ("system"). Once true, publishAndConfirm refuses to overwrite the
  // RAP graph — company-recorded progress must never be silently wiped or
  // mis-attributed by a later re-extraction of the same document.
  hasCompanyProgress(rapId: string): Promise<boolean>;
}
