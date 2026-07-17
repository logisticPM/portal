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
import { deriveClassification, derivePillars } from "./classify";
import { getDocumentBytes, getJsonByS3Uri, putDocument } from "./storage";
import { validateAndFlag } from "./validate";
import type {
  CommitmentType, ExtractedCommitment, ExtractedRap, ExtractionResult, Grounded, Jurisdiction,
  Pillar, Sector,
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
  // drop empty-action artifacts (BDA sometimes returns blank commitment objects)
  const commitments: ExtractedCommitment[] = irCommits
    .map((c: any, i: number) => mapCommitment(c, exCommits[i]))
    .filter((c: ExtractedCommitment) => !empty(c.action.value));
  return {
    orgName: g("orgName"),
    sector: g("sector") as Grounded<Sector>,
    jurisdiction: g("jurisdiction") as Grounded<Jurisdiction>,
    rapTitle: g("rapTitle"),
    publicationDate: g("publicationDate"),
    periodCovered: g("periodCovered"),
    frameworkRefs: g("frameworkRefs"),
    governanceBody: g("governanceBody"),
    reviewCycle: g("reviewCycle"),
    rapType: g("rapType"),
    pairLevel: g("pairLevel"),
    endorsementStatus: g("endorsementStatus"),
    commitments,
    // DERIVED from the commitments, not read from the blueprint's own `pillars`
    // field — that field is a summary with no verbatim span, and BDA grounds by
    // confidence anyway. The blueprint may still emit it; we ignore it.
    pillars: derivePillars(commitments),
    sectorFields: {}, // populate from ir.sectorFields once the blueprint defines them
    extras: Array.isArray(ir.extras) ? ir.extras : [],
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

// BDA custom-blueprint extraction caps at ~20 pages per document (verified: a
// 35-page RAP fails with "input document size is too large" even at 2.9 MB — it's
// a PAGE limit, not file size). Longer docs are auto-split into ≤20-page chunks.
const BDA_MAX_PAGES = 20;

// Run ONE BDA job on an S3 input; return its inference_result + explainability.
async function runBdaJob(inputS3Uri: string, outSuffix: string): Promise<{ ir: any; ex: any }> {
  const started = await client.send(
    new InvokeDataAutomationAsyncCommand({
      inputConfiguration: { s3Uri: inputS3Uri },
      outputConfiguration: { s3Uri: `s3://${outputBucket}/bda-output/${outSuffix}` },
      dataAutomationConfiguration: { dataAutomationProjectArn: projectArn!, stage: "LIVE" },
      dataAutomationProfileArn: profileArn!,
    } as any),
  );
  const invocationArn = (started as any).invocationArn as string;
  let outputS3Uri: string | undefined;
  for (let i = 0; i < 90; i++) { // ~7.5 min per job (parallel across chunks)
    await sleep(5000);
    const st = await client.send(new GetDataAutomationStatusCommand({ invocationArn }));
    const status = (st as any).status as string;
    if (status === "Success") { outputS3Uri = (st as any).outputConfiguration?.s3Uri; break; }
    if (status === "ServiceError" || status === "ClientError") {
      throw new Error(`BDA job failed: ${status} — ${(st as any).errorMessage ?? "unknown"}`);
    }
  }
  if (!outputS3Uri) throw new Error("BDA job did not complete within the poll window");
  return readBdaResult(outputS3Uri);
}

// WORKAROUND for the ~20-page limit: split a long PDF into ≤20-page chunks
// (uploaded to S3 under bda-chunks/) and return the S3 URIs to run BDA on. Short
// PDFs / non-PDFs run on the original object unchanged.
async function planBdaInputs(bytes: Uint8Array, sourceS3Key: string, uploadBucket: string): Promise<string[]> {
  const isPdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
  const original = [`s3://${uploadBucket}/${sourceS3Key}`];
  if (!isPdf) return original;

  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total <= BDA_MAX_PAGES) return original;

  const uris: string[] = [];
  for (let start = 0, idx = 0; start < total; start += BDA_MAX_PAGES, idx++) {
    const end = Math.min(start + BDA_MAX_PAGES, total);
    const sub = await PDFDocument.create();
    const pages = await sub.copyPages(src, Array.from({ length: end - start }, (_, k) => start + k));
    pages.forEach((p) => sub.addPage(p));
    const out = await sub.save();
    const key = `bda-chunks/${sourceS3Key}/part${idx}.pdf`;
    await putDocument(key, out, "application/pdf");
    uris.push(`s3://${uploadBucket}/${key}`);
  }
  return uris;
}

// Shift a chunk's grounded page numbers back to the ORIGINAL document's numbering.
function offsetChunk(e: ExtractedRap, offset: number): ExtractedRap {
  if (!offset) return e;
  const off = (g: Grounded<any>): Grounded<any> => (g && g.page != null ? { ...g, page: g.page + offset } : g);
  return {
    ...e,
    commitments: e.commitments.map((c) => ({
      ...c,
      pillarRaw: off(c.pillarRaw), action: off(c.action), deliverable: off(c.deliverable),
      timeline: off(c.timeline), owner: off(c.owner), metric: off(c.metric), commitmentType: off(c.commitmentType),
    })),
    extras: (e.extras ?? []).map((x) => (x.page != null ? { ...x, page: x.page + offset } : x)),
  };
}

// Merge per-chunk extractions: header fields = first chunk that found a value;
// commitments + extras = union, de-duplicated across chunk boundaries.
function mergeExtracted(parts: ExtractedRap[]): ExtractedRap {
  const pick = (get: (e: ExtractedRap) => Grounded<any>): Grounded<any> => {
    for (const p of parts) { const g = get(p); if (g && g.value != null && g.value !== "") return g; }
    return get(parts[0]);
  };
  const seen = new Set<string>();
  const commitments: ExtractedCommitment[] = [];
  for (const p of parts) for (const c of p.commitments) {
    const k = (c.action.value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!k || seen.has(k)) continue; // drop empty-action artifacts + exact duplicates
    seen.add(k);
    commitments.push(c);
  }
  const exSeen = new Set<string>();
  const extras: ExtractedRap["extras"] = [];
  for (const p of parts) for (const x of p.extras ?? []) {
    const k = `${x.label}|${x.value}`.toLowerCase();
    if (exSeen.has(k)) continue;
    exSeen.add(k);
    extras.push(x);
  }
  return {
    orgName: pick((e) => e.orgName), sector: pick((e) => e.sector) as Grounded<Sector>,
    jurisdiction: pick((e) => e.jurisdiction) as Grounded<Jurisdiction>, rapTitle: pick((e) => e.rapTitle),
    publicationDate: pick((e) => e.publicationDate), periodCovered: pick((e) => e.periodCovered),
    frameworkRefs: pick((e) => e.frameworkRefs),
    governanceBody: pick((e) => e.governanceBody), reviewCycle: pick((e) => e.reviewCycle),
    rapType: pick((e) => e.rapType), pairLevel: pick((e) => e.pairLevel),
    endorsementStatus: pick((e) => e.endorsementStatus),
    commitments,
    // Derive from the MERGED commitments. pick() takes the first chunk that found
    // a value, which for an array field silently discarded every other chunk's
    // pillars on a >20-page RAP; the commitments are unioned across chunks, so
    // deriving from them is both correct and complete.
    pillars: derivePillars(commitments),
    sectorFields: parts[0].sectorFields ?? {}, extras,
  };
}

export async function runExtractionBda(input: { fileName: string; sourceS3Key: string }): Promise<ExtractionResult> {
  if (!projectArn) throw new Error("BDA_PROJECT_ARN not set");
  if (!profileArn) throw new Error("BDA_PROFILE_ARN not set (required — e.g. …/us.data-automation-v1)");
  if (!outputBucket) throw new Error("BDA_OUTPUT_BUCKET / RAP_ANALYTICS_BUCKET not set");
  const uploadBucket = process.env.RAP_UPLOAD_BUCKET;
  if (!uploadBucket) throw new Error("RAP_UPLOAD_BUCKET not set");

  // Auto-chunk long PDFs (BDA's ~20-page limit), then run each chunk in PARALLEL
  // (wall time ≈ one job, not the sum) and merge into a single extraction.
  const bytes = await getDocumentBytes(input.sourceS3Key);
  const inputs = await planBdaInputs(bytes, input.sourceS3Key, uploadBucket);
  const results = await Promise.all(inputs.map((uri, i) => runBdaJob(uri, `${input.sourceS3Key}/part${i}`)));
  const parts = results.map((r, i) => offsetChunk(mapBdaToExtracted(r.ir, r.ex), i * BDA_MAX_PAGES));
  const raw = parts.length === 1 ? parts[0] : mergeExtracted(parts);

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
