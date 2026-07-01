// ===========================================================================
// Real extraction pipeline — Amazon Bedrock Data Automation (BDA). The PRIMARY
// path: multi-page PDF/Office native (no Textract OCR step), returns structured
// fields + confidence against a custom BLUEPRINT, in one async job. Gated behind
// EXTRACTION_IMPL=bda; the mock is the default so dev never loads this module.
//
// Flow: InvokeDataAutomationAsync(input doc, output bucket, project/blueprint) →
// poll GetDataAutomationStatus → read the result JSON from S3 → map BDA's
// inference_result + explainability (confidence/location) into our Grounded<T>
// shape → validateAndFlag (requireQuote=false: BDA grounds by confidence, not a
// text quote) → ExtractionResult.
//
// PREREQUISITE: a BDA blueprint whose field names match extraction-schema.ts
// (orgName, sector, …, commitments[].action, …). Create it once via console/API
// and set BDA_PROJECT_ARN. The mapping below assumes those names; VERIFY the
// exact BDA result JSON shape (job-metadata → custom-output file) against your
// account before relying on it — the manifest layout is version-dependent.
// ===========================================================================
import {
  GetDataAutomationStatusCommand,
  InvokeDataAutomationAsyncCommand,
  BedrockDataAutomationRuntimeClient,
} from "@aws-sdk/client-bedrock-data-automation-runtime";
import { getJsonByS3Uri } from "./storage";
import { validateAndFlag } from "./validate";
import type {
  CommitmentType, ExtractedCommitment, ExtractedRap, ExtractionResult, Grounded, Jurisdiction,
  Pillar, RapClassification, Sector,
} from "./types";
import { RAP_SCHEMA_VERSION } from "./types";

const region = process.env.BEDROCK_REGION ?? "ca-central-1";
const projectArn = process.env.BDA_PROJECT_ARN; // custom-blueprint project
// REQUIRED by the BDA runtime (verified live): the data-automation profile ARN,
// e.g. arn:aws:bedrock:us-east-1:<acct>:data-automation-profile/us.data-automation-v1
const profileArn = process.env.BDA_PROFILE_ARN;
const outputBucket = process.env.BDA_OUTPUT_BUCKET ?? process.env.RAP_ANALYTICS_BUCKET;

// BDA confidence runs on a LOWER scale than Claude's (observed ~0.5–0.8 for
// solid extractions), so the bda path flags below this rather than the default 0.85.
const BDA_CONFIDENCE_THRESHOLD = 0.5;

const client = new BedrockDataAutomationRuntimeClient({ region });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- BDA → Grounded mapping ------------------------------------------------
// BDA gives clean values in `inference_result` and per-field {confidence,
// geometry[].page} in `explainability_info[0]` — merge them. No verbatim quote
// (grounding is confidence-based → validate runs requireQuote=false). Empty
// string means "not found" → value null.
const empty = (v: any) => v === "" || v == null;

function grounded(value: any, ex: any): Grounded<any> {
  return {
    value: empty(value) ? null : value,
    quote: null,
    page: ex?.geometry?.[0]?.page ?? null,
    confidence: typeof ex?.confidence === "number" ? ex.confidence : 0.5,
    flagged: false, // set by validateAndFlag
  };
}

function mapCommitment(ir: any, ex: any): ExtractedCommitment {
  ir = ir ?? {}; ex = ex ?? {};
  return {
    pillarRaw: grounded(ir.pillarRaw, ex.pillarRaw),
    pillarNormalized: (empty(ir.pillarNormalized) ? null : ir.pillarNormalized) as Pillar | null,
    action: grounded(ir.action, ex.action),
    deliverable: grounded(ir.deliverable, ex.deliverable),
    timeline: grounded(ir.timeline, ex.timeline),
    owner: grounded(ir.owner, ex.owner),
    metric: grounded(ir.metric, ex.metric),
    commitmentType: grounded(ir.commitmentType, ex.commitmentType) as Grounded<CommitmentType>,
  };
}

function mapBdaToExtracted(ir: any, ex: any): ExtractedRap {
  ir = ir ?? {}; ex = ex ?? {};
  const g = (k: string) => grounded(ir[k], ex[k]);
  const irCommits = Array.isArray(ir.commitments) ? ir.commitments : [];
  const exCommits = Array.isArray(ex.commitments) ? ex.commitments : [];
  return {
    orgName: g("orgName"),
    sector: g("sector") as Grounded<Sector>,
    jurisdiction: g("jurisdiction") as Grounded<Jurisdiction>,
    rapTitle: g("rapTitle"),
    publicationDate: g("publicationDate"),
    periodCovered: g("periodCovered"),
    frameworkRefs: g("frameworkRefs"),
    pillars: g("pillars"),
    governanceBody: g("governanceBody"),
    reviewCycle: g("reviewCycle"),
    rapType: g("rapType"),
    pairLevel: g("pairLevel"),
    endorsementStatus: g("endorsementStatus"),
    commitments: irCommits.map((c: any, i: number) => mapCommitment(c, exCommits[i])),
    sectorFields: {}, // populate from ir.sectorFields once the blueprint defines them
    extras: Array.isArray(ir.extras) ? ir.extras : [],
  };
}

function deriveClassification(e: ExtractedRap): RapClassification {
  return {
    jurisdiction: e.jurisdiction.value ?? "other",
    sector: e.sector.value ?? "other",
    rapType: e.rapType.value,
    confidence: Math.min(e.jurisdiction.confidence, e.sector.confidence, e.rapType.confidence),
  };
}

// Read the BDA output. The status s3Uri is a job-metadata JSON; the blueprint
// result (inference_result + explainability_info) lives in the per-segment
// custom_output file it references. Structure verified against a real run.
async function readBdaResult(jobOutputS3Uri: string): Promise<{ ir: any; ex: any }> {
  const meta = await getJsonByS3Uri<any>(jobOutputS3Uri);
  // real shape: output_metadata[0].segment_metadata[0].custom_output_path
  const seg = meta?.output_metadata?.[0]?.segment_metadata?.[0];
  const customPath = seg?.custom_output_path ?? seg?.custom_output?.s3_uri;
  const custom = customPath ? await getJsonByS3Uri<any>(customPath) : meta;
  const ir = custom?.inference_result;
  if (!ir) throw new Error("could not locate inference_result in BDA output");
  // explainability_info is a single-element list of {field: {confidence, geometry, value}}
  const ex = Array.isArray(custom?.explainability_info) ? custom.explainability_info[0] : {};
  return { ir, ex };
}

export async function runExtractionBda(input: { fileName: string; sourceS3Key: string }): Promise<ExtractionResult> {
  if (!projectArn) throw new Error("BDA_PROJECT_ARN not set");
  if (!profileArn) throw new Error("BDA_PROFILE_ARN not set (required — e.g. …/us.data-automation-v1)");
  if (!outputBucket) throw new Error("BDA_OUTPUT_BUCKET / RAP_ANALYTICS_BUCKET not set");
  const uploadBucket = process.env.RAP_UPLOAD_BUCKET;
  if (!uploadBucket) throw new Error("RAP_UPLOAD_BUCKET not set");

  const started = await client.send(
    new InvokeDataAutomationAsyncCommand({
      inputConfiguration: { s3Uri: `s3://${uploadBucket}/${input.sourceS3Key}` },
      outputConfiguration: { s3Uri: `s3://${outputBucket}/bda-output/${input.sourceS3Key}` },
      dataAutomationConfiguration: { dataAutomationProjectArn: projectArn, stage: "LIVE" },
      dataAutomationProfileArn: profileArn,
    } as any),
  );
  const invocationArn = (started as any).invocationArn as string;

  // poll until terminal (bounded ~5 min)
  let outputS3Uri: string | undefined;
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const st = await client.send(new GetDataAutomationStatusCommand({ invocationArn }));
    const status = (st as any).status as string;
    if (status === "Success") {
      outputS3Uri = (st as any).outputConfiguration?.s3Uri;
      break;
    }
    if (status === "ServiceError" || status === "ClientError") {
      throw new Error(`BDA job failed: ${status} — ${(st as any).errorMessage ?? "unknown"}`);
    }
  }
  if (!outputS3Uri) throw new Error("BDA job did not complete within the poll window");

  const { ir, ex } = await readBdaResult(outputS3Uri);
  const raw = mapBdaToExtracted(ir, ex);
  // BDA grounds by confidence (no quote) and on a lower scale → requireQuote=false, lower threshold
  const { extracted, issues } = validateAndFlag(raw, {
    requireQuote: false,
    threshold: BDA_CONFIDENCE_THRESHOLD,
  });

  return {
    engine: "bda",
    schemaVersion: RAP_SCHEMA_VERSION,
    classification: deriveClassification(extracted),
    extracted,
    validationIssues: issues,
    verdicts: [],
  };
}
