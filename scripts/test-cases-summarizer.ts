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

  const { parseClaims, verifyClaims, normWs } = await import("../src/lib/cases/ingest/summarizer");

  // --- parser ---
  const good = `Here is the summary:\n{"claims":[{"text":"T","quote":"Q","paragraph":12}]}\nDone.`;
  const parsed = parseClaims(good);
  assert.ok(parsed && parsed.length === 1);
  assert.deepEqual(parsed![0], { text: "T", quote: "Q", paragraph: "12" }); // numeric para coerced to string
  assert.equal(parseClaims("no json here"), null);
  assert.equal(parseClaims(`{"claims": "not-an-array"}`), null);
  assert.equal(parseClaims(`{"claims":[{"text":"T"`), null); // truncated JSON

  // --- verifier ---
  const chunks = [
    { paragraph: "12", text: "The Crown owed a duty to consult the Haida Nation before transferring the licence." },
    { paragraph: "48", text: "Compensation of $10 million was awarded for the breach of treaty obligations." },
  ];
  const URL = "https://example.org/case";
  const mk = (text: string, quote: string, paragraph: string) => ({ text, quote, paragraph });

  // valid quote passes and is anchored
  let v = verifyClaims([mk("Plain claim.", "duty to consult the Haida Nation", "12")], chunks, URL);
  assert.equal(v.anchors.length, 1);
  assert.deepEqual(v.anchors[0], { text: "Plain claim.", sourceParagraph: "12", sourceUrl: URL });
  assert.equal(v.dropped, 0);

  // whitespace differences still match (normalization)
  v = verifyClaims([mk("C.", "Compensation of   $10 million\n was awarded", "48")], chunks, URL);
  assert.equal(v.anchors.length, 1);

  // fabricated quote dropped
  v = verifyClaims([mk("C.", "the court awarded punitive damages", "48")], chunks, URL);
  assert.equal(v.anchors.length, 0); assert.equal(v.dropped, 1);

  // right quote, wrong paragraph id → dropped
  v = verifyClaims([mk("C.", "duty to consult the Haida Nation", "48")], chunks, URL);
  assert.equal(v.anchors.length, 0);

  // unknown paragraph id → dropped
  v = verifyClaims([mk("C.", "duty to consult the Haida Nation", "99")], chunks, URL);
  assert.equal(v.anchors.length, 0);

  // short quote (<15 chars normalized) → dropped
  v = verifyClaims([mk("C.", "duty to", "12")], chunks, URL);
  assert.equal(v.anchors.length, 0);

  // empty text → dropped
  v = verifyClaims([mk("  ", "duty to consult the Haida Nation", "12")], chunks, URL);
  assert.equal(v.anchors.length, 0);

  // more than 6 survivors → first 6 kept, rest counted dropped
  const many = Array.from({ length: 8 }, (_, i) => mk(`claim ${i}`, "duty to consult the Haida Nation", "12"));
  v = verifyClaims(many, chunks, URL);
  assert.equal(v.anchors.length, 6); assert.equal(v.dropped, 2);

  assert.equal(normWs("  a\n\t b  "), "a b");

  // prose braces around otherwise-valid JSON → unparseable slice → null (retry trigger)
  assert.equal(parseClaims(`intro {brace} {"claims":[{"text":"T","quote":"Q","paragraph":"1"}]} outro {brace}`), null);

  // non-object entries become empty claims (counted as dropped downstream)
  const mixed = parseClaims(`{"claims":["junk",{"text":"T","quote":"Q","paragraph":"1"}]}`);
  assert.equal(mixed!.length, 2);
  assert.deepEqual(mixed![0], { text: "", quote: "", paragraph: "" });

  // mixed batch: 2 valid + 1 fabricated → 2 anchors, dropped 1
  v = verifyClaims([
    mk("A.", "duty to consult the Haida Nation", "12"),
    mk("B.", "the moon is made of green cheese!!", "48"),
    mk("C.", "Compensation of $10 million was awarded", "48"),
  ], chunks, URL);
  assert.equal(v.anchors.length, 2); assert.equal(v.dropped, 1);

  // typographic source vs ASCII quote → still verified (symmetric folding)
  const curly = [{ paragraph: "7", text: "The Crown’s honour is engaged — and the “duty to consult” arises." }];
  v = verifyClaims([mk("D.", `The Crown's honour is engaged - and the "duty to consult" arises.`, "7")], curly, URL);
  assert.equal(v.anchors.length, 1);

  console.log("✅ test-cases-summarizer passed");
})();
