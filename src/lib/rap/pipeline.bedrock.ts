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
import {
  type Block,
  GetDocumentAnalysisCommand,
  StartDocumentAnalysisCommand,
  TextractClient,
} from "@aws-sdk/client-textract";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { resolveBedrockModelId } from "./bedrock-model";
import { DEFAULT_TARGET_CHARS, type DocChunk, chunkDocument, splitInHalf } from "./chunk";
import {
  COMMITMENTS_TOOL,
  COMMITMENTS_TOOL_NAME,
  EXTRACTION_SYSTEM,
  EXTRACTION_TOOL_NAME,
  HEADER_TOOL,
  HEADER_TOOL_NAME,
} from "./extraction-schema";
import { getDocumentBytes } from "./storage";
import { validateAndFlag } from "./validate";
import type { ExtractedCommitment, ExtractedRap, ExtractionResult, RapClassification } from "./types";

const region = process.env.BEDROCK_REGION ?? "ca-central-1";
// Must be an INFERENCE PROFILE, not a bare model id — Bedrock rejects bare ids
// for on-demand invoke, which made every Option B call fail. resolveBedrockModelId
// enforces that and explains the fix. (There is no "ca." geo prefix; ca-central-1
// reaches Claude via the "us." profile — see src/lib/rap/bedrock-model.ts.)
const modelId = resolveBedrockModelId(process.env);
const uploadBucket = process.env.RAP_UPLOAD_BUCKET;
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
//
// Oversized blocks (load-bearing): a single LAYOUT_ block's text can exceed
// chunkDocument's targetChars — LAYOUT_TABLE widening in particular means a
// tabled commitments section can produce one huge block. chunk.ts's own
// splitLargeParagraph would later cut that into multiple pieces, but it only
// keeps the FIRST piece's leading "[p.N]" line — every later piece would land
// in the document with no marker at all, and once a chunk boundary falls
// between pieces the model attributes the marker-less piece to whatever page
// happens to precede it: in-range, non-null, and wrong. So we pre-split here,
// at the source, into multiple paragraphs that EACH carry their own "[p.N]"
// marker — chunk.ts stays pure and marker-agnostic, and no marker-less piece
// can ever exist downstream.
function splitOversizedBlockText(text: string, target: number): string[] {
  if (text.length <= target) return [text];
  const sentences = text.split(/(?<=\.)(?:\s+|\n)/);
  const parts: string[] = [];
  let current = "";
  for (const s of sentences) {
    const candidate = current ? `${current} ${s}` : s;
    if (candidate.length > target) {
      if (current) {
        parts.push(current);
        current = s;
      } else {
        // a single sentence already over target: keep it whole
        current = s;
      }
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts.filter(Boolean);
}

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
    if (!t) return;
    for (const piece of splitOversizedBlockText(t, DEFAULT_TARGET_CHARS)) {
      paragraphs.push(`[p.${page ?? "?"}]\n${piece}`);
    }
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

    // Emit every remaining LAYOUT_* type, not an allowlist of the three seen in
    // the test fixture. Textract also emits LAYOUT_TABLE / LAYOUT_KEY_VALUE, and
    // RAPs commonly table their commitments — an allowlist would drop those
    // silently, violating "no commitment may be silently dropped". Unknown
    // future types get emitted rather than lost; noise is denied above.
    if (b.BlockType.startsWith("LAYOUT_")) {
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
    // .txt bypasses Textract entirely: no LAYOUT paragraphs, no "[p.N]"
    // markers, so every page number the model reports is a guess, not
    // grounding (measured: 1/10 correct — see docs/rap-extraction-findings.md
    // §4a). src/app/api/rap/upload-url/route.ts imposes no extension
    // restriction, so this path is reachable in production; refuse it by
    // default. ALLOW_UNGROUNDED_TXT=1 is a diagnostic escape hatch only (used
    // to produce the synthetic-.txt measurements in §4) — it must never be set
    // in prod.
    if (process.env.ALLOW_UNGROUNDED_TXT !== "1") {
      throw new Error(
        `Refusing to extract from "${fileName}": .txt bypasses Textract and cannot carry page grounding. ` +
          "Convert to PDF/image for a Textract-grounded extraction, or set ALLOW_UNGROUNDED_TXT=1 to force it " +
          "for diagnostic work (pages will be model-guessed and ungrounded).",
      );
    }
    console.warn(
      `ALLOW_UNGROUNDED_TXT=1: extracting "${fileName}" as plain text, bypassing Textract. ` +
        "Page numbers will be MODEL-GUESSED, not grounded — do not use this output for anything but diagnostics.",
    );
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
  header: Omit<ExtractedRap, "commitments">,
  commitmentGroups: C[][],
): Omit<ExtractedRap, "commitments"> & { commitments: C[] } {
  return {
    ...header,
    commitments: commitmentGroups.flat(),
  };
}

export async function runExtractionBedrock(input: { fileName: string; sourceS3Key: string }): Promise<ExtractionResult> {
  const documentText = await loadDocumentText(input.sourceS3Key, input.fileName);
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
      `No extractable text found in "${input.fileName}" — is this an image-only scan with no OCR-able text? ` +
        "Textract LAYOUT returned no usable paragraphs, so there is nothing to extract commitments from.",
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
  const header = parseToolJson<Omit<ExtractedRap, "commitments">>(headerJson, HEADER_TOOL_NAME);

  // Commitment calls run SEQUENTIALLY, one per chunk — never in parallel. The
  // abort failure mode observed against live Bedrock is not understood well
  // enough to reason about what concurrency would do to it; a bounded pool is
  // a later optimisation, not this task's.
  const commitmentGroups: ExtractedCommitment[][] = [];
  for (const chunk of chunks) {
    commitmentGroups.push(await extractChunkCommitments(chunk, input.fileName, 0));
  }

  const merged = mergeExtraction(header, commitmentGroups);

  // deterministic gate: Claude returns verbatim quotes → require them
  const { extracted, issues } = validateAndFlag(merged, { requireQuote: true });

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
