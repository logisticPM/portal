// Verifies Option-A's re-extraction lock: once a RAP has any COMPANY-recorded
// progress (an Observation with recordedBy !== "system"), re-publishing over
// that rapId must be rejected — company progress is never silently wiped or
// mis-attributed by a re-extraction. Baseline "system" observations written at
// publish must NOT trip the lock (re-publish stays allowed until a real party
// records progress).
//
// Run: npx tsx scripts/test-rap-reextract-lock.ts   (mock repo, no AWS/Bedrock needed)
import assert from "node:assert/strict";
import { extractionRepo, rapRepo } from "../src/lib/rap/index";
import { publishAndConfirm } from "../src/lib/rap/stage-extraction";
import { runExtraction } from "../src/lib/rap/pipeline.mock";

(async () => {
  const base = (await runExtraction({ fileName: "lock.pdf", sourceS3Key: "s3://l" })).extracted;
  async function pub(id: string) {
    const job = await extractionRepo.createJob({ id, fileName: "lock.pdf", sourceS3Key: `s3://${id}` });
    await extractionRepo.setJobOrg(id, { businessNumber: "119653384", businessNumberSource: "ised", registryLegalName: "X", registryStatus: "Active" });
    await publishAndConfirm((await extractionRepo.getJob(id))!, base, "tester");
    return (await extractionRepo.getJob(id))!.rapId!;
  }

  const rapId = await pub("lk1");
  // only baseline system observations → re-publish allowed
  await pub("lk2");
  assert.equal((await rapRepo.listCommitmentsByRap(rapId)).length, base.commitments.length, "re-publish replaced, not doubled");

  // company records progress → lock engages
  const commit = (await rapRepo.listCommitmentsByRap(rapId))[0];
  await rapRepo.putObservation({ commitId: commit.id, observedAt: new Date().toISOString(), status: "on_track", observedValue: 40, note: null, recordedBy: "party-123" });
  await assert.rejects(() => pub("lk3"), /locked/i, "re-extraction blocked after company progress");
  console.log("OK test-rap-reextract-lock");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
