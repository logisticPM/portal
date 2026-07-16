// dataClass threads from upload → job, and survives a Dynamo item round-trip.
// Run: npx tsx scripts/test-rap-dataclass.ts
import { toJobItem, itemToJob } from "../src/lib/dynamo/rap-table";
import type { ExtractionJob } from "../src/lib/rap/types";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const job: ExtractionJob = {
  id: "doc-1",
  fileName: "rap.pdf",
  sourceS3Key: "uploads/doc-1/rap.pdf",
  status: "PENDING",
  schemaVersion: "test",
  engine: null,
  classification: null,
  extracted: null,
  validationIssues: [],
  verdicts: [],
  reviewedBy: null,
  reviewNote: null,
  rapId: null,
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
  businessNumber: null,
  businessNumberSource: null,
  registryLegalName: null,
  registryStatus: null,
  dataClass: "org_submitted",
};

// The trap this guards: a mapping that silently drops the field on read.
const roundTripped = itemToJob(toJobItem(job));
check("dataClass survives the Dynamo item round-trip", roundTripped.dataClass === "org_submitted");

const publicJob = itemToJob(toJobItem({ ...job, dataClass: "public" }));
check("public dataClass round-trips too", publicJob.dataClass === "public");

process.exit(fail ? 1 : 0);
