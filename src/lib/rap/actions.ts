"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { extractionRepo } from "./index";
import { resolveOrgForJob } from "./actions-core";
import { getRegistryProvider } from "./registry";
import { publishAndConfirm, stageExtraction } from "./stage-extraction";
import { contentTypeFor, isUploadConfigured, putDocument, uploadKey } from "./storage";

const uuid = () => globalThis.crypto.randomUUID();

// Fire the async extraction worker (fire-and-forget). EXTRACTOR_FUNCTION_NAME is
// set by sst.config on the deployed stacks; unset locally → the synchronous mock
// path below runs instead.
async function invokeExtractor(functionName: string, payload: { jobId: string; fileName: string; sourceS3Key: string }) {
  const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
  await new LambdaClient({}).send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }),
  );
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

  // ASYNC path (deployed): BDA takes ~60-80s — beyond the request Lambda's
  // timeout — so hand extraction to a long-timeout worker and return to the
  // review queue immediately (the job shows "extracting…", then updates).
  const extractorFn = process.env.EXTRACTOR_FUNCTION_NAME;
  if (extractorFn) {
    try {
      await invokeExtractor(extractorFn, { jobId: job.id, fileName, sourceS3Key });
    } catch (e) {
      await extractionRepo.markFailed(job.id, `extractor invoke failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    revalidatePath("/extract");
    redirect("/extract?tab=review");
  }

  // SYNC path (local dev / mock — fast): run inline. redirect() throws
  // NEXT_REDIRECT, so it runs AFTER stageExtraction (which never throws).
  const outcome = await stageExtraction({ jobId: job.id, fileName, sourceS3Key });
  if (outcome.status === "published") {
    revalidatePath("/commitments");
    redirect("/commitments"); // auto-published → dashboard
  }
  revalidatePath("/extract");
  redirect("/extract?tab=review"); // flagged or failed → review queue
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
  revalidatePath("/commitments");
  revalidatePath("/extract");
  redirect("/commitments");
}

export async function rejectExtractionAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "").trim();
  const reviewedBy = String(formData.get("reviewedBy") ?? "admin").trim();
  const reason = String(formData.get("reason") ?? "Rejected by reviewer").trim();
  if (!jobId) return;

  await extractionRepo.rejectJob(jobId, reviewedBy, reason);
  revalidatePath("/extract");
  redirect("/extract?tab=review");
}

// Human resolves a job's org identity at review time (BN lookup, with an
// explicit self-asserted fallback when the registry has no match). Thin
// FormData shim over the testable core in actions-core.ts — this file's
// file-level "use server" already makes this a Server Action, so no
// function-level directive is added here.
export async function resolveOrgAction(formData: FormData) {
  return resolveOrgForJob(getRegistryProvider(), {
    jobId: String(formData.get("jobId") ?? ""),
    bnRaw: String(formData.get("bn") ?? ""),
    selfAsserted: formData.get("selfAsserted") === "on",
  });
}
