/**
 * Find pages where the prose guard REJECTS, and measure band co-occurrence RATE.
 *
 * Evidence for the p4 fix (docs/rap-p4-interleaving-investigation.md, fix 3).
 * A commitment table links every band on every row, so its rate is ~1.0
 * regardless of how few rows it has. Two independent regions that merely share
 * a page should link on few or no lines. The question is whether those two
 * populations separate cleanly on real documents.
 *
 * Rate is normalised by min(linesWithA, linesWithB), NOT by an absolute count:
 * an absolute threshold of 3 would split a genuine 2-row commitment table.
 *
 * Usage: npx tsx scripts/scan-guard-rejections.ts <dir> [<dir>...]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { bucketIntoLines, detectColumnGutters, columnsLookLikeProse, splitLineIntoColumns } from "../src/lib/rap/doc-loader/textlayer";

async function main() {
  const files: string[] = [];
  for (const d of process.argv.slice(2))
    for (const f of readdirSync(d)) if (f.toLowerCase().endsWith(".pdf")) files.push(join(d, f));
  files.sort();
  let rejected = 0;
  for (const file of files) {
    await (pdfParse as any)(new Uint8Array(readFileSync(file)), {
      pagerender: async (pd: any) => {
        const c = await pd.getTextContent();
        const items = c.items.map((it: any) => ({ str: it.str, transform: it.transform, width: it.width }))
          .filter((i: any) => i.str.trim().length > 0);
        const lines = bucketIntoLines(items);
        const g = detectColumnGutters(lines);
        if (!g.length || columnsLookLikeProse(lines, g)) return "";
        rejected++;
        const nBands = g.length + 1;
        const linesWith = new Array(nBands).fill(0);
        const co = new Map<string, number>();
        let spanning = 0;
        for (const ln of lines) {
          const s = splitLineIntoColumns(ln.items, g);
          if (s.spans) { spanning++; continue; }
          const present: number[] = [];
          s.cols.forEach((v: any, i: number) => { if (v?.length) { present.push(i); linesWith[i]++; } });
          for (let a = 0; a < present.length; a++)
            for (let b = a + 1; b < present.length; b++)
              co.set(`${present[a]}-${present[b]}`, (co.get(`${present[a]}-${present[b]}`) ?? 0) + 1);
        }
        const rates: string[] = [];
        for (let a = 0; a < nBands; a++)
          for (let b = a + 1; b < nBands; b++) {
            const n = co.get(`${a}-${b}`) ?? 0;
            const denom = Math.min(linesWith[a], linesWith[b]);
            rates.push(`${a}-${b}: ${n}/${denom || 0} = ${denom ? (n / denom).toFixed(2) : "n/a"}`);
          }
        console.log(`\n${basename(file)} p${pd.pageIndex + 1}  (${nBands} bands, ${spanning} spanning, lines/band ${linesWith.join("/")})`);
        console.log(`   ${rates.join("   ")}`);
        return "";
      },
    }).catch(() => {});
  }
  console.log(`\n${rejected} guard-rejected pages across ${files.length} documents`);
}
main();
