// New-case monitoring (spec 2026-07-07): scan-report item shape + additive scan.
// Async IIFE — this repo is NOT ESM (top-level await is illegal).
import assert from "node:assert/strict";
import { scanItem } from "../src/lib/cases/monitor/repo";

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

  console.log("✅ test-cases-monitor passed");
})().catch((e) => { console.error(e); process.exit(1); });
