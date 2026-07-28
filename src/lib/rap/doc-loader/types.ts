// The document-loading seam. Everything upstream of chunkDocument that turns a
// stored file into "[p.N]"-marked paragraph text lives behind this interface.
// Two implementations exist because Textract is unavailable to this account's
// service roles (docs/ca-extraction-textract-scp.md) — NOT because we want a
// runtime fallback. Selection is explicit; see index.ts.

export type LoaderName = "textract" | "textlayer";

/**
 * The page marker every loader prefixes onto each paragraph, and the pattern
 * that finds one again.
 *
 * These live together because they MUST agree, and until now they did not have
 * to: the format was a bare template literal in each loader while validate.ts
 * only mentioned markers in a comment. A quote that spans a paragraph or page
 * boundary contains one of these in the DOCUMENT but not in the model's quote,
 * so the verbatim substring check failed on quotes the model had reproduced
 * perfectly — measured on Hydro-Québec as 3 of 5 quote_not_found flags.
 *
 * `"?"` appears when a loader has a paragraph whose page it could not determine
 * (textract's LAYOUT blocks are not guaranteed to carry Page), so the pattern
 * has to admit it or those markers would survive stripping.
 */
export const pageMarker = (page: number | string) => `[p.${page}]\n`;

/** Matches any marker `pageMarker` can produce, with or without its newline. */
export const PAGE_MARKER_RE = /\[p\.(?:\d+|\?)\]\n?/g;

export interface LoadResult {
  /** "[p.N]\n<paragraph>" blocks, separated by a blank line. */
  text: string;
  /** True when the decoded text contained unmappable glyphs (see the fidelity gate). */
  fidelityDamaged: boolean;
  /** Character offsets into `text` where damage was found. Reviewer context only. */
  damagedOffsets: number[];
  /**
   * Set when too few of the document's pages individually carried extractable
   * text — the document may be partly scanned, so the extraction may be
   * missing whole pages. NOT a rejection: the pipeline turns this into a
   * document-level ValidationIssue so the document routes to human review
   * (see textlayer.ts's MIN_PAGE_COVERAGE_RATIO for why this is an issue and
   * not an error). Null when coverage is fine, or when the loader has no
   * per-page view of the document at all (textract).
   */
  lowPageCoverage: { coveredPages: number; pageCount: number } | null;
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
