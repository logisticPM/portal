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
  type Block,
  GetDocumentAnalysisCommand,
  StartDocumentAnalysisCommand,
  TextractClient,
} from "@aws-sdk/client-textract";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { resolveBedrockModelId } from "./bedrock-model";
import { CLAUDE_TOOL, EXTRACTION_SYSTEM, EXTRACTION_TOOL_NAME } from "./extraction-schema";
import { getDocumentBytes } from "./storage";
import { validateAndFlag } from "./validate";
import type { ExtractedRap, ExtractionResult, RapClassification } from "./types";

const region = process.env.BEDROCK_REGION ?? "ca-central-1";
// Must be an INFERENCE PROFILE, not a bare model id — Bedrock rejects bare ids
// for on-demand invoke, which made every Option B call fail. resolveBedrockModelId
// enforces that and explains the fix. (There is no "ca." geo prefix; ca-central-1
// reaches Claude via the "us." profile — see src/lib/rap/bedrock-model.ts.)
const modelId = resolveBedrockModelId(process.env);
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

// Layout block types that carry emittable body text. LAYOUT_HEADER / LAYOUT_FOOTER
// / LAYOUT_PAGE_NUMBER are dropped as running-boilerplate noise (repeated on
// every page, no extraction value — page identity is carried explicitly by the
// "[p.N]" marker below instead). LAYOUT_FIGURE is dropped too, but costs
// nothing in this document: figures have no LINE children (pure images, no
// caption text was OCR'd). Dropping any of these means the emitted text is no
// longer a byte-for-byte reproduction of the source document.
const NOISE_LAYOUT_TYPES = new Set(["LAYOUT_HEADER", "LAYOUT_FOOTER", "LAYOUT_PAGE_NUMBER", "LAYOUT_FIGURE"]);

// Join a layout block's LINE children (its CHILD relationship) into one string.
function childLineText(block: Block, byId: Map<string, Block>): string {
  const rel = block.Relationships?.find((r) => r.Type === "CHILD");
  if (!rel) return "";
  return (rel.Ids ?? [])
    .map((id) => byId.get(id))
    .filter((b): b is Block => !!b && b.BlockType === "LINE" && !!b.Text)
    .map((b) => b.Text as string)
    .join("\n");
}

// Reconstruct document text from Textract LAYOUT blocks, in Textract's own
// reading order (LAYOUT already resolves multi-column pages into the correct
// order; no re-sort needed). Pure, no AWS/IO — shared by the production loader
// below and the offline measurement script (scratchpad/emit-chunks.ts), so the
// two cannot drift.
//
// Dedupe (load-bearing): a LAYOUT_LIST's CHILD relationship points at
// LAYOUT_TEXT blocks that ALSO appear as their own top-level entries in the
// same Blocks array (verified against the cached test-fixture dump: 55
// LAYOUT_TEXT blocks are list children; naively emitting every top-level
// block duplicates ~33% of the document, including every commitment bullet).
// We keep the LAYOUT_LIST's children — one paragraph per list item — and skip
// those same LAYOUT_TEXT blocks when encountered again at top level. Emitting
// one paragraph per list item (rather than one blob per list) also means each
// bullet gets its own blank-line-delimited paragraph, so chunkDocument's
// paragraph split can never land inside a single commitment.
//
// Page markers: every paragraph is prefixed with a "[p.N]" line so a page
// number survives into whatever chunk the paragraph lands in. A marker
// emitted only on page-change would be lost once a later chunk starts
// mid-page, without the block that changed to that page — this pipeline has
// no other page signal (a flat LINE join, the old behavior, carried none).
// Cost: repeats a short marker on every paragraph, and — like dropping the
// noise block types above — means chunk text is no longer a verbatim copy of
// the source.
export function buildTextFromLayoutBlocks(blocks: Block[]): string {
  const byId = new Map<string, Block>();
  for (const b of blocks) if (b.Id) byId.set(b.Id, b);

  const listChildIds = new Set<string>();
  for (const b of blocks) {
    if (b.BlockType !== "LAYOUT_LIST") continue;
    const rel = b.Relationships?.find((r) => r.Type === "CHILD");
    for (const id of rel?.Ids ?? []) listChildIds.add(id);
  }

  const paragraphs: string[] = [];
  const pushParagraph = (page: number | undefined, text: string) => {
    const t = text.trim();
    if (t) paragraphs.push(`[p.${page ?? "?"}]\n${t}`);
  };

  for (const b of blocks) {
    if (!b.BlockType || NOISE_LAYOUT_TYPES.has(b.BlockType)) continue;

    if (b.BlockType === "LAYOUT_LIST") {
      const rel = b.Relationships?.find((r) => r.Type === "CHILD");
      for (const id of rel?.Ids ?? []) {
        const child = byId.get(id);
        if (child) pushParagraph(child.Page, childLineText(child, byId));
      }
      continue;
    }

    // duplicate top-level entry for a block already emitted as a LAYOUT_LIST child
    if (b.BlockType === "LAYOUT_TEXT" && b.Id && listChildIds.has(b.Id)) continue;

    if (b.BlockType === "LAYOUT_TITLE" || b.BlockType === "LAYOUT_SECTION_HEADER" || b.BlockType === "LAYOUT_TEXT") {
      pushParagraph(b.Page, childLineText(b, byId));
    }
  }

  return paragraphs.join("\n\n");
}

// Fetch document text. Plain-text is decoded directly; PDFs/images are OCR'd via
// ASYNC Textract LAYOUT analysis (StartDocumentAnalysis FeatureTypes:["LAYOUT"]
// → poll → paginate), which handles MULTI-PAGE PDFs (the sync path was
// single-page only) and gives block boundaries the paragraph chunker can
// actually use (see buildTextFromLayoutBlocks above — a flat LINE join has no
// blank lines, so chunkDocument's paragraph split never used to fire).
// Reads the object straight from S3 by bucket/key — no bytes round-trip.
async function loadDocumentText(sourceS3Key: string, fileName: string): Promise<string> {
  if (/\.txt$/i.test(fileName)) {
    return new TextDecoder().decode(await getDocumentBytes(sourceS3Key));
  }
  if (!uploadBucket) throw new Error("RAP_UPLOAD_BUCKET not set (needed for Textract S3 input)");

  const start = await textract.send(
    new StartDocumentAnalysisCommand({
      DocumentLocation: { S3Object: { Bucket: uploadBucket, Name: sourceS3Key } },
      FeatureTypes: ["LAYOUT"],
    }),
  );
  const jobId = start.JobId!;

  // poll until the OCR job finishes (bounded ~5 min)
  let status = "IN_PROGRESS";
  for (let i = 0; i < 60 && status === "IN_PROGRESS"; i++) {
    await sleep(5000);
    const r = await textract.send(new GetDocumentAnalysisCommand({ JobId: jobId }));
    status = r.JobStatus ?? "IN_PROGRESS";
    if (status === "FAILED") throw new Error(`Textract job failed: ${r.StatusMessage ?? "unknown"}`);
  }
  if (status !== "SUCCEEDED") throw new Error("Textract job did not complete within the poll window");

  // collect all blocks across all result pages (NextToken pagination)
  const blocks: Block[] = [];
  let token: string | undefined;
  do {
    const page = await textract.send(new GetDocumentAnalysisCommand({ JobId: jobId, NextToken: token }));
    blocks.push(...(page.Blocks ?? []));
    token = page.NextToken;
  } while (token);

  return buildTextFromLayoutBlocks(blocks);
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
