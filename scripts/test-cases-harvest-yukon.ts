// cases-harvest-yukon runner tests — injected deps, no network/LLM/Dynamo.
import assert from "node:assert/strict";
import { runYukonHarvest, type YukonHarvestDeps } from "./cases-harvest-yukon";
import type { LegalCase } from "../src/lib/cases/types";

(async () => {
  // Two candidate PDFs on the SC page; one already in the corpus (must be skipped, never written).
  const html = `
    <a href="/sites/default/files/2026-05/2026_yksc_36_FNNND%20v%20Yukon%20%28Government%20of%29.pdf">a</a>
    <a href="/sites/default/files/2020-01/2020_yksc_1_Ross%20River%20Dena%20v%20Yukon.pdf">b</a>
  `;
  const written: string[] = [];
  const deps: YukonHarvestDeps = {
    fetchListing: async () => html,
    fetchText: async () => "The First Nation sought relief regarding treaty land and resource royalties. ".repeat(12),
    exists: async (id) => id === "2020-yksc-1", // Ross River already present → skip
    promote: async (c) => ({ ...c, corpusTier: "core" }), // consensus → core
    writeCase: async (c) => { written.push(c.id); },
  };

  const rep = await runYukonHarvest(["supreme-court"], deps);
  assert.equal(rep.listed, 2, "2 decisions listed");
  assert.equal(rep.shortlisted, 2, "both shortlisted (First Nation / Yukon(Government of))");
  assert.equal(rep.alreadyPresent, 1, "Ross River already present → skipped");
  assert.equal(rep.promoted, 1, "the new FNNND case promoted to core");
  assert.deepEqual(written, ["2026-yksc-36"], "only the new case written; existing never overwritten");

  console.log("✅ test-cases-harvest-yukon passed");
})().catch((e) => { console.error(e); process.exit(1); });
