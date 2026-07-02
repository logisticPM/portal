// Approve (publish) a PENDING_REVIEW extraction job — same as clicking "Approve
// & publish" in /rap/review. Writes the canonical graph (dedup-replaces any prior
// version) and marks the job CONFIRMED.
// Run: REPO_IMPL=dynamo RAP_TABLE=<t> AWS_REGION=us-east-1 AWS_PROFILE=<p> \
//        JOB_ID=<id> npx tsx scripts/approve-job.ts
import { extractionRepo } from "../src/lib/rap";
import { publishAndConfirm } from "../src/lib/rap/stage-extraction";

async function main() {
  const jobId = process.env.JOB_ID;
  if (!jobId) throw new Error("JOB_ID env required");
  const job = await extractionRepo.getJob(jobId);
  if (!job || !job.extracted) throw new Error(`job ${jobId} not found or has no extracted payload`);
  await publishAndConfirm(job, job.extracted, "indigenomics");
  console.log(`✅ approved+published "${jobId}" (${job.fileName}) → ${job.extracted.commitments.length} commitments`);
}

main().catch((e) => { console.error(e); process.exit(1); });
