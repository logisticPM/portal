// Verifies the RAP extraction → publish path does NOT duplicate canonical data,
// even when the extractor's output varies between uploads of the SAME document.
//
// Dedup design under test (src/lib/rap/stage-extraction.ts + repo.*):
//   orgId  = slug(normalizeOrgName(orgName))    — stable across corporate-suffix noise
//   rapId  = stableRapId(orgId, contentHash)    — keyed on the SOURCE DOCUMENT, not
//                                                 on the model-extracted title/period
//   publish = putOrg → deleteRapGraph → rewrite (replace, not append)
//
// Run: npx tsx scripts/test-rap-dedup.ts     (mock repo, no AWS/Bedrock needed)
import assert from "node:assert/strict";
import { extractionRepo, rapRepo } from "../src/lib/rap/index";
import { publishAndConfirm } from "../src/lib/rap/stage-extraction";
import { runExtraction } from "../src/lib/rap/pipeline.mock";
import type { ExtractedRap } from "../src/lib/rap/types";

let seq = 0;
// Publish one document through the real publish path; returns its resolved rapId.
// The same `fileName` across two calls simulates re-uploading the same file (the
// content-hash falls back to hashing the file name when no S3 is configured).
async function publishDoc(fileName: string, extracted: ExtractedRap): Promise<string> {
  const id = `job-${seq++}`;
  const job = await extractionRepo.createJob({ id, fileName, sourceS3Key: `s3://doc/${id}` });
  await publishAndConfirm(job, extracted, "tester");
  return (await extractionRepo.getJob(id))!.rapId!;
}

function withOrgAndTitle(base: ExtractedRap, org: string, title: string): ExtractedRap {
  return {
    ...base,
    orgName: { ...base.orgName, value: org },
    rapTitle: { ...base.rapTitle, value: title },
  };
}

async function main() {
  const base = (await runExtraction({ fileName: "clean.pdf", sourceS3Key: "s3://x" })).extracted;

  // === Scenario 1: exact re-upload is idempotent =============================
  const idem = withOrgAndTitle(base, "Idem Co", "Idem RAP");
  const r1a = await publishDoc("idem.pdf", idem);
  const c1 = await rapRepo.listCommitmentsByRap(r1a);
  const n1 = c1.length;
  const oldCommitId = c1[0].id;
  assert.ok(n1 > 0, "publish #1 wrote commitments");

  const r1b = await publishDoc("idem.pdf", idem);
  assert.equal(r1b, r1a, "exact re-upload → same rapId");
  assert.equal((await rapRepo.listCommitmentsByRap(r1a)).length, n1, "commitments not doubled");
  assert.equal((await rapRepo.listObservations(oldCommitId)).length, 0, "old observations cascade-deleted");
  assert.equal(await rapRepo.getRollup(oldCommitId), null, "old rollup cascade-deleted");
  console.log(`OK scenario 1 (exact re-upload): ${n1} commitment(s), no duplicates, no orphans`);

  // === Scenario 2: org-name variance still dedups ===========================
  // Same document; extractor returns "Varorg" once and "Varorg Inc." the next
  // time. Corporate-suffix noise must NOT fragment into two orgs/graphs.
  const rv1 = await publishDoc("var.pdf", withOrgAndTitle(base, "Varorg", "Var RAP"));
  const nv = (await rapRepo.listCommitmentsByRap(rv1)).length;
  const rv2 = await publishDoc("var.pdf", withOrgAndTitle(base, "Varorg Inc.", "Var RAP"));
  assert.equal(rv2, rv1, "org-name suffix variance → same rapId (normalized org key)");
  assert.equal((await rapRepo.listCommitmentsByRap(rv1)).length, nv, "commitments not doubled by org variance");
  assert.equal(await rapRepo.getOrganization("org-varorg-inc"), null, "no fragmented 'org-varorg-inc' row");
  console.log("OK scenario 2 (org-name variance): deduped to one org/graph");

  // === Scenario 3: title/period variance still dedups =======================
  // Same file; extractor returns a different RAP title the second time. Because
  // identity is keyed on the source document (content hash), not the extracted
  // title, this must still resolve to the same RAP.
  const rt1 = await publishDoc("title.pdf", withOrgAndTitle(base, "Titleco", "Title RAP v1"));
  const nt = (await rapRepo.listCommitmentsByRap(rt1)).length;
  const rt2 = await publishDoc("title.pdf", withOrgAndTitle(base, "Titleco", "A Completely Different Title"));
  assert.equal(rt2, rt1, "title variance on the same document → same rapId (content-keyed)");
  assert.equal((await rapRepo.listCommitmentsByRap(rt1)).length, nt, "commitments not doubled by title variance");
  console.log("OK scenario 3 (title variance): deduped via content identity");

  console.log("\ntest-rap-dedup: PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
