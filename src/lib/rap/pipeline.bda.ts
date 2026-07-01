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
const profileArn = process.env.BDA_PROFILE_ARN; // required by newer BDA API
const outputBucket = process.env.BDA_OUTPUT_BUCKET ?? process.env.RAP_ANALYTICS_BUCKET;

const client = new BedrockDataAutomationRuntimeClient({ region });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- BDA → Grounded mapping ------------------------------------------------
// BDA returns a confidence + location per field, not a verbatim quote, so quote
// is null and grounding is confidence-based (validate runs with requireQuote=false).
type BdaField = { value: any; confidence?: number; page?: number | null };
const field = (raw: BdaField | undefined): Grounded<any> => ({
  value: raw?.value ?? null,
  quote: null,
  page: raw?.page ?? null,
  confidence: raw?.confidence ?? 0.5,
  flagged: false, // set by validateAndFlag
});

// `inf` is the blueprint's inference_result keyed by our field names; each value
// may be a bare value or a {value, confidence, page} object depending on how the
// blueprint/explainability is shaped — normalize both.
function norm(v: any): BdaField {
  if (v && typeof v === "object" && "value" in v) return v as BdaField;
  return { value: v ?? null };
}

function mapCommitment(c: any): ExtractedCommitment {
  return {
    pillarRaw: field(norm(c?.pillarRaw)),
    pillarNormalized: (norm(c?.pillarNormalized).value ?? null) as Pillar | null,
    action: field(norm(c?.action)),
    deliverable: field(norm(c?.deliverable)),
    timeline: field(norm(c?.timeline)),
    owner: field(norm(c?.owner)),
    metric: field(norm(c?.metric)),
    commitmentType: field(norm(c?.commitmentType)) as Grounded<CommitmentType>,
  };
}

function mapBdaToExtracted(inf: any): ExtractedRap {
  return {
    orgName: field(norm(inf?.orgName)),
    sector: field(norm(inf?.sector)) as Grounded<Sector>,
    jurisdiction: field(norm(inf?.jurisdiction)) as Grounded<Jurisdiction>,
    rapTitle: field(norm(inf?.rapTitle)),
    publicationDate: field(norm(inf?.publicationDate)),
    periodCovered: field(norm(inf?.periodCovered)),
    frameworkRefs: field(norm(inf?.frameworkRefs)),
    pillars: field(norm(inf?.pillars)),
    governanceBody: field(norm(inf?.governanceBody)),
    reviewCycle: field(norm(inf?.reviewCycle)),
    rapType: field(norm(inf?.rapType)),
    pairLevel: field(norm(inf?.pairLevel)),
    endorsementStatus: field(norm(inf?.endorsementStatus)),
    commitments: Array.isArray(inf?.commitments) ? inf.commitments.map(mapCommitment) : [],
    sectorFields: {}, // populate from inf.sectorFields once the blueprint defines them
    extras: Array.isArray(inf?.extras) ? inf.extras : [],
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

// Pull the blueprint inference_result out of the BDA output. The status response
// points to a job-metadata JSON; custom output lives in a per-segment file it
// references. Tolerant of either layout — VERIFY against real output.
async function readInferenceResult(jobOutputS3Uri: string): Promise<any> {
  const meta = await getJsonByS3Uri<any>(jobOutputS3Uri);
  if (meta?.inference_result) return meta.inference_result;
  // follow the custom-output path referenced by the metadata
  const seg = meta?.output_metadata?.[0]?.segment_metadata?.[0];
  const customPath = seg?.custom_output_path ?? seg?.custom_output?.s3_uri;
  if (customPath) {
    const custom = await getJsonByS3Uri<any>(customPath);
    return custom?.inference_result ?? custom;
  }
  throw new Error("could not locate inference_result in BDA output metadata");
}

export async function runExtractionBda(input: { fileName: string; sourceS3Key: string }): Promise<ExtractionResult> {
  if (!projectArn) throw new Error("BDA_PROJECT_ARN not set");
  if (!outputBucket) throw new Error("BDA_OUTPUT_BUCKET / RAP_ANALYTICS_BUCKET not set");
  const uploadBucket = process.env.RAP_UPLOAD_BUCKET;
  if (!uploadBucket) throw new Error("RAP_UPLOAD_BUCKET not set");

  const started = await client.send(
    new InvokeDataAutomationAsyncCommand({
      inputConfiguration: { s3Uri: `s3://${uploadBucket}/${input.sourceS3Key}` },
      outputConfiguration: { s3Uri: `s3://${outputBucket}/bda-output/${input.sourceS3Key}` },
      dataAutomationConfiguration: { dataAutomationProjectArn: projectArn, stage: "LIVE" },
      ...(profileArn ? { dataAutomationProfileArn: profileArn } : {}),
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

  const inference = await readInferenceResult(outputS3Uri);
  const raw = mapBdaToExtracted(inference);
  // BDA grounds by confidence, not a text quote → requireQuote=false
  const { extracted, issues } = validateAndFlag(raw, { requireQuote: false });

  return {
    engine: "bda",
    schemaVersion: RAP_SCHEMA_VERSION,
    classification: deriveClassification(extracted),
    extracted,
    validationIssues: issues,
    verdicts: [],
  };
}
