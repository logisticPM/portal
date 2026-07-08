// ===========================================================================
// Real extraction pipeline — Claude on Bedrock (tool-use), with deterministic
// validation. This is Option B (fully in-region, e.g. ca-central-1): async
// Textract OCR (multi-page) → Claude forced to call record_rap_extraction
// (grounded JSON with verbatim quotes) → validateAndFlag → ExtractionResult.
// Gated behind EXTRACTION_IMPL=bedrock; the mock is the default so dev/demo
// never loads this module. (Option A is pipeline.bda.ts — managed, US-region.)
// ===========================================================================
import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  GetDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommand,
  TextractClient,
} from "@aws-sdk/client-textract";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { CLAUDE_TOOL, EXTRACTION_SYSTEM, EXTRACTION_TOOL_NAME } from "./extraction-schema";
import { getDocumentBytes } from "./storage";
import { validateAndFlag } from "./validate";
import type { ExtractedRap, ExtractionResult, RapClassification } from "./types";

const region = process.env.BEDROCK_REGION ?? "ca-central-1";
// Set to the Claude-on-Bedrock model / inference-profile id for `region`
// (ca-central-1 reaches Claude via the Canada/NA geo cross-region profile).
const modelId = process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-sonnet-4-6";
const uploadBucket = process.env.RAP_UPLOAD_BUCKET;
// Output cap. NOTE (see docs/rap-extraction-findings.md): on this model the
// per-subfield grounded schema is very output-heavy and a many-commitment RAP
// can exhaust this before the JSON completes (detected below). Raising it much
// higher makes the generation long enough that the connection drops.
const MAX_OUTPUT_TOKENS = 16000;

// Use an http/1.1 handler with a long request timeout. A large extraction (many
// pages + a big grounded tool response) is a slow non-streaming generation; the
// default http2 handler drops it with "http2 request did not get a response".
const client = new BedrockRuntimeClient({
  region,
  requestHandler: new NodeHttpHandler({ requestTimeout: 300_000, connectionTimeout: 10_000 }),
});
const textract = new TextractClient({ region });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch document text. Plain-text is decoded directly; PDFs/images are OCR'd via
// ASYNC Textract (StartDocumentTextDetection → poll → paginate), which handles
// MULTI-PAGE PDFs (the sync DetectDocumentText path was single-page only).
// Reads the object straight from S3 by bucket/key — no bytes round-trip.
async function loadDocumentText(sourceS3Key: string, fileName: string): Promise<string> {
  if (/\.txt$/i.test(fileName)) {
    return new TextDecoder().decode(await getDocumentBytes(sourceS3Key));
  }
  if (!uploadBucket) throw new Error("RAP_UPLOAD_BUCKET not set (needed for Textract S3 input)");

  const start = await textract.send(
    new StartDocumentTextDetectionCommand({
      DocumentLocation: { S3Object: { Bucket: uploadBucket, Name: sourceS3Key } },
    }),
  );
  const jobId = start.JobId!;

  // poll until the OCR job finishes (bounded ~5 min)
  let status = "IN_PROGRESS";
  for (let i = 0; i < 60 && status === "IN_PROGRESS"; i++) {
    await sleep(5000);
    const r = await textract.send(new GetDocumentTextDetectionCommand({ JobId: jobId }));
    status = r.JobStatus ?? "IN_PROGRESS";
    if (status === "FAILED") throw new Error(`Textract job failed: ${r.StatusMessage ?? "unknown"}`);
  }
  if (status !== "SUCCEEDED") throw new Error("Textract job did not complete within the poll window");

  // collect LINE blocks across all result pages (NextToken pagination)
  const lines: string[] = [];
  let token: string | undefined;
  do {
    const page = await textract.send(new GetDocumentTextDetectionCommand({ JobId: jobId, NextToken: token }));
    for (const b of page.Blocks ?? []) {
      if (b.BlockType === "LINE" && b.Text) lines.push(b.Text);
    }
    token = page.NextToken;
  } while (token);

  return lines.join("\n");
}

// classification is derivable from the grounded core fields (one fewer API call);
// confidence = the least confident of the three signals.
function deriveClassification(e: ExtractedRap): RapClassification {
  return {
    jurisdiction: e.jurisdiction.value ?? "other",
    sector: e.sector.value ?? "other",
    rapType: e.rapType.value,
    confidence: Math.min(e.jurisdiction.confidence, e.sector.confidence, e.rapType.confidence),
  };
}

export async function runExtractionBedrock(input: { fileName: string; sourceS3Key: string }): Promise<ExtractionResult> {
  const documentText = await loadDocumentText(input.sourceS3Key, input.fileName);

  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: MAX_OUTPUT_TOKENS,
    system: EXTRACTION_SYSTEM,
    tools: [CLAUDE_TOOL],
    tool_choice: { type: "tool", name: EXTRACTION_TOOL_NAME }, // force the schema
    messages: [
      {
        role: "user",
        content: `Extract the RAP fields from this document.\n\n<document filename="${input.fileName}">\n${documentText}\n</document>`,
      },
    ],
  };

  // STREAM the response. A big grounded extraction is a long generation, and a
  // non-streaming InvokeModel gets its socket closed mid-generation ("socket hang
  // up"). Streaming keeps the connection alive and delivers the forced tool_use
  // input as incremental input_json_delta chunks, which we reassemble + parse.
  const res = await client.send(
    new InvokeModelWithResponseStreamCommand({ modelId, contentType: "application/json", body: JSON.stringify(body) }),
  );

  let toolJson = "";
  let stopReason = "";
  for await (const event of res.body ?? []) {
    const bytes = event.chunk?.bytes;
    if (!bytes) continue;
    const evt = JSON.parse(new TextDecoder().decode(bytes));
    if (evt.type === "message_delta" && evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
    if (evt.type === "content_block_delta" && evt.delta?.type === "input_json_delta") {
      toolJson += evt.delta.partial_json ?? "";
    }
  }
  if (!toolJson) throw new Error("Bedrock stream contained no record_rap_extraction tool input");
  if (stopReason === "max_tokens") {
    // Truncated: the grounded schema exhausted the output budget before finishing.
    // Known limitation for many-commitment RAPs — see docs/rap-extraction-findings.md.
    throw new Error(
      "Claude extraction truncated at max_tokens — this RAP has too many commitments for the per-subfield grounded schema in a single call (see docs/rap-extraction-findings.md).",
    );
  }
  let raw: ExtractedRap;
  try {
    raw = JSON.parse(toolJson) as ExtractedRap;
  } catch (e) {
    const m = /position (\d+)/.exec(String(e));
    const p = m ? parseInt(m[1], 10) : 0;
    throw new Error(`tool JSON parse failed (len ${toolJson.length}) near: …${toolJson.slice(Math.max(0, p - 60), p + 60)}…`);
  }

  // deterministic gate: Claude returns verbatim quotes → require them
  const { extracted, issues } = validateAndFlag(raw, { requireQuote: true });

  return {
    engine: "claude",
    schemaVersion: (await import("./types")).RAP_SCHEMA_VERSION,
    classification: deriveClassification(extracted),
    extracted,
    validationIssues: issues,
    // TODO: optional second-pass LLM-as-judge ("does each quote support its
    // value?") → populate verdicts. Empty is safe; flagged + issues already gate.
    verdicts: [],
  };
}
