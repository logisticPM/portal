// Consumes a human double-coded gold file and reports accuracy (spec §6). Honest
// degradation: if the gold file is absent, prints "unvalidated" and exits 0.
import { promises as fs } from "node:fs";
import { prf1, cohenKappa, pabak, wilsonInterval } from "../src/lib/cases/validate/metrics";
import { ALL_THEMES } from "../src/lib/cases/ingest/rubric";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import type { Theme } from "../src/lib/cases/types";

const GOLD = "docs/research/gold/cases-gold.jsonl";
interface Gold { citation: string; includedTrue: boolean; themesCoderA: Theme[]; themesCoderB: Theme[]; }

async function main() {
  let lines: string[];
  try { lines = (await fs.readFile(GOLD, "utf8")).trim().split(/\n+/).filter(Boolean); }
  catch { console.log("ℹ️  no gold sample — accuracy UNVALIDATED (exploratory corpus)."); return; }
  const gold = lines.map((l) => JSON.parse(l) as Gold);

  // inter-coder reliability per theme (binary present/absent), averaged
  let kSum = 0, poSum = 0;
  for (const t of ALL_THEMES) {
    const a = gold.map((g) => (g.themesCoderA.includes(t) ? "1" : "0"));
    const b = gold.map((g) => (g.themesCoderB.includes(t) ? "1" : "0"));
    kSum += cohenKappa(a, b);
    poSum += a.filter((x, i) => x === b[i]).length / a.length;
  }
  console.log(`inter-coder mean kappa=${(kSum / ALL_THEMES.length).toFixed(3)} PABAK=${pabak(poSum / ALL_THEMES.length).toFixed(3)}`);

  // labeling accuracy: machine themes vs human consensus (both coders agree)
  let TP = 0, FP = 0, FN = 0, offTopic = 0;
  for (const g of gold) {
    const consensus = new Set(g.themesCoderA.filter((t) => g.themesCoderB.includes(t)));
    const machine = (await dynamoCaseRepo.getCase(g.citation.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")))?.themes ?? [];
    for (const t of machine) (consensus.has(t) ? TP++ : FP++);
    for (const t of consensus) if (!machine.includes(t)) FN++;
    if (!g.includedTrue) offTopic++;
  }
  const m = prf1(TP, FP, FN);
  console.log(`theme labels: P=${m.precision.toFixed(2)} R=${m.recall.toFixed(2)} F1=${m.f1.toFixed(2)}`);
  const w = wilsonInterval(offTopic, gold.length);
  console.log(`corpus off-topic rate=${(w.p * 100).toFixed(1)}% (Wilson 95% CI [${(w.lower * 100).toFixed(1)}%, ${(w.upper * 100).toFixed(1)}%], n=${gold.length})`);
}
main().catch((e) => { console.error("❌ cases-validate failed:", e); process.exit(1); });
