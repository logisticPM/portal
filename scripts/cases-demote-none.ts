// One-off migration (policy 2026-07-05): demote zero-consensus core cases back to
// substrate. The dual-LLM run promoted agreement="none" cases with an empty agreed
// theme set; audit showed most are non-Indigenous noise the inclusion regexes
// over-matched. Demotion keeps everything recoverable: full text, chunks (and
// their vectors), labels and labelMeta stay; only corpusTier flips and the AI
// summary/summaryMeta are removed (regenerable for free from the disk cache if a
// case is ever human-reviewed back into core). PROFILE-item-only update — CHUNK
// items are never touched.
import "./fetch-polyfill";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseKeys } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

async function main() {
  const core = await dynamoCaseRepo.listCases({ tier: "core" });
  const targets = core.filter(
    (c) => c.labelMeta?.method === "dual_llm" && c.labelMeta?.agreement === "none",
  );
  console.log(`demoting ${targets.length} zero-consensus cases of ${core.length} core`);
  let done = 0;
  for (const c of targets) {
    await ddbDoc.send(new UpdateCommand({
      TableName: TABLE,
      Key: caseKeys.profile(c.id),
      // Case fields live under the PROFILE's `data` attribute (DATA is a
      // DynamoDB reserved word) — alias every path segment.
      UpdateExpression: "SET #d.#t = :sub REMOVE #d.#s, #d.#m",
      ExpressionAttributeNames: { "#d": "data", "#t": "corpusTier", "#s": "summary", "#m": "summaryMeta" },
      ExpressionAttributeValues: { ":sub": "substrate" },
    }));
    if (++done % 25 === 0) console.log(`… ${done}/${targets.length}`);
  }
  const after = await dynamoCaseRepo.listCases({ tier: "core" });
  console.log(`✅ demoted ${done} · core ${core.length} → ${after.length} · labels retained for audit`);
}
main().catch((e) => { console.error("❌ cases-demote-none failed:", e); process.exit(1); });
