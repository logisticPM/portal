// scripts/test-rap-publish-gate.ts
import assert from "node:assert/strict";
import { canPublish } from "../src/lib/rap/actions-core";
import { extractionRepo } from "../src/lib/rap/index";

async function main() {
  assert.equal(canPublish({ businessNumber: null } as any), false, "no BN → cannot publish");
  assert.equal(canPublish({ businessNumber: "119653384" } as any), true, "BN → can publish");

  const job = await extractionRepo.createJob({ id: "pg1", fileName: "x.pdf", sourceS3Key: "s3://pg1", dataClass: "org_submitted" });
  assert.equal(canPublish(job), false, "freshly created job has no BN");
  await extractionRepo.setJobOrg(job.id, {
    businessNumber: "119653384",
    businessNumberSource: "self_asserted",
    registryLegalName: null,
    registryStatus: null,
  });
  const resolved = await extractionRepo.getJob(job.id);
  assert.equal(canPublish(resolved!), true, "job with resolved BN can publish");

  console.log("OK test-rap-publish-gate");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
