// pdf-parse has no bundled types. We import the implementation entrypoint directly
// (pdf-parse/lib/pdf-parse.js) to bypass the package index's debug block, which reads
// a local test PDF when the module is run as main.
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
  // matrix where [4]=x and [5]=y in PDF user space (origin bottom-left), and
  // `width` is the run's advance width in those same units — so the run's
  // right edge is transform[4] + width. Verified against this bundled pdf.js
  // (2026-07-27): every item in a getTextContent result carries `width`
  // (e.g. {str:"Recon", width:34.68, transform:[12,0,0,12,50,660]} followed by
  // {str:"ciliation", transform:[...,84.68,660]} — abutting to the point).
  // src/lib/rap/doc-loader/textlayer.ts uses it to tell an intra-word run
  // boundary from a real space, and a column gutter from a word gap.
  interface PdfTextItem {
    str: string;
    transform: number[];
    width: number;
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
  // Accepts a plain Uint8Array as well as Buffer: pdf-parse's bundled pdf.js
  // (v1.10.100) mishandles a Node Buffer's prototype in its Node "fake
  // worker" postMessage-clone path (LoopbackPort, pdf.js/v1.10.100/build/
  // pdf.js:3914-3996) for small inputs (~1.1-2.9KB), corrupting the parse
  // deterministically. A plain Uint8Array over the SAME bytes is unaffected
  // at every size tested (2026-07-27, this repo: 20/20 fresh-process passes
  // for Uint8Array vs 10/10 fresh-process failures for Buffer, isolated
  // single-attempt calls). See src/lib/rap/doc-loader/textlayer.ts.
  function pdfParse(dataBuffer: Buffer | Uint8Array, options?: PdfParseOptions): Promise<PdfParseResult>;
  export default pdfParse;
}
