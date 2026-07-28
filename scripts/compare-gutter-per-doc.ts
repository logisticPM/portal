/**
 * Per-document page classification under the shipped criterion vs the
 * font-relative candidate.
 *
 * The binding constraint is NOT stability — it is that Bank of Canada's four
 * columnar pages (7, 8, 13, 15) keep being reordered, because those pages carry
 * the gold-set commitments and the 22/22 acceptance depends on them. A more
 * stable constant that loses them is not an improvement.
 *
 * Usage: npx tsx scripts/compare-gutter-per-doc.ts <dir-of-pdfs>
 */
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

const dir = process.argv[2];
const MODULE = "src/lib/rap/doc-loader/textlayer.ts";
const SHIPPED_LINE = "  const minGutter = textWidth * COLUMN_GUTTER_RATIO;";
const KS = [1.75, 2.0, 2.25, 2.5, 3.0, 3.5];

type Page = { doc: string; page: number; lines: any[] };

async function geometry(file: string, bucket: (i: any[]) => any[]): Promise<Page[]> {
  const out: Page[] = [];
  await (pdfParse as any)(new Uint8Array(readFileSync(file)), {
    pagerender: async (pageData: any) => {
      const content = await pageData.getTextContent();
      const items = content.items
        .map((it: any) => ({ str: it.str, transform: it.transform, width: it.width }))
        .filter((i: any) => i.str.trim().length > 0);
      out.push({ doc: basename(file), page: pageData.pageIndex + 1, lines: bucket(items) });
      return "";
    },
  }).catch(() => {});
  return out;
}

async function withPatch(tag: string, mutate: (s: string) => string) {
  const src = readFileSync(MODULE, "utf8");
  if (!src.includes(SHIPPED_LINE)) throw new Error("anchor line not found — update SHIPPED_LINE");
  const tmp = `src/lib/rap/doc-loader/__cmp_${tag}.ts`;
  writeFileSync(tmp, mutate(src));
  try {
    return { mod: await import(`../${tmp}?v=${tag}`), tmp };
  } catch (e) {
    unlinkSync(tmp);
    throw e;
  }
}

function reorderedPages(mod: any, pages: Page[], doc: string): number[] {
  const out: number[] = [];
  for (const p of pages) {
    if (p.doc !== doc) continue;
    const g = mod.detectColumnGutters(p.lines);
    if (g.length > 0 && mod.columnsLookLikeProse(p.lines, g)) out.push(p.page);
  }
  return out.sort((a, b) => a - b);
}

async function main() {
  const base = await import("../src/lib/rap/doc-loader/textlayer");
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  const pages: Page[] = [];
  for (const f of files) pages.push(...(await geometry(join(dir, f), base.bucketIntoLines)));

  const docs = [...new Set(pages.map((p) => p.doc))].sort();
  const settings: { label: string; mod: any }[] = [];

  const shipped = await withPatch("shipped", (s) => s);
  settings.push({ label: "A 0.12 (shipped)", mod: shipped.mod });

  const tmps = [shipped.tmp];
  for (const k of KS) {
    const { mod, tmp } = await withPatch(`k${String(k).replace(".", "_")}`, (s) =>
      s.replace(
        SHIPPED_LINE,
        [
          "  const __sizes = all.map(approxFontSize).sort((a, b) => a - b);",
          "  const __med = __sizes[Math.floor(__sizes.length / 2)] || 12;",
          `  const minGutter = __med * ${k};`,
        ].join("\n"),
      ),
    );
    settings.push({ label: `B K=${k}`, mod });
    tmps.push(tmp);
  }

  const BOC = "BankOfCanada_RAP.pdf";
  const GOLD_COLUMNAR = [7, 8, 13, 15];

  for (const doc of docs) {
    console.log(`\n=== ${doc} ===`);
    for (const s of settings) {
      const got = reorderedPages(s.mod, pages, doc);
      let note = "";
      if (doc === BOC) {
        const missing = GOLD_COLUMNAR.filter((p) => !got.includes(p));
        const extra = got.filter((p) => !GOLD_COLUMNAR.includes(p));
        note =
          missing.length === 0 && extra.length === 0
            ? "   <== matches the accepted 22/22 set"
            : `   MISSING ${missing.join(",") || "none"}  EXTRA ${extra.join(",") || "none"}`;
      }
      console.log(`  ${s.label.padEnd(17)} ${got.length ? got.join(",") : "(none)"}${note}`);
    }
  }
  for (const t of tmps) unlinkSync(t);
}

main();
