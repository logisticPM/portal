// dataClass threads from upload → job, and survives a Dynamo item round-trip.
// Also verifies it propagates from the job through buildCanonical to every
// entity in the published graph (org, rap, commitments, observations, rollups).
// Run: npx tsx scripts/test-rap-dataclass.ts
import { toJobItem, itemToJob } from "../src/lib/dynamo/rap-table";
import type { ExtractionJob } from "../src/lib/rap/types";
import { buildCanonical } from "../src/lib/rap/publish";
import type { ExtractedRap } from "../src/lib/rap/types";

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

// --- buildCanonical propagation ---

const g = <T>(value: T) => ({ value, confidence: 1, quote: "q", page: 1 });

const extracted = {
  orgName: g("Acme Ltd"),
  sector: g("other"),
  jurisdiction: g("CA"),
  rapTitle: g("Acme RAP"),
  rapType: g("reflect"),
  publicationDate: g("2026-01-01"),
  periodCovered: g({ start: "2026-01-01", end: "2026-12-31" }),
  commitments: [
    {
      pillarRaw: g("Other"),
      pillarNormalized: "other",
      commitmentType: g("other"),
      action: g("Do the thing"),
      deliverable: g("A thing"),
      timeline: g("2026-12-31"),
      owner: g("Someone"),
      metric: g("10%"),
    },
  ],
} as unknown as ExtractedRap;

const built = buildCanonical(
  extracted,
  { orgId: "org-1", rapId: "rap-1", commitId: (i) => `commit-${i}` },
  {
    sourceS3Key: "uploads/doc-1/rap.pdf",
    extractionId: "doc-1",
    now: "2026-07-16T00:00:00.000Z",
    reviewedBy: "system:auto",
    dataClass: "org_submitted",
  },
);

check("org carries dataClass", built.org.dataClass === "org_submitted");
check("rap document carries dataClass", built.rap.dataClass === "org_submitted");
check("every commitment carries dataClass", built.commitments.every((c) => c.dataClass === "org_submitted"));
check("every observation carries dataClass", built.observations.every((o) => o.dataClass === "org_submitted"));
check("every rollup carries dataClass", built.rollups.every((r) => r.dataClass === "org_submitted"));

const builtPublic = buildCanonical(
  extracted,
  { orgId: "org-2", rapId: "rap-2", commitId: (i) => `commit-${i}` },
  {
    sourceS3Key: "uploads/doc-2/rap.pdf",
    extractionId: "doc-2",
    now: "2026-07-16T00:00:00.000Z",
    reviewedBy: "system:auto",
    dataClass: "public",
  },
);
check("a public job publishes a public graph", builtPublic.rap.dataClass === "public");
check("public propagates to commitments", builtPublic.commitments.every((c) => c.dataClass === "public"));

process.exit(fail ? 1 : 0);
