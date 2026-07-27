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
