// Official-source full-text backfill (spec 2026-07-07 rev). v1: for no-full-text
// cases whose sourceUrl is an open host (bccourts), fetch verbatim HTML text, apply,
// mark provenance official_court, and promote inline. ADDITIVE: only touches
// !fullTextAvailable cases, so existing full text / vectors are never rewritten.
// Resumable (re-run skips cases that now have text); disk-cached fetches.
import "./fetch-polyfill";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseToItems } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { applyFullText } from "../src/lib/cases/ingest/fulltext";
import { fetchOfficialText, isOpenSource } from "../src/lib/cases/ingest/official-source";
import { promoteOne } from "./cases-ingest";
import type { LegalCase } from "../src/lib/cases/types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
const SLEEP_MS = Number(process.env.BACKFILL_SLEEP_MS ?? 400); // polite delay between official-site fetches
const HOST = process.env.BACKFILL_HOST; // optional: scope the run to one open host (e.g. decisions.scc-csc.ca)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function flush(batch: LegalCase[]) {
  const reqs = batch.flatMap((c) => caseToItems(c).map((Item) => ({ PutRequest: { Item } })));
  for (let i = 0; i < reqs.length; i += 25)
    await ddbDoc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: reqs.slice(i, i + 25) } }));
}

async function main() {
  const all = await dynamoCaseRepo.listCases({ tier: "all" });
  const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ""; } };
  const todo = all.filter((c) =>
    !c.fullTextAvailable &&
    isOpenSource(c.provenance.sourceUrl) &&
    (!HOST || hostOf(c.provenance.sourceUrl) === HOST));
  console.log(`backfill: ${todo.length} open-source no-fulltext cases${HOST ? ` (host=${HOST})` : ""}`);

  let done = 0, withText = 0, promoted = 0;
  let batch: LegalCase[] = [];
  for (const c of todo) {
    const text = await fetchOfficialText(c.provenance.sourceUrl);
    if (text) {
      withText++;
      const withTextCase: LegalCase = { ...applyFullText(c, text), provenance: { ...c.provenance, source: "official_court" } };
      const p = await promoteOne(withTextCase);
      if (p && p !== "no_consensus") promoted++;
      batch.push(p && p !== "no_consensus" ? p : withTextCase);
      if (batch.length >= 100) { await flush(batch); batch = []; }
    }
    if (++done % 100 === 0) console.log(`  ${done}/${todo.length} · text ${withText} · promoted ${promoted}`);
    await sleep(SLEEP_MS); // pace requests — official sites rate-limit/WAF-block bursts
  }
  if (batch.length) await flush(batch);
  console.log(`✅ backfill: processed ${done} · got text ${withText} · promoted to core ${promoted}`);
}
main().catch((e) => { console.error("❌ cases-backfill-fulltext failed:", e); process.exit(1); });
