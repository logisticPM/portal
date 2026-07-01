import assert from "node:assert/strict";
import { mockCaseRepo } from "../src/lib/cases/repo.mock";

const repo = mockCaseRepo;

(async () => {
  assert.equal((await repo.listCases()).length, 4, "lists all");
  assert.equal((await repo.getCase("haida-2004"))?.citation, "2004 SCC 73", "get by id");
  assert.equal(await repo.getCase("nope"), null, "missing → null");
  assert.equal((await repo.searchCases("Tsilhqot'in"))[0].id, "tsilhqotin-2014", "search by name");
  assert.equal((await repo.listFacets()).byLevel.scc, 3, "facets");
  assert.equal((await repo.getActivationSummary()).totalCases, 4, "activation");
  assert.equal((await repo.getCitationGraph("haida-2004")).citing[0]?.id, "tsilhqotin-2014", "graph");
  assert.ok((await repo.exportCases()).asOf, "export has asOf");
  console.log("✅ mock repo tests passed");
})().catch((e) => { console.error("❌ test failed:", e); process.exit(1); });
