// Score candidate models against the quote-verified gold set.
//
// Reports three numbers per model. Polarity accuracy is the elimination metric;
// self-consistency is the number this whole design exists to drive down.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { modelFromId, DUAL_LLM_MAX_TOKENS, cachedCall } from "../src/lib/cases/ingest/llm";
import { outcomePrompt, parseOutcome, impliedDirection, contradictsDerivation } from "../src/lib/cases/ingest/outcome-rubric";
import { verifyGoldLabel, type GoldLabel } from "../src/lib/cases/eval/outcome-gold";

const GOLD = path.join(process.cwd(), "docs", "research", "gold", "cases-outcome-gold.jsonl");
const MODELS = (process.env.EVAL_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

async function main() {
  if (!MODELS.length) throw new Error("Set EVAL_MODELS to a comma-separated list of model ids.");
  const lines = (await fs.readFile(GOLD, "utf8")).split("\n").filter((l) => l.trim());
  const labels: GoldLabel[] = lines.map((l) => JSON.parse(l));

  // Load cases and reject unsound labels BEFORE scoring anything.
  const usable: { g: GoldLabel; style: string; chunks: any[] }[] = [];
  for (const g of labels) {
    const c = await dynamoCaseRepo.getCase(g.caseId);
    if (!c?.chunks) { console.log(`  ✗ ${g.caseId}: no chunks`); continue; }
    const bad = verifyGoldLabel(g, c.chunks);
    if (bad) { console.log(`  ✗ ${g.caseId}: ${bad}`); continue; }
    usable.push({ g, style: c.styleOfCause, chunks: c.chunks });
  }
  console.log(`\ngold: ${usable.length} usable of ${labels.length}\n`);
  if (!usable.length) return;

  for (const id of MODELS) {
    const m = modelFromId(id, { maxTokens: DUAL_LLM_MAX_TOKENS });
    let polarityOk = 0, polarityBad = 0, abstain = 0, selfContra = 0, errored = 0;
    for (const { g, style, chunks } of usable) {
      let r;
      try { r = parseOutcome(await cachedCall(m, outcomePrompt(style, chunks))); }
      catch { errored++; continue; }
      if (r.derivation && contradictsDerivation(r.winType, r.derivation)) selfContra++;
      if (r.winType === "unclassified") { abstain++; continue; }
      const want = impliedDirection({ movingPartyIsIndigenous: g.movingPartyIsIndigenous, granted: g.granted });
      const gotWin = r.winType === "party_win" || r.winType === "doctrine_win";
      if (want === "partly" || r.winType === "mixed") continue;
      if ((want === "prevailed") === gotWin) polarityOk++; else polarityBad++;
    }
    const scored = polarityOk + polarityBad;
    const pct = (n: number) => scored ? `${((n / scored) * 100).toFixed(1)}%` : "n/a";
    console.log(`### ${id}`);
    console.log(`    polarity  ${polarityOk}/${scored} (${pct(polarityOk)})  · INVERTED ${polarityBad}`);
    console.log(`    coverage  ${usable.length - abstain - errored}/${usable.length}  · abstained ${abstain} · errors ${errored}`);
    console.log(`    self-contradictions ${selfContra}\n`);
  }
}
main().catch((e) => { console.error("❌ cases-outcome-eval failed:", e); process.exit(1); });
