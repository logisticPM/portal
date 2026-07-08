// ===========================================================================
// Async extraction worker. Invoked (fire-and-forget, InvocationType "Event") by
// the upload server action so extraction runs OUTSIDE the request Lambda — BDA
// takes ~60-80s, far beyond the web function's timeout. Long timeout is set on
// this function in sst.config.ts. Reads the uploaded doc from S3, runs the
// pipeline, and updates the job (→ PENDING_REVIEW, CONFIRMED, or FAILED).
// ===========================================================================
import { stageExtraction } from "../lib/rap/stage-extraction";

type Event = { jobId: string; fileName: string; sourceS3Key: string };

export async function handler(event: Event) {
  console.log("rap-extract: start", { jobId: event.jobId, fileName: event.fileName });
  const outcome = await stageExtraction(event);
  console.log("rap-extract: done", { jobId: event.jobId, ...outcome });
  return outcome;
}
