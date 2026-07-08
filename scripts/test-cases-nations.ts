// Nations extraction (spec 2026-07-07): verify verbatim + skip rules. Async IIFE
// because this repo is NOT ESM (top-level await is illegal).
import assert from "node:assert/strict";
import { verifyNations, extractNations } from "../src/lib/cases/ingest/nations";
import type { LegalCase } from "../src/lib/cases/types";
import type { LlmModel } from "../src/lib/cases/ingest/llm";

(async () => {
  // --- verifyNations ---
  const chunks = [{ paragraph: "para-1", text: "The Musqueam Indian Band brought this claim." }];
  assert.deepEqual(verifyNations(["Haida Nation"], "Haida Nation v. British Columbia", chunks), ["Haida Nation"], "styleOfCause match kept");
  assert.deepEqual(verifyNations(["Musqueam Indian Band"], "R. v. Sparrow", chunks), ["Musqueam Indian Band"], "body match kept");
  assert.deepEqual(verifyNations(["Atlantis Nation"], "R. v. Sparrow", chunks), [], "not-in-record dropped");
  assert.deepEqual(verifyNations(["Haida Nation", "haida nation"], "Haida Nation v. BC", []), ["Haida Nation"], "case-insensitive dedupe");
  assert.equal(
    verifyNations(["A Nation", "B Nation", "C Nation", "D Nation", "E Nation", "F Nation"],
      "A Nation B Nation C Nation D Nation E Nation F Nation v. X", []).length,
    5, "capped at 5");

  // --- extractNations skip rules + generated (fake model) ---
  const base = (over: Partial<LegalCase>): LegalCase => ({
    id: "c1", citation: "2020 SCC 1", styleOfCause: "Haida Nation v. British Columbia", court: "SCC", level: "scc", year: 2020,
    jurisdiction: "CA", nations: [], themes: [],
    outcome: { outcomeType: "precedent", winType: "party_win", whoWon: "", holding: "consult" },
    chunks: [{ paragraph: "para-1", text: "The Haida Nation sought consultation." }],
    casesCited: [], casesCiting: [], citingCount: 0, enrichmentLevel: "index", corpusTier: "core", fullTextAvailable: true,
    provenance: { source: "a2aj", sourceUrl: "u", upstreamLicense: "open", ingestedAt: "2026", unofficial: true },
    ...over,
  });
  const fake: LlmModel = { id: "fake", call: async () => JSON.stringify({ nations: ["Haida Nation"] }) };
  const ok = await extractNations(base({}), fake);
  assert.equal(ok.status, "generated");
  assert.deepEqual(ok.nations, ["Haida Nation"]);
  assert.equal((await extractNations(base({ corpusTier: "substrate" }), fake)).status, "skipped_not_core");
  assert.equal((await extractNations(base({ nations: ["X Nation"] }), fake)).status, "skipped_has_nations");
  assert.equal((await extractNations(base({ chunks: [] }), fake)).status, "skipped_no_fulltext");

  console.log("✅ test-cases-nations passed");
})().catch((e) => { console.error(e); process.exit(1); });
