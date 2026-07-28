import {
  type Block,
  GetDocumentAnalysisCommand,
  StartDocumentAnalysisCommand,
  TextractClient,
} from "@aws-sdk/client-textract";
import { DEFAULT_TARGET_CHARS } from "../chunk";
import { getDocumentBytes } from "../storage";
import { type DocLoader, type LoadResult, pageMarker, UnsupportedDocumentError } from "./types";

const region = process.env.BEDROCK_REGION ?? "ca-central-1";
const uploadBucket = process.env.RAP_UPLOAD_BUCKET;
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
export function splitOversizedBlockText(text: string, target: number): string[] {
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
    // Split against the target MINUS the marker about to be prepended —
    // splitting against the full target then prepending yields a block over
    // the target, which chunkDocument's splitLargeParagraph re-splits while
    // keeping the marker only on the first piece. See buildTextFromPages in
    // textlayer.ts for the same subtraction.
    const marker = pageMarker(page ?? "?");
    for (const piece of splitOversizedBlockText(t, DEFAULT_TARGET_CHARS - marker.length)) {
      paragraphs.push(`${marker}${piece}`);
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
async function loadViaTextract(sourceS3Key: string, fileName: string): Promise<string> {
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
  // Anything that is neither a PDF nor the .txt diagnostic path is refused by
  // FILE TYPE, with the same error the textlayer loader raises — both loaders
  // sit behind the same DocLoader interface and a caller must not have to know
  // which one it got in order to know what an unsupported file looks like.
  // (Before this, an unknown extension fell straight through to the Textract
  // API and surfaced as whatever AWS chose to say about it.)
  if (!/\.pdf$/i.test(fileName)) throw new UnsupportedDocumentError(fileName);
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

export const textractLoader: DocLoader = {
  name: "textract",
  async load({ sourceS3Key, fileName }): Promise<LoadResult> {
    const text = await loadViaTextract(sourceS3Key, fileName);
    // Textract's blocks carry a Page number but this loader never reconstructs
    // per-page paragraph arrays, so it has no per-page coverage view to report.
    return { text, fidelityDamaged: false, damagedOffsets: [], lowPageCoverage: null };
  },
};
