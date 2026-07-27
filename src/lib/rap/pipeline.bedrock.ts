// ===========================================================================
// Real extraction pipeline — Claude on Bedrock (tool-use), with deterministic
// validation. This is Option B (fully in-region, e.g. ca-central-1): async
// Textract LAYOUT OCR (multi-page, page-grounded paragraphs) → one HEADER_TOOL
// call over the whole document + one COMMITMENTS_TOOL call per ~6000-char
// chunk (each forced via tool_choice, grounded JSON with verbatim quotes) →
// merge in chunk order → validateAndFlag → ExtractionResult. Chunking exists
// because a single forced call over a large RAP truncates before the JSON
// completes (see docs/rap-extraction-findings.md §4).
// Gated behind EXTRACTION_IMPL=bedrock; the mock is the default so dev/demo
// never loads this module. (Option A is pipeline.bda.ts — managed, US-region.)
// ===========================================================================
import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { resolveBedrockModelId } from "./bedrock-model";
import { DEFAULT_TARGET_CHARS, type DocChunk, chunkDocument, splitInHalf } from "./chunk";
import { deriveClassification, derivePillars } from "./classify";
import { selectLoader } from "./doc-loader";
import {
  COMMITMENTS_TOOL,
  COMMITMENTS_TOOL_NAME,
  EXTRACTION_SYSTEM,
  EXTRACTION_TOOL_NAME,
  HEADER_TOOL,
  HEADER_TOOL_NAME,
} from "./extraction-schema";
import { validateAndFlag } from "./validate";
import type { ExtractedCommitment, ExtractedRap, ExtractionResult } from "./types";

// Moved to ./doc-loader/textract. Re-exported so the existing offline test
// (scripts/test-layout-text.ts) keeps its import path unchanged.
export { buildTextFromLayoutBlocks } from "./doc-loader";

const region = process.env.BEDROCK_REGION ?? "ca-central-1";
// Must be an INFERENCE PROFILE, not a bare model id — Bedrock rejects bare ids
// for on-demand invoke, which made every Option B call fail. resolveBedrockModelId
// enforces that and explains the fix. (There is no "ca." geo prefix; ca-central-1
// reaches Claude via the "us." profile — see src/lib/rap/bedrock-model.ts.)
const modelId = resolveBedrockModelId(process.env);
// Output cap. Measured regime (docs/rap-extraction-findings.md §4, live
// 2026-07-16, do not re-derive — it costs real money): ~410 output tokens per
// commitment; 22 commitments succeeded 3/3 runs in both regions (~8.9k-10.2k
// output tokens); 32 aborted the connection 3/3, also on sonnet-4-5. Raising
// this cap makes it WORSE, not better (32 @16000 aborts outright, where 32
// @4000 at least returns a clean max_tokens stop). The burn is also
// INVISIBLE — at 32 commitments ~89% of the budget goes to tokens that never
// appear in any stream channel (no text block, no thinking block, just
// {tool_use: 1}), always dying ~1,380 chars into the commitments array — so a
// smaller per-subfield grounded schema was measured NOT to fix this; do not
// "lighten the grounding" to address a truncation, that costs provenance and
// buys nothing. The real fix is chunking (this file): each call stays well
// inside the proven-good regime instead of trying to shrink the schema.
const MAX_OUTPUT_TOKENS = 16000;

// Use an http/1.1 handler with a long request timeout. A large extraction (many
// pages + a big grounded tool response) is a slow non-streaming generation; the
// default http2 handler drops it with "http2 request did not get a response".
const client = new BedrockRuntimeClient({
  region,
  requestHandler: new NodeHttpHandler({ requestTimeout: 300_000, connectionTimeout: 10_000 }),
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Max times a chunk may be recursively halved (either on max_tokens truncation
// or as the last resort after transient-error retries are exhausted). Bounds
// the recursion so a pathological chunk fails loudly instead of splitting
// forever; splitInHalf itself already returns null (→ throw, see below) once a
// chunk has no internal paragraph boundary left to split at.
const MAX_SPLIT_DEPTH = 3;

// Result of one forced-tool-use call: the reassembled tool input JSON plus the
// stream's stop_reason. Parsing is left to the caller — the header and
// commitments calls parse into different shapes.
interface ToolCallResult {
  json: string;
  stopReason: string;
}

// Build body → stream → reassemble the forced tool_use input. Shared by the
// header call (whole document) and every per-chunk commitments call — the
// only things that differ between call sites are the tool, its name, the
// user text, and (for retries) the max_tokens budget.
//
// system prompt: EXTRACTION_SYSTEM's rules are engine-shared, but its last
// line names EXTRACTION_TOOL_NAME ("record_rap_extraction") — the old
// single-call tool. That is wrong for both HEADER_TOOL and COMMITMENTS_TOOL,
// each of which is FORCED via tool_choice and must be told its own name, or
// the instruction contradicts what Claude is actually being forced to call.
// Swapping the one place that name appears (rather than duplicating the whole
// rule set here) keeps EXTRACTION_SYSTEM's exported value untouched — Task 2's
// schema module, scripts/diag-truncation.ts, and anything else importing
// EXTRACTION_SYSTEM/CLAUDE_TOOL/EXTRACTION_TOOL_NAME directly keep working.
async function callTool(tool: object, toolName: string, userText: string, maxTokens: number): Promise<ToolCallResult> {
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: maxTokens,
    system: EXTRACTION_SYSTEM.replace(EXTRACTION_TOOL_NAME, toolName),
    tools: [tool],
    tool_choice: { type: "tool", name: toolName }, // force the schema
    messages: [{ role: "user", content: userText }],
  };

  // STREAM the response. A big grounded extraction is a long generation, and a
  // non-streaming InvokeModel gets its socket closed mid-generation ("socket hang
  // up"). Streaming keeps the connection alive and delivers the forced tool_use
  // input as incremental input_json_delta chunks, which we reassemble + parse.
  // NOTE: this call (and the async iteration below) is exactly where the
  // observed "aborted" transient stream error surfaces — a real failure at
  // ~61s/0 output tokens on a 5,794-char chunk, not theoretical. It propagates
  // as a thrown error here, distinct from a normal completion whose
  // stop_reason is "max_tokens" — callers must handle those two cases
  // differently (retry vs split).
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
  // Only throw on empty JSON when it's NOT a max_tokens truncation. A
  // truncation that emitted zero visible input_json_delta bytes before dying
  // (the invisible-burn failure mode — see the MAX_OUTPUT_TOKENS comment
  // above) must be handed back to the caller as {json: "", stopReason:
  // "max_tokens"} so it can split immediately, not thrown here — a throw
  // would make callToolWithRetry treat it as transient and re-run the
  // identical (doomed) generation three times before the caller ever gets a
  // chance to split.
  if (!toolJson && stopReason !== "max_tokens") {
    throw new Error(`Bedrock stream contained no ${toolName} tool input`);
  }
  return { json: toolJson, stopReason };
}

// Retry a TRANSIENT stream error (the observed "aborted") with backoff (1s, 4s),
// then give up and rethrow. Only wraps callTool: a normal completion whose
// stop_reason is "max_tokens" is NOT a transient error and must not be retried
// here — a smaller generation, not a repeat of the same one, is what's measured
// to help. Every Bedrock call goes through this, including the header call: it
// reads the whole document (the largest single input we send) and the abort was
// observed live at 61s on a chunk a quarter that size.
async function callToolWithRetry(
  tool: object,
  toolName: string,
  userText: string,
  maxTokens: number,
): Promise<ToolCallResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await callTool(tool, toolName, userText, maxTokens);
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(attempt === 0 ? 1000 : 4000);
    }
  }
  throw lastErr;
}

function parseToolJson<T>(json: string, toolName: string): T {
  try {
    return JSON.parse(json) as T;
  } catch (e) {
    const m = /position (\d+)/.exec(String(e));
    const p = m ? parseInt(m[1], 10) : 0;
    throw new Error(
      `${toolName} tool JSON parse failed (len ${json.length}) near: …${json.slice(Math.max(0, p - 60), p + 60)}…`,
    );
  }
}

function chunkUserText(chunk: DocChunk, fileName: string): string {
  return `Extract the commitments from this chunk of a RAP document.\n\n<document-chunk filename="${fileName}" chunkIndex="${chunk.index}">\n${chunk.text}\n</document-chunk>`;
}

// Extract commitments for one chunk, with the two independent failure paths
// required above:
//   - stop_reason "max_tokens" (truncation): split immediately, no retry
//     (a smaller generation, not a repeat of the same generation, is what's
//     measured to help).
//   - a thrown transient stream error (e.g. "aborted"): retry the SAME chunk
//     up to 2 times with backoff (1s, 4s) first — that failure mode is not
//     about size — and only split once retries are exhausted.
// Both paths funnel into the same bounded recursive split; splitInHalf
// returning null, or MAX_SPLIT_DEPTH being reached, is a hard throw — never a
// silent partial result. F4: splitInHalf's two returned halves both carry the
// PARENT chunk's `index` (by design — see chunk.ts), so halves must never be
// keyed/deduped by index. This function never does that: results are
// concatenated by recursive call/return order (resultA then resultB), i.e.
// append order, never a Map/index lookup.
async function extractChunkCommitments(
  chunk: DocChunk,
  fileName: string,
  depth: number,
): Promise<ExtractedCommitment[]> {
  const splitAndRecurse = async (reason: string): Promise<ExtractedCommitment[]> => {
    if (depth >= MAX_SPLIT_DEPTH) {
      throw new Error(`chunk ${chunk.index} still failing (${reason}) after ${MAX_SPLIT_DEPTH} recursive splits — refusing to return partial results`);
    }
    const halves = splitInHalf(chunk);
    if (!halves) {
      throw new Error(`chunk ${chunk.index} cannot be split further (${reason}) — no internal paragraph boundary; refusing to return partial results`);
    }
    const [first, second] = halves;
    // Sequential, not Promise.all — concurrency is deliberately out of scope
    // (see runExtractionBedrock). Order preserved by await order, not index.
    const a = await extractChunkCommitments(first, fileName, depth + 1);
    const b = await extractChunkCommitments(second, fileName, depth + 1);
    return [...a, ...b];
  };

  // ONLY the Bedrock call goes inside the try. The try turns an exhausted
  // transient retry into a split; it must not wrap splitAndRecurse or
  // parseToolJson, whose throws are deliberate loud failures. Wrapping those
  // would catch a "refusing to return partial results" throw, retry the chunk
  // against live Bedrock, and rethrow it mislabelled as a transient error.
  let call: ToolCallResult;
  try {
    call = await callToolWithRetry(
      COMMITMENTS_TOOL,
      COMMITMENTS_TOOL_NAME,
      chunkUserText(chunk, fileName),
      MAX_OUTPUT_TOKENS,
    );
  } catch (e) {
    // transient retries exhausted: a smaller generation is the one thing measured to help
    return await splitAndRecurse(`transient stream error after retries: ${String(e)}`);
  }
  if (call.stopReason === "max_tokens") {
    return await splitAndRecurse("max_tokens truncation");
  }
  return parseToolJson<{ commitments: ExtractedCommitment[] }>(call.json, COMMITMENTS_TOOL_NAME).commitments ?? [];
}

// Merge the header call's fields with every chunk's commitments, concatenated
// IN CHUNK ORDER. Pure — no AWS, no I/O — so it's testable without a live
// Bedrock call (see scripts/test-rap-merge.ts). No dedupe: Task 1's chunker
// guarantees chunks never overlap, so there is nothing to dedupe and no
// identity key a commitment could be deduped by anyway.
// Generic over the commitment shape (rather than fixed to ExtractedCommitment)
// so scripts/test-rap-merge.ts can exercise ordering/merge behaviour with
// minimal fixtures ({action, deliverable} only) without needing to fabricate
// every ExtractedCommitment subfield. The real call site (runExtractionBedrock
// below) always passes full ExtractedCommitment[][], so C is inferred as
// ExtractedCommitment there and the result is a true ExtractedRap.
export function mergeExtraction<C>(
  header: Omit<ExtractedRap, "commitments" | "pillars" | "sectorFields">,
  commitmentGroups: C[][],
): Omit<ExtractedRap, "commitments" | "pillars" | "sectorFields"> & { commitments: C[] } {
  return {
    ...header,
    commitments: commitmentGroups.flat(),
  };
}

export async function runExtractionBedrock(input: { fileName: string; sourceS3Key: string }): Promise<ExtractionResult> {
  const loader = selectLoader();
  const loaded = await loader.load({ sourceS3Key: input.sourceS3Key, fileName: input.fileName });
  const documentText = loaded.text;
  const chunks = chunkDocument(documentText);
  // No extractable text (an image-only scan whose LAYOUT blocks are all noise
  // types, or a document that OCR'd to nothing) means chunkDocument("")
  // returns []. Without this guard the per-chunk loop below would simply
  // never run and this function would return a complete-looking
  // ExtractionResult with commitments: [] — exactly the "silently dropped
  // commitments" failure the whole pipeline exists to prevent. Fail loudly
  // instead.
  if (documentText.trim() === "" || chunks.length === 0) {
    throw new Error(
      `No extractable text found in "${input.fileName}" — the ${loader.name} loader returned no usable paragraphs, ` +
        "so there is nothing to extract commitments from.",
    );
  }

  // Header call runs over the WHOLE document text, not just the first chunk.
  // AMENDED 2026-07-16 (supersedes an earlier "first chunk only" plan): on the
  // real test RAP, reviewCycle and governanceBody both live on p16 — the LAST
  // chunk — so first-chunk-only would silently null both. The measured
  // failure mode is OUTPUT-token burn (~410 tok/commitment); a header-only
  // call emits ~13 fields regardless of input size, so reading the whole
  // document here is safe. If the header call truncates anyway, that's a hard
  // failure — headers were measured to fit comfortably in one call.
  const headerUserText = `Extract the RAP header fields (everything except individual commitments) from this document.\n\n<document filename="${input.fileName}">\n${documentText}\n</document>`;
  // Retried like every other call: reading the whole document makes this the
  // largest single input we send, and the transient abort was observed live on a
  // chunk a quarter its size. A transient stream error here is not a truncation
  // and must not fail the whole extraction on the first blip. (It cannot fall
  // back to splitting the way a chunk does — there is only one header call — so
  // an exhausted retry throws.)
  const { json: headerJson, stopReason: headerStopReason } = await callToolWithRetry(
    HEADER_TOOL,
    HEADER_TOOL_NAME,
    headerUserText,
    MAX_OUTPUT_TOKENS,
  );
  if (headerStopReason === "max_tokens") {
    throw new Error(
      "Header call truncated at max_tokens — header fields were measured to fit comfortably in a single call; this is unexpected and a hard failure, not a split-and-retry case.",
    );
  }
  const header = parseToolJson<Omit<ExtractedRap, "commitments" | "pillars" | "sectorFields">>(headerJson, HEADER_TOOL_NAME);

  // Commitment calls run SEQUENTIALLY, one per chunk — never in parallel. The
  // abort failure mode observed against live Bedrock is not understood well
  // enough to reason about what concurrency would do to it; a bounded pool is
  // a later optimisation, not this task's.
  const commitmentGroups: ExtractedCommitment[][] = [];
  for (const chunk of chunks) {
    commitmentGroups.push(await extractChunkCommitments(chunk, input.fileName, 0));
  }

  // pillars is DERIVED from the commitments, never extracted — HEADER_TOOL does
  // not carry it (see classify.ts derivePillars). The commitments are the single
  // source of truth; this is a projection of their already-grounded pillars.
  const merged: ExtractedRap = {
    ...mergeExtraction(header, commitmentGroups),
    pillars: derivePillars(commitmentGroups.flat()),
    // Neither HEADER_TOOL nor CLAUDE_TOOL asks for sectorFields, so the model
    // never returns it — and parseToolJson CASTS, so the type claimed a
    // SectorFields that was `undefined` at runtime on every extraction. Every
    // key on SectorFields is optional, so {} is the honest empty value; this
    // mirrors pipeline.bda.ts, which sets {} for the same reason. Populate it
    // for real only when the schema actually asks for per-sector fields.
    sectorFields: {},
  };

  // deterministic gate: Claude returns verbatim quotes → require them
  // deterministic gate: Claude returns verbatim quotes → require them, AND check
  // each one actually occurs in what the model was shown. sourceText is the
  // LAYOUT-built documentText (with its "[p.N]" markers), never the raw PDF —
  // chunks are non-overlapping slices of exactly this text, so any chunk's quote
  // is a substring of it, and no per-chunk plumbing is needed.
  const { extracted, issues } = validateAndFlag(merged, { requireQuote: true, sourceText: documentText });

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
