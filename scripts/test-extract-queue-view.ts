// Pure view logic for the extraction review queue.
//
// The behaviour under test is the one that was MISSING: before this, the panel
// queried PENDING_REVIEW alone, so a job that was still extracting and a job
// that had hard-failed both rendered as an empty queue. These assertions pin
// the ordering, the elapsed-time formatting, and the stall threshold.
//
// Run: npx tsx scripts/test-extract-queue-view.ts
import {
  SLOW_EXTRACTION_MS,
  elapsedSince,
  isStalled,
  orderFailed,
  orderInProgress,
} from "../src/app/extract/queue-view";
import type { ExtractionJob } from "../src/lib/rap/types";

let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
}

const NOW = Date.parse("2026-07-28T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW - offsetMs).toISOString();

// Only the fields these functions read; the panel supplies whole jobs.
const job = (over: Partial<ExtractionJob>): ExtractionJob =>
  ({
    id: "j",
    fileName: "f.pdf",
    status: "EXTRACTING",
    createdAt: at(0),
    updatedAt: at(0),
    reviewNote: null,
    ...over,
  }) as ExtractionJob;

// --- elapsedSince -----------------------------------------------------------
check("seconds under a minute", elapsedSince(at(45_000), NOW) === "45s", elapsedSince(at(45_000), NOW));
check("minutes and seconds", elapsedSince(at(192_000), NOW) === "3m 12s", elapsedSince(at(192_000), NOW));
check("hours and minutes", elapsedSince(at(3_840_000), NOW) === "1h 4m", elapsedSince(at(3_840_000), NOW));
check("exactly one minute rolls over", elapsedSince(at(60_000), NOW) === "1m 0s", elapsedSince(at(60_000), NOW));

// A clock skew between the writer and the renderer must not surface as "-3s"
// or "NaNs" in the UI — both were reachable before the guard.
check("a future timestamp reads as just now", elapsedSince(at(-5_000), NOW) === "just now");
check("an unparseable timestamp reads as just now", elapsedSince("not-a-date", NOW) === "just now");

// --- isStalled --------------------------------------------------------------
// The real hazard: the worker's Lambda timeout is 900s, and on timeout NOTHING
// updates the record, so the job stays EXTRACTING forever. The threshold has to
// fire before that to be useful.
check("a fresh job is not stalled", isStalled(job({ createdAt: at(30_000) }), NOW) === false);
check("a typical 90s extraction is not stalled", isStalled(job({ createdAt: at(90_000) }), NOW) === false);
check("just under the threshold is not stalled",
  isStalled(job({ createdAt: at(SLOW_EXTRACTION_MS - 1_000) }), NOW) === false);
check("past the threshold is stalled",
  isStalled(job({ createdAt: at(SLOW_EXTRACTION_MS + 1_000) }), NOW) === true);
check("the threshold fires before the 900s Lambda timeout", SLOW_EXTRACTION_MS < 900_000);
check("a malformed createdAt is never reported as stalled",
  isStalled(job({ createdAt: "nope" }), NOW) === false);

// --- ordering ---------------------------------------------------------------
const pending = [job({ id: "p1", status: "PENDING", createdAt: at(10_000) })];
const extracting = [
  job({ id: "e1", status: "EXTRACTING", createdAt: at(300_000) }),
  job({ id: "e2", status: "EXTRACTING", createdAt: at(5_000) }),
];

const merged = orderInProgress(pending, extracting);
check("in-progress merges PENDING and EXTRACTING", merged.length === 3);
check("in-progress is newest first",
  merged.map((j) => j.id).join(",") === "e2,p1,e1", merged.map((j) => j.id).join(","));
check("in-progress keeps each job's own status for diagnosis",
  merged.find((j) => j.id === "p1")?.status === "PENDING");

// Inputs must not be mutated — they are the arrays returned by the repo, and a
// sort in place would reorder a caller's data.
const originalOrder = extracting.map((j) => j.id).join(",");
orderInProgress(pending, extracting);
check("orderInProgress does not mutate its inputs", extracting.map((j) => j.id).join(",") === originalOrder);

// Failures sort by updatedAt (when markFailed ran), NOT createdAt: a document
// uploaded first can fail last.
const failed = [
  job({ id: "f_old", status: "FAILED", createdAt: at(900_000), updatedAt: at(800_000) }),
  job({ id: "f_new", status: "FAILED", createdAt: at(500_000), updatedAt: at(60_000) }),
];
check("failed is most-recently-failed first",
  orderFailed(failed).map((j) => j.id).join(",") === "f_new,f_old",
  orderFailed(failed).map((j) => j.id).join(","));
const failedOrder = failed.map((j) => j.id).join(",");
orderFailed(failed);
check("orderFailed does not mutate its input", failed.map((j) => j.id).join(",") === failedOrder);

// --- empty cases ------------------------------------------------------------
check("no in-progress jobs yields an empty list", orderInProgress([], []).length === 0);
check("no failed jobs yields an empty list", orderFailed([]).length === 0);

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
