// ===========================================================================
// Real extraction pipeline — Claude on Bedrock (tool-use), with deterministic
// validation. SCAFFOLD: structurally complete, but two integration points are
// marked TODO (S3 document fetch + optional Textract OCR) and it requires
// `npm i @aws-sdk/client-bedrock-runtime`. Gated behind EXTRACTION_IMPL=bedrock;
// the mock is the default so dev/demo never loads this module.
//
// Flow: load doc text → Claude forced to call record_rap_extraction (grounded
// JSON) → validateAndFlag (set flagged + collect issues) → derive classification
// → ExtractionResult. The BDA path would replace the Claude call with a Bedrock
// Data Automation blueprint invoke and map its output into the same shape.
// ===========================================================================
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { DetectDocumentTextCommand, TextractClient } from "@aws-sdk/client-textract";
import { CLAUDE_TOOL, EXTRACTION_SYSTEM, EXTRACTION_TOOL_NAME } from "./extraction-schema";
import { getDocumentBytes } from "./storage";
import { validateAndFlag } from "./validate";
import type { ExtractedRap, ExtractionResult, RapClassification } from "./types";

const region = process.env.BEDROCK_REGION ?? "ca-central-1";
// Set to the Claude-on-Bedrock model / inference-profile id for `region`
// (ca-central-1 reaches Claude via the Canada/NA geo cross-region profile).
const modelId = process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-sonnet-4-6";

const client = new BedrockRuntimeClient({ region });
const textract = new TextractClient({ region });

// Fetch the raw document from S3 and return its text. Plain-text/.txt is decoded
// directly; everything else is OCR'd with Textract DetectDocumentText.
// NOTE: synchronous DetectDocumentText handles single-page docs and images. A
// multi-page PDF needs the ASYNC StartDocumentTextDetection → poll flow (reads
// the object from S3 by bucket/key). For multi-page extraction at scale, prefer
// the BDA path, which ingests multi-page PDFs/Office docs natively. This sync
// path is the simple single-page/image baseline.
async function loadDocumentText(sourceS3Key: string, fileName: string): Promise<string> {
  const bytes = await getDocumentBytes(sourceS3Key);

  if (/\.txt$/i.test(fileName)) {
    return new TextDecoder().decode(bytes);
  }

  const res = await textract.send(new DetectDocumentTextCommand({ Document: { Bytes: bytes } }));
  return (res.Blocks ?? [])
    .filter((b: any) => b.BlockType === "LINE" && b.Text)
    .map((b: any) => b.Text as string)
    .join("\n");
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
    max_tokens: 8192,
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

  const res = await client.send(
    new InvokeModelCommand({ modelId, contentType: "application/json", body: JSON.stringify(body) }),
  );
  const payload = JSON.parse(new TextDecoder().decode(res.body));

  // pull the forced tool_use block; its `input` is the ExtractedRap-shaped object
  const toolUse = (payload.content ?? []).find(
    (b: any) => b.type === "tool_use" && b.name === EXTRACTION_TOOL_NAME,
  );
  if (!toolUse) throw new Error("Bedrock response contained no record_rap_extraction tool_use block");
  const raw = toolUse.input as ExtractedRap;

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
