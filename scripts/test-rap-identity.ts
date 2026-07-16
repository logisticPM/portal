// scripts/test-rap-identity.ts
// Wrapped in an async IIFE: this repo is NOT ESM, so top-level await is illegal
// (same convention as scripts/test-cases-figures.ts).
import assert from "node:assert/strict";
import { extractionRepo, rapRepo } from "../src/lib/rap/index";
import { publishAndConfirm } from "../src/lib/rap/stage-extraction";
import { runExtraction } from "../src/lib/rap/pipeline.mock";
import type { ExtractedRap } from "../src/lib/rap/types";

(async () => {
  const base = (await runExtraction({ fileName: "x.pdf", sourceS3Key: "s3://x" })).extracted;
  let seq = 0;
  async function publishWithBN(name: string, bn9: string | null, file = "x.pdf") {
    const id = `job-id-${seq++}`;
    const job = await extractionRepo.createJob({ id, fileName: file, sourceS3Key: `s3://${id}`, dataClass: "org_submitted" });
    // Task 4 sets these at review; here we simulate a resolved job:
    await extractionRepo.setJobOrg(id, bn9 ? { businessNumber: bn9, businessNumberSource: "ised", registryLegalName: name.toUpperCase(), registryStatus: "Active" } : null);
    const staged = (await extractionRepo.getJob(id))!;
    const extracted: ExtractedRap = { ...base, orgName: { ...base.orgName, value: name } };
    await publishAndConfirm(staged, extracted, "tester");
    return (await extractionRepo.getJob(id))!.rapId!;
  }

  // three real "Enbridge" entities → three distinct orgs
  await publishWithBN("Enbridge", "119653384", "a.pdf");
  await publishWithBN("Enbridge", "102505641", "b.pdf");
  assert.ok(await rapRepo.getOrganization("org-bn-119653384"), "Enbridge Inc org keyed on BN");
  assert.ok(await rapRepo.getOrganization("org-bn-102505641"), "Enbridge Pipelines org keyed on BN");
  const org = await rapRepo.getOrganization("org-bn-119653384");
  assert.equal(org?.legalName, "ENBRIDGE", "registry legal name stored");
  assert.equal(org?.registrySource, "ised");

  // program accounts of one business collapse to one org (Task 4 passes the 9-root)
  // self-asserted (no BN) falls back to the name key
  await publishWithBN("Tinyco", null, "c.pdf");
  assert.ok(await rapRepo.getOrganization("org-tinyco"), "no BN → name fallback org");
  console.log("OK test-rap-identity");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
