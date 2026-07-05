// Live: fetch full text for substrate records lacking it, fuse with inline promotion,
// and write PROFILE+CHUNK items. Idempotent (skips records already fullTextAvailable),
// rate-limited (fetchCitation sleeps on cache miss), cached + resumable.
// Flushes to DynamoDB every 100 cases so partial progress persists across re-runs.
import "./fetch-polyfill"; // must be first: patches global.fetch before any live-network modules load
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseToItems } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { fetchCitation } from "../src/lib/cases/ingest/harvest";
import { applyFullText } from "../src/lib/cases/ingest/fulltext";
import { emptyPrisma, includeCandidate, tallyExclude } from "../src/lib/cases/ingest/include";
import { enrichment } from "../src/lib/cases/enrichment";
import { promoteOne } from "./cases-ingest";
import type { LegalCase } from "../src/lib/cases/types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";

// Flush a batch of cases (any tier) as PROFILE+CHUNK items, ≤25 per BatchWrite call.
async function flush(batch: LegalCase[]) {
  const requests = batch.flatMap((c) => caseToItems(c).map((Item) => ({ PutRequest: { Item } })));
  for (let i = 0; i < requests.length; i += 25)
    await ddbDoc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: requests.slice(i, i + 25) } }));
}

async function main() {
  const subs = await dynamoCaseRepo.listCases({ tier: "substrate" });
  // Resumable: skip records that already have full text stored
  const todo = subs.filter((c) => !c.fullTextAvailable);
  console.log(`full text: ${todo.length} of ${subs.length} substrate records need fetching`);

  let done = 0, withText = 0, promotedToCore = 0;
  const prisma = emptyPrisma();
  prisma.identified = todo.length;
  prisma.deduped = todo.length;

  let batch: LegalCase[] = [];

  for (const c of todo) {
    prisma.screened++;

    // 1. Fetch + apply full text (in-memory chunks)
    const rec = await fetchCitation(c.citation);
    const withTextCase = applyFullText(c, rec?.unofficial_text_en ?? "");
    if (withTextCase.fullTextAvailable) withText++;

    // 2. Fused inline promotion decision
    // Compute verdict for PRISMA tally (promoteOne won't tally)
    const hasEnrichment = !!enrichment[c.citation];
    if (!hasEnrichment) {
      const verdict = includeCandidate(withTextCase);
      if (!verdict.include) {
        tallyExclude(prisma, verdict.reason ?? "unknown");
        // Still write the substrate record (with full text) — stays substrate
        batch.push(withTextCase);
        if (++done % 100 === 0) { await flush(batch); batch = []; console.log(`  ${done}/${todo.length} (withText: ${withText} promoted: ${promotedToCore})`); }
        continue;
      }
    }

    const promoted = await promoteOne(withTextCase);
    if (promoted === "no_consensus") tallyExclude(prisma, "no_model_consensus");
    // promoted case → core; "no_consensus"/null → stays substrate
    const finalCase = promoted && promoted !== "no_consensus" ? promoted : withTextCase;
    if (promoted && promoted !== "no_consensus") { promotedToCore++; prisma.included++; }

    batch.push(finalCase);
    if (++done % 100 === 0) { await flush(batch); batch = []; console.log(`  ${done}/${todo.length} (withText: ${withText} promoted: ${promotedToCore})`); }
  }

  if (batch.length) await flush(batch);

  console.log(`✅ full text applied to ${done} records (${withText} got text, ${done - withText} had none)`);
  console.log(`   promoted to core: ${promotedToCore} · stayed substrate: ${done - promotedToCore}`);
  console.log("PRISMA:", JSON.stringify(prisma.excluded));
}
main().catch((e) => { console.error("❌ cases-fetch-fulltext failed:", e); process.exit(1); });
