// cases-harvest-court runner test — injected deps, no network/LLM/Dynamo. Uses the NB adapter to
// exercise the 2-level BFS (landing → monthly) and additive-safety (existing case never written).
import assert from "node:assert/strict";
import { runCourtHarvest, type CourtHarvestDeps } from "./cases-harvest-court";
import { nbAdapter } from "../src/lib/cases/ingest/court-adapters";

(async () => {
  const landing = `<a href="/content/cour/en/appeal/content/decisions/2024/may.html">May 2024</a>`;
  const month = `
    <a href="/content/dam/courts/pdf/appeal-appel/decisions/2024/05/2024-05-01-elsipogtog-first-nation-v-nb-2024-nbca-20.pdf">a</a>
    <a href="/content/dam/courts/pdf/appeal-appel/decisions/2024/05/2024-05-02-mikmaq-nation-v-nb-2024-nbca-21.pdf">b</a>`;
  const written: string[] = [];
  const deps: CourtHarvestDeps = {
    fetchListing: async (url) => (url.endsWith("/decisions.html") ? landing : url.endsWith("/may.html") ? month : ""),
    fetchText: async () => "The First Nation appealed regarding treaty rights and resource compensation. ".repeat(12),
    exists: async (id) => id === "2024-nbca-20", // Elsipogtog already present → skip
    promote: async (c) => ({ ...c, corpusTier: "core" }),
    writeCase: async (c) => { written.push(c.id); },
  };

  const rep = await runCourtHarvest(nbAdapter, deps);
  assert.equal(rep.indexPages, 2, "BFS visited landing + monthly");
  assert.equal(rep.listed, 2, "2 NBCA decisions found on monthly page");
  assert.equal(rep.shortlisted, 2, "both First Nation → shortlisted");
  assert.equal(rep.alreadyPresent, 1, "Elsipogtog already present → skipped");
  assert.equal(rep.promoted, 1, "the new Mi'kmaq case promoted");
  assert.deepEqual(written, ["2024-nbca-21"], "only the new case written; existing never overwritten");

  console.log("✅ test-cases-harvest-court passed");
})().catch((e) => { console.error(e); process.exit(1); });
