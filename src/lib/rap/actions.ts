"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { extractionRepo } from "./index";
import { canPublish, claimOrgForParty, recordRapProgressForParty, resolveOrgForJob, setShowcaseOptInForParty, uploadBNForSession } from "./actions-core";
import type { ProgressStatus } from "./types";
import { getRegistryProvider } from "./registry";
import { publishAndConfirm, stageExtraction } from "./stage-extraction";
import { contentTypeFor, isUploadConfigured, putDocument, uploadKey } from "./storage";
import { getSession } from "@/lib/auth";

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

// FLOW: staff OR a claimed company uploads → AI extract → auto-publish if
// clean, else route to the review queue. A company's claimed BN is
// auto-tagged on the job below so it doesn't get re-resolved at review; staff
// uploads leave the BN null (resolved at review, as before). The only human
// touch beyond that is extraction QA on FLAGGED documents.
export async function uploadRapAction(formData: FormData) {
  // Hybrid ownership: staff (indigenomics) and companies may both upload —
  // only claimed companies additionally get to post progress (gated
  // separately in recordRapProgressAction). Any other/no session is a silent
  // no-op, matching this file's other identity guards.
  const session = getSession();
  if (!session || (session.kind !== "indigenomics" && session.kind !== "company")) return;

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

  // Company self-upload: auto-tag the job with the uploader's (single) claimed
  // BN so it isn't re-resolved at review. Staff uploads (or an ambiguous/no
  // claim) leave the job's BN null, resolved at review as before.
  const bn = await uploadBNForSession(session);
  if (bn) {
    await extractionRepo.setJobOrg(job.id, { ...bn, registryLegalName: null, registryStatus: null });
  }

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
    // A company uploads from /my-rap and can't see the staff-only /extract queue
    // (middleware bounces it to /home). Return it to /my-rap, where the extracted
    // RAP appears once review completes; staff stay on the review queue.
    if (session.kind === "company") {
      revalidatePath("/my-rap");
      redirect("/my-rap");
    }
    revalidatePath("/extract");
    redirect("/extract?tab=review");
  }

  // SYNC path (local dev / mock — fast): run inline. redirect() throws
  // NEXT_REDIRECT, so it runs AFTER stageExtraction (which never throws).
  const outcome = await stageExtraction({ jobId: job.id, fileName, sourceS3Key });
  // Published RAPs land in the RapData domain — they surface on the uploader's
  // /my-rap (company) and the staff /extract queue, NOT on the Commitments-backed
  // public Index (/commitments never reads RapData). Send the uploader to where
  // their data actually appears.
  if (outcome.status === "published" && session.kind === "company") {
    revalidatePath("/my-rap");
    redirect("/my-rap");
  }
  revalidatePath("/extract");
  redirect("/extract?tab=review"); // staff publish, flagged, or failed → review queue
}

// Human approves a flagged extraction. `reviewedBy` identifies the admin/org
// reviewer. (A fuller build parses reviewer field-edits from the form here; for
// now the approved payload is the staged extraction as-is.)
export async function confirmExtractionAction(formData: FormData) {
  const session = getSession();
  if (session?.kind !== "indigenomics") return;
  const jobId = String(formData.get("jobId") ?? "").trim();
  const reviewedBy = String(formData.get("reviewedBy") ?? "admin").trim();
  if (!jobId) return;

  const job = await extractionRepo.getJob(jobId);
  if (!job || !job.extracted) return;
  if (!canPublish(job)) {
    revalidatePath("/extract");
    return;
  }

  await publishAndConfirm(job, job.extracted, reviewedBy);
  // Publishing writes to the RapData domain (surfaces on /extract and the claimed
  // company's /my-rap), not the Commitments-backed public Index — so revalidate
  // those, not /commitments.
  revalidatePath("/extract");
  revalidatePath("/my-rap");
  redirect("/extract?tab=review");
}

export async function rejectExtractionAction(formData: FormData) {
  const session = getSession();
  if (session?.kind !== "indigenomics") return;
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
  const session = getSession();
  if (session?.kind !== "indigenomics") return;
  return resolveOrgForJob(getRegistryProvider(), {
    jobId: String(formData.get("jobId") ?? ""),
    bnRaw: String(formData.get("bn") ?? ""),
    selfAsserted: formData.get("selfAsserted") === "on",
  });
}

// Company self-claim: a logged-in company party claims the right to post
// progress on a BN'd org. Identity comes SOLELY from the verified session
// (never a form field) — a non-company session (or no session) is a no-op, so
// this can't be used to claim on someone else's behalf.
export async function claimOrgAction(formData: FormData) {
  const session = getSession();
  if (!session || session.kind !== "company" || !session.partyId) return;
  return claimOrgForParty(getRegistryProvider(), {
    partyId: session.partyId,
    bnRaw: String(formData.get("bn") ?? ""),
    attested: formData.get("attested") === "on",
  });
}

// Company progress append: a logged-in company party posts an Observation
// against one of their claimed org's commitments. Identity comes SOLELY from
// the verified session (never a form field) — a non-company session (or no
// session) is a no-op, matching claimOrgAction's guard above.
export async function recordRapProgressAction(formData: FormData) {
  const session = getSession();
  if (!session || session.kind !== "company" || !session.partyId) return;
  const observedValueRaw = String(formData.get("observedValue") ?? "").trim();
  const result = await recordRapProgressForParty({
    partyId: session.partyId,
    rapId: String(formData.get("rapId") ?? ""),
    commitId: String(formData.get("commitId") ?? ""),
    status: String(formData.get("status") ?? "") as ProgressStatus,
    observedValue: observedValueRaw ? Number(observedValueRaw) : null,
    note: (formData.get("note") ? String(formData.get("note")) : null),
  });
  if (result.ok) revalidatePath("/my-rap");
  return result;
}

// Company toggles public-Index surfacing for a claimed org. Identity comes
// SOLELY from the verified session (never a form field) — a non-company session
// (or no session) is a no-op, matching claimOrgAction's guard.
export async function setShowcaseOptInAction(formData: FormData) {
  const session = getSession();
  if (!session || session.kind !== "company" || !session.partyId) return;
  return setShowcaseOptInForParty({
    partyId: session.partyId,
    bn: String(formData.get("bn") ?? ""),
    optIn: formData.get("optIn") === "on",
    now: new Date().toISOString(),
  });
}
