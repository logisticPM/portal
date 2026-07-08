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
  function pdfParse(dataBuffer: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
