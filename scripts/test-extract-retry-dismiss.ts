// Recovery actions for FAILED extraction jobs: dismiss and retry.
//
// These exist because a failed job is now VISIBLE in the review queue (it used
// to appear nowhere at all), and a visible failure needs a way out that is not
// "re-upload the document".
//
// Driven by the mock repo, with `dispatch` injected — so nothing here invokes
// Lambda. Same core/shim split as resolveOrgForJob.
//
// Run: npx tsx scripts/test-extract-retry-dismiss.ts
import { mockExtractionRepo } from "../src/lib/rap/repo.mock";
import { dismissFailedJob, retryFailedJob } from "../src/lib/rap/actions-core";
import { itemToJob } from "../src/lib/dynamo/rap-table";

let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
}

// actions-core imports the repo through ./index, which selects by REPO_IMPL.
// Force the mock before that module is touched.
process.env.REPO_IMPL = "mock";

let seq = 0;
async function makeFailedJob(error = "The specified key does not exist.") {
  const id = `job-${++seq}`;
  await mockExtractionRepo.createJob({
    id,
    fileName: `${id}.pdf`,
    sourceS3Key: `uploads/${id}/${id}.pdf`,
    dataClass: "org_submitted",
  });
  await mockExtractionRepo.markExtracting(id);
  await mockExtractionRepo.markFailed(id, error);
  return id;
}

async function main() {
  // --- dismiss -------------------------------------------------------------
  const d1 = await makeFailedJob("Textract explicit deny in SCP p-9n6l6a99");
  const r1 = await dismissFailedJob({ jobId: d1, reviewedBy: "admin" });
  const after1 = await mockExtractionRepo.getJob(d1);
  check("dismiss moves a FAILED job to REJECTED", r1.ok && after1?.status === "REJECTED", after1?.status);

  // THE TRAP this test exists for: rejectJob overwrites reviewNote, which is
  // the only place markFailed stored the error. A naive dismiss erases the
  // diagnosis at the moment someone tidies the queue.
  check("dismiss PRESERVES the original error in the note",
    after1?.reviewNote?.includes("Textract explicit deny in SCP p-9n6l6a99") === true,
    after1?.reviewNote ?? "");
  check("dismiss records who did it", after1?.reviewedBy === "admin");

  // Directly POST-able as a Server Action, so the guard must be server-side.
  const d2 = await makeFailedJob();
  await mockExtractionRepo.saveResult(d2, {
    engine: "claude",
    classification: { jurisdiction: "CA", sector: "energy", rapType: null, confidence: 0.9 },
    extracted: null as any,
    validationIssues: [],
    verdicts: [],
  } as any);
  const r2 = await dismissFailedJob({ jobId: d2, reviewedBy: "admin" });
  const after2 = await mockExtractionRepo.getJob(d2);
  check("dismiss REFUSES a job that is not FAILED", r2.ok === false && r2.reason === "not-failed", r2.reason ?? "");
  check("...and leaves that job's status untouched", after2?.status === "PENDING_REVIEW", after2?.status);

  check("dismiss reports a missing job rather than throwing",
    (await dismissFailedJob({ jobId: "nope", reviewedBy: "admin" })).reason === "not-found");

  // --- retry ---------------------------------------------------------------
  const t1 = await makeFailedJob();
  const calls: any[] = [];
  const r3 = await retryFailedJob({ jobId: t1, dispatch: async (p) => void calls.push(p) });
  const after3 = await mockExtractionRepo.getJob(t1);

  check("retry dispatches exactly once", r3.ok && calls.length === 1, `${calls.length} call(s)`);
  check("retry dispatches the ORIGINAL source object",
    calls[0]?.jobId === t1 && calls[0]?.sourceS3Key === `uploads/${t1}/${t1}.pdf` && calls[0]?.fileName === `${t1}.pdf`,
    JSON.stringify(calls[0] ?? {}));

  // PENDING, not EXTRACTING — the worker sets EXTRACTING itself, and a job left
  // EXTRACTING by a dispatch that never happened can never be recovered.
  check("retry lands the job on PENDING", after3?.status === "PENDING", after3?.status);
  check("retry clears the stale error", after3?.reviewNote === null, String(after3?.reviewNote));
  check("retry increments attempts 1 -> 2", after3?.attempts === 2, String(after3?.attempts));

  // Two pipelines writing one record, interleaved, is the failure this prevents.
  const t2 = await makeFailedJob();
  await mockExtractionRepo.markExtracting(t2);
  const calls2: any[] = [];
  const r4 = await retryFailedJob({ jobId: t2, dispatch: async (p) => void calls2.push(p) });
  check("retry REFUSES a job that is already EXTRACTING",
    r4.ok === false && r4.reason === "not-failed" && calls2.length === 0, `${calls2.length} call(s)`);

  // The important failure mode: if dispatch throws AFTER requeue, the job must
  // not be stranded on PENDING — nothing would ever pick it up again.
  const t3 = await makeFailedJob();
  const r5 = await retryFailedJob({
    jobId: t3,
    dispatch: async () => { throw new Error("Lambda unreachable"); },
  });
  const after5 = await mockExtractionRepo.getJob(t3);
  check("a dispatch that throws leaves the job FAILED, not stranded on PENDING",
    r5.ok === false && r5.reason === "dispatch-failed" && after5?.status === "FAILED", after5?.status);
  check("...and records the dispatch error",
    after5?.reviewNote?.includes("Lambda unreachable") === true, after5?.reviewNote ?? "");

  // Repeated retries must keep counting, so an operator can see a failure is
  // deterministic rather than retrying it forever.
  const t4 = await makeFailedJob();
  await retryFailedJob({ jobId: t4, dispatch: async () => {} });
  await mockExtractionRepo.markFailed(t4, "again");
  await retryFailedJob({ jobId: t4, dispatch: async () => {} });
  check("attempts accumulates across retries (1 -> 2 -> 3)",
    (await mockExtractionRepo.getJob(t4))?.attempts === 3,
    String((await mockExtractionRepo.getJob(t4))?.attempts));

  // --- stored-row compatibility -------------------------------------------
  // Rows written before `attempts` existed have no such field; consumers must
  // still see a number (job.attempts > 1 is read directly in ReviewPanel).
  const legacy = itemToJob({ PK: "EXTRACT#old", SK: "META", id: "old", fileName: "old.pdf", status: "FAILED" });
  check("a stored row predating `attempts` reads as attempt 1", legacy.attempts === 1, String(legacy.attempts));

  console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  console.log(`\n${fail + 1} failed (suite aborted before completing)`);
  process.exit(1);
});
