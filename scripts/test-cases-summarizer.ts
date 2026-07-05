// Tests for the AI summary pipeline (spec 2026-07-03). Offline: stub models and
// counting fakes; the cachedModel test exercises the real disk cache (gitignored).
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

  // cachedModel: preserves the id; second call with the same prompt is served
  // from the disk cache (the model is called exactly once). Unique prompt per
  // run so a stale cache entry from a previous run can't interfere.
  let calls = 0;
  const counting = { id: "fake:count", call: async () => { calls++; return "counted-output"; } };
  const cm = cachedModel(counting);
  assert.equal(cm.id, "fake:count");
  const uniquePrompt = `cache test ${Date.now()}-${Math.random()}`;
  const first = await cm.call(uniquePrompt);
  const second = await cm.call(uniquePrompt);
  assert.equal(first, "counted-output");
  assert.equal(second, "counted-output");
  assert.equal(calls, 1, "second call must be a cache hit, not a model call");

  console.log("✅ test-cases-summarizer (task 1: modelFromId/cachedModel) passed");
})();
