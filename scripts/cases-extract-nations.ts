// Batch nations extraction over core cases (spec 2026-07-07). Idempotent: LLM
// responses are disk-cached (scripts/.cache/llm) and only empty-nations cases are
// written, so curated nations are never overwritten and re-runs are free. Writes
// data.nations onto the PROFILE item ONLY — never rewrites CHUNK items.
import "./fetch-polyfill";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseKeys } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { cachedModel, modelFromId } from "../src/lib/cases/ingest/llm";
import { extractNations } from "../src/lib/cases/ingest/nations";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
const MODEL_ID = process.env.NATIONS_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";

async function main() {
  const model = cachedModel(modelFromId(MODEL_ID, { maxTokens: 256 }));
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  console.log(`extracting nations from ${profiles.length} core cases with ${MODEL_ID}`);

  const stats = { filled: 0, empty: 0, skipped_has: 0, skipped_no_fulltext: 0, failed: 0 };
  const distinct = new Set<string>();
  let done = 0;

  for (const p of profiles) {
    if (p.nations.length > 0) { stats.skipped_has++; continue; } // curated / already-done → never overwrite
    const c = await dynamoCaseRepo.getCase(p.id);
    if (!c) continue;
    const r = await extractNations(c, model);
    if (r.status === "generated" && r.nations.length > 0) {
      await ddbDoc.send(new UpdateCommand({
        TableName: TABLE, Key: caseKeys.profile(c.id),
        UpdateExpression: "SET #d.#n = :n",
        ExpressionAttributeNames: { "#d": "data", "#n": "nations" },
        ExpressionAttributeValues: { ":n": r.nations },
      }));
      stats.filled++; r.nations.forEach((n) => distinct.add(n));
    } else if (r.status === "generated") stats.empty++;
    else if (r.status === "failed") stats.failed++;
    else if (r.status === "skipped_no_fulltext") stats.skipped_no_fulltext++;
    else if (r.status === "skipped_has_nations") stats.skipped_has++;
    if (++done % 25 === 0) console.log(`… ${done}/${profiles.length} · filled ${stats.filled} · distinct ${distinct.size}`);
  }

  console.log(`✅ extract-nations: filled ${stats.filled} · empty ${stats.empty} · has-already ${stats.skipped_has} · no-fulltext ${stats.skipped_no_fulltext} · failed ${stats.failed}`);
  console.log(`   distinct nations filled: ${distinct.size}`);
}
main().catch((e) => { console.error("❌ cases-extract-nations failed:", e); process.exit(1); });
