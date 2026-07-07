// Batch figure extraction over core cases (spec 2026-07-07). Idempotent: responses
// are disk-cached (scripts/.cache/llm), so re-runs and the cloud replay are free.
// Writes extractedFigures + figuresMeta onto the PROFILE item ONLY — never rewrites
// CHUNK items (that would wipe embedded vectors; the promote lesson).
import "./fetch-polyfill";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseKeys } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { cachedModel, modelFromId } from "../src/lib/cases/ingest/llm";
import { extractFigures } from "../src/lib/cases/ingest/figures";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
const MODEL_ID = process.env.FIGURES_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";
const FORCE = process.env.FIGURES_FORCE === "1";

async function main() {
  const model = cachedModel(modelFromId(MODEL_ID, { maxTokens: 1024 }));
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  console.log(`extracting figures from ${profiles.length} core cases with ${MODEL_ID}${FORCE ? " (FORCE)" : ""}`);

  const stats = { generated: 0, skipped_already: 0, skipped_no_fulltext: 0, skipped_not_core: 0, failed: 0 };
  let casesWithFigures = 0, kept = 0, dropped = 0, done = 0;

  for (const p of profiles) {
    if (p.figuresMeta?.method === "llm" && !FORCE) { stats.skipped_already++; continue; }
    const c = await dynamoCaseRepo.getCase(p.id);
    if (!c) continue;
    const r = await extractFigures(c, model);
    if (r.status === "generated" && r.figures && r.meta) {
      await ddbDoc.send(new UpdateCommand({
        TableName: TABLE,
        Key: caseKeys.profile(c.id),
        UpdateExpression: "SET #d.#f = :f, #d.#m = :m",
        ExpressionAttributeNames: { "#d": "data", "#f": "extractedFigures", "#m": "figuresMeta" },
        ExpressionAttributeValues: { ":f": r.figures, ":m": r.meta },
      }));
      stats.generated++; kept += r.figures.length; dropped += r.dropped;
      if (r.figures.length > 0) casesWithFigures++;
    } else if (r.status === "failed") stats.failed++;
    else if (r.status === "skipped_no_fulltext") stats.skipped_no_fulltext++;
    else if (r.status === "skipped_not_core") stats.skipped_not_core++;
    if (++done % 25 === 0) console.log(`… ${done}/${profiles.length} · generated ${stats.generated} · cases-with-figures ${casesWithFigures}`);
  }

  console.log(`✅ extract-figures: generated ${stats.generated} · already ${stats.skipped_already} · no-fulltext ${stats.skipped_no_fulltext} · failed ${stats.failed}`);
  console.log(`   cases with ≥1 figure ${casesWithFigures} · figures kept ${kept} · dropped ${dropped}`);
}
main().catch((e) => { console.error("❌ cases-extract-figures failed:", e); process.exit(1); });
