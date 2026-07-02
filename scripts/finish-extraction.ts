// ===========================================================================
// Drive any jobs stuck in EXTRACTING to completion, OUTSIDE the request Lambda
// (which has a 20s timeout while BDA takes ~60s). Runs the same runExtraction
// pipeline locally, then saveResult (→ PENDING_REVIEW) or markFailed.
//
// Run: REPO_IMPL=dynamo RAP_TABLE=<table> AWS_REGION=us-east-1 AWS_PROFILE=<p> \
//        EXTRACTION_IMPL=bda BEDROCK_REGION=us-east-1 BDA_PROJECT_ARN=… \
//        BDA_PROFILE_ARN=… RAP_UPLOAD_BUCKET=… BDA_OUTPUT_BUCKET=… \
//        npx tsx scripts/finish-extraction.ts
// ===========================================================================
import { extractionRepo } from "../src/lib/rap";
import { runExtraction } from "../src/lib/rap/pipeline";

async function main() {
  const stuck = await extractionRepo.listByStatus("EXTRACTING");
  if (stuck.length === 0) {
    console.log("no jobs in EXTRACTING");
    return;
  }
  console.log(`found ${stuck.length} stuck job(s)`);
  for (const job of stuck) {
    console.log(`→ extracting ${job.fileName} (${job.id}) …`);
    const t0 = Date.now();
    try {
      const result = await runExtraction({ fileName: job.fileName, sourceS3Key: job.sourceS3Key });
      await extractionRepo.saveResult(job.id, result);
      const n = result.extracted?.commitments?.length ?? 0;
      console.log(`  ✅ PENDING_REVIEW in ${Math.round((Date.now() - t0) / 1000)}s — ${n} commitments, engine=${result.engine}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await extractionRepo.markFailed(job.id, msg);
      console.log(`  ❌ FAILED — ${msg}`);
    }
  }
}

main().catch((e) => {
  console.error("finish-extraction error:", e);
  process.exit(1);
});
