# Textract-Free In-Country Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `ca` stage a real, page-grounded extraction path that never calls Textract, by making document loading a pluggable strategy inside the existing Claude-on-Bedrock engine.

**Architecture:** Extract the document-loading step of `pipeline.bedrock.ts` into `src/lib/rap/doc-loader/` behind a `DocLoader` interface with two implementations — `textract` (the existing LAYOUT path, moved verbatim) and `textlayer` (new, `pdf-parse` based). Selection is by explicit `DOC_LOADER` env var with no silent fallback. Both loaders emit the identical `[p.N]`-marked paragraph format the rest of the pipeline already consumes, so nothing downstream changes.

**Tech Stack:** TypeScript, Node 24, `pdf-parse` (already a dependency), `pdf-lib` (already a dependency, used to synthesise test PDFs), AWS SDK v3 Textract client, SST v3.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-27-textract-free-extraction-design.md`. Context: `docs/ca-extraction-textract-scp.md`.
- Loader output contract is **exactly** `[p.N]\n<paragraph>`, paragraphs separated by a blank line. Both loaders must produce this. Do not change `chunkDocument` or any prompt.
- **No silent fallback.** An unrecognised `DOC_LOADER` throws. Never catch an AccessDenied from one loader and switch to another.
- `EXTRACTION_IMPL=bedrock` is not renamed.
- Tests follow the existing convention: standalone `scripts/test-*.ts`, run with `npx tsx scripts/test-<name>.ts`, using a local `check(name, ok)` helper that prints ✅/❌ and tracks a failure count, exiting non-zero on failure. See `scripts/test-layout-text.ts` for the canonical shape. There is no aggregate test runner.
- Test fixtures are **synthesised at test time with `pdf-lib`**. Do not commit binary PDFs. Do not make a committed test depend on any untracked dump.
- Typecheck with `npx tsc --noEmit` before every commit. It must exit 0.
- Every `sst deploy --stage ca` must re-export `DIGEST_SENDER=su.en@northeastern.edu DIGEST_RECIPIENT=enpingsu555@gmail.com`, or the notification email silently reverts to `skipped`.

---

### Task 1: Extract the document-loader seam (behaviour-neutral)

Move the existing Textract loading code into a new module behind an interface, and wire `DOC_LOADER`. After this task every stage behaves exactly as before, because the default is `textract`.

**Files:**
- Create: `src/lib/rap/doc-loader/types.ts`
- Create: `src/lib/rap/doc-loader/textract.ts`
- Create: `src/lib/rap/doc-loader/index.ts`
- Modify: `src/lib/rap/pipeline.bedrock.ts` (remove lines 14-19, 65, 68-262; rewrite call site at 459)
- Modify: `sst.config.ts` (`extractionEnv`, after `BEDROCK_MODEL_ID`)
- Test: `scripts/test-doc-loader-select.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `interface LoadResult { text: string; fidelityDamaged: boolean; damagedOffsets: number[] }`
  - `interface DocLoader { readonly name: LoaderName; load(input: { sourceS3Key: string; fileName: string }): Promise<LoadResult> }`
  - `type LoaderName = "textract" | "textlayer"`
  - `function selectLoader(env: NodeJS.ProcessEnv): DocLoader`
  - `class ScannedDocumentError extends Error`
  - `class UnsupportedDocumentError extends Error`
  - `function buildTextFromLayoutBlocks(blocks: Block[]): string` — re-exported from `pipeline.bedrock.ts` for back-compat
  - `function splitOversizedBlockText(text: string, target: number): string[]` — exported from `doc-loader/textract.ts`, reused by Task 2

- [ ] **Step 1: Write the failing test**

Create `scripts/test-doc-loader-select.ts`:

```ts
// selectLoader is the seam that decides how a document becomes text. It must
// be EXPLICIT: an unknown DOC_LOADER is a deploy misconfiguration and has to
// fail loudly, never fall through to a default. See the spec's "Explicit
// selection, never silent fallback".
// Run: npx tsx scripts/test-doc-loader-select.ts
import { selectLoader } from "../src/lib/rap/doc-loader";

let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
}

check("DOC_LOADER=textract selects the textract loader", selectLoader({ DOC_LOADER: "textract" } as NodeJS.ProcessEnv).name === "textract");
check("DOC_LOADER=textlayer selects the textlayer loader", selectLoader({ DOC_LOADER: "textlayer" } as NodeJS.ProcessEnv).name === "textlayer");

let threw = false;
try {
  selectLoader({ DOC_LOADER: "layout" } as NodeJS.ProcessEnv);
} catch (e) {
  threw = e instanceof Error && e.message.includes("DOC_LOADER");
}
check("unknown DOC_LOADER throws (no silent fallback)", threw);

let threwUnset = false;
try {
  selectLoader({} as NodeJS.ProcessEnv);
} catch {
  threwUnset = true;
}
check("unset DOC_LOADER throws rather than defaulting", threwUnset);

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-doc-loader-select.ts`
Expected: FAIL — `Cannot find module '../src/lib/rap/doc-loader'`

- [ ] **Step 3: Create the types module**

Create `src/lib/rap/doc-loader/types.ts`:

```ts
// The document-loading seam. Everything upstream of chunkDocument that turns a
// stored file into "[p.N]"-marked paragraph text lives behind this interface.
// Two implementations exist because Textract is unavailable to this account's
// service roles (docs/ca-extraction-textract-scp.md) — NOT because we want a
// runtime fallback. Selection is explicit; see index.ts.

export type LoaderName = "textract" | "textlayer";

export interface LoadResult {
  /** "[p.N]\n<paragraph>" blocks, separated by a blank line. */
  text: string;
  /** True when the decoded text contained unmappable glyphs (see the fidelity gate). */
  fidelityDamaged: boolean;
  /** Character offsets into `text` where damage was found. Reviewer context only. */
  damagedOffsets: number[];
}

export interface DocLoader {
  readonly name: LoaderName;
  load(input: { sourceS3Key: string; fileName: string }): Promise<LoadResult>;
}

/** The document carries no extractable text layer — almost always an image-only scan. */
export class ScannedDocumentError extends Error {
  constructor(fileName: string) {
    super(
      `No extractable text layer in "${fileName}" — this document appears to be scanned. ` +
        "In-region extraction requires a text-based PDF.",
    );
    this.name = "ScannedDocumentError";
  }
}

/** The file type is not one this loader can read. */
export class UnsupportedDocumentError extends Error {
  constructor(fileName: string) {
    super(`Cannot extract from "${fileName}" — expected a PDF (or .txt for diagnostics).`);
    this.name = "UnsupportedDocumentError";
  }
}
```

- [ ] **Step 4: Move the Textract loader**

Create `src/lib/rap/doc-loader/textract.ts`. Move these from `pipeline.bedrock.ts` **verbatim, without editing their bodies or comments**: the `@aws-sdk/client-textract` imports (lines 14-19), `const textract` (line 65), `NOISE_LAYOUT_TYPES` (75), `childLineText` (78), `splitOversizedBlockText` (125), `buildTextFromLayoutBlocks` (148), and the body of `loadDocumentText` (203-262).

Export `splitOversizedBlockText` (Task 2 reuses it) and keep `buildTextFromLayoutBlocks` exported. Wrap the loading body in the interface:

```ts
import {
  type Block,
  GetDocumentAnalysisCommand,
  StartDocumentAnalysisCommand,
  TextractClient,
} from "@aws-sdk/client-textract";
import { DEFAULT_TARGET_CHARS } from "../chunk";
import { getDocumentBytes } from "../storage";
import { type DocLoader, type LoadResult, UnsupportedDocumentError } from "./types";

const region = process.env.BEDROCK_REGION ?? "ca-central-1";
const uploadBucket = process.env.RAP_UPLOAD_BUCKET;
const textract = new TextractClient({ region });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- MOVED VERBATIM from pipeline.bedrock.ts: NOISE_LAYOUT_TYPES,
// ---- childLineText, splitOversizedBlockText, buildTextFromLayoutBlocks.
// ---- Export splitOversizedBlockText and buildTextFromLayoutBlocks.

export const textractLoader: DocLoader = {
  name: "textract",
  async load({ sourceS3Key, fileName }): Promise<LoadResult> {
    // body moved verbatim from the old loadDocumentText (the .txt branch,
    // the StartDocumentAnalysis call, the poll loop, the NextToken pagination)
    // ending in `buildTextFromLayoutBlocks(blocks)`.
    const text = await loadViaTextract(sourceS3Key, fileName);
    return { text, fidelityDamaged: false, damagedOffsets: [] };
  },
};
```

The Textract path reports `fidelityDamaged: false` — OCR produces its own characters and cannot inherit a broken font-to-Unicode map.

- [ ] **Step 5: Create the selector**

Create `src/lib/rap/doc-loader/index.ts`:

```ts
import { textractLoader } from "./textract";
import { textlayerLoader } from "./textlayer";
import type { DocLoader } from "./types";

export * from "./types";
export { buildTextFromLayoutBlocks, splitOversizedBlockText } from "./textract";

// Explicit selection only. An unset or unrecognised DOC_LOADER is a deploy
// misconfiguration, and this project has been bitten twice by quiet defaults
// (empty DIGEST_* degrading email to "skipped"; pipeline.ts's bare
// runExtractionMock fallthrough serving fake extractions). Fail loudly here.
export function selectLoader(env: NodeJS.ProcessEnv = process.env): DocLoader {
  switch (env.DOC_LOADER) {
    case "textract":
      return textractLoader;
    case "textlayer":
      return textlayerLoader;
    default:
      throw new Error(
        `DOC_LOADER must be "textract" or "textlayer" (got ${JSON.stringify(env.DOC_LOADER)}). ` +
          "Set it explicitly in the deploy environment — there is no default.",
      );
  }
}
```

Create a placeholder `src/lib/rap/doc-loader/textlayer.ts` so this compiles; Task 2 fills it in:

```ts
import { type DocLoader, type LoadResult, UnsupportedDocumentError } from "./types";

export const textlayerLoader: DocLoader = {
  name: "textlayer",
  async load(): Promise<LoadResult> {
    throw new Error("textlayer loader not implemented yet (see Task 2)");
  },
};
```

- [ ] **Step 6: Rewrite the call site in `pipeline.bedrock.ts`**

Delete the moved code. Replace the `loadDocumentText` call at line 459:

```ts
const loader = selectLoader();
const loaded = await loader.load({ sourceS3Key: input.sourceS3Key, fileName: input.fileName });
const documentText = loaded.text;
```

Add `import { selectLoader } from "./doc-loader";`. Keep `import { DEFAULT_TARGET_CHARS, type DocChunk, chunkDocument, splitInHalf } from "./chunk";`.

Preserve back-compat for `scripts/test-layout-text.ts`, which imports `buildTextFromLayoutBlocks` from `pipeline.bedrock`:

```ts
// Moved to ./doc-loader/textract. Re-exported so the existing offline test
// (scripts/test-layout-text.ts) keeps its import path.
export { buildTextFromLayoutBlocks } from "./doc-loader";
```

Update the generic empty-text guard's message at line 468-472, which currently names Textract, so it is loader-neutral:

```ts
if (documentText.trim() === "" || chunks.length === 0) {
  throw new Error(
    `No extractable text found in "${input.fileName}" — the ${loader.name} loader returned no usable paragraphs, ` +
      "so there is nothing to extract commitments from.",
  );
}
```

- [ ] **Step 7: Wire `DOC_LOADER` into deploys**

In `sst.config.ts`, inside `extractionEnv`, immediately after the `BEDROCK_MODEL_ID` line:

```ts
      // "textract" | "textlayer" — how a document becomes text. Explicit; the
      // loader throws on anything else. Defaults to textract so this refactor
      // is behaviour-neutral; ca flips to textlayer in Task 5 after measurement.
      DOC_LOADER: process.env.DOC_LOADER ?? "textract",
```

- [ ] **Step 8: Run the tests and typecheck**

Run: `npx tsx scripts/test-doc-loader-select.ts`
Expected: PASS, 4 checks

Run: `npx tsx scripts/test-layout-text.ts`
Expected: PASS — unchanged, proving the move was verbatim

Run: `npx tsc --noEmit`
Expected: exit 0, no output

- [ ] **Step 9: Commit**

```bash
git add src/lib/rap/doc-loader src/lib/rap/pipeline.bedrock.ts sst.config.ts scripts/test-doc-loader-select.ts
git commit -m "refactor(rap): extract document loading behind a DocLoader seam

Moves the Textract LAYOUT path verbatim into src/lib/rap/doc-loader/textract.ts
behind a DocLoader interface, selected by an explicit DOC_LOADER env var that
throws on anything unrecognised. Behaviour-neutral: the default is textract, so
every stage loads documents exactly as before.

This is the seam a Textract-free loader plugs into
(docs/superpowers/specs/2026-07-27-textract-free-extraction-design.md). Keeping
both implementations live means restoring Textract is a config flip once the org
SCP is lifted, and the two can be compared on the same document.

buildTextFromLayoutBlocks is re-exported from pipeline.bedrock so the existing
offline test keeps its import path unchanged."
```

---

### Task 2: Text-layer loader — pages and paragraphs

The substance of the plan. Produce `[p.N]`-marked paragraph text from a PDF's embedded text layer, with paragraph boundaries reconstructed from glyph geometry.

**Files:**
- Modify: `src/lib/cases/ingest/pdf-parse.d.ts`
- Modify: `src/lib/rap/doc-loader/textlayer.ts` (replace the Task 1 placeholder)
- Test: `scripts/test-doc-loader-textlayer.ts`

**Interfaces:**
- Consumes: `DocLoader`, `LoadResult`, `UnsupportedDocumentError` from `./types`; `splitOversizedBlockText` from `./textract`; `getDocumentBytes` from `../storage`; `DEFAULT_TARGET_CHARS` from `../chunk`.
- Produces:
  - `function buildTextFromPages(pages: string[][]): string` — exported for tests; takes per-page arrays of paragraph strings, returns the `[p.N]` format
  - `function groupItemsIntoParagraphs(items: TextItem[]): string[]` — exported for tests
  - `interface TextItem { str: string; transform: number[] }`
  - `const textlayerLoader: DocLoader`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-doc-loader-textlayer.ts`:

```ts
// The text-layer loader replaces Textract OCR with the PDF's own embedded text.
// Its two load-bearing behaviours are (a) attaching the correct "[p.N]" marker
// to each paragraph — page grounding is the whole reason this pipeline beats a
// plain summariser — and (b) recovering paragraph boundaries from glyph
// geometry, because a flat line join makes chunkDocument split on the size
// budget and cut through commitments.
// Fixtures are synthesised with pdf-lib so no binary blobs are committed.
// Run: npx tsx scripts/test-doc-loader-textlayer.ts
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildTextFromPages, groupItemsIntoParagraphs } from "../src/lib/rap/doc-loader/textlayer";

let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
}

// --- buildTextFromPages: the "[p.N]" contract -------------------------------
const text = buildTextFromPages([["Alpha para"], ["Beta para", "Gamma para"]]);
check("page 1 paragraph carries [p.1]", text.includes("[p.1]\nAlpha para"));
check("page 2 paragraphs carry [p.2]", text.includes("[p.2]\nBeta para") && text.includes("[p.2]\nGamma para"));
check("paragraphs are blank-line separated", text.split("\n\n").length === 3, JSON.stringify(text));
check("page order preserved", text.indexOf("Alpha") < text.indexOf("Beta"));
check("empty paragraphs dropped", !buildTextFromPages([["", "   "], ["Real"]]).includes("[p.1]"));

// --- groupItemsIntoParagraphs: geometry -------------------------------------
// transform is a 6-element matrix; [4] is x, [5] is y. Larger y = higher on page.
const item = (str: string, y: number, x = 50) => ({ str, transform: [1, 0, 0, 1, x, y] });

// Three lines 12pt apart, then a 40pt gap, then two more: two paragraphs.
const paras = groupItemsIntoParagraphs([
  item("Line one", 700), item("Line two", 688), item("Line three", 676),
  item("Second para", 636), item("still second", 624),
]);
check("large vertical gap starts a new paragraph", paras.length === 2, `got ${paras.length}`);
check("first paragraph joins its lines", paras[0] === "Line one\nLine two\nLine three", JSON.stringify(paras[0]));
check("second paragraph joins its lines", paras[1] === "Second para\nstill second", JSON.stringify(paras[1]));

// Items sharing a y are one line, joined left-to-right by x.
const oneLine = groupItemsIntoParagraphs([item("world", 700, 90), item("Hello", 700, 50)]);
check("same-y items form one line ordered by x", oneLine[0] === "Hello world", JSON.stringify(oneLine[0]));

// Uniform spacing = a single paragraph.
const uniform = groupItemsIntoParagraphs([item("a", 700), item("b", 688), item("c", 676), item("d", 664)]);
check("uniform line spacing stays one paragraph", uniform.length === 1, `got ${uniform.length}`);

check("no items yields no paragraphs", groupItemsIntoParagraphs([]).length === 0);

// --- end-to-end over a synthesised PDF --------------------------------------
async function makePdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    let y = 700;
    for (const line of lines) {
      if (line === "") { y -= 40; continue; } // blank marker = paragraph gap
      page.drawText(line, { x: 50, y, size: 12, font });
      y -= 14;
    }
  }
  return doc.save();
}

const { extractPagesFromPdf } = await import("../src/lib/rap/doc-loader/textlayer");
const pdf = await makePdf([["Page one para"], ["Page two first", "", "Page two second"]]);
const extracted = await extractPagesFromPdf(Buffer.from(pdf));
check("extracts one entry per page", extracted.length === 2, `got ${extracted.length}`);
check("page 1 text recovered", extracted[0].join(" ").includes("Page one para"));
check("page 2 split into two paragraphs", extracted[1].length === 2, `got ${extracted[1].length}`);

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-doc-loader-textlayer.ts`
Expected: FAIL — `buildTextFromPages` / `groupItemsIntoParagraphs` are not exported

- [ ] **Step 3: Extend the `pdf-parse` type declaration**

In `src/lib/cases/ingest/pdf-parse.d.ts`, add the options overload. **Additive only** — the cases pipeline shares this file and its existing single-argument call must keep compiling:

```ts
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  // A pdf.js TextItem: `str` is the glyph run, `transform` is a 6-element
  // matrix where [4]=x and [5]=y in PDF user space (origin bottom-left).
  interface PdfTextItem {
    str: string;
    transform: number[];
  }
  interface PdfPageData {
    pageIndex: number;
    getTextContent(opts?: { normalizeWhitespace?: boolean; disableCombineTextItems?: boolean }): Promise<{ items: PdfTextItem[] }>;
  }
  interface PdfParseOptions {
    /** Called once per page. Its return value is concatenated into `text`. */
    pagerender?: (pageData: PdfPageData) => Promise<string>;
    max?: number;
  }
  function pdfParse(dataBuffer: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>;
  export default pdfParse;
}
```

- [ ] **Step 4: Implement the loader**

Replace `src/lib/rap/doc-loader/textlayer.ts` entirely:

```ts
// Textract-free document loading: read the PDF's OWN embedded text layer.
// Viable because RAPs are digitally produced, not scanned (measured 2026-07-27:
// Bank of Canada 17pp -> 21,994 chars, TMX 2pp -> 3,805 chars). Necessary
// because an org SCP denies Textract to this account's service roles
// (docs/ca-extraction-textract-scp.md).
//
// The hard part is NOT getting text — pdf-parse does that in one call. It is
// getting the SAME output shape the LAYOUT path produces: paragraphs, each
// carrying its own "[p.N]" marker. pdf-parse's default output is one flat blob
// with no page boundaries and no paragraph breaks, which loses page grounding
// entirely (measured: the model then guesses pages, ~1/10 correct) and makes
// chunkDocument split on the size budget instead of at paragraph edges.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { DEFAULT_TARGET_CHARS } from "../chunk";
import { getDocumentBytes } from "../storage";
import { splitOversizedBlockText } from "./textract";
import { type DocLoader, type LoadResult, ScannedDocumentError, UnsupportedDocumentError } from "./types";

export interface TextItem {
  str: string;
  transform: number[];
}

// A new paragraph starts when the vertical gap exceeds this multiple of the
// page's own median line gap. Relative, not absolute, so it holds across font
// sizes. 1.5 is the usual typographic paragraph lead; tune only with a
// measurement, never by feel.
const PARAGRAPH_GAP_RATIO = 1.5;
// Two glyph runs within this many points of the same baseline are one line.
const SAME_LINE_EPSILON = 2;

/** Group a page's glyph runs into paragraphs, in reading order. */
export function groupItemsIntoParagraphs(items: TextItem[]): string[] {
  const printable = items.filter((i) => i.str.trim() !== "");
  if (printable.length === 0) return [];

  // 1. lines: bucket by baseline y (descending — PDF origin is bottom-left)
  const lines: { y: number; items: TextItem[] }[] = [];
  for (const it of [...printable].sort((a, b) => b.transform[5] - a.transform[5])) {
    const y = it.transform[5];
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) <= SAME_LINE_EPSILON) last.items.push(it);
    else lines.push({ y, items: [it] });
  }
  const rendered = lines.map((l) => ({
    y: l.y,
    text: [...l.items].sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(" ").replace(/\s+/g, " ").trim(),
  }));

  if (rendered.length === 1) return [rendered[0].text];

  // 2. paragraphs: split where the gap exceeds the page's median gap * ratio
  const gaps = rendered.slice(1).map((l, i) => rendered[i].y - l.y);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const threshold = median * PARAGRAPH_GAP_RATIO;

  const paragraphs: string[] = [];
  let current = [rendered[0].text];
  for (let i = 1; i < rendered.length; i++) {
    if (median > 0 && rendered[i - 1].y - rendered[i].y > threshold) {
      paragraphs.push(current.join("\n"));
      current = [rendered[i].text];
    } else {
      current.push(rendered[i].text);
    }
  }
  paragraphs.push(current.join("\n"));
  return paragraphs.filter((p) => p.trim() !== "");
}

/** Per-page paragraph arrays, page order preserved. */
export async function extractPagesFromPdf(buf: Buffer): Promise<string[][]> {
  const pages: string[][] = [];
  await pdfParse(buf, {
    pagerender: async (pageData) => {
      const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      const paras = groupItemsIntoParagraphs(content.items);
      pages.push(paras);
      return paras.join("\n\n");
    },
  });
  return pages;
}

/**
 * Emit the "[p.N]" contract. Every paragraph carries its OWN marker — a
 * marker emitted only on page change is lost once a chunk starts mid-page,
 * and the model then attributes that text to whatever page preceded it:
 * in-range, non-null, and wrong. Oversized paragraphs are pre-split here so
 * no marker-less piece can exist downstream.
 */
export function buildTextFromPages(pages: string[][]): string {
  const out: string[] = [];
  pages.forEach((paras, idx) => {
    for (const para of paras) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      for (const piece of splitOversizedBlockText(trimmed, DEFAULT_TARGET_CHARS)) {
        out.push(`[p.${idx + 1}]\n${piece}`);
      }
    }
  });
  return out.join("\n\n");
}

export const textlayerLoader: DocLoader = {
  name: "textlayer",
  async load({ sourceS3Key, fileName }): Promise<LoadResult> {
    if (!/\.pdf$/i.test(fileName)) throw new UnsupportedDocumentError(fileName);
    const bytes = await getDocumentBytes(sourceS3Key);
    const pages = await extractPagesFromPdf(Buffer.from(bytes));
    const text = buildTextFromPages(pages);
    // Fidelity and scanned gates are added in Tasks 3 and 4.
    return { text, fidelityDamaged: false, damagedOffsets: [] };
  },
};
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx tsx scripts/test-doc-loader-textlayer.ts`
Expected: PASS, 13 checks

Run: `npx tsx scripts/test-doc-loader-select.ts`
Expected: PASS (the placeholder is now a real loader)

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add src/lib/rap/doc-loader/textlayer.ts src/lib/cases/ingest/pdf-parse.d.ts scripts/test-doc-loader-textlayer.ts
git commit -m "feat(rap): text-layer document loader with page-grounded paragraphs

Reads the PDF's own embedded text instead of OCRing it, which works because
RAPs are digitally produced (measured: BoC 17pp -> 21,994 chars, TMX 2pp ->
3,805) and is necessary because an org SCP denies Textract to this account's
service roles.

The work is not getting text — pdf-parse does that in one call — but producing
the SAME shape the LAYOUT path does. pdf-parse returns one flat blob with no
page or paragraph boundaries, which loses page grounding entirely (the model
then guesses, ~1/10 correct) and makes chunkDocument cut on the size budget
rather than at paragraph edges. So the loader rebuilds structure from glyph
geometry: bucket runs into lines by baseline y, split into paragraphs where the
vertical gap exceeds 1.5x the page's median line gap, and emit [p.N] per
paragraph with oversized ones pre-split so no marker-less piece survives.

Pure and offline-testable: fixtures are synthesised with pdf-lib, so no binary
PDFs are committed and no test depends on an untracked dump."
```

---

### Task 3: Fidelity gate — make font damage legible

Detection already exists: `ValidationRule` has `quote_not_found` and `isClean()` fails on any issue, so Claude's silent repair of a damaged word is already caught. What is missing is telling the reviewer *why*.

**Files:**
- Modify: `src/lib/rap/types.ts:202-208` (`ValidationRule` union)
- Modify: `src/lib/rap/doc-loader/textlayer.ts`
- Modify: `src/lib/rap/pipeline.bedrock.ts` (after the `validateAndFlag` call, ~line 533)
- Test: `scripts/test-doc-loader-fidelity.ts`

**Interfaces:**
- Consumes: `LoadResult` from Task 1; `buildTextFromPages` from Task 2.
- Produces: `function scanFidelity(text: string): { text: string; fidelityDamaged: boolean; damagedOffsets: number[] }`; new `ValidationRule` member `"source_text_damaged"`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-doc-loader-fidelity.ts`:

```ts
// Some PDFs embed fonts whose glyphs have no Unicode mapping. pdf-parse then
// emits a NUL where the character belongs — measured on the TMX RAP, where
// every "fi" ligature became a NUL byte ("its \u0000rst Reconciliation Action
// Plan"). Claude SILENTLY REPAIRS this, returning "first", so the quote reads
// verbatim but does not match the source bytes.
//
// The existing validator already catches that: the repaired quote fails
// quote_not_found, and isClean() fails on any issue. What this gate adds is
// LEGIBILITY — damage rendered visibly as U+FFFD, plus one document-level
// issue so a reviewer knows the source text is damaged rather than the model
// hallucinating.
// Run: npx tsx scripts/test-doc-loader-fidelity.ts
import { scanFidelity } from "../src/lib/rap/doc-loader/textlayer";

let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
}

const NUL = String.fromCharCode(0);

const clean = scanFidelity("[p.1]\nits first Reconciliation Action Plan");
check("clean text is not flagged", clean.fidelityDamaged === false);
check("clean text is unchanged", clean.text === "[p.1]\nits first Reconciliation Action Plan");
check("clean text records no offsets", clean.damagedOffsets.length === 0);

const damaged = scanFidelity(`[p.1]\nits ${NUL}rst Reconciliation Action Plan`);
check("NUL byte flags damage", damaged.fidelityDamaged === true);
check("NUL is replaced with U+FFFD so it is visible", damaged.text.includes("�") && !damaged.text.includes(NUL));
check("offset recorded", damaged.damagedOffsets.length === 1 && damaged.damagedOffsets[0] === 10, JSON.stringify(damaged.damagedOffsets));

const multi = scanFidelity(`a${NUL}b${NUL}c`);
check("multiple NULs all recorded", multi.damagedOffsets.length === 2, JSON.stringify(multi.damagedOffsets));

const existing = scanFidelity("already � damaged");
check("pre-existing U+FFFD counts as damage", existing.fidelityDamaged === true);

// Newlines and tabs are structure, not damage — the [p.N] format depends on them.
const structural = scanFidelity("[p.1]\nline\ttab\r\nend");
check("newlines and tabs are not damage", structural.fidelityDamaged === false, JSON.stringify(structural.damagedOffsets));

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-doc-loader-fidelity.ts`
Expected: FAIL — `scanFidelity` is not exported

- [ ] **Step 3: Add the validation rule**

In `src/lib/rap/types.ts`, extend the union (additive; no existing consumer breaks):

```ts
export type ValidationRule =
  | "no_quote" // value present but ungrounded
  | "quote_not_found" // quote given, but it does not appear in the source document
  | "source_text_damaged" // the extracted source text itself had unmappable glyphs
  | "date_format"
  | "currency_format"
  | "out_of_range"
  | "cross_field"; // e.g. timeline outside periodCovered
```

- [ ] **Step 4: Implement `scanFidelity` and wire it into the loader**

Add to `src/lib/rap/doc-loader/textlayer.ts`:

```ts
// Control characters that indicate a glyph failed to map to Unicode. \n, \r and
// \t are deliberately excluded — they are the structure the "[p.N]" format is
// built from. U+FFFD counts as damage whether we introduced it or pdf-parse did.
const DAMAGE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g;

/**
 * Render unmappable glyphs VISIBLY and report where they were. Detection of the
 * downstream consequence (a quote that no longer matches the source) is already
 * handled by validate.ts's quote_not_found; this exists so a reviewer can tell
 * a damaged source from a hallucinating model.
 */
export function scanFidelity(text: string): { text: string; fidelityDamaged: boolean; damagedOffsets: number[] } {
  const damagedOffsets: number[] = [];
  let m: RegExpExecArray | null;
  DAMAGE_RE.lastIndex = 0;
  while ((m = DAMAGE_RE.exec(text)) !== null) damagedOffsets.push(m.index);
  if (damagedOffsets.length === 0) return { text, fidelityDamaged: false, damagedOffsets: [] };
  return { text: text.replace(DAMAGE_RE, "�"), fidelityDamaged: true, damagedOffsets };
}
```

Use it in `textlayerLoader.load`, replacing the `const text = buildTextFromPages(pages);` line and the return:

```ts
    const scanned = scanFidelity(buildTextFromPages(pages));
    return scanned;
```

- [ ] **Step 5: Surface it as a document-level validation issue**

In `pipeline.bedrock.ts`, immediately after the `validateAndFlag` call (~line 533):

```ts
  const { extracted, issues } = validateAndFlag(merged, { requireQuote: true, sourceText: documentText });

  // One document-level issue when the SOURCE TEXT was damaged. Individual bad
  // quotes already fail quote_not_found; without this the reviewer sees N
  // unexplained quote errors and no reason for them. Any issue makes isClean()
  // false, so a damaged document can never auto-publish.
  if (loaded.fidelityDamaged) {
    issues.push({
      path: "$document",
      rule: "source_text_damaged",
      message:
        `The extracted source text contains ${loaded.damagedOffsets.length} unmappable character(s) ` +
        `(offsets ${loaded.damagedOffsets.slice(0, 10).join(", ")}${loaded.damagedOffsets.length > 10 ? ", …" : ""}). ` +
        "The document's embedded fonts lack Unicode mappings for some glyphs, so quotes may not match the source verbatim. Review manually.",
    });
  }
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx tsx scripts/test-doc-loader-fidelity.ts`
Expected: PASS, 10 checks

Run: `npx tsx scripts/test-doc-loader-textlayer.ts && npx tsx scripts/test-layout-text.ts`
Expected: both PASS

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add src/lib/rap/types.ts src/lib/rap/doc-loader/textlayer.ts src/lib/rap/pipeline.bedrock.ts scripts/test-doc-loader-fidelity.ts
git commit -m "feat(rap): make source-text font damage legible to reviewers

Some PDFs embed fonts whose glyphs have no Unicode mapping; pdf-parse then
emits a NUL where the character belongs. Measured on the TMX RAP, where every
fi ligature became \\u0000 — and Claude silently REPAIRED it, returning a quote
that reads verbatim but does not match the source bytes.

Detection already existed: the repaired quote fails quote_not_found and
isClean() fails on any issue. What was missing was legibility — a reviewer saw
N unexplained quote errors with no signal that the source text, not the model,
was at fault. So render damage visibly as U+FFFD and add one document-level
issue under a new source_text_damaged rule naming the count and offsets.

Flag, do not reject: TMX's damage was 5 characters in 3,805, and failing a whole
RAP over one bad ligature blocks legitimate documents. Corrupt text may enter
the system, but never unreviewed.

ValidationRule gains one member; ExtractionResult is unchanged."
```

---

### Task 4: Scanned-document gate

A scanned PDF yields little or no text. The existing guard at `pipeline.bedrock.ts:468` only catches *exactly* empty text, so a scan with a few stray glyphs slips through and produces a confident, empty extraction.

**Files:**
- Modify: `src/lib/rap/doc-loader/textlayer.ts`
- Test: `scripts/test-doc-loader-scanned.ts`

**Interfaces:**
- Consumes: `ScannedDocumentError` from `./types`; `extractPagesFromPdf`, `buildTextFromPages`, `scanFidelity` from Task 2/3.
- Produces: `function assertHasTextLayer(text: string, pageCount: number, fileName: string): void`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-doc-loader-scanned.ts`:

```ts
// A scanned PDF has no text layer, so this loader returns (almost) nothing.
// Without a gate that produces a CONFIDENT EMPTY extraction — the exact
// "silently dropped commitments" failure the pipeline exists to prevent.
// The existing guard in pipeline.bedrock only catches exactly-empty text, so a
// scan carrying a stray glyph or a page-number artifact slips past it.
//
// Per the design decision (spec, Gate 2): fail in-region rather than falling
// back to BDA in us-east-1. A silent cross-border fallback is precisely what
// the residency architecture exists to prevent.
// Run: npx tsx scripts/test-doc-loader-scanned.ts
import { assertHasTextLayer } from "../src/lib/rap/doc-loader/textlayer";
import { ScannedDocumentError } from "../src/lib/rap/doc-loader/types";

let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
}
function throwsScanned(fn: () => void): boolean {
  try { fn(); return false; } catch (e) { return e instanceof ScannedDocumentError; }
}

check("empty text is rejected", throwsScanned(() => assertHasTextLayer("", 5, "scan.pdf")));
check("whitespace-only text is rejected", throwsScanned(() => assertHasTextLayer("   \n\n  ", 3, "scan.pdf")));
check("a stray glyph on a 10-page doc is rejected", throwsScanned(() => assertHasTextLayer("[p.1]\n7", 10, "scan.pdf")));

// 17 pages x ~1,300 chars is the real Bank of Canada RAP shape.
const realDoc = Array.from({ length: 17 }, (_, i) => `[p.${i + 1}]\n${"word ".repeat(260)}`).join("\n\n");
check("a real 17-page RAP passes", !throwsScanned(() => assertHasTextLayer(realDoc, 17, "boc.pdf")));

// A short but genuine one-page document must not be mistaken for a scan.
check("a genuine short 1-page doc passes", !throwsScanned(() => assertHasTextLayer(`[p.1]\n${"word ".repeat(60)}`, 1, "short.pdf")));

// Just under the floor.
check("under the absolute floor is rejected", throwsScanned(() => assertHasTextLayer("[p.1]\nshort", 1, "tiny.pdf")));

let msg = "";
try { assertHasTextLayer("", 4, "mystery.pdf"); } catch (e) { msg = (e as Error).message; }
check("message names the file and says scanned", msg.includes("mystery.pdf") && /scan/i.test(msg), msg);
check("message tells the user what to do", /text-based PDF/i.test(msg), msg);

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-doc-loader-scanned.ts`
Expected: FAIL — `assertHasTextLayer` is not exported

- [ ] **Step 3: Implement the gate**

Add to `src/lib/rap/doc-loader/textlayer.ts`:

```ts
// Heuristics, not laws — tuned against the two real RAPs we have (BoC 17pp /
// 21,994 chars ~= 1,294 per page; TMX 2pp / 3,805 ~= 1,902 per page) with wide
// margin so a genuinely terse document is not mistaken for a scan. Change these
// only against a measured document, never by feel.
const MIN_TOTAL_CHARS = 200;
const MIN_CHARS_PER_PAGE = 50;

/** Throw ScannedDocumentError when the document carries no usable text layer. */
export function assertHasTextLayer(text: string, pageCount: number, fileName: string): void {
  // Page markers are ours, not the document's — exclude them so a 40-page scan
  // does not look content-rich purely because it has 40 "[p.N]" lines.
  const body = text.replace(/^\[p\.[^\]]*\]$/gm, "").trim();
  if (body.length < MIN_TOTAL_CHARS) throw new ScannedDocumentError(fileName);
  if (pageCount > 0 && body.length / pageCount < MIN_CHARS_PER_PAGE) throw new ScannedDocumentError(fileName);
}
```

Call it in `textlayerLoader.load`, after building the text and before returning:

```ts
    const scanned = scanFidelity(buildTextFromPages(pages));
    assertHasTextLayer(scanned.text, pages.length, fileName);
    return scanned;
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx tsx scripts/test-doc-loader-scanned.ts`
Expected: PASS, 8 checks

Run: `npx tsx scripts/test-doc-loader-textlayer.ts && npx tsx scripts/test-doc-loader-fidelity.ts && npx tsx scripts/test-doc-loader-select.ts && npx tsx scripts/test-layout-text.ts`
Expected: all PASS

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/rap/doc-loader/textlayer.ts scripts/test-doc-loader-scanned.ts
git commit -m "feat(rap): reject scanned PDFs in-region instead of extracting nothing

A scanned PDF has no text layer, so the text-layer loader returns almost
nothing and the pipeline would produce a confident, empty extraction — the
silently-dropped-commitments failure it exists to prevent. The existing guard
only catches exactly-empty text, so a scan carrying a stray glyph or a page
number slips past.

assertHasTextLayer applies an absolute floor and a per-page floor, excluding our
own [p.N] markers so a 40-page scan does not look content-rich just because it
has 40 marker lines. Thresholds are named constants tuned against the two real
RAPs with wide margin, and commented as heuristics.

Per the design decision this fails IN REGION rather than falling back to BDA in
us-east-1: a silent cross-border fallback is precisely what the residency
architecture exists to prevent, and an honest 'cannot process this in-region' is
defensible where quiet exfiltration is not."
```

---

### Task 5: Measure on `ca`, then decide

Everything so far is behaviour-neutral (`DOC_LOADER` still defaults to `textract`). This task measures the new path against gold and records the result either way.

**Files:**
- Create: `scripts/measure-textlayer-parity.ts`
- Create: `scripts/score-extraction-vs-gold.ts`
- Modify: `docs/ca-extraction-textract-scp.md` (append a result section)

**Interfaces:**
- Consumes: `extractPagesFromPdf`, `buildTextFromPages` (Task 2); `scripts/fixtures/gold-commitments-bankofcanada.json` (22 entries of `{page: number, action: string}`).
- Produces: two scripts; no library code.

- [ ] **Step 1: Write the offline parity script**

Create `scripts/measure-textlayer-parity.ts`. Not in CI — the source PDF is not in the repo, same rationale as `scripts/test-layout-real-ocr.ts`:

```ts
// Compares the text-layer loader's output against the cached Textract LAYOUT
// dump for the same pages. Manual: needs a real PDF, which is not committed.
// Run: npx tsx scripts/measure-textlayer-parity.ts <path-to-boc.pdf>
import { readFileSync } from "node:fs";
import { buildTextFromLayoutBlocks } from "../src/lib/rap/doc-loader";
import { buildTextFromPages, extractPagesFromPdf } from "../src/lib/rap/doc-loader/textlayer";
import type { Block } from "@aws-sdk/client-textract";

const pdfPath = process.argv[2];
if (!pdfPath) { console.error("usage: npx tsx scripts/measure-textlayer-parity.ts <path-to-boc.pdf>"); process.exit(1); }

const blocks = JSON.parse(readFileSync("scripts/fixtures/textract-layout-p13-p15.json", "utf8")) as Block[];
const textractText = buildTextFromLayoutBlocks(blocks);
const pages = await extractPagesFromPdf(readFileSync(pdfPath));
const textlayerText = buildTextFromPages(pages);

const onlyPages = (t: string, wanted: number[]) =>
  t.split("\n\n").filter((p) => wanted.some((n) => p.startsWith(`[p.${n}]`))).join("\n\n");

const a = onlyPages(textractText, [13, 15]);
const b = onlyPages(textlayerText, [13, 15]);
const words = (s: string) => new Set(s.replace(/\[p\.\d+\]/g, " ").toLowerCase().match(/[a-z0-9']+/g) ?? []);
const wa = words(a), wb = words(b);
const shared = [...wa].filter((w) => wb.has(w)).length;

console.log(`textract p13+p15: ${a.length} chars, ${wa.size} unique words`);
console.log(`textlayer p13+p15: ${b.length} chars, ${wb.size} unique words`);
console.log(`shared vocabulary: ${shared}/${wa.size} (${((shared / wa.size) * 100).toFixed(1)}% of Textract's words recovered)`);
console.log(`textract-only words: ${[...wa].filter((w) => !wb.has(w)).slice(0, 20).join(", ")}`);
```

- [ ] **Step 2: Write the gold-scoring script**

Create `scripts/score-extraction-vs-gold.ts`:

```ts
// Scores a finished extraction job against the gold commitment set. Page
// accuracy is the acceptance bar: the pre-work baseline recovered gold ACTION
// text verbatim but put it on page 12 where gold says 13, because pdf-parse's
// flat output left the model guessing pages.
// Run: AWS_PROFILE=isb AWS_REGION=ca-central-1 \
//        RAP_TABLE=<table> JOB_ID=<jobId> npx tsx scripts/score-extraction-vs-gold.ts
import { readFileSync } from "node:fs";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

type Gold = { page: number; action: string };
const gold = JSON.parse(readFileSync("scripts/fixtures/gold-commitments-bankofcanada.json", "utf8")) as Gold[];

const table = process.env.RAP_TABLE, jobId = process.env.JOB_ID;
if (!table || !jobId) { console.error("RAP_TABLE and JOB_ID are required"); process.exit(1); }

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ca-central-1" });
const res = await ddb.send(new GetItemCommand({ TableName: table, Key: { PK: { S: `EXTRACT#${jobId}` }, SK: { S: "META" } } }));
if (!res.Item) { console.error(`job ${jobId} not found`); process.exit(1); }
const item = unmarshall(res.Item) as { extracted?: { commitments?: any[] }; validationIssues?: any[] };
const got = item.extracted?.commitments ?? [];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
let actionHits = 0, pageHits = 0;
const misses: string[] = [];
for (const g of gold) {
  const match = got.find((c) => norm(String(c?.action?.value ?? "")).includes(norm(g.action).slice(0, 40)));
  if (!match) { misses.push(g.action.slice(0, 60)); continue; }
  actionHits++;
  if (Number(match.action?.page) === g.page) pageHits++;
}

console.log(`gold commitments:      ${gold.length}`);
console.log(`extracted commitments: ${got.length}`);
console.log(`action matches:        ${actionHits}/${gold.length}`);
console.log(`PAGE matches:          ${pageHits}/${gold.length}   <-- acceptance bar`);
console.log(`validation issues:     ${item.validationIssues?.length ?? 0}`);
if (misses.length) console.log(`missed:\n  ${misses.join("\n  ")}`);
```

- [ ] **Step 3: Run the offline parity check**

Download the BoC PDF (it is not in the repo):

```bash
AWS_PROFILE=isb AWS_REGION=ca-central-1 aws s3 cp \
  s3://indigenomics-portal-ca-rapuploadsbucket-bbhvotne/test/BankOfCanada_RAP.pdf /tmp/boc.pdf
npx tsx scripts/measure-textlayer-parity.ts /tmp/boc.pdf
```

Expected: a high shared-vocabulary percentage. A low number means the paragraph grouping is dropping content — stop and fix Task 2 before deploying.

- [ ] **Step 4: Deploy `ca` with the text-layer loader**

```bash
AWS_PROFILE=isb SST_AWS_REGION=ca-central-1 CASES_EMBED_PROVIDER=stub \
  EXTRACTION_IMPL=bedrock DOC_LOADER=textlayer \
  DIGEST_SENDER=su.en@northeastern.edu DIGEST_RECIPIENT=enpingsu555@gmail.com \
  npx sst deploy --stage ca
```

The `DIGEST_*` vars are mandatory on every `ca` deploy or the notification email silently reverts to `skipped`.

- [ ] **Step 5: Run a real extraction and score it**

```bash
AWS_PROFILE=isb AWS_REGION=ca-central-1 REPO_IMPL=dynamo \
  RAP_TABLE=indigenomics-portal-ca-RapDataTable-dxcrrfcz \
  FILE_NAME=BankOfCanada_RAP.pdf S3KEY=test/BankOfCanada_RAP.pdf \
  npx tsx scripts/make-test-job.ts
# then, with the printed jobId:
echo '<printed json>' > /tmp/payload.json
AWS_PROFILE=isb AWS_REGION=ca-central-1 aws lambda invoke \
  --function-name indigenomics-portal-ca-RapExtractFunction-uzfxuerh \
  --cli-binary-format raw-in-base64-out --payload file:///tmp/payload.json \
  --cli-read-timeout 0 /tmp/out.json
AWS_PROFILE=isb AWS_REGION=ca-central-1 \
  RAP_TABLE=indigenomics-portal-ca-RapDataTable-dxcrrfcz JOB_ID=<jobId> \
  npx tsx scripts/score-extraction-vs-gold.ts
```

Acceptance: **action matches ≥22/22 and PAGE matches 22/22** (12 on p13, 10 on p15). The pre-work baseline was ~25 commitments found with pages wrong.

- [ ] **Step 6: Record the outcome and set `ca`'s final state**

Append a "Result" section to `docs/ca-extraction-textract-scp.md` with the measured numbers, then:

- **If the page bar is met** — leave `ca` on `DOC_LOADER=textlayer`, and record that `ca` now has a working in-country extraction path.
- **If it is not met** — redeploy `ca` without `EXTRACTION_IMPL`/`DOC_LOADER` (returning it to `mock`), and record the measured shortfall honestly next to the SCP escalation. Do not ship a path that misses its stated bar.

Then delete the test job row and any probe objects:

```bash
AWS_PROFILE=isb AWS_REGION=ca-central-1 aws dynamodb delete-item \
  --table-name indigenomics-portal-ca-RapDataTable-dxcrrfcz \
  --key '{"PK":{"S":"EXTRACT#<jobId>"},"SK":{"S":"META"}}'
```

- [ ] **Step 7: Commit**

```bash
git add scripts/measure-textlayer-parity.ts scripts/score-extraction-vs-gold.ts docs/ca-extraction-textract-scp.md
git commit -m "test(rap): measure the text-layer loader against gold and record the result

Two manual measurement scripts plus the recorded outcome. measure-textlayer-parity
diffs the loader's p13/p15 output against the cached Textract LAYOUT dump offline.
score-extraction-vs-gold scores a finished job against the 22-entry gold set,
reporting action matches and — the acceptance bar — PAGE matches.

Page accuracy is the bar because the pre-work baseline already recovered gold
action text verbatim while attributing it to page 12 where gold says 13. Finding
the right commitments was never in doubt; grounding them was."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| Architecture — `doc-loader/` module, `DocLoader`, `LoadResult` | 1 |
| Textract loader moved verbatim, `buildTextFromLayoutBlocks` re-exported | 1 |
| `DOC_LOADER` explicit selection, throws on unknown, no silent fallback | 1 |
| `sst.config.ts` wiring, default `textract` | 1 |
| `pdf-parse.d.ts` `pagerender` overload, additive | 2 |
| Per-page capture, line grouping, paragraph grouping by 1.5× median gap | 2 |
| `[p.N]` emission + `splitOversizedBlockText` reuse | 2 |
| Gate 1 — `U+FFFD`, one `source_text_damaged` issue, `ValidationRule` addition | 3 |
| Gate 1 — reuses `quote_not_found` / `isClean`, no `ExtractionResult` change | 3 |
| Gate 2 — thresholds, `ScannedDocumentError`, fail in-region | 4 |
| `UnsupportedDocumentError` | 1 (defined), 2 (thrown for non-PDF) |
| Offline tests with `pdf-lib`-synthesised fixtures | 2, 3, 4 |
| Manual parity script vs Textract fixture | 5 |
| Acceptance vs gold, page bar | 5 |
| Rollout: behaviour-neutral, then measure, then decide | 1 (neutral), 5 (measure/decide) |
| `DIGEST_*` on every `ca` deploy | Global Constraints, Task 5 |

No gaps.

**Placeholder scan:** No TBD/TODO. Every code step carries real code. The one deliberately abbreviated block is Task 1 Step 4's `// ---- MOVED VERBATIM` marker — that is an instruction to move existing code unchanged, with exact source line numbers given in the **Files** block, which is more reliable than reproducing 180 lines and risking transcription drift.

**Type consistency:** `LoadResult{text, fidelityDamaged, damagedOffsets}` is defined in Task 1 and used unchanged in Tasks 2-3. `selectLoader(env)` returns `DocLoader` in Task 1, called with no argument in Task 1 Step 6 (defaulted). `splitOversizedBlockText` is exported in Task 1 Step 4 and imported in Task 2. `scanFidelity` returns exactly `LoadResult`'s shape, so Task 3's `return scanned;` typechecks. `assertHasTextLayer(text, pageCount, fileName)` matches its Task 4 call site. `buildTextFromPages(pages: string[][])` matches `extractPagesFromPdf`'s return type in both Task 2 and Task 5.

**One risk called out:** Task 2's paragraph reconstruction is the only genuinely new algorithm; everything else moves code or reuses existing machinery. If `PARAGRAPH_GAP_RATIO` proves wrong on real documents, Task 5 Step 3's parity check catches it *before* any deploy.
