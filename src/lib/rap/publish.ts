// ===========================================================================
// publish — pure mapping from a human-approved ExtractedRap to the canonical
// entities (RapDocument → Commitment[] → seed Observation[]) the dashboard
// reads. NO LLM here: target numbers and dates are parsed deterministically in
// code (the rule from the hallucination design — the model locates & quotes,
// code computes). Also hosts the "is this extraction clean enough to
// auto-publish?" check used by the confidence gate.
// ===========================================================================
import type {
  ClaimBasis,
  Commitment,
  CommitmentRollup,
  CommitmentType,
  ExtractedCommitment,
  ExtractedRap,
  ExtractionResult,
  Grounded,
  Observation,
  Pillar,
  RapDocument,
  RapOrganization,
  Sector,
  SizeBand,
} from "./types";
import type { DataClass } from "../governance";
import { COMMITMENT_TYPES, PILLARS, SECTORS } from "./extraction-schema";

// Coerce a raw (possibly model-produced) string to a known enum value, falling
// back when it's out of range. BDA doesn't hard-enforce the blueprint enums, so
// e.g. a pillar name ("economy") can leak into commitmentType — this stops any
// out-of-enum value from reaching the dashboard (where it renders as a blank
// category). See the "economy" incident on the RBC extraction.
function oneOf<T extends string>(v: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return v != null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

// Pipeline sets Grounded.flagged when confidence < this OR a validation rule
// fails. The action layer treats any flagged field as "needs a human", so this
// constant is the single knob trading manual-review volume against safety.
export const CONFIDENCE_THRESHOLD = 0.85;

// Who clears the QA queue:
//   "indigenomics" (default) — flagged docs route to /rap/review for a human.
//   "off"                    — no human step; every upload auto-publishes,
//                              trusting ONLY grounded + validation-passing fields
//                              (scrubForAutoPublish blanks the rest). The review
//                              UI stays in the repo, dormant.
export type ReviewMode = "indigenomics" | "off";
export const REVIEW_MODE: ReviewMode =
  process.env.REVIEW_MODE === "off" ? "off" : "indigenomics";
export const reviewIsOff = () => REVIEW_MODE === "off";

// --- deterministic parsers (code-side, never the LLM) ----------------------

// "$1.8B" → 1_800_000_000 · "$855 million" → 855_000_000 · "5%" → 5 · "212" → 212
export function parseTargetValue(text: string | null): number | null {
  if (!text) return null;
  const cleaned = text.replace(/,/g, "");
  const m = cleaned.match(/(\d+(?:\.\d+)?)\s*(b|bn|billion|m|mm|million|k|thousand|%)?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  switch ((m[2] ?? "").toLowerCase()) {
    case "b":
    case "bn":
    case "billion":
      return n * 1_000_000_000;
    case "m":
    case "mm":
    case "million":
      return n * 1_000_000;
    case "k":
    case "thousand":
      return n * 1_000;
    default:
      return n; // includes "%" → raw percentage value, and bare integers
  }
}

// Accepts ISO dates, "2027", "Q2 2026", "June 2025" → best-effort ISO date string.
// A timeline that RECURS rather than falling due. Not a malformed date — a
// different kind of timeline, and the most common kind in a real RAP ("Host an
// annual event", "review every three years"). Recognising it lets validate.ts
// stop reporting a legitimate cadence as a date_format defect, which flagged the
// field and made isClean() false on essentially every RAP. Deliberately a closed
// list: unrecognised text ("sometime", "TBD") is still a real defect and must
// still flag, so this must not degrade into "anything non-numeric is fine".
const RECURRING =
  /\b(annual|annually|ongoing|continuous(?:ly)?|quarterly|monthly|weekly|daily|biannual|semi-?annual|periodic(?:ally)?|regular(?:ly)?|each\s+year|every\s+[\w-]+\s+(?:year|month|quarter)s?)\b/i;

export function isRecurringTimeline(text: string | null): boolean {
  return text !== null && RECURRING.test(text);
}

export function parseDueDate(text: string | null): string | null {
  if (!text) return null;
  const iso = text.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const year = text.match(/\b(20\d{2})\b/);
  if (year) {
    const q = text.match(/Q([1-4])/i);
    if (q) {
      const month = ["03", "06", "09", "12"][parseInt(q[1], 10) - 1];
      return `${year[1]}-${month}-30`;
    }
    return `${year[1]}-12-31`; // year-only → end of that year
  }
  return null;
}

// --- the clean / auto-publish gate -----------------------------------------

// Walk every Grounded field on the extraction so we can ask "is anything
// flagged?" without threading checks through each call site.
function collectGrounded(e: ExtractedRap): Grounded<unknown>[] {
  const core: Grounded<unknown>[] = [
    e.orgName, e.sector, e.jurisdiction, e.rapTitle, e.publicationDate,
    e.periodCovered, e.frameworkRefs, e.governanceBody, e.reviewCycle,
    e.rapType, e.pairLevel, e.endorsementStatus,
  ];
  for (const c of e.commitments) {
    core.push(c.pillarRaw, c.action, c.deliverable, c.timeline, c.owner, c.metric, c.commitmentType);
  }
  return core;
}

// Clean ⇒ no validation issues, no judge disagreement, no flagged field. Such a
// job can be auto-published; anything else routes to the human review queue.
export function isClean(result: ExtractionResult): boolean {
  if (result.validationIssues.length > 0) return false;
  if (result.verdicts.some((v) => !v.quoteSupportsValue)) return false;
  if (collectGrounded(result.extracted).some((g) => g.flagged)) return false;
  return true;
}

// Auto-publish safety net (REVIEW_MODE="off"): blank any field that is flagged or
// ungrounded so unreviewed junk never reaches the public board — keep only what
// the model both quoted and passed validation on. Pure; returns a new object.
function scrub<T>(g: Grounded<T>): Grounded<T> {
  return g.flagged || g.quote === null ? { ...g, value: null } : g;
}
export function scrubForAutoPublish(e: ExtractedRap): ExtractedRap {
  return {
    ...e,
    orgName: scrub(e.orgName), sector: scrub(e.sector), jurisdiction: scrub(e.jurisdiction),
    rapTitle: scrub(e.rapTitle), publicationDate: scrub(e.publicationDate),
    periodCovered: scrub(e.periodCovered), frameworkRefs: scrub(e.frameworkRefs),
    governanceBody: scrub(e.governanceBody),
    reviewCycle: scrub(e.reviewCycle), rapType: scrub(e.rapType),
    pairLevel: scrub(e.pairLevel), endorsementStatus: scrub(e.endorsementStatus),
    commitments: e.commitments.map((c) => ({
      ...c,
      pillarRaw: scrub(c.pillarRaw), action: scrub(c.action), deliverable: scrub(c.deliverable),
      timeline: scrub(c.timeline), owner: scrub(c.owner), metric: scrub(c.metric),
      commitmentType: scrub(c.commitmentType),
    })),
  };
}

// lowest grounded confidence across a commitment → its extractionConfidence
function commitmentConfidence(c: ExtractedCommitment): number {
  return Math.min(
    c.pillarRaw.confidence, c.action.confidence, c.deliverable.confidence,
    c.timeline.confidence, c.owner.confidence, c.metric.confidence, c.commitmentType.confidence,
  );
}

// --- ExtractedRap → canonical entities -------------------------------------

const val = <T>(g: Grounded<T>): T | null => g.value;

function deriveSizeBand(): SizeBand {
  // size isn't in the RAP document itself; resolved later from org metadata.
  return "unknown";
}

export interface PublishResult {
  org: RapOrganization;
  rap: RapDocument;
  commitments: Commitment[];
  observations: Observation[];
  rollups: CommitmentRollup[];
}

// Map an approved extraction into the canonical graph. `ids` are generated by
// the caller (server action) so this stays pure and testable.
export function buildCanonical(
  extracted: ExtractedRap,
  ids: { orgId: string; rapId: string; commitId: (i: number) => string },
  meta: {
    sourceS3Key: string;
    extractionId: string;
    now: string;
    reviewedBy: string | null; // "system:auto" | reviewer id
    dataClass: DataClass; // REQUIRED — from the job. Never defaulted (spec §6).
    claimBasis?: ClaimBasis; // default: self_reported (RAPs are self-published)
    // registry-backed identity (Task 3: BN-keyed org). null/absent ⇒ self-asserted,
    // name-keyed org — every field on the org defaults to null.
    registry?: {
      businessNumber: string;
      legalName: string | null;
      registryStatus: string | null;
      registrySource: "ised" | "self_asserted";
      verifiedAt: string;
    } | null;
  },
): PublishResult {
  const claimBasis: ClaimBasis = meta.claimBasis ?? "self_reported";
  const sector = oneOf<Sector>(val(extracted.sector), SECTORS, "other");
  const orgName = val(extracted.orgName) ?? "Unknown organization";

  const org: RapOrganization = {
    id: ids.orgId,
    name: meta.registry?.legalName ?? orgName,
    sector,
    sizeBand: deriveSizeBand(),
    region: val(extracted.jurisdiction) ?? "unknown",
    createdAt: meta.now,
    businessNumber: meta.registry?.businessNumber ?? null,
    legalName: meta.registry?.legalName ?? null,
    registryStatus: meta.registry?.registryStatus ?? null,
    registrySource: meta.registry?.registrySource ?? null,
    verifiedAt: meta.registry?.verifiedAt ?? null,
    dataClass: meta.dataClass,
  };

  const period = val(extracted.periodCovered);
  const rap: RapDocument = {
    id: ids.rapId,
    orgId: ids.orgId,
    title: val(extracted.rapTitle) ?? `${orgName} RAP`,
    jurisdiction: val(extracted.jurisdiction) ?? "other",
    rapType: val(extracted.rapType),
    publicationDate: val(extracted.publicationDate) ?? meta.now,
    periodStart: period?.start ?? "",
    periodEnd: period?.end ?? "",
    sourceS3Key: meta.sourceS3Key,
    extractionId: meta.extractionId,
    claimBasis,
    status: "active",
    createdAt: meta.now,
    dataClass: meta.dataClass,
  };

  const commitments: Commitment[] = [];
  const observations: Observation[] = [];
  const rollups: CommitmentRollup[] = [];

  extracted.commitments.forEach((c, i) => {
    const id = ids.commitId(i);
    commitments.push({
      id,
      rapId: ids.rapId,
      orgId: ids.orgId,
      sector,
      pillar: oneOf<Pillar>(c.pillarNormalized, PILLARS, "other"),
      commitmentType: oneOf<CommitmentType>(val(c.commitmentType), COMMITMENT_TYPES, "other"),
      action: val(c.action) ?? "",
      deliverable: val(c.deliverable) ?? "",
      targetText: val(c.metric),
      targetValue: parseTargetValue(val(c.metric)), // parsed in code
      timelineText: val(c.timeline), // the document's words — kept even when they don't parse
      dueDate: parseDueDate(val(c.timeline)), // parsed in code; null for a cadence
      owner: val(c.owner),
      source: { quote: c.action.quote ?? "", page: c.action.page },
      provenance: {
        claimBasis,
        reviewedBy: meta.reviewedBy,
        reviewedAt: meta.now,
        sourceS3Key: meta.sourceS3Key,
        extractionConfidence: commitmentConfidence(c),
      },
      dataClass: meta.dataClass,
    });
    // seed a baseline observation so the commitment shows on the trend from day 1
    observations.push({
      commitId: id,
      observedAt: meta.now,
      status: "not_started",
      observedValue: null,
      note: "Baseline at publication",
      recordedBy: "system",
      dataClass: meta.dataClass,
    });
    rollups.push({
      commitId: id,
      latestStatus: "not_started",
      percentComplete: 0,
      observationCount: 1,
      updatedAt: meta.now,
      dataClass: meta.dataClass,
    });
  });

  return { org, rap, commitments, observations, rollups };
}
