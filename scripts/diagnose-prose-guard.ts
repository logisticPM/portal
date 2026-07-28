/**
 * Diagnose the prose-likeness guard on one page: per-band fill ratio and mean
 * word-characters per line (the two quantities columnsLookLikeProse tests),
 * plus what the page would read like under each ordering.
 *
 * Usage: npx tsx scripts/diagnose-prose-guard.ts <pdf> <page>
 */
import { readFileSync } from "node:fs";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import {
  bucketIntoLines,
  detectColumnGutters,
  columnsLookLikeProse,
  splitLineIntoColumns,
} from "../src/lib/rap/doc-loader/textlayer";

const [file, pageArg] = process.argv.slice(2);
const wanted = Number(pageArg);

const runLeft = (i: any) => i.transform[4];
const runRight = (i: any) => i.transform[4] + (i.width ?? 0);

async function main() {
  await (pdfParse as any)(new Uint8Array(readFileSync(file)), {
    pagerender: async (pageData: any) => {
      if (pageData.pageIndex + 1 !== wanted) return "";
      const content = await pageData.getTextContent();
      const items = content.items
        .map((it: any) => ({ str: it.str, transform: it.transform, width: it.width }))
        .filter((i: any) => i.str.trim().length > 0);
      const lines = bucketIntoLines(items);
      const gutters = detectColumnGutters(lines);
      console.log(`page ${wanted}: ${lines.length} lines, ${gutters.length} raw gutters`);
      if (!gutters.length) return "";

      const all = lines.flatMap((l: any) => l.items);
      const mid = (g: any) => (g.lo + g.hi) / 2;
      const edges = [
        Math.min(...all.map(runLeft)),
        ...gutters.map(mid),
        Math.max(...all.map(runRight)),
      ];

      const bands = edges.slice(1).map(() => ({ left: Infinity, right: -Infinity, chars: [] as number[] }));
      let spanning = 0;
      for (const line of lines) {
        const split = splitLineIntoColumns(line.items, gutters);
        if (split.spans) {
          spanning++;
          continue;
        }
        split.cols.forEach((runs: any[], c: number) => {
          if (!runs?.length) return;
          const b = bands[c];
          b.left = Math.min(b.left, ...runs.map(runLeft));
          b.right = Math.max(b.right, ...runs.map(runRight));
          b.chars.push(runs.map((r) => r.str).join("").replace(/[^\p{L}\p{N}]/gu, "").length);
        });
      }

      console.log(`spanning lines (excluded from the measurement): ${spanning}/${lines.length}\n`);
      console.log("band  lines   fill   meanChars   verdict            (need fill>=0.65, chars>=10)");
      bands.forEach((b, c) => {
        const width = edges[c + 1] - edges[c];
        const fill = (b.right - b.left) / width;
        const mean = b.chars.reduce((s, n) => s + n, 0) / (b.chars.length || 1);
        const ok = b.chars.length > 0 && fill >= 0.65 && mean >= 10;
        console.log(
          `  ${c}   ${String(b.chars.length).padStart(5)}  ${fill.toFixed(3)}  ${mean.toFixed(2).padStart(9)}   ${
            ok ? "prose-like" : "REJECTS THE PAGE"
          }`,
        );
      });
      console.log(`\nguard verdict: ${columnsLookLikeProse(lines, gutters) ? "PROSE" : "TABLE (no reordering)"}`);

      // What each ordering actually yields.
      const colText: string[][] = bands.map(() => []);
      const rowText: string[] = [];
      for (const line of lines) {
        const split = splitLineIntoColumns(line.items, gutters);
        const whole = line.items.map((i: any) => i.str).join(" ").replace(/\s+/g, " ").trim();
        if (split.spans) {
          rowText.push(whole);
          continue;
        }
        rowText.push(whole);
        split.cols.forEach((runs: any[], c: number) => {
          if (runs?.length) colText[c].push(runs.map((r) => r.str).join(" ").replace(/\s+/g, " ").trim());
        });
      }

      console.log("\n--- ROW-MAJOR (what the loader emits today when the guard rejects) ---");
      for (const t of rowText.slice(0, 26)) console.log(`  ${t.slice(0, 96)}`);
      console.log("\n--- COLUMN-MAJOR (what the loader would emit if the guard passed) ---");
      colText.forEach((col, c) => {
        console.log(`  [band ${c}]`);
        for (const t of col.slice(0, 14)) console.log(`    ${t.slice(0, 90)}`);
      });
      return "";
    },
  }).catch((e: any) => console.error("pdf-parse:", e.message));
}

main();
