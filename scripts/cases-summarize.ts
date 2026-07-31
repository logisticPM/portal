// Batch AI plain-language summaries over core cases (spec 2026-07-03).
// Idempotent: responses are disk-cached (scripts/.cache/llm), so re-runs and the
// cloud replay are free. Writes summary + summaryMeta onto the PROFILE item ONLY —
// never rewrites CHUNK items (that would wipe embedded vectors; the promote lesson).
import "./fetch-polyfill";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseKeys } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { cachedModel, modelFromId } from "../src/lib/cases/ingest/llm";
import { summarizeCase, type ClaimDrop } from "../src/lib/cases/ingest/summarizer";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
const MODEL_ID = process.env.SUMMARY_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";

// SUMMARIZE_FORCE=1: regenerate LLM summaries in place (verification/prompt
// iterations replay from the disk cache, so this is ~free). Curated summaries
// are still never touched — force only bypasses summaryMeta.method === "llm".
const FORCE = process.env.SUMMARIZE_FORCE === "1";

async function main() {
  const model = cachedModel(modelFromId(MODEL_ID, { maxTokens: 1024 }));
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  console.log(`summarizing ${profiles.length} core cases with ${MODEL_ID}${FORCE ? " (FORCE: regenerating llm summaries)" : ""}`);

  const stats = { generated: 0, skipped_curated: 0, skipped_already_generated: 0, skipped_not_core: 0, skipped_no_fulltext: 0 };
  const failed: string[] = [];
  let kept = 0, dropped = 0, done = 0;
  const allDrops: (ClaimDrop & { caseId: string })[] = [];

  for (const p of profiles) {
    // Curated cases short-circuit on the PROFILE alone; others need chunks reassembled.
    const redo = FORCE && p.summaryMeta?.method === "llm";
    const c = p.summary && !redo ? p : await dynamoCaseRepo.getCase(p.id);
    if (!c) continue;
    const target = redo ? { ...c, summary: undefined, summaryMeta: undefined } : c;
    const r = await summarizeCase(target, model);
    if (r.drops) allDrops.push(...r.drops.map((d) => ({ ...d, caseId: c.id })));
    if (r.status === "generated" && r.summary && r.meta) {
      await ddbDoc.send(new UpdateCommand({
        TableName: TABLE,
        Key: caseKeys.profile(c.id),
        // Case fields live under the PROFILE's `data` attribute, and DATA is a
        // DynamoDB reserved word — alias both path segments.
        UpdateExpression: "SET #d.#s = :s, #d.#m = :m",
        ExpressionAttributeNames: { "#d": "data", "#s": "summary", "#m": "summaryMeta" },
        ExpressionAttributeValues: { ":s": r.summary, ":m": r.meta },
      }));
      stats.generated++; kept += r.summary.claims.length; dropped += r.claimsDropped;
    } else if (r.status === "failed") {
      failed.push(c.id); dropped += r.claimsDropped;
      if (redo) console.log(`   ⚠ ${c.id}: forced regeneration failed — previous summary retained in table`);
    }
    else if (r.status === "skipped_curated" && c.summaryMeta?.method === "llm") stats.skipped_already_generated++;
    else stats[r.status]++;
    if (++done % 25 === 0) console.log(`… ${done}/${profiles.length} · generated ${stats.generated} · failed ${failed.length}`);
  }

  console.log(`✅ summarize: generated ${stats.generated} · curated ${stats.skipped_curated} · already-generated ${stats.skipped_already_generated} · no-fulltext ${stats.skipped_no_fulltext} · failed ${failed.length} of ${profiles.length}`);
  console.log(`   claims kept ${kept} · dropped ${dropped}`);
  if (allDrops.length) {
    const by = (reason: string) => allDrops.filter((d) => d.reason === reason).length;
    // Only drops we actually measured may be bucketed. overlapMeasured=false means "not
    // computed", which is NOT an overlap of zero — conflating them would pad the
    // correctly-dropped bucket with claims that were never examined.
    const measured = allDrops.filter((d) => d.overlapMeasured);
    const bucket = (lo: number, hi: number) => measured.filter((d) => d.bestOverlap >= lo && d.bestOverlap < hi).length;
    console.log(`   drop diagnostics: no_span ${by("no_span")} · quote_too_short ${by("quote_too_short")} · no_text ${by("no_text")} · over_cap ${by("over_cap")}`);
    console.log(`   drops recorded ${allDrops.length} · dropped ${dropped}${allDrops.length === dropped ? " (reconciled)" : " ⚠ MISMATCH — the histogram does not describe the whole population"}`);
    console.log(`   cited-para-not-found ${allDrops.filter((d) => !d.citedParaFound).length} · overlap measured for ${measured.length} of ${by("no_span")} no_span drops`);
    // The >=0.5 bucket IS the population span alignment could recover. Boundaries follow
    // from how LCS behaves: one substitution mid-quote splits the quote, so the metric
    // returns the longer surviving fragment — about HALF. So ~0.5 is the worst case for a
    // single-word garble and ~0.25 roughly the two-edit case; a measured genuine
    // paraphrase sits near 0.13.
    console.log(`   no_span overlap: >=0.5 → ${measured.filter((d) => d.bestOverlap >= 0.5).length} · 0.25–0.5 → ${bucket(0.25, 0.5)} · <0.25 → ${bucket(0, 0.25)}`);
    // Highest overlap first, with the case id, so these can actually be opened and
    // checked. Flagging bestPara != citedPara also quantifies the id misattribution.
    const near = measured.filter((d) => d.bestOverlap >= 0.5)
      .sort((a, b) => b.bestOverlap - a.bestOverlap).slice(0, 5)
      .map((d) => `${d.caseId} ${d.bestPara ?? "?"}${d.bestPara !== d.citedPara ? ` (model cited ${d.citedPara})` : ""} ${d.bestOverlap.toFixed(2)}`)
      .join(" · ");
    if (near) console.log(`   near-miss samples: ${near}`);
  }
  if (failed.length) console.log("   failed ids:", failed.join(", "));
}
main().catch((e) => { console.error("❌ cases-summarize failed:", e); process.exit(1); });
