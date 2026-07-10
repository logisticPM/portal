// Verifies recordRapProgressForParty: a claimed company party can append an
// Observation to a commitment on their BN'd org (append-only, never edits
// grounded fields); an unclaimed party is rejected. Direct (rapId, commitId)
// read via rapRepo.getCommitment — no new GSI.
//
// Run: npx tsx scripts/test-rap-progress.ts   (mock repo, no AWS/Bedrock needed)
import assert from "node:assert/strict";
import { extractionRepo, rapRepo } from "../src/lib/rap/index";
import { publishAndConfirm } from "../src/lib/rap/stage-extraction";
import { recordRapProgressForParty } from "../src/lib/rap/actions-core";
import { runExtraction } from "../src/lib/rap/pipeline.mock";

(async () => {
  const base = (await runExtraction({ fileName: "p.pdf", sourceS3Key: "s3://p" })).extracted;
  const job = await extractionRepo.createJob({ id: "pj1", fileName: "p.pdf", sourceS3Key: "s3://pj1" });
  await extractionRepo.setJobOrg("pj1", { businessNumber: "119653384", businessNumberSource: "ised", registryLegalName: "X", registryStatus: "Active" });
  await publishAndConfirm((await extractionRepo.getJob("pj1"))!, base, "tester");
  const rapId = (await extractionRepo.getJob("pj1"))!.rapId!;
  const commit = (await rapRepo.listCommitmentsByRap(rapId))[0];

  // unclaimed party rejected
  assert.equal(
    (await recordRapProgressForParty({ partyId: "p9", rapId, commitId: commit.id, status: "on_track", observedValue: 30, note: null })).ok,
    false,
    "unclaimed party rejected",
  );

  await rapRepo.putClaim({ businessNumber: "119653384", partyId: "p1", status: "granted", attestedAt: "t", grantedBy: "test" });
  const ok = await recordRapProgressForParty({ partyId: "p1", rapId, commitId: commit.id, status: "on_track", observedValue: 55, note: "Q3" });
  assert.equal(ok.ok, true);
  const obs = await rapRepo.listObservations(commit.id);
  assert.ok(obs.some((o) => o.recordedBy === "p1" && o.observedValue === 55), "company observation appended");
  console.log("OK test-rap-progress");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
