/**
 * Measure the horizontal gap between consecutive glyph runs on a line, in
 * multiples of the left run's font size — the exact quantity WORD_SPACE_RATIO
 * is compared against.
 *
 * Purpose: WORD_SPACE_RATIO = 0.2 was chosen from font metrics (a real space is
 * ~0.25-0.33 em, kerning is <0.05 em). This checks the assumption against real
 * documents, and in particular against table cells, where the "gap" between two
 * semantically distinct cells may be smaller than a word space.
 *
 * Usage: npx tsx scripts/measure-run-gaps.ts <pdf> <page> [y]
 */
import { readFileSync } from "node:fs";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { bucketIntoLines } from "../src/lib/rap/doc-loader/textlayer";

const [file, pageArg, yArg] = process.argv.slice(2);
const wanted = Number(pageArg);
const wantY = yArg === undefined ? null : Number(yArg);

const runLeft = (i: any) => i.transform[4];
const runRight = (i: any) => i.transform[4] + (i.width ?? 0);
const fontSize = (i: any) => Math.abs(i.transform[3]) || Math.abs(i.transform[0]) || 12;

async function main() {
  const bytes = new Uint8Array(readFileSync(file));
  await (pdfParse as any)(bytes, {
    pagerender: async (pageData: any) => {
      if (pageData.pageIndex + 1 !== wanted) return "";
      const content = await pageData.getTextContent();
      const items = content.items
        .map((it: any) => ({ str: it.str, transform: it.transform, width: it.width }))
        .filter((i: any) => i.str.trim().length > 0);
      const lines = bucketIntoLines(items);

      for (const ln of lines) {
        if (wantY !== null && Math.abs(ln.y - wantY) > 2) continue;
        if (ln.items.length < 2) continue;
        console.log(`\ny=${ln.y.toFixed(0)}  (${ln.items.length} runs)`);
        for (let i = 0; i < ln.items.length; i++) {
          const cur = ln.items[i];
          if (i === 0) {
            console.log(`   ${JSON.stringify(cur.str)}`);
            continue;
          }
          const prev = ln.items[i - 1];
          const gap = runLeft(cur) - runRight(prev);
          const ratio = gap / fontSize(prev);
          const verdict = !Number.isFinite(gap) ? "no-width→space" : ratio > 0.2 ? "SPACE" : "joined";
          console.log(
            `   gap=${gap.toFixed(2)}pt  size=${fontSize(prev).toFixed(1)}  ratio=${ratio.toFixed(3)}  ${verdict.padEnd(14)} ${JSON.stringify(cur.str)}`,
          );
        }
      }
      return "";
    },
  }).catch((e: any) => console.error("pdf-parse:", e.message));
}

main();
