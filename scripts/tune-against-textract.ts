/**
 * Tune COLUMN_GUTTER_RATIO against an INDEPENDENT reference.
 *
 * THE PROBLEM THIS SOLVES. Only one document (Bank of Canada) has a
 * human-verified gold set, and scoring the extractor against its own output
 * would be circular — it would score well and measure nothing. Textract LAYOUT
 * breaks the deadlock: it resolves columns by a completely different mechanism
 * (a vision model over the rendered page, not glyph geometry), so its reading
 * order is an independent opinion on the same question. It is NOT ground truth
 * and carries its own errors — but those errors are uncorrelated with ours,
 * which is all a reference has to be to carry signal.
 *
 * THE TWO METRICS, and why the obvious one is a trap:
 *
 *   - AGREEING SENTENCES (absolute). Sentences both engines recovered AND
 *     placed on the same page. This is the recall-bearing number and the
 *     primary objective.
 *   - WITHIN-PAGE ORDER DISAGREEMENT. Adjacent transpositions between the two
 *     readings, pooled over pages, as a share of orderable pairs. Restricted to
 *     same-page pairs because page order is never in question — column order
 *     within a page is exactly what this constant controls.
 *
 *   The trap is the RATIO agreeing/matched. It rises as the loader recovers
 *   LESS text, because a smaller matched set is easier to agree on. Measured:
 *   ratio 0.20 scores 99.8% on 435 sentences while 0.12 scores 99.2% on 505 —
 *   0.12 places 67 more sentences correctly. Never optimise the percentage.
 *
 * Reads committed fixtures (scripts/fixtures/textract-reference/), so it needs
 * no AWS session and no Textract spend. Regenerate one with
 * scripts/build-textract-reference.ts if the loader's page-marker format changes.
 *
 * Usage: npx tsx scripts/tune-against-textract.ts <pdf>=<reference.json> [...]
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { basename } from "node:path";
import { referenceUnits, hashKey } from "./lib/reference-units";

const MODULE = "src/lib/rap/doc-loader/textlayer.ts";
const RATIOS = [0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.18, 0.2];

const pairs = process.argv.slice(2).map((a) => {
  const i = a.lastIndexOf("=");
  return { pdf: a.slice(0, i), ref: a.slice(i + 1) };
});
if (pairs.length === 0) {
  console.error("usage: npx tsx scripts/tune-against-textract.ts <pdf>=<reference.json> [...]");
  process.exit(1);
}

function inversions(seq: number[]) {
  let n = 0;
  for (let i = 0; i < seq.length; i++) for (let j = i + 1; j < seq.length; j++) if (seq[i] > seq[j]) n++;
  return { n, max: (seq.length * (seq.length - 1)) / 2 };
}

/** Order disagreement measured within each page and pooled — see the header. */
function pagewiseDisagreement(shared: { h: string; ref: number; our: number }[], rank: Map<string, number>) {
  let n = 0;
  let max = 0;
  for (const page of new Set(shared.map((s) => s.our))) {
    const onPage = shared.filter((s) => s.our === page && s.ref === page);
    const inv = inversions(onPage.map((s) => rank.get(s.h)!).filter((v) => v !== undefined));
    n += inv.n;
    max += inv.max;
  }
  return { n, max, rate: max > 0 ? n / max : 0 };
}

async function patched(ratio: number) {
  const src = readFileSync(MODULE, "utf8");
  const RE = /const COLUMN_GUTTER_RATIO = [0-9.]+;/;
  if (!RE.test(src)) throw new Error("COLUMN_GUTTER_RATIO declaration not found — loader refactored?");
  const tag = String(ratio).replace(".", "_");
  const tmp = `src/lib/rap/doc-loader/__tune_${tag}.ts`;
  writeFileSync(tmp, src.replace(RE, `const COLUMN_GUTTER_RATIO = ${ratio};`));
  try {
    return { mod: await import(`../${tmp}?v=${tag}`), tmp };
  } catch (e) {
    unlinkSync(tmp);
    throw e;
  }
}

async function main() {
  const refs = pairs.map((p) => {
    const fx = JSON.parse(readFileSync(p.ref, "utf8"));
    const byHash = new Map<string, number[]>();
    for (const u of fx.units) (byHash.get(u.h) ?? byHash.set(u.h, []).get(u.h)!).push(u.page);
    return {
      name: basename(p.pdf).replace(/\.pdf$/i, ""),
      bytes: new Uint8Array(readFileSync(p.pdf)),
      // Sentences appearing twice cannot adjudicate a page or a position.
      unique: new Map([...byHash].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]])),
      rank: new Map<string, number>(fx.units.map((u: any) => [u.h, u.i])),
    };
  });

  console.log(`\nratio  ${refs.map((r) => r.name.slice(0, 11).padEnd(15)).join("")}  TOTAL`);
  const rows: { ratio: number; agree: number; shared: number; n: number; max: number }[] = [];

  for (const ratio of RATIOS) {
    const { mod, tmp } = await patched(ratio);
    let tAgree = 0;
    let tShared = 0;
    let tN = 0;
    let tMax = 0;
    const cells: string[] = [];
    for (const r of refs) {
      const ours = referenceUnits(mod.buildTextFromPages(await mod.extractPagesFromPdf(r.bytes)));
      const seen = new Set<string>();
      const shared: { h: string; ref: number; our: number }[] = [];
      for (const u of ours) {
        const h = hashKey(u.key);
        const rp = r.unique.get(h);
        if (rp === undefined || seen.has(h)) continue;
        seen.add(h);
        shared.push({ h, ref: rp, our: u.page });
      }
      const agree = shared.filter((s) => s.ref === s.our).length;
      const dis = pagewiseDisagreement(shared, r.rank);
      tAgree += agree;
      tShared += shared.length;
      tN += dis.n;
      tMax += dis.max;
      cells.push(`${agree}/${shared.length} ${(dis.rate * 100).toFixed(1)}%`.padEnd(15));
    }
    unlinkSync(tmp);
    rows.push({ ratio, agree: tAgree, shared: tShared, n: tN, max: tMax });
    console.log(
      ` ${ratio.toFixed(2)}  ${cells.join("")}  ${tAgree}/${tShared} pooled-disagree ${((tN / tMax) * 100).toFixed(2)}%`,
    );
  }

  console.log("\nlegend: <sentencesOnCorrectPage>/<sentencesMatched>  <within-page order disagreement>");
  console.log("NOTE: optimise ABSOLUTE agreeing sentences, never the ratio — see the header comment.");
  const byAbs = [...rows].sort((a, b) => b.agree - a.agree || a.n / a.max - b.n / b.max);
  const byOrder = [...rows].sort((a, b) => a.n / a.max - b.n / b.max || b.agree - a.agree);
  const fmt = (r: (typeof rows)[number]) =>
    `ratio=${r.ratio} (${r.agree} sentences, order disagreement ${((r.n / r.max) * 100).toFixed(2)}%)`;
  console.log(`\nmost sentences correctly placed: ${fmt(byAbs[0])}`);
  console.log(`lowest order disagreement:       ${fmt(byOrder[0])}`);
}

main();
