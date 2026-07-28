// Compares the text-layer loader's output against the cached Textract LAYOUT
// dump, for the two commitment pages (p13, p15) of the real Bank of Canada
// RAP. Manual, not part of any suite — like scripts/test-layout-real-ocr.ts,
// it needs the real source PDF, which is not committed to the repo (only its
// cached Textract LAYOUT blocks and the derived gold set are).
//
// This is a DIAGNOSTIC, not a test: it reports shared-vocabulary overlap and
// what the Textract path captured that the text-layer path did not. It does
// not assert and does not exit non-zero on a poor score — a human reads the
// numbers and decides whether Task 2's paragraph reconstruction needs work
// before anything gets deployed.
//
// Run:
//   AWS_PROFILE=isb AWS_REGION=ca-central-1 aws s3 cp \
//     s3://indigenomics-portal-ca-rapuploadsbucket-bbhvotne/test/BankOfCanada_RAP.pdf /tmp/boc.pdf
//   npx tsx scripts/measure-textlayer-parity.ts /tmp/boc.pdf
//
// Wrapped in an async IIFE: this repo is NOT ESM, so top-level await is illegal.
import { readFileSync } from "node:fs";
import type { Block } from "@aws-sdk/client-textract";
import { buildTextFromLayoutBlocks } from "../src/lib/rap/doc-loader";
import { buildTextFromPages, extractPagesFromPdf } from "../src/lib/rap/doc-loader/textlayer";

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("usage: npx tsx scripts/measure-textlayer-parity.ts <path-to-boc.pdf>");
  process.exit(1);
}

let pdfBytes: Buffer;
try {
  pdfBytes = readFileSync(pdfPath);
} catch (e) {
  console.error(`could not read PDF at ${pdfPath}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

async function main() {
  const blocks = JSON.parse(
    readFileSync("scripts/fixtures/textract-layout-p13-p15.json", "utf8"),
  ) as Block[];
  const textractText = buildTextFromLayoutBlocks(blocks);
  const pages = await extractPagesFromPdf(pdfBytes);
  const textlayerText = buildTextFromPages(pages);

  const onlyPages = (t: string, wanted: number[]) =>
    t
      .split("\n\n")
      .filter((p) => wanted.some((n) => p.startsWith(`[p.${n}]`)))
      .join("\n\n");

  const a = onlyPages(textractText, [13, 15]);
  const b = onlyPages(textlayerText, [13, 15]);
  const words = (s: string) => new Set(s.replace(/\[p\.\d+\]/g, " ").toLowerCase().match(/[a-z0-9']+/g) ?? []);
  const wa = words(a);
  const wb = words(b);
  const shared = [...wa].filter((w) => wb.has(w)).length;

  console.log(`textract p13+p15:  ${a.length} chars, ${wa.size} unique words`);
  console.log(`textlayer p13+p15: ${b.length} chars, ${wb.size} unique words`);
  console.log("");
  console.log(
    `shared vocabulary: ${shared}/${wa.size} (${wa.size ? ((shared / wa.size) * 100).toFixed(1) : "0.0"}% of Textract's words recovered)`,
  );
  console.log(`textract-only words: ${[...wa].filter((w) => !wb.has(w)).slice(0, 20).join(", ") || "(none)"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
