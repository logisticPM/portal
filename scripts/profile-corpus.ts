/**
 * Structural profile of the text-layer loader across the local RAP sample corpus.
 *
 * No gold set required — this measures properties that are checkable without one:
 * does the document have a usable text layer, does the fidelity gate fire, does the
 * page-coverage gate fire, and how much column reordering happens.
 *
 * Usage: npx tsx scripts/profile-corpus.ts <dir-of-pdfs>
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  extractPagesFromPdf,
  buildTextFromPages,
  scanFidelity,
  assertHasTextLayer,
  measurePageCoverage,
  bucketIntoLines,
  detectColumnGutters,
  columnsLookLikeProse,
} from "../src/lib/rap/doc-loader/textlayer";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: npx tsx scripts/profile-corpus.ts <dir-of-pdfs>");
  process.exit(1);
}

/** Re-run the geometry pass so column stats can be gathered per page. */
async function columnStats(bytes: Uint8Array) {
  // Import the lib entry, NOT the package root — pdf-parse/index.js runs a demo
  // harness when it thinks it is the main module, which reads a fixture that is
  // not shipped. The loader imports the same path for the same reason.
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as any;
  const perPage: { page: number; lines: number; gutters: number; prose: boolean }[] = [];
  await pdfParse(bytes, {
    pagerender: async (pageData: any) => {
      const content = await pageData.getTextContent();
      const items = content.items.map((it: any) => ({
        str: it.str,
        transform: it.transform,
        width: it.width,
      }));
      const lines = bucketIntoLines(items.filter((i: any) => i.str.trim().length > 0));
      // detectColumnGutters is the RAW geometric pass. detectColumnBoundaries
      // would be wrong here: it applies the prose guard itself and returns []
      // on failure, so asking the guard about its output is tautological.
      const gutters = detectColumnGutters(lines);
      perPage.push({
        page: pageData.pageIndex + 1,
        lines: lines.length,
        gutters: gutters.length,
        prose: gutters.length > 0 ? columnsLookLikeProse(lines, gutters) : false,
      });
      return "";
    },
  }).catch(() => {});
  return perPage;
}

async function main() {
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();

for (const f of files) {
  const bytes = new Uint8Array(readFileSync(join(dir, f)));
  process.stdout.write(`\n=== ${f} (${(bytes.length / 1024).toFixed(0)} KB) ===\n`);
  try {
    const pages = await extractPagesFromPdf(bytes);
    const raw = buildTextFromPages(pages);
    const fid = scanFidelity(raw);

    let scannedGate = "PASS";
    try {
      assertHasTextLayer(fid.text, pages, f);
    } catch (e: any) {
      scannedGate = `REJECT (${e.name})`;
    }

    const cov = measurePageCoverage(pages);
    const chars = pages.map((p) => p.join("").length);
    // Sparse pages come from measurePageCoverage, not a local threshold — the
    // MIN_PAGE_CHARS constant is module-private and importing it yields undefined.
    const empty = cov.pageCount - cov.coveredPages;
    const cols = await columnStats(bytes);
    const colPages = cols.filter((c) => c.gutters > 0);
    const reordered = colPages.filter((c) => c.prose);

    console.log(`  pages:            ${pages.length}`);
    console.log(`  total chars:      ${raw.length}`);
    console.log(
      `  chars/page:       min ${Math.min(...chars)}  median ${
        chars.slice().sort((a, b) => a - b)[Math.floor(chars.length / 2)]
      }  max ${Math.max(...chars)}`,
    );
    console.log(`  sparse pages:     ${empty}/${pages.length} (below the coverage threshold)`);
    console.log(`  scanned gate:     ${scannedGate}`);
    console.log(
      `  coverage gate:    ${cov.low ? "LOW (flag)" : "ok"}  (${cov.coveredPages}/${cov.pageCount})`,
    );
    console.log(
      `  fidelity:         ${fid.fidelityDamaged ? `DAMAGED (${fid.damagedOffsets.length} glyphs)` : "clean"}`,
    );
    console.log(
      `  raw gutters:      ${colPages.length}/${cols.length} pages;  guard PASSES ${reordered.length} (reordered), REJECTS ${
        colPages.length - reordered.length
      } (left as-is)`,
    );
    if (colPages.length) {
      const detail = colPages
        .slice(0, 14)
        .map((c) => `p${c.page}:${c.gutters}g${c.prose ? "/prose" : "/TABLE"}`)
        .join(" ");
      console.log(`    ${detail}${colPages.length > 14 ? " …" : ""}`);
    }
  } catch (e: any) {
    console.log(`  FAILED: ${e.name}: ${e.message}`);
  }
}
}

main();
