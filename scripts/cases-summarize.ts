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
import { summarizeCase } from "../src/lib/cases/ingest/summarizer";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
const MODEL_ID = process.env.SUMMARY_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";

async function main() {
  const model = cachedModel(modelFromId(MODEL_ID, { maxTokens: 1024 }));
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  console.log(`summarizing ${profiles.length} core cases with ${MODEL_ID}`);

  const stats = { generated: 0, skipped_curated: 0, skipped_not_core: 0, skipped_no_fulltext: 0 };
  const failed: string[] = [];
  let kept = 0, dropped = 0, done = 0;

  for (const p of profiles) {
    // Curated cases short-circuit on the PROFILE alone; others need chunks reassembled.
    const c = p.summary ? p : await dynamoCaseRepo.getCase(p.id);
    if (!c) continue;
    const r = await summarizeCase(c, model);
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
    } else if (r.status === "failed") { failed.push(c.id); dropped += r.claimsDropped; }
    else stats[r.status]++;
    if (++done % 25 === 0) console.log(`… ${done}/${profiles.length} · generated ${stats.generated} · failed ${failed.length}`);
  }

  console.log(`✅ summarize: generated ${stats.generated} · curated ${stats.skipped_curated} · no-fulltext ${stats.skipped_no_fulltext} · failed ${failed.length} of ${profiles.length}`);
  console.log(`   claims kept ${kept} · dropped ${dropped}`);
  if (failed.length) console.log("   failed ids:", failed.join(", "));
}
main().catch((e) => { console.error("❌ cases-summarize failed:", e); process.exit(1); });
