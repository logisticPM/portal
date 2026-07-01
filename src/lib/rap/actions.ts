"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { extractionRepo, rapRepo } from "./index";
import { runExtraction } from "./pipeline";
import { buildCanonical, isClean, reviewIsOff, scrubForAutoPublish } from "./publish";
import { computeRollup } from "./rollup";
import { contentTypeFor, isUploadConfigured, putDocument, uploadKey } from "./storage";
import type { ExtractedRap, ExtractionJob, Observation, ProgressStatus } from "./types";

const uuid = () => globalThis.crypto.randomUUID();
const slug = (s: string) =>
  "org-" + s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

// Write the canonical graph for an approved extraction, then flip the job to
// CONFIRMED. One org partition per org name (re-uploads append RAPs to it).
// Numbers/dates are parsed in buildCanonical (code-side), never by the LLM.
async function publishAndConfirm(job: ExtractionJob, extracted: ExtractedRap, reviewedBy: string) {
  const now = new Date().toISOString();
  const orgId = slug(extracted.orgName.value ?? job.id);
  const rapId = uuid();

  const { org, rap, commitments, observations, rollups } = buildCanonical(
    extracted,
    { orgId, rapId, commitId: () => uuid() },
    { sourceS3Key: job.sourceS3Key, extractionId: job.id, now, reviewedBy },
  );

  await rapRepo.putOrganization(org);
  await rapRepo.putRap(rap);
  for (const c of commitments) await rapRepo.putCommitment(c);
  for (const o of observations) await rapRepo.putObservation(o);
  for (const r of rollups) await rapRepo.putRollup(r);

  await extractionRepo.confirmJob(job.id, reviewedBy, extracted, rapId);
}

// FLOW: (optional login) → upload → AI extract → auto-publish if clean,
// else route to the review queue. No Indigenomics truth-verification — the only
// human touch is extraction QA on FLAGGED documents.
export async function uploadRapAction(formData: FormData) {
  // Three entry shapes, in priority order:
  //   1. s3Key present  → browser already uploaded via presigned URL (primary;
  //      no 6 MB Lambda limit). The action just records the key.
  //   2. file present + S3 configured → small-file server-side upload (fallback).
  //   3. neither → synthesize a key (mock/dev → mock pipeline).
  const presignedKey = String(formData.get("s3Key") ?? "").trim();
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  const fileName = (
    String(formData.get("fileName") ?? "") || (hasFile ? (file as File).name : "")
  ).trim();
  if (!fileName) return; // identity guard — silent no-op

  const docId = uuid();
  let sourceS3Key: string;
  if (presignedKey) {
    sourceS3Key = presignedKey; // already in S3
  } else if (hasFile && isUploadConfigured()) {
    sourceS3Key = uploadKey(docId, fileName);
    const bytes = new Uint8Array(await (file as File).arrayBuffer());
    await putDocument(sourceS3Key, bytes, contentTypeFor(fileName));
  } else {
    sourceS3Key = `uploads/${docId}/${fileName}`;
  }

  const job = await extractionRepo.createJob({ id: docId, fileName, sourceS3Key });
  await extractionRepo.markExtracting(job.id);

  // Decide the outcome inside the try; redirect AFTER it — redirect() throws
  // NEXT_REDIRECT and must not be caught by the error handler.
  let published = false;
  try {
    const result = await runExtraction({ fileName, sourceS3Key });
    const staged = await extractionRepo.saveResult(job.id, result);

    if (reviewIsOff()) {
      // no human step: publish everything, but keep only grounded+validated fields
      await publishAndConfirm(staged, scrubForAutoPublish(result.extracted), "system:auto");
      published = true;
    } else if (isClean(result)) {
      await publishAndConfirm(staged, result.extracted, "system:auto");
      published = true;
    }
  } catch (e) {
    await extractionRepo.markFailed(job.id, e instanceof Error ? e.message : String(e));
  }

  if (published) {
    revalidatePath("/rap");
    redirect("/rap"); // auto-published → dashboard
  }
  revalidatePath("/rap/review");
  redirect("/rap/review"); // flagged or failed → review queue
}

// Human approves a flagged extraction. `reviewedBy` identifies the admin/org
// reviewer. (A fuller build parses reviewer field-edits from the form here; for
// now the approved payload is the staged extraction as-is.)
export async function confirmExtractionAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "").trim();
  const reviewedBy = String(formData.get("reviewedBy") ?? "admin").trim();
  if (!jobId) return;

  const job = await extractionRepo.getJob(jobId);
  if (!job || !job.extracted) return;

  await publishAndConfirm(job, job.extracted, reviewedBy);
  revalidatePath("/rap");
  revalidatePath("/rap/review");
  redirect("/rap");
}

// Record a progress observation against a commitment, then recompute its rollup.
// Recomputing here keeps local/mock consistent (no Streams Lambda locally); the
// deployed Streams Lambda also recomputes the same rollup — idempotent.
export async function recordProgressAction(formData: FormData) {
  const commitId = String(formData.get("commitId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim() as ProgressStatus;
  if (!commitId || !status) return;

  const rawValue = String(formData.get("observedValue") ?? "").trim();
  const observedValue = rawValue === "" ? null : Number(rawValue);

  const obs: Observation = {
    commitId,
    observedAt: new Date().toISOString(),
    status,
    observedValue: observedValue === null || Number.isNaN(observedValue) ? null : observedValue,
    note: String(formData.get("note") ?? "").trim() || null,
    recordedBy: String(formData.get("recordedBy") ?? "admin").trim(),
  };
  await rapRepo.putObservation(obs);
  await rapRepo.putRollup(computeRollup(commitId, await rapRepo.listObservations(commitId)));

  revalidatePath("/rap");
  redirect("/rap");
}

export async function rejectExtractionAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "").trim();
  const reviewedBy = String(formData.get("reviewedBy") ?? "admin").trim();
  const reason = String(formData.get("reason") ?? "Rejected by reviewer").trim();
  if (!jobId) return;

  await extractionRepo.rejectJob(jobId, reviewedBy, reason);
  revalidatePath("/rap/review");
  redirect("/rap/review");
}
