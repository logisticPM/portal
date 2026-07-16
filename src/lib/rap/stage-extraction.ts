// ===========================================================================
// Shared post-upload extraction handling — used by BOTH the upload server action
// (sync/local path) and the async extractor Lambda (src/functions/rap-extract).
// Deliberately NOT a "use server" module so a plain Lambda can import it.
//
// markExtracting → runExtraction (BDA/Claude/mock) → saveResult → auto-publish
// (when REVIEW_MODE is off or the extraction is clean). Never throws — a failure
// is recorded on the job (status FAILED) and returned.
// ===========================================================================
import { createHash } from "node:crypto";
import { extractionRepo, rapRepo } from "./index";
import { runExtraction } from "./pipeline";
import { buildCanonical, isClean, reviewIsOff, scrubForAutoPublish } from "./publish";
import { getDocumentBytes, isUploadConfigured } from "./storage";
import type { ExtractedRap, ExtractionJob } from "./types";

const uuid = () => globalThis.crypto.randomUUID();

// Collapse corporate-suffix / punctuation noise so "Enbridge", "Enbridge Inc."
// and "ENBRIDGE, INC" all map to one organization identity. Conservative — only
// strips well-known legal-form suffixes and separators. This makes the dedup key
// robust to the extractor returning a slightly different org name between runs.
export function normalizeOrgName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/&/g, " and ")
    .replace(/\b(incorporated|inc|corporation|corp|limited|ltd|llc|llp|lp|ulc|plc|company|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const orgIdFor = (orgName: string): string =>
  "org-" + normalizeOrgName(orgName).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

// BN-keyed org identity: the 9-digit BN root is the authoritative identity for a
// registry-verified business, so program accounts of the SAME business (and
// name-spelling variance) all collapse onto one org row.
export const orgIdForBN = (bn9: string): string => `org-bn-${bn9}`;

// The document's stable identity: a content hash of the SOURCE bytes when S3 is
// configured, else a hash of the file name (dev/mock/test — same file name =
// same logical document). Keyed on the source document, so a re-extraction that
// wobbles the model-produced title/period still maps to the SAME rapId.
export async function documentContentHash(sourceS3Key: string, fileName: string): Promise<string> {
  if (isUploadConfigured()) {
    try {
      const bytes = await getDocumentBytes(sourceS3Key);
      return "sha256:" + createHash("sha256").update(bytes).digest("hex");
    } catch {
      // object unreadable (transient) → fall back to the name-based identity
    }
  }
  return "name:" + createHash("sha256").update(fileName).digest("hex");
}

// DEDUP: a RAP's identity is org + source-document. Re-publishing the same
// document yields the SAME rapId, so the delete-then-write below REPLACES the
// prior version instead of appending a duplicate.
export function stableRapId(orgId: string, contentHash: string): string {
  const basis = `${orgId}|${contentHash}`;
  let h = 0;
  for (let i = 0; i < basis.length; i++) h = (h * 31 + basis.charCodeAt(i)) >>> 0;
  return `${orgId}-${h.toString(36)}`;
}

// Turn a reviewed/clean extraction into canonical entities (org + rap + commitments
// + observations + rollups) and mark the job CONFIRMED. Re-publishing the same
// document replaces the prior canonical graph (no duplicate double-counting).
export async function publishAndConfirm(job: ExtractionJob, extracted: ExtractedRap, reviewedBy: string) {
  const now = new Date().toISOString();
  const orgId = job.businessNumber
    ? orgIdForBN(job.businessNumber)
    : orgIdFor(extracted.orgName.value || job.id);
  const contentHash = await documentContentHash(job.sourceS3Key, job.fileName);
  const rapId = stableRapId(orgId, contentHash);

  // Option-A guarantee: once a company has recorded any progress on this RAP,
  // re-extraction is locked — deleteRapGraph below would otherwise silently
  // wipe or mis-attribute that progress. Upload a corrected version as a new
  // document instead (it gets its own rapId).
  if (await rapRepo.hasCompanyProgress(rapId)) {
    throw new Error("RAP is locked: company progress recorded — upload a corrected version as a new document");
  }

  const { org, rap, commitments, observations, rollups } = buildCanonical(
    extracted,
    { orgId, rapId, commitId: () => uuid() },
    {
      sourceS3Key: job.sourceS3Key,
      extractionId: job.id,
      now,
      reviewedBy,
      dataClass: job.dataClass,
      registry: job.businessNumber
        ? {
            businessNumber: job.businessNumber,
            legalName: job.registryLegalName,
            registryStatus: job.registryStatus,
            registrySource: job.businessNumberSource!,
            verifiedAt: now,
          }
        : null,
    },
  );

  await rapRepo.putOrganization(org);
  await rapRepo.deleteRapGraph(orgId, rapId); // dedup: drop any prior version of this exact RAP
  await rapRepo.putRap(rap);
  for (const c of commitments) await rapRepo.putCommitment(c);
  for (const o of observations) await rapRepo.putObservation(o);
  for (const r of rollups) await rapRepo.putRollup(r);

  await extractionRepo.confirmJob(job.id, reviewedBy, extracted, rapId);
}

export type StageOutcome = { status: "published" | "review" | "failed"; error?: string };

export async function stageExtraction(input: {
  jobId: string; fileName: string; sourceS3Key: string;
}): Promise<StageOutcome> {
  const { jobId, fileName, sourceS3Key } = input;
  try {
    await extractionRepo.markExtracting(jobId);
    const result = await runExtraction({ fileName, sourceS3Key });
    const staged = await extractionRepo.saveResult(jobId, result);

    if (reviewIsOff()) {
      // no human step: publish everything, keeping only grounded+validated fields
      await publishAndConfirm(staged, scrubForAutoPublish(result.extracted), "system:auto");
      return { status: "published" };
    }
    if (isClean(result)) {
      await publishAndConfirm(staged, result.extracted, "system:auto");
      return { status: "published" };
    }
    return { status: "review" }; // flagged → human review queue
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await extractionRepo.markFailed(jobId, msg).catch(() => {});
    return { status: "failed", error: msg };
  }
}
