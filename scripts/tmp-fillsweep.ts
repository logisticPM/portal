/** Sweep MIN_BAND_FILL_RATIO against the Textract reference. */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { basename } from "node:path";
import { referenceUnits, hashKey } from "./lib/reference-units";
const MODULE = "src/lib/rap/doc-loader/textlayer.ts";
const VALUES = [0.5, 0.55, 0.57, 0.6, 0.62, 0.65, 0.7];
const pairs = process.argv.slice(2).map((a) => { const i = a.lastIndexOf("="); return { pdf: a.slice(0, i), ref: a.slice(i + 1) }; });
function inv(seq: number[]) { let n = 0; for (let i = 0; i < seq.length; i++) for (let j = i + 1; j < seq.length; j++) if (seq[i] > seq[j]) n++; return { n, max: (seq.length * (seq.length - 1)) / 2 }; }
async function load(v: number) {
  const src = readFileSync(MODULE, "utf8");
  const RE = /const MIN_BAND_FILL_RATIO = [0-9.]+;/;
  if (!RE.test(src)) throw new Error("MIN_BAND_FILL_RATIO not found");
  const tag = String(v).replace(".", "_");
  const tmp = `src/lib/rap/doc-loader/__fill_${tag}.ts`;
  writeFileSync(tmp, src.replace(RE, `const MIN_BAND_FILL_RATIO = ${v};`));
  try { return { mod: await import(`../${tmp}?v=${tag}`), tmp }; } catch (e) { unlinkSync(tmp); throw e; }
}
async function main() {
  const refs = pairs.map((p) => {
    const fx = JSON.parse(readFileSync(p.ref, "utf8"));
    const by = new Map<string, number[]>();
    for (const u of fx.units) (by.get(u.h) ?? by.set(u.h, []).get(u.h)!).push(u.page);
    return { name: basename(p.pdf).slice(0, 9), bytes: new Uint8Array(readFileSync(p.pdf)),
      unique: new Map([...by].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]])),
      rank: new Map<string, number>(fx.units.map((u: any) => [u.h, u.i])) };
  });
  for (const v of VALUES) {
    const { mod, tmp } = await load(v);
    let A = 0, S = 0, N = 0, M = 0;
    for (const r of refs) {
      const ours = referenceUnits(mod.buildTextFromPages(await mod.extractPagesFromPdf(r.bytes)));
      const seen = new Set<string>(); const sh: any[] = [];
      for (const u of ours) { const h = hashKey(u.key); const rp = r.unique.get(h); if (rp === undefined || seen.has(h)) continue; seen.add(h); sh.push({ h, ref: rp, our: u.page }); }
      A += sh.filter((s) => s.ref === s.our).length; S += sh.length;
      for (const pg of new Set(sh.map((s) => s.our))) { const on = sh.filter((s) => s.our === pg && s.ref === pg); const i2 = inv(on.map((s) => r.rank.get(s.h)!).filter((x) => x !== undefined)); N += i2.n; M += i2.max; }
    }
    unlinkSync(tmp);
    console.log(` fill=${v.toFixed(2)}   ${A}/${S} placed   order disagreement ${((N / M) * 100).toFixed(2)}%`);
  }
}
main();
