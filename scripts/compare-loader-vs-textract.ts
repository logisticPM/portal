/**
 * Cross-engine check: the text-layer loader vs Textract LAYOUT, on one PDF.
 *
 * Textract LAYOUT is an INDEPENDENT, layout-aware reading of the same document.
 * It is not ground truth — it is another engine with its own errors — but its
 * errors are uncorrelated with ours, which is what makes it useful. It cannot
 * certify the loader; it localises disagreement, so a human verifies a short
 * list of pages instead of reading the whole document.
 *
 * Column reordering changes two observable things: which PAGE a sentence lands
 * on, and the ORDER sentences appear in. Textract resolves columns itself, so
 * it is a genuine reference for both.
 *
 * Reads a committed fixture — no AWS session, no Textract spend. See
 * scripts/build-textract-reference.ts to regenerate one, and
 * scripts/tune-against-textract.ts to sweep a constant against all of them.
 *
 * Usage: npx tsx scripts/compare-loader-vs-textract.ts <pdf> <reference.json>
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { extractPagesFromPdf, buildTextFromPages } from "../src/lib/rap/doc-loader/textlayer";
import { referenceUnits, hashKey } from "./lib/reference-units";

const [pdf, refFile] = process.argv.slice(2);
if (!pdf || !refFile) {
  console.error("usage: npx tsx scripts/compare-loader-vs-textract.ts <pdf> <reference.json>");
  process.exit(1);
}

/** Kendall tau distance (adjacent transpositions), normalised. */
function orderDistance(seq: number[]) {
  let n = 0;
  for (let i = 0; i < seq.length; i++) for (let j = i + 1; j < seq.length; j++) if (seq[i] > seq[j]) n++;
  const max = (seq.length * (seq.length - 1)) / 2;
  return { n, max, rate: max > 0 ? n / max : 0 };
}

async function main() {
  const fx = JSON.parse(readFileSync(refFile, "utf8"));
  const byHash = new Map<string, number[]>();
  for (const u of fx.units) (byHash.get(u.h) ?? byHash.set(u.h, []).get(u.h)!).push(u.page);
  const unique = new Map([...byHash].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
  const rank = new Map<string, number>(fx.units.map((u: any) => [u.h, u.i]));

  const ours = referenceUnits(buildTextFromPages(await extractPagesFromPdf(new Uint8Array(readFileSync(pdf)))));

  const seen = new Set<string>();
  const shared: { h: string; refPage: number; ourPage: number }[] = [];
  for (const u of ours) {
    const h = hashKey(u.key);
    const rp = unique.get(h);
    if (rp === undefined || seen.has(h)) continue;
    seen.add(h);
    shared.push({ h, refPage: rp, ourPage: u.page });
  }

  const agree = shared.filter((s) => s.refPage === s.ourPage);
  const disagree = shared.filter((s) => s.refPage !== s.ourPage);

  console.log(`\n=== ${basename(pdf)} vs ${fx.engine} (${fx.region}) ===`);
  console.log(`  reference sentences: ${fx.units.length}  (${unique.size} unique)`);
  console.log(`  loader sentences:    ${ours.length}`);
  console.log(`  matched in both:     ${shared.length}`);
  if (shared.length === 0) return console.log("  no shared sentences — cannot compare");

  console.log(`\n  PAGE AGREEMENT: ${agree.length}/${shared.length} (${((agree.length / shared.length) * 100).toFixed(1)}%)`);
  if (disagree.length) {
    const byPair = new Map<string, number>();
    for (const d of disagree) {
      const k = `ours p${d.ourPage} vs ref p${d.refPage}`;
      byPair.set(k, (byPair.get(k) ?? 0) + 1);
    }
    for (const [k, n] of [...byPair].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${n}`);
  }

  const whole = orderDistance(shared.map((s) => rank.get(s.h)!).filter((v) => v !== undefined));
  console.log(`\n  ORDER (whole doc): ${whole.n}/${whole.max} inverted pairs = ${(whole.rate * 100).toFixed(2)}%`);
  console.log("  per page (>=4 sentences):");
  for (const p of [...new Set(shared.map((s) => s.ourPage))].sort((a, b) => a - b)) {
    const onPage = shared.filter((s) => s.ourPage === p && s.refPage === p);
    if (onPage.length < 4) continue;
    const d = orderDistance(onPage.map((s) => rank.get(s.h)!).filter((v) => v !== undefined));
    console.log(
      `    p${String(p).padStart(2)}  ${String(onPage.length).padStart(3)} sentences  ${(d.rate * 100).toFixed(1)}%${
        d.rate > 0.15 ? "   <-- ORDER DIVERGES, inspect" : ""
      }`,
    );
  }
}

main();
