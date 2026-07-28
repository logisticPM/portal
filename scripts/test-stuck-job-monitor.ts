// Stuck-extraction detector: the core that decides when an EXTRACTING job has
// outlived any possible live invocation, and the EMF metric line an alarm reads.
//
// Driven by the mock repo with `now` injected, so no clock and no AWS. Same
// shape as scripts/test-extract-queue-view.ts.
//
// Run: npx tsx scripts/test-stuck-job-monitor.ts
process.env.REPO_IMPL = "mock"; // select the in-memory repo before ./index binds
import { mockExtractionRepo } from "../src/lib/rap/repo.mock";
import {
  emfStuckJobs,
  scanStuckExtractions,
  STUCK_MAX_AGE_MS,
  STUCK_METRIC_NAME,
  STUCK_METRIC_NAMESPACE,
} from "../src/lib/rap/monitor";
import type { ExtractionStatus } from "../src/lib/rap/types";

let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
}

const NOW = Date.parse("2026-07-28T12:00:00.000Z");
let seq = 0;

/** Create a job, force it to `status`, and stamp `updatedAt` to `now - ageMs`. */
async function jobAged(status: ExtractionStatus, ageMs: number): Promise<string> {
  const id = `job-${++seq}`;
  await mockExtractionRepo.createJob({ id, fileName: `${id}.pdf`, sourceS3Key: `uploads/${id}/${id}.pdf`, dataClass: "org_submitted" });
  // The mock returns the live object reference, so status/updatedAt can be set
  // directly — mirrors how repo.mock mutates in place.
  const j = await mockExtractionRepo.getJob(id);
  (j as any).status = status;
  (j as any).updatedAt = new Date(NOW - ageMs).toISOString();
  return id;
}

async function main() {
  // --- empty ---------------------------------------------------------------
  check("no jobs at all → nothing stuck", (await scanStuckExtractions({ now: NOW })).stuckCount === 0);

  // --- a fresh EXTRACTING job is not stuck ---------------------------------
  await jobAged("EXTRACTING", 30_000); // 30s in
  check("a job that just started is not stuck", (await scanStuckExtractions({ now: NOW })).stuckCount === 0);

  // --- a long-but-legitimate run is not stuck ------------------------------
  await jobAged("EXTRACTING", 10 * 60_000); // 10 min — under the 20-min ceiling
  check("a 10-minute extraction is not stuck (under the ceiling)", (await scanStuckExtractions({ now: NOW })).stuckCount === 0);

  // --- past the ceiling → stuck --------------------------------------------
  const old = await jobAged("EXTRACTING", 25 * 60_000); // 25 min
  const scan = await scanStuckExtractions({ now: NOW });
  check("a job past the 20-min ceiling is stuck", scan.stuckCount === 1, `count=${scan.stuckCount}`);
  check("  ...and it is the right job", scan.jobIds.length === 1 && scan.jobIds[0] === old);
  check("  ...and oldestAgeMs is reported", Math.round(scan.oldestAgeMs / 60000) === 25, `${Math.round(scan.oldestAgeMs / 60000)}min`);

  // --- boundary: exactly at the ceiling is NOT stuck (strict >) ------------
  seq = 0; // reset ids; a fresh repo is easier reasoned about
  await freshRepo();
  await jobAged("EXTRACTING", STUCK_MAX_AGE_MS); // exactly 20 min
  check("exactly at the ceiling is not stuck (strict >)", (await scanStuckExtractions({ now: NOW })).stuckCount === 0);
  await freshRepo();
  await jobAged("EXTRACTING", STUCK_MAX_AGE_MS + 1000); // one second over
  check("one second over the ceiling is stuck", (await scanStuckExtractions({ now: NOW })).stuckCount === 1);

  // --- other statuses are ignored, however old -----------------------------
  await freshRepo();
  for (const s of ["PENDING", "PENDING_REVIEW", "FAILED", "CONFIRMED", "REJECTED"] as ExtractionStatus[]) {
    await jobAged(s, 999 * 60_000); // ancient
  }
  check("only EXTRACTING counts — old jobs in any other status are ignored",
    (await scanStuckExtractions({ now: NOW })).stuckCount === 0);

  // --- a malformed updatedAt must not page ---------------------------------
  await freshRepo();
  const bad = await jobAged("EXTRACTING", 25 * 60_000);
  ((await mockExtractionRepo.getJob(bad)) as any).updatedAt = "not-a-date";
  check("an unparseable updatedAt is not counted as stuck", (await scanStuckExtractions({ now: NOW })).stuckCount === 0);

  // --- multiple stuck, oldest wins for oldestAgeMs -------------------------
  await freshRepo();
  await jobAged("EXTRACTING", 22 * 60_000);
  await jobAged("EXTRACTING", 40 * 60_000);
  await jobAged("EXTRACTING", 5 * 60_000); // not stuck
  const multi = await scanStuckExtractions({ now: NOW });
  check("counts every stuck job", multi.stuckCount === 2, `count=${multi.stuckCount}`);
  check("oldestAgeMs is the oldest of the stuck set", Math.round(multi.oldestAgeMs / 60000) === 40);

  // --- EMF line shape ------------------------------------------------------
  const emf = JSON.parse(emfStuckJobs({ stage: "ca", stuckCount: 3, timestamp: NOW }));
  check("EMF carries the metric value at the top level", emf[STUCK_METRIC_NAME] === 3);
  check("EMF declares the metric under the right namespace",
    emf._aws.CloudWatchMetrics[0].Namespace === STUCK_METRIC_NAMESPACE &&
      emf._aws.CloudWatchMetrics[0].Metrics[0].Name === STUCK_METRIC_NAME);
  check("EMF tags the stage dimension", emf.Stage === "ca" && emf._aws.CloudWatchMetrics[0].Dimensions[0][0] === "Stage");
  check("EMF timestamp is the injected one", emf._aws.Timestamp === NOW);

  console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

// The mock repo has module-level state; clear it between cases that assert on
// the whole EXTRACTING set. listByStatus reads mockExtractionRepo's store, so
// resetting it keeps each block independent.
async function freshRepo() {
  const mod: any = await import("../src/lib/rap/repo.mock");
  if (typeof mod.__resetMockStore === "function") return mod.__resetMockStore();
  // No reset hook exported — reject every currently-EXTRACTING job so the next
  // block starts from an empty EXTRACTING partition without needing repo internals.
  for (const j of await mockExtractionRepo.listByStatus("EXTRACTING")) {
    (j as any).status = "REJECTED";
  }
}

main().catch((e) => {
  console.error(e);
  console.log(`\n${fail + 1} failed (suite aborted before completing)`);
  process.exit(1);
});
