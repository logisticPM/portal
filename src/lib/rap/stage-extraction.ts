// ===========================================================================
// Shared post-upload extraction handling — used by BOTH the upload server action
// (sync/local path) and the async extractor Lambda (src/functions/rap-extract).
// Deliberately NOT a "use server" module so a plain Lambda can import it.
//
// markExtracting → runExtraction (BDA/Claude/mock) → saveResult → auto-publish
// (when REVIEW_MODE is off or the extraction is clean). Never throws — a failure
// is recorded on the job (status FAILED) and returned.
// ===========================================================================
import { extractionRepo, rapRepo } from "./index";
import { runExtraction } from "./pipeline";
import { buildCanonical, isClean, reviewIsOff, scrubForAutoPublish } from "./publish";
import type { ExtractedRap, ExtractionJob } from "./types";

const uuid = () => globalThis.crypto.randomUUID();
const slug = (s: string) =>
  "org-" + s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

// DEDUP: a RAP's identity is its natural key — org + title + period. Re-publishing
// the same document (same org/title/period) yields the SAME rapId, so the delete-
// then-write below REPLACES the prior version instead of appending a duplicate.
function stableRapId(orgId: string, title: string, periodStart: string, periodEnd: string): string {
  const basis = `${title}|${periodStart}|${periodEnd}`.toLowerCase();
  let h = 0;
  for (let i = 0; i < basis.length; i++) h = (h * 31 + basis.charCodeAt(i)) >>> 0;
  return `${orgId}-${h.toString(36)}`;
}

// Turn a reviewed/clean extraction into canonical entities (org + rap + commitments
// + observations + rollups) and mark the job CONFIRMED. Re-publishing the same
// document replaces the prior canonical graph (no duplicate double-counting).
export async function publishAndConfirm(job: ExtractionJob, extracted: ExtractedRap, reviewedBy: string) {
  const now = new Date().toISOString();
  const orgId = slug(extracted.orgName.value ?? job.id);
  const period = extracted.periodCovered.value as { start?: string; end?: string } | null;
  const rapId = stableRapId(orgId, extracted.rapTitle.value ?? "", period?.start ?? "", period?.end ?? "");

  const { org, rap, commitments, observations, rollups } = buildCanonical(
    extracted,
    { orgId, rapId, commitId: () => uuid() },
    { sourceS3Key: job.sourceS3Key, extractionId: job.id, now, reviewedBy },
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
