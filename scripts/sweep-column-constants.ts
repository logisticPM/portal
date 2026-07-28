/**
 * Sweep COLUMN_GUTTER_RATIO / MIN_COLUMN_ROWS across the whole local RAP corpus.
 *
 * WHY. Both constants were measured against a single document (Bank of Canada).
 * A constant fitted to one document is indistinguishable from a constant tuned
 * to it. This re-measures the plateau over seven real documents: if 0.12 still
 * sits in a flat band where the columnar-page classification does not move, it
 * is a threshold; if the classification shifts under it, it was a fit.
 *
 * HOW. Glyph geometry is extracted ONCE per document and cached, then detection
 * is re-run over that cache for each candidate value. The candidate values are
 * injected by writing a patched COPY of textlayer.ts next to the original (so
 * its relative imports still resolve) and importing that — the real module is
 * never modified.
 *
 * Usage: npx tsx scripts/sweep-column-constants.ts <dir-of-pdfs>
 */
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: npx tsx scripts/sweep-column-constants.ts <dir-of-pdfs>");
  process.exit(1);
}

const MODULE = "src/lib/rap/doc-loader/textlayer.ts";
const RATIOS = [0.06, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.15, 0.18, 0.22, 0.28];
const ROWS = [2, 3, 4, 5];

type Page = { doc: string; page: number; lines: any[] };

/** Extract per-page bucketed lines once per document. */
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

/** Write a patched copy of the loader and import it. */
async function patched(ratio: number, rows: number) {
  const src = readFileSync(MODULE, "utf8");
  // Check each pattern MATCHES rather than comparing the whole string: at the
  // current values (0.12 / 3) a correct substitution is a no-op, and comparing
  // whole strings reports that identity case as a failure.
  const RATIO_RE = /const COLUMN_GUTTER_RATIO = [0-9.]+;/;
  const ROWS_RE = /const MIN_COLUMN_ROWS = [0-9]+;/;
  if (!RATIO_RE.test(src) || !ROWS_RE.test(src)) {
    throw new Error("constant declaration not found — the loader was refactored, update the patterns");
  }
  const next = src
    .replace(RATIO_RE, `const COLUMN_GUTTER_RATIO = ${ratio};`)
    .replace(ROWS_RE, `const MIN_COLUMN_ROWS = ${rows};`);
  const tmp = `src/lib/rap/doc-loader/__sweep_${String(ratio).replace(".", "_")}_${rows}.ts`;
  writeFileSync(tmp, next);
  try {
    // Cache-bust so repeated imports of the same path are not deduped.
    return { mod: await import(`../${tmp}?v=${ratio}-${rows}`), tmp };
  } catch (e) {
    unlinkSync(tmp);
    throw e;
  }
}

async function main() {
  const base = await import("../src/lib/rap/doc-loader/textlayer");
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();

  process.stderr.write("extracting geometry once per document…\n");
  const pages: Page[] = [];
  for (const f of files) pages.push(...(await geometry(join(dir, f), base.bucketIntoLines)));
  process.stderr.write(`cached ${pages.length} pages from ${files.length} documents\n\n`);

  const label = (r: number, n: number) => `ratio=${r.toFixed(2)} rows=${n}`;
  const results: { key: string; raw: number; prose: number; sig: string }[] = [];

  for (const rows of ROWS) {
    for (const ratio of RATIOS) {
      const { mod, tmp } = await patched(ratio, rows);
      let raw = 0;
      let prose = 0;
      const sig: string[] = [];
      for (const p of pages) {
        const g = mod.detectColumnGutters(p.lines);
        if (g.length === 0) continue;
        raw++;
        if (mod.columnsLookLikeProse(p.lines, g)) {
          prose++;
          sig.push(`${p.doc.slice(0, 4)}${p.page}:${g.length}`);
        }
      }
      unlinkSync(tmp);
      results.push({ key: label(ratio, rows), raw, prose, sig: sig.join(",") });
    }
  }

  // Group by the SET of reordered pages: identical signature = same behaviour.
  console.log("ratio  rows  rawGutterPages  reorderedPages  behaviourClass");
  const classes = new Map<string, number>();
  for (const r of results) {
    if (!classes.has(r.sig)) classes.set(r.sig, classes.size + 1);
    const [ratio, rowsPart] = r.key.split(" ");
    console.log(
      `${ratio.split("=")[1].padStart(5)}  ${rowsPart.split("=")[1].padStart(4)}  ${String(r.raw).padStart(14)}  ${String(
        r.prose,
      ).padStart(14)}  ${String(classes.get(r.sig)).padStart(2)}`,
    );
  }
  console.log(`\n${classes.size} distinct behaviour classes across ${results.length} settings.`);
}

main();
