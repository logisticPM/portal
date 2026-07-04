// Tests for the AI summary pipeline (spec 2026-07-03). Offline: fake LlmModels
// with canned JSON — no network, no cache interference (fakes bypass cachedCall).
import assert from "node:assert/strict";

(async () => {
  const { modelFromId, cachedModel } = await import("../src/lib/cases/ingest/llm");

  // modelFromId: stub path stays deterministic and carries the id.
  const m = modelFromId("stub:sum-a");
  assert.equal(m.id, "stub:sum-a");
  const out1 = await m.call("same prompt");
  const out2 = await m.call("same prompt");
  assert.equal(out1, out2, "stub output must be deterministic");
  assert.ok(Array.isArray(JSON.parse(out1)), "stub output is a JSON array");

  // cachedModel: preserves the id, wraps the call.
  const cm = cachedModel(m);
  assert.equal(cm.id, "stub:sum-a");
  assert.equal(await cm.call("same prompt"), out1);

  console.log("✅ test-cases-summarizer (task 1: modelFromId/cachedModel) passed");
})();
