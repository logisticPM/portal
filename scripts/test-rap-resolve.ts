// scripts/test-rap-resolve.ts
import assert from "node:assert/strict";
import { extractionRepo } from "../src/lib/rap/index";
import { resolveOrgForJob } from "../src/lib/rap/actions-core";
import { StubRegistryProvider } from "../src/lib/rap/registry";

async function main() {
  const reg = new StubRegistryProvider({ "119653384": { businessNumber: "119653384", legalName: "ENBRIDGE INC.", status: "Active", jurisdiction: "CA-federal", officeLocation: null, source: "ised" } });
  const job = await extractionRepo.createJob({ id: "rj1", fileName: "x.pdf", sourceS3Key: "s3://rj1", dataClass: "org_submitted" });

  const bad = await resolveOrgForJob(reg, { jobId: job.id, bnRaw: "123" });
  assert.equal(bad.ok, false, "invalid BN rejected");

  const ok = await resolveOrgForJob(reg, { jobId: job.id, bnRaw: "119653384RC0001" });
  assert.equal(ok.ok, true);
  const stored = await extractionRepo.getJob("rj1");
  assert.equal(stored?.businessNumber, "119653384", "9-root stored");
  assert.equal(stored?.businessNumberSource, "ised");

  const miss = await resolveOrgForJob(reg, { jobId: job.id, bnRaw: "000000018" }); // luhn-valid but unknown
  assert.equal(miss.ok, false, "unknown BN not silently self-asserted");
  const self = await resolveOrgForJob(reg, { jobId: job.id, bnRaw: "000000018", selfAsserted: true });
  assert.equal(self.ok, true);
  assert.equal((await extractionRepo.getJob("rj1"))?.businessNumberSource, "self_asserted");
  console.log("OK test-rap-resolve");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
