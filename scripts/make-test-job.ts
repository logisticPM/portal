// Create a fresh PENDING ExtractionJob (for testing the async worker end-to-end).
// Reuses an already-uploaded S3 object. Prints the {jobId, fileName, sourceS3Key}
// payload to feed `aws lambda invoke` against the deployed RapExtract function.
//
// Run: REPO_IMPL=dynamo RAP_TABLE=<t> AWS_REGION=us-east-1 AWS_PROFILE=<p> \
//        FILE_NAME=BankOfCanada_RAP.pdf S3KEY=<key> npx tsx scripts/make-test-job.ts
import { extractionRepo } from "../src/lib/rap";

async function main() {
  const id = `test-${Date.now()}`;
  const fileName = process.env.FILE_NAME ?? "BankOfCanada_RAP.pdf";
  const sourceS3Key = process.env.S3KEY;
  if (!sourceS3Key) throw new Error("S3KEY env required (an existing uploaded object key)");
  const job = await extractionRepo.createJob({ id, fileName, sourceS3Key, dataClass: "org_submitted" });
  console.log(JSON.stringify({ jobId: job.id, fileName, sourceS3Key }));
}

main().catch((e) => { console.error(e); process.exit(1); });
