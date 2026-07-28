/**
 * Dump one page's column geometry and the text the loader would produce for it.
 *
 * Used to check the prose-likeness guard by eye: does a page the guard called
 * "prose" (and therefore reordered column-major) actually read as prose?
 *
 * Usage: npx tsx scripts/dump-page-columns.ts <pdf> <page-number>
 */
import { readFileSync } from "node:fs";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import {
  bucketIntoLines,
  detectColumnGutters,
  columnsLookLikeProse,
  splitLineIntoColumns,
  groupItemsIntoParagraphs,
} from "../src/lib/rap/doc-loader/textlayer";

const [file, pageArg] = process.argv.slice(2);
if (!file || !pageArg) {
  console.error("usage: npx tsx scripts/dump-page-columns.ts <pdf> <page-number>");
  process.exit(1);
}
const wanted = Number(pageArg);

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
      // Raw geometric gutters — see the note in profile-corpus.ts on why
      // detectColumnBoundaries cannot be used to interrogate the guard.
      const gutters = detectColumnGutters(lines);
      const prose = gutters.length > 0 ? columnsLookLikeProse(lines, gutters) : false;

      const xs = items.map((i: any) => i.transform[4]);
      console.log(`page ${wanted}: ${items.length} items, ${lines.length} lines`);
      console.log(`x range: ${Math.min(...xs).toFixed(0)} .. ${Math.max(...xs).toFixed(0)}`);
      console.log(`gutters: ${gutters.length ? gutters.map((g: any) => JSON.stringify(g)).join(" ") : "none"}`);
      console.log(`prose guard: ${prose ? "PROSE -> reordered column-major" : "TABLE -> left as-is"}`);

      console.log("\n--- per-line, split at the detected gutters ---");
      for (const ln of lines.slice(0, 60)) {
        const split = gutters.length
          ? splitLineIntoColumns(ln.items, gutters)
          : ({ spans: false, cols: [ln.items] } as const);
        if (split.spans) {
          const whole = ln.items.map((i: any) => i.str).join("").trim();
          console.log(`y=${ln.y.toFixed(0).padStart(4)} | SPANS: ${whole.slice(0, 96)}`);
          continue;
        }
        const rendered = Array.from({ length: gutters.length + 1 }, (_, c) => split.cols[c] ?? [])
          .map((c: any[]) => c.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim())
          .map((s: string) => (s.length > 44 ? s.slice(0, 41) + "..." : s).padEnd(44));
        console.log(`y=${ln.y.toFixed(0).padStart(4)} | ${rendered.join(" ‖ ")}`);
      }
      if (lines.length > 60) console.log(`… ${lines.length - 60} more lines`);

      console.log("\n--- paragraphs the loader emits for this page ---");
      for (const p of groupItemsIntoParagraphs(items)) {
        console.log(`  • ${p.length > 160 ? p.slice(0, 157) + "..." : p}`);
      }
      return "";
    },
  }).catch((e: any) => console.error("pdf-parse:", e.message));
}

main();
