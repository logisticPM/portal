// New-case monitoring (spec 2026-07-07): scan-report item shape + additive scan.
// Async IIFE — this repo is NOT ESM (top-level await is illegal).
import assert from "node:assert/strict";
import { scanItem } from "../src/lib/cases/monitor/repo";
import { scanRecent } from "../src/lib/cases/monitor/scan";
import type { A2ajRecord } from "../src/lib/cases/ingest/a2aj";

(async () => {
  // --- Task 1: SCAN# meta item shape ---
  const item = scanItem({ ts: "2026-07-07T00:00:00.000Z", windowDays: 90, scanned: 10, added: 3, newCitations: ["2026 SCC 1"] });
  assert.equal(item.PK, "SCAN#2026-07-07T00:00:00.000Z");
  assert.equal(item.SK, "SCAN");
  assert.equal(item.et, "Scan", "non-Case et so corpus queries ignore it");
  assert.equal(item.GSI2PK, "SCAN#ALL");
  assert.equal(item.GSI2SK, "2026-07-07T00:00:00.000Z");
  assert.equal(item.GSI1PK, undefined, "no GSI1PK — invisible to the corpus GSI1 scan");
  assert.equal((item.data as any).added, 3);

  // --- Task 2: additive scan (injected harvest + send) ---
  const rec = (cit: string): A2ajRecord => ({ dataset: "SCC", citation_en: cit, name_en: "X v. Y", document_date_en: "2026-01-01", url_en: "u" });
  const fakeHarvest = async () => [rec("2026 SCC 1"), rec("2026 SCC 2"), rec("2026 SCC 3")];
  const calls: any[] = [];
  const fakeSend = async (cmd: any) => {
    calls.push(cmd);
    if (cmd.input.Item.PK === "CASE#2026-scc-2") { const e: any = new Error("exists"); e.name = "ConditionalCheckFailedException"; throw e; }
    return {};
  };
  const report = await scanRecent(90, { harvest: fakeHarvest, send: fakeSend, now: () => new Date("2026-07-07T00:00:00.000Z") });
  assert.equal(report.scanned, 3);
  assert.equal(report.added, 2, "existing case (2026-scc-2) skipped via conditional put");
  assert.deepEqual(report.newCitations, ["2026 SCC 1", "2026 SCC 3"]);
  assert.equal(report.windowDays, 90);
  assert.equal(report.ts, "2026-07-07T00:00:00.000Z");
  assert.equal(calls[0].input.ConditionExpression, "attribute_not_exists(PK)", "additive conditional write");

  let threw = false;
  try {
    await scanRecent(90, { harvest: fakeHarvest, now: () => new Date(),
      send: async () => { const e: any = new Error("boom"); e.name = "ProvisionedThroughputExceededException"; throw e; } });
  } catch { threw = true; }
  assert.ok(threw, "a non-conditional error propagates, not swallowed");

  console.log("✅ test-cases-monitor passed");
})().catch((e) => { console.error(e); process.exit(1); });
