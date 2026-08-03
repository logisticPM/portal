// Read-only: how much does the uniqueness guard cost, and could the model's own cited
// paragraph break the ties it declines?
//
// Claim recovery (#227) anchors a claim when exactly one paragraph scores >=0.95. What
// blocks progress now is strong matches that are AMBIGUOUS: 2008-scc-41 has no summary at
// all despite a 0.97 best match, because a second paragraph also cleared 0.95. Lowering the
// threshold would not help — it is already above it.
//
// The candidate tie-breaker is `citedPara`: the model's bookkeeping and our text matching are
// independent, so agreement is real corroboration. But summarizer.ts records that models
// misattribute paragraph ids about half the time. Whether they do so AMONG THE CLAIMS WHERE
// TWO PARAGRAPHS MATCH STRONGLY is what nobody has measured, and it is the only thing that
// decides whether a tie-breaker is safe.
//
// ZERO LLM calls — model responses replay from scripts/.cache/llm. Needs DynamoDB read.
// Writes nothing.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { assembleInput, buildPrompt, parseClaims, verifyClaims, RETRY_SUFFIX } from "../src/lib/cases/ingest/summarizer";
import type { ClaimDrop } from "../src/lib/cases/ingest/summarizer";

const CACHE = path.join(process.cwd(), "scripts", ".cache", "llm");
const MODEL_ID = process.env.SUMMARY_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";
const keyFor = (p: string) => createHash("sha256").update(MODEL_ID + "\n" + p).digest("hex").slice(0, 32);
const readCache = async (p: string) => {
  try { return await fs.readFile(path.join(CACHE, keyFor(p) + ".txt"), "utf8"); } catch { return null; }
};

const BANDS: [string, number, number][] = [
  [">=0.95", 0.95, 1.01],
  ["0.90-0.95", 0.90, 0.95],
  ["0.80-0.90", 0.80, 0.90],
  ["0.50-0.80", 0.50, 0.80],
  ["<0.50", 0, 0.50],
];

type Row = { drops: number; declined: number; citedIsBest: number; citedIsRival: number; citedIsNeither: number; citedMissing: number };
const empty = (): Row => ({ drops: 0, declined: 0, citedIsBest: 0, citedIsRival: 0, citedIsNeither: 0, citedMissing: 0 });

// The cited paragraph is free text from the model; locate() accepts a bare "N" as "para-N",
// so the comparison must too or agreement is undercounted.
const same = (cited: string, para: string | null) =>
  para !== null && (cited === para || `para-${cited}` === para);

async function main() {
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  const rows = new Map(BANDS.map(([n]) => [n, empty()]));
  const declinedSamples: string[] = [];
  let cases = 0, totalDrops = 0, unmeasured = 0;

  for (const prof of profiles) {
    const c = await dynamoCaseRepo.getCase(prof.id);
    if (!c?.chunks?.length) continue;
    const assembled = assembleInput(c.chunks, c.outcome.holding);
    const prompt = buildPrompt(c, assembled);
    const raw = await readCache(prompt);
    let claims = raw === null ? null : parseClaims(raw);
    if (!claims) {
      const retry = await readCache(prompt + RETRY_SUFFIX);
      // A miss means the cache no longer matches the prompts the corpus would produce —
      // exactly what happened after the SCC backfill changed 19 cases' text. Measuring a
      // partial population is the failure mode this whole line of work keeps hitting.
      if (retry === null) {
        throw new Error(`cache miss for ${c.id}. Re-run cases:summarize first, or the ` +
          `distribution describes an unrepresentative subset. Do NOT interpret a partial run.`);
      }
      claims = parseClaims(retry);
    }
    if (!claims) continue;
    cases++;
    const { drops } = verifyClaims(claims, c.chunks, c.provenance.sourceUrl, { measureOverlap: true });
    for (const d of drops as ClaimDrop[]) {
      if (d.reason !== "no_span") continue;
      totalDrops++;
      if (!d.overlapMeasured) { unmeasured++; continue; }
      const band = BANDS.find(([, lo, hi]) => d.bestOverlap >= lo && d.bestOverlap < hi);
      if (!band) continue;
      const r = rows.get(band[0])!;
      r.drops++;
      if (d.declinedByGuard) {
        r.declined++;
        if (same(d.citedPara, d.bestPara)) r.citedIsBest++;
        else if (same(d.citedPara, d.rivalPara)) r.citedIsRival++;
        else if (!d.citedParaFound) r.citedMissing++;
        else r.citedIsNeither++;
        if (declinedSamples.length < 6) {
          declinedSamples.push(`${c.id} best=${d.bestPara}@${d.bestOverlap.toFixed(2)} rival=${d.rivalPara}@${d.rival.toFixed(2)} cited=${d.citedPara}`);
        }
      }
    }
  }

  console.log(`\n${totalDrops} no_span drops across ${cases} cases${unmeasured ? ` · ${unmeasured} unmeasured` : ""}\n`);
  console.log("band        drops  declined   cited=best  cited=rival  cited=neither  cited=absent");
  for (const [name] of BANDS) {
    const r = rows.get(name)!;
    console.log(`${name.padEnd(11)} ${String(r.drops).padStart(5)}  ${String(r.declined).padStart(8)}   ${String(r.citedIsBest).padStart(10)}  ${String(r.citedIsRival).padStart(11)}  ${String(r.citedIsNeither).padStart(13)}  ${String(r.citedMissing).padStart(12)}`);
  }
  const top = rows.get(">=0.95")!;
  console.log(`\nWhat the guard costs at >=0.95: ${top.declined} claims declined for ambiguity.`);
  if (top.declined > 0) {
    const usable = top.citedIsBest + top.citedIsRival;
    console.log(`  citedPara points at one of the two candidates in ${usable}/${top.declined}` +
      ` (${((usable / top.declined) * 100).toFixed(0)}%) — the ceiling for a tie-breaker.`);
    console.log(`  it agrees with the BEST match in ${top.citedIsBest}, with the rival in ${top.citedIsRival}.` +
      ` A tie-breaker is only safe if that split is lopsided.`);
  }
  if (declinedSamples.length) {
    console.log(`\nsample declines:`);
    for (const s of declinedSamples) console.log(`  ${s}`);
  }
}
main().catch((e) => { console.error("❌ cases-anchor-signals failed:", e.message); process.exit(1); });
