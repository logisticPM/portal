// Batch dual-LLM outcome classification over core cases (spec 2026-07-30).
// Idempotent: responses are disk-cached (scripts/.cache/llm), so re-runs and the
// cloud replay are free. Writes outcome + outcomeMeta onto the PROFILE item ONLY —
// never rewrites CHUNK items (that would wipe embedded vectors; the promote lesson).
import "./fetch-polyfill";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseKeys, gsi2WinType } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { classifyOutcome } from "../src/lib/cases/ingest/outcome-labeler";
import { ALL_WINTYPES } from "../src/lib/cases/ingest/outcome-rubric";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
// OUTCOME_FORCE=1: re-classify rows already carrying a dual_llm outcome. Curated
// values stay immune either way.
const FORCE = process.env.OUTCOME_FORCE === "1";

async function main() {
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  console.log(`classifying ${profiles.length} core cases${FORCE ? " (FORCE)" : ""}`);

  const stats = { classified: 0, curated: 0, already: 0, no_chunks: 0, missing: 0, failed: 0 };
  const agree = { full: 0, partial: 0, none: 0 };
  let contradictions = 0;
  const wins = Object.fromEntries(ALL_WINTYPES.map((w) => [w, 0])) as Record<string, number>;
  let done = 0;

  for (const prof of profiles) {
    // Curated outcomes are never touched. Cases seeded before outcomeMeta existed have
    // no meta but DO have a real winType — that pre-existing value is curated too.
    if (prof.outcomeMeta?.method === "curated"
      || (!prof.outcomeMeta && prof.outcome?.winType && prof.outcome.winType !== "unclassified")) {
      stats.curated++; continue;
    }
    if (prof.outcomeMeta?.method === "dual_llm" && !FORCE) { stats.already++; continue; }

    const c = await dynamoCaseRepo.getCase(prof.id);
    if (!c) { stats.missing++; continue; }
    if (!c.chunks || c.chunks.length === 0) { stats.no_chunks++; continue; }

    let r;
    try {
      r = await classifyOutcome(c.styleOfCause, c.chunks);
    } catch (e) {
      stats.failed++;
      console.log(`   ⚠ ${c.id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    await ddbDoc.send(new UpdateCommand({
      TableName: TABLE,
      Key: caseKeys.profile(c.id),
      // Case fields live under the PROFILE's `data` attribute, and DATA is a
      // DynamoDB reserved word — alias every path segment. GSI2PK is top-level and
      // not reserved, so it needs no alias.
      //
      // GSI2PK is DERIVED from winType (see gsi2WinType in cases-table.ts), so it must
      // move in the same write — otherwise the win-type browse index keeps pointing at
      // the pre-backfill value and silently disagrees with the base table forever.
      UpdateExpression: "SET #d.#o = :o, #d.#om = :om, GSI2PK = :g",
      ExpressionAttributeNames: { "#d": "data", "#o": "outcome", "#om": "outcomeMeta" },
      ExpressionAttributeValues: {
        ":o": {
          ...c.outcome, winType: r.winType, outcomeType: r.outcomeType,
          ...(r.derivation ? { derivation: r.derivation } : {}),
        },
        ":om": r.outcomeMeta,
        ":g": gsi2WinType(r.winType),
      },
    }));

    stats.classified++;
    agree[r.outcomeMeta.agreement ?? "none"]++;
    contradictions += r.outcomeMeta.contradictions ?? 0;
    wins[r.winType]++;
    if (++done % 25 === 0) console.log(`… ${done}/${profiles.length} · classified ${stats.classified}`);
  }

  console.log(`✅ classify-outcome: classified ${stats.classified} · curated ${stats.curated} · already ${stats.already} · no-chunks ${stats.no_chunks} · missing ${stats.missing} · failed ${stats.failed}`);
  console.log(`   agreement: full ${agree.full} · partial ${agree.partial} · none ${agree.none}`);
  console.log(`   self-contradicting responses discarded: ${contradictions}`);
  console.log(`   winType: ${ALL_WINTYPES.map((w) => `${w} ${wins[w]}`).join(" · ")}`);
}
main().catch((e) => { console.error("❌ cases-classify-outcome failed:", e); process.exit(1); });
