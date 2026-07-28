/**
 * Compare two criteria for "is this horizontal gap a column gutter?"
 *
 *   A (shipped)   minGutter = pageTextWidth * COLUMN_GUTTER_RATIO
 *   B (candidate) minGutter = medianFontSize * K
 *
 * WHY. A is page-relative, and this corpus spans text-block widths from ~533pt
 * (Deloitte) to ~1124pt (RBC two-page spreads). One ratio therefore means a
 * 64pt minimum gutter on one document and a 135pt minimum on another, for the
 * same typography. Typographers set a gutter relative to TYPE SIZE (roughly
 * 1-2 em), which is what B measures, and B is scale-free across page sizes.
 *
 * The test is not "which finds more columns" — it is which one has a PLATEAU:
 * a band of values over which the set of reordered pages does not move. A
 * constant with no plateau is fitted to whatever document produced it.
 *
 * Usage: npx tsx scripts/sweep-gutter-criterion.ts <dir-of-pdfs>
 */
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: npx tsx scripts/sweep-gutter-criterion.ts <dir-of-pdfs>");
  process.exit(1);
}

const MODULE = "src/lib/rap/doc-loader/textlayer.ts";
const SHIPPED_LINE = "  const minGutter = textWidth * COLUMN_GUTTER_RATIO;";
const RATIOS = [0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.18, 0.2];
const KS = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 3.0, 3.5, 4.0, 5.0];

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

/** Write a patched copy of the loader (relative imports still resolve) and import it. */
async function withPatch(tag: string, mutate: (src: string) => string) {
  const src = readFileSync(MODULE, "utf8");
  if (!src.includes(SHIPPED_LINE)) {
    throw new Error(`anchor line not found in ${MODULE} — update SHIPPED_LINE`);
  }
  const tmp = `src/lib/rap/doc-loader/__crit_${tag}.ts`;
  writeFileSync(tmp, mutate(src));
  try {
    return { mod: await import(`../${tmp}?v=${tag}`), tmp };
  } catch (e) {
    unlinkSync(tmp);
    throw e;
  }
}

/**
 * Per-page outcome under a given module. Keyed by page so two settings can be
 * compared page-by-page: an all-or-nothing "did anything change" verdict is
 * useless across 166 pages, because a single page moving anywhere makes two
 * otherwise-identical settings look unrelated. What matters is CHURN — how many
 * pages change their reading order — and a plateau is a band where churn is 0.
 */
function outcomes(mod: any, pages: Page[]) {
  const byPage = new Map<string, number>(); // page key -> gutters applied (0 = read as-is)
  let raw = 0;
  for (const p of pages) {
    const g = mod.detectColumnGutters(p.lines);
    if (g.length > 0) raw++;
    const applied = g.length > 0 && mod.columnsLookLikeProse(p.lines, g) ? g.length : 0;
    byPage.set(`${p.doc.slice(0, 5)}${p.page}`, applied);
  }
  const reordered = [...byPage.values()].filter((v) => v > 0).length;
  return { raw, reordered, byPage };
}

/** Pages whose applied-gutter count differs between two settings. */
function churn(a: Map<string, number>, b: Map<string, number>) {
  let n = 0;
  for (const [k, v] of a) if ((b.get(k) ?? 0) !== v) n++;
  return n;
}

function report(
  title: string,
  rows: { label: string; raw: number; reordered: number; byPage: Map<string, number> }[],
) {
  console.log(`\n=== ${title} ===`);
  console.log("  value    rawPages  reordered   churn-vs-prev");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c = i === 0 ? "-" : String(churn(rows[i - 1].byPage, r.byPage));
    console.log(
      `  ${r.label.padStart(6)}  ${String(r.raw).padStart(8)}  ${String(r.reordered).padStart(9)}   ${c.padStart(6)}${
        i > 0 && c === "0" ? "   <- stable" : ""
      }`,
    );
  }
  // Total churn across the swept band is the single comparable number: how many
  // page-level decisions are at the mercy of where the constant is set.
  let total = 0;
  for (let i = 1; i < rows.length; i++) total += churn(rows[i - 1].byPage, rows[i].byPage);
  console.log(`  total churn across the band: ${total} page-changes`);
}

async function main() {
  const base = await import("../src/lib/rap/doc-loader/textlayer");
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  process.stderr.write("extracting geometry once per document…\n");
  const pages: Page[] = [];
  for (const f of files) pages.push(...(await geometry(join(dir, f), base.bucketIntoLines)));
  process.stderr.write(`cached ${pages.length} pages from ${files.length} documents\n`);

  const aRows = [];
  for (const ratio of RATIOS) {
    const tag = `a${String(ratio).replace(".", "_")}`;
    const { mod, tmp } = await withPatch(tag, (s) =>
      s.replace(/const COLUMN_GUTTER_RATIO = [0-9.]+;/, `const COLUMN_GUTTER_RATIO = ${ratio};`),
    );
    aRows.push({ label: ratio.toFixed(2), ...outcomes(mod, pages) });
    unlinkSync(tmp);
  }

  const bRows = [];
  for (const k of KS) {
    const tag = `b${String(k).replace(".", "_")}`;
    const { mod, tmp } = await withPatch(tag, (s) =>
      s.replace(
        SHIPPED_LINE,
        [
          "  const __sizes = all.map(approxFontSize).sort((a, b) => a - b);",
          "  const __med = __sizes[Math.floor(__sizes.length / 2)] || 12;",
          `  const minGutter = __med * ${k};`,
        ].join("\n"),
      ),
    );
    bRows.push({ label: k.toFixed(2), ...outcomes(mod, pages) });
    unlinkSync(tmp);
  }

  report("A (shipped): minGutter = pageTextWidth * ratio", aRows);
  report("B (candidate): minGutter = medianFontSize * K", bRows);
}

main();
