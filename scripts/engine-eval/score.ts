// scripts/engine-eval/score.ts
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CORPUS } from "./corpus";
import type { EngineKey, RunResult } from "./types";
import { scoreAgainstGold, type GoldEntry } from "./gold-score";
import { computeAgreement } from "./agreement";
import { scoreGrounding } from "./grounding";
import { loadLocalDocText, pageText } from "./util";
import { estimateCost } from "./cost";
import { judgeFindings, cohenKappa, buildWorklist, type Finding } from "./judge";
import { openRouterModel } from "./openrouter";
import { modelFromId } from "@/lib/cases/ingest/llm";

const ENGINES: EngineKey[] = ["bda", "textract", "textlayer"];
const resultsDir = resolve(__dirname, "results");
const samplesDir = resolve(process.env.RAP_SAMPLES_DIR ?? "../CS7980/Week 7/rap_samples");
const WORKLIST_CAP = 25;

const estTokens = (chars: number) => Math.ceil(chars / 4);

async function loadRun(docKey: string, engine: EngineKey): Promise<RunResult | null> {
  try { return JSON.parse(await readFile(join(resultsDir, docKey, `${engine}.json`), "utf8")); }
  catch { return null; }
}

async function main() {
  const gold = JSON.parse(await readFile(join(__dirname, "..", "fixtures", "gold-commitments-bankofcanada.json"), "utf8")) as GoldEntry[];
  const rows: string[] = [];
  const allFindings: Finding[] = [];
  const pageTextByDoc = new Map<string, string[][]>();

  // Preload doc text (for grounding + judge windows) once per doc.
  for (const doc of CORPUS) {
    const { pages } = await loadLocalDocText(join(samplesDir, doc.fileName));
    pageTextByDoc.set(doc.key, pages);
  }

  // Per engine × doc: gold (BoC only), grounding, cost, timing; collect findings for judges + agreement.
  const perEngine: Record<EngineKey, { grounding: { q: number; p: number; total: number }; costUSD: number; timeMs: number; commits: number; goldF1: number | null; goldRecall: number | null; goldPrec: number | null }> =
    Object.fromEntries(ENGINES.map((e) => [e, { grounding: { q: 0, p: 0, total: 0 }, costUSD: 0, timeMs: 0, commits: 0, goldF1: null, goldRecall: null, goldPrec: null }])) as never;

  const agreementByDoc: { doc: string; engines: { engine: string; actions: string[] }[] }[] = [];

  for (const doc of CORPUS) {
    const pages = pageTextByDoc.get(doc.key)!;
    const perDocEngines: { engine: string; actions: string[] }[] = [];
    for (const engine of ENGINES) {
      const run = await loadRun(doc.key, engine);
      if (!run || !run.extracted) continue;
      const commits = run.extracted.commitments;
      perEngine[engine].commits += commits.length;
      perEngine[engine].timeMs += run.timingMs;

      // grounding (guardrail: BDA page column marked N/A at report layer)
      const g = scoreGrounding(commits.map((c) => ({ quote: c.action.quote, page: c.action.page })), pages);
      perEngine[engine].grounding.q += g.quotePresent;
      perEngine[engine].grounding.p += g.pagePresent;
      perEngine[engine].grounding.total += g.total;

      // cost estimate (input ≈ doc text ×2 read; output ≈ extracted JSON)
      const inTokens = estTokens(pages.flat().join(" ").length) * 2;
      const outTokens = estTokens(JSON.stringify(commits).length);
      perEngine[engine].costUSD += estimateCost(engine, doc.pages, inTokens, outTokens);

      // gold (BoC only)
      if (doc.isGold) {
        const s = scoreAgainstGold(commits.map((c) => ({ action: { value: c.action.value }, page: c.action.page })), gold);
        perEngine[engine].goldF1 = s.f1; perEngine[engine].goldRecall = s.recall; perEngine[engine].goldPrec = s.precision;
      }

      // findings for judges (non-gold docs only — gold uses the oracle) + agreement (all docs)
      perDocEngines.push({ engine, actions: commits.map((c) => c.action.value ?? "").filter(Boolean) });
      if (!doc.isGold) {
        for (const c of commits) {
          if (!c.action.value) continue;
          allFindings.push({ docKey: doc.key, engine, action: c.action.value, quote: c.action.quote, page: c.action.page });
        }
      }
    }
    agreementByDoc.push({ doc: doc.key, engines: perDocEngines });
  }

  // Dual-judge the non-gold findings (Nova Pro + Kimi K2.5).
  const judgeA = modelFromId(process.env.JUDGE_A_MODEL ?? "us.amazon.nova-pro-v1:0", { maxTokens: 256 });
  const judgeB = openRouterModel(process.env.JUDGE_B_MODEL ?? "moonshotai/kimi-k2.5", { maxTokens: 256 });
  for (const j of [judgeA, judgeB]) {
    if (/claude|anthropic/i.test(j.id)) {
      throw new Error(`Judge model must not be a Claude/Anthropic family (no engine judges itself): ${j.id}`);
    }
  }
  const judged = await judgeFindings(
    allFindings, { id: judgeA.id, call: judgeA.call }, judgeB,
    (f) => pageText(pageTextByDoc.get(f.docKey)!, f.page),
  );
  const kappa = cohenKappa(judged.map((j) => j.verdictA), judged.map((j) => j.verdictB));
  const worklist = buildWorklist(judged, WORKLIST_CAP);

  // Cross-engine relative recall (union), per engine, per doc — absolute counts.
  const agg: Record<string, { found: number; corroborated: number }> = {};
  for (const d of agreementByDoc) {
    const rep = computeAgreement(d.engines);
    for (const pe of rep.perEngine) {
      agg[pe.engine] ??= { found: 0, corroborated: 0 };
      agg[pe.engine].found += pe.found;
      agg[pe.engine].corroborated += pe.corroborated;
    }
  }

  // ---- Emit scorecard.md ----
  rows.push("# RAP Extraction Engine Comparison — Results\n");
  rows.push(`Generated ${new Date().toISOString()} · n=8 (BankOfCanada gold + 7). Dual judges: ${judgeA.id} + ${judgeB.id}. Inter-judge κ = **${kappa.toFixed(3)}**.\n`);
  rows.push("## Scorecard\n");
  rows.push("| Engine | Gold P / R / F1 (BoC) | Grounding: quote-present | Grounding: page-correct | Commitments found | Corroborated (≥2 engines) | Est. cost | Total time |");
  rows.push("|---|---|---|---|---|---|---|---|");
  for (const e of ENGINES) {
    const p = perEngine[e];
    const goldCell = p.goldF1 == null ? "—" : `${(p.goldPrec! * 100).toFixed(0)}% / ${(p.goldRecall! * 100).toFixed(0)}% / ${p.goldF1!.toFixed(2)}`;
    const pageCell = e === "bda" ? "N/A (inferred)" : `${p.grounding.p}/${p.grounding.total}`;
    rows.push(`| ${e} | ${goldCell} | ${p.grounding.q}/${p.grounding.total} | ${pageCell} | ${agg[e]?.found ?? 0} | ${agg[e]?.corroborated ?? 0} | $${p.costUSD.toFixed(2)} | ${(p.timeMs / 1000).toFixed(0)}s |`);
  }
  rows.push("\n> Recall on the 7 non-gold docs is **relative to the union of all engines' finds** — a defect all three miss is invisible here. BDA page numbers are inferred and are never used as a page reference. All figures are absolute counts, not agreement ratios.\n");
  rows.push(`## Judge adjudication\n\n${judged.length} findings judged; ${judged.filter((j) => !j.agree).length} disagreements → worklist (capped ${WORKLIST_CAP}). Open \`results/worklist.html\` to resolve.\n`);

  await writeFile(resolve(__dirname, "..", "..", "docs", "rap-engine-comparison.md"), rows.join("\n"));

  // ---- Emit worklist.html ----
  const items = worklist.map((w) => `<li><b>${w.docKey} / ${w.engine}</b>: ${w.action}<br><i>quote:</i> ${w.quote ?? "(none)"} · p.${w.page ?? "?"} — judgeA=${w.verdictA} judgeB=${w.verdictB} <label><input type="checkbox"> real</label></li>`).join("\n");
  await writeFile(join(resultsDir, "worklist.html"), `<!doctype html><meta charset=utf-8><title>Adjudication worklist</title><h1>Adjudication worklist (${worklist.length})</h1><ol>${items}</ol>`);

  console.log(`scorecard → docs/rap-engine-comparison.md · worklist → results/worklist.html (κ=${kappa.toFixed(3)})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
