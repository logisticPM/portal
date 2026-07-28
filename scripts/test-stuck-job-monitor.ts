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
  emfExtractionHealth,
  FAILED_METRIC_NAME,
  METRIC_NAMESPACE,
  scanExtractionHealth,
  STUCK_MAX_AGE_MS,
  STUCK_METRIC_NAME,
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
  check("no jobs at all → nothing stuck", (await scanExtractionHealth({ now: NOW })).stuckCount === 0);

  // --- a fresh EXTRACTING job is not stuck ---------------------------------
  await jobAged("EXTRACTING", 30_000); // 30s in
  check("a job that just started is not stuck", (await scanExtractionHealth({ now: NOW })).stuckCount === 0);

  // --- a long-but-legitimate run is not stuck ------------------------------
  await jobAged("EXTRACTING", 10 * 60_000); // 10 min — under the 20-min ceiling
  check("a 10-minute extraction is not stuck (under the ceiling)", (await scanExtractionHealth({ now: NOW })).stuckCount === 0);

  // --- past the ceiling → stuck --------------------------------------------
  const old = await jobAged("EXTRACTING", 25 * 60_000); // 25 min
  const scan = await scanExtractionHealth({ now: NOW });
  check("a job past the 20-min ceiling is stuck", scan.stuckCount === 1, `count=${scan.stuckCount}`);
  check("  ...and it is the right job", scan.stuckJobIds.length === 1 && scan.stuckJobIds[0] === old);
  check("  ...and oldestAgeMs is reported", Math.round(scan.oldestStuckAgeMs / 60000) === 25, `${Math.round(scan.oldestStuckAgeMs / 60000)}min`);

  // --- boundary: exactly at the ceiling is NOT stuck (strict >) ------------
  seq = 0; // reset ids; a fresh repo is easier reasoned about
  await freshRepo();
  await jobAged("EXTRACTING", STUCK_MAX_AGE_MS); // exactly 20 min
  check("exactly at the ceiling is not stuck (strict >)", (await scanExtractionHealth({ now: NOW })).stuckCount === 0);
  await freshRepo();
  await jobAged("EXTRACTING", STUCK_MAX_AGE_MS + 1000); // one second over
  check("one second over the ceiling is stuck", (await scanExtractionHealth({ now: NOW })).stuckCount === 1);

  // --- other statuses are ignored, however old -----------------------------
  await freshRepo();
  for (const s of ["PENDING", "PENDING_REVIEW", "CONFIRMED", "REJECTED"] as ExtractionStatus[]) {
    await jobAged(s, 999 * 60_000); // ancient — none of these is EXTRACTING or FAILED
  }
  const ignored = await scanExtractionHealth({ now: NOW });
  check("only EXTRACTING counts toward stuck — other non-FAILED statuses ignored",
    ignored.stuckCount === 0 && ignored.failedCount === 0);

  // --- a malformed updatedAt must not page ---------------------------------
  await freshRepo();
  const bad = await jobAged("EXTRACTING", 25 * 60_000);
  ((await mockExtractionRepo.getJob(bad)) as any).updatedAt = "not-a-date";
  check("an unparseable updatedAt is not counted as stuck", (await scanExtractionHealth({ now: NOW })).stuckCount === 0);

  // --- multiple stuck, oldest wins for oldestAgeMs -------------------------
  await freshRepo();
  await jobAged("EXTRACTING", 22 * 60_000);
  await jobAged("EXTRACTING", 40 * 60_000);
  await jobAged("EXTRACTING", 5 * 60_000); // not stuck
  const multi = await scanExtractionHealth({ now: NOW });
  check("counts every stuck job", multi.stuckCount === 2, `count=${multi.stuckCount}`);
  check("oldestAgeMs is the oldest of the stuck set", Math.round(multi.oldestStuckAgeMs / 60000) === 40);

  // --- FAILED count (the SCP-outage shape: caught, not thrown) --------------
  await freshRepo();
  await jobAged("FAILED", 3 * 60_000);
  await jobAged("FAILED", 200 * 60_000);
  await jobAged("EXTRACTING", 25 * 60_000); // also stuck — the two are independent
  const health = await scanExtractionHealth({ now: NOW });
  check("counts unresolved FAILED jobs", health.failedCount === 2, `failed=${health.failedCount}`);
  check("stuck and failed are counted independently", health.stuckCount === 1 && health.failedCount === 2);
  await freshRepo();
  check("no FAILED jobs → failedCount 0", (await scanExtractionHealth({ now: NOW })).failedCount === 0);

  // --- EMF line shape (both metrics) ---------------------------------------
  const emf = JSON.parse(emfExtractionHealth({ stage: "ca", stuckCount: 3, failedCount: 5, timestamp: NOW }));
  check("EMF carries both metric values at the top level",
    emf[STUCK_METRIC_NAME] === 3 && emf[FAILED_METRIC_NAME] === 5);
  check("EMF declares both metrics under the right namespace",
    emf._aws.CloudWatchMetrics[0].Namespace === METRIC_NAMESPACE &&
      emf._aws.CloudWatchMetrics[0].Metrics.map((m: any) => m.Name).sort().join(",") ===
        [STUCK_METRIC_NAME, FAILED_METRIC_NAME].sort().join(","));
  check("EMF tags the stage dimension", emf.Stage === "ca" && emf._aws.CloudWatchMetrics[0].Dimensions[0][0] === "Stage");
  check("EMF timestamp is the injected one", emf._aws.Timestamp === NOW);

  console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

// The mock repo has module-level state; clear it between cases that assert on
// the whole EXTRACTING set. listByStatus reads mockExtractionRepo's store, so
// resetting it keeps each block independent.
async function freshRepo() {
  // Park every job the scan reads (EXTRACTING + FAILED) in a status the scan
  // ignores, so each block starts from empty partitions without needing repo
  // internals. CONFIRMED is inert to both counts.
  for (const status of ["EXTRACTING", "FAILED"] as ExtractionStatus[]) {
    for (const j of await mockExtractionRepo.listByStatus(status)) {
      (j as any).status = "CONFIRMED";
    }
  }
}

main().catch((e) => {
  console.error(e);
  console.log(`\n${fail + 1} failed (suite aborted before completing)`);
  process.exit(1);
});
