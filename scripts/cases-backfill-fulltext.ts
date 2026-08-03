// Official-source full-text backfill. For no-full-text cases whose sourceUrl is an open
// host (bccourts HTML or SCC PDF — see official-source.ts), fetch verbatim text, apply,
// mark provenance official_court, and promote inline. ADDITIVE: only touches
// !fullTextAvailable cases, so existing full text / vectors are never rewritten.
// Resumable (re-run skips cases that now have text). Optional BACKFILL_HOST scopes the run.
import "./fetch-polyfill";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseToItems } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { applyFullText } from "../src/lib/cases/ingest/fulltext";
import { fetchOfficialSource, isOpenSource } from "../src/lib/cases/ingest/official-source";
import { makeRobotsGate } from "../src/lib/cases/ingest/robots";
import { promoteOne } from "./cases-ingest";
import type { LegalCase } from "../src/lib/cases/types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
// 3s default: the observed SCC response time is ~3.5s, so this is roughly half the rate of
// a back-to-back sequential crawl. The 2026-07-07 burst at 400ms is what tripped the gate.
const SLEEP_MS = Number(process.env.BACKFILL_SLEEP_MS ?? 3000);
const LIMIT = Number(process.env.BACKFILL_LIMIT ?? 0); // 0 = no cap; used for staged runs
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
  const gate = makeRobotsGate(); // one per run → each host's robots.txt fetched once

  let done = 0, withText = 0, promoted = 0;
  const outcomes: Record<string, number> = {};
  let batch: LegalCase[] = [];
  for (const c of todo) {
    const { text, outcome } = await fetchOfficialSource(c.provenance.sourceUrl, undefined, gate.allows);
    if (outcome === "blocked") {
      if (batch.length) await flush(batch);
      console.error(`\n❌ BLOCKED by ${hostOf(c.provenance.sourceUrl)} at ${c.id} (${done}/${todo.length} processed).`);
      console.error("   A gate response means every further request is futile and rude. Stopping.");
      console.error("   Progress is saved. Resume is a decision, not an automatic retry.");
      process.exit(2);
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    if (text) {
      withText++;
      const withTextCase: LegalCase = { ...applyFullText(c, text), provenance: { ...c.provenance, source: "official_court" } };
      const p = await promoteOne(withTextCase);
      if (p && p !== "no_consensus") promoted++;
      batch.push(p && p !== "no_consensus" ? p : withTextCase);
      if (batch.length >= 100) { await flush(batch); batch = []; }
    }
    if (++done % 100 === 0) console.log(`  ${done}/${todo.length} · text ${withText} · promoted ${promoted}`);
    if (LIMIT && done >= LIMIT) { console.log(`  reached BACKFILL_LIMIT=${LIMIT}, stopping cleanly`); break; }
    await sleep(SLEEP_MS); // pace requests — official sites rate-limit/WAF-block bursts
  }
  if (batch.length) await flush(batch);
  console.log(`✅ backfill: processed ${done} · got text ${withText} · promoted to core ${promoted}`);
  console.log(`   outcomes: ${JSON.stringify(outcomes)}`);
}
main().catch((e) => { console.error("❌ cases-backfill-fulltext failed:", e); process.exit(1); });
