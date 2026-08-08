// Tests for the rung-3 probe's pure parts. Run: npx tsx scripts/test-cases-nli-probe.ts
import assert from "node:assert/strict";
import { parseNliLabel, buildNliPrompt, buildReversalPrompt, parseReversal } from "../src/lib/cases/nli-probe/prompt";
import { emptyConfusion, addToConfusion, rowTotal, decide, formatConfusion, assertNoCallFailures, FALSE_ALARM_MAX, SYNTHETIC_RECALL_MIN } from "../src/lib/cases/nli-probe/tally";
import { callParsed } from "../src/lib/cases/nli-probe/repair";
import { cacheKeyFor, hasCached, evictCached, cachedCall, modelFromId } from "../src/lib/cases/ingest/llm";

// --- parseNliLabel ---------------------------------------------------------------------
assert.equal(parseNliLabel('{"label":"entailment"}'), "entailment");
assert.equal(parseNliLabel('Sure!\n```json\n{"label":"CONTRADICTION"}\n```'), "contradiction", "fenced + uppercase");
assert.equal(parseNliLabel('{"label":" neutral "}'), "neutral", "whitespace tolerated");
// A parse failure must be null, never a default label — a defaulted "neutral" would read
// as the detector declining to flag, which is evidence about the product invented from a
// broken response.
assert.equal(parseNliLabel("the premise supports it"), null, "no JSON");
assert.equal(parseNliLabel('{"label":"supported"}'), null, "judge vocabulary is not NLI vocabulary");
assert.equal(parseNliLabel('{"verdict":"entailment"}'), null, "wrong key");
assert.equal(parseNliLabel('{"label":true}'), null, "non-string");

// --- prompts ---------------------------------------------------------------------------
{
  const p = buildNliPrompt("PREM_TEXT", "HYP_TEXT");
  assert.ok(p.includes("PREM_TEXT") && p.includes("HYP_TEXT"));
  // Premise/hypothesis order is load-bearing: NLI is directional, and swapping them
  // measures a different relation. Pin the order rather than trusting the call site.
  assert.ok(p.indexOf("PREM_TEXT") < p.indexOf("HYP_TEXT"), "premise must precede hypothesis");
  // The probe must not inherit the eval judge's 4-way vocabulary, or agreement between the
  // two becomes an artefact of asking the same question twice.
  for (const w of ["supported", "overstated", "unrelated"]) {
    assert.ok(!p.includes(w), `NLI prompt leaks judge vocabulary: ${w}`);
  }
}

// --- parseReversal ---------------------------------------------------------------------
const ORIG = "The court found that the Crown had discharged its duty to consult the First Nation.";
assert.equal(
  parseReversal('{"reversed":"The court found that the Crown had not discharged its duty to consult the First Nation."}', ORIG),
  "The court found that the Crown had not discharged its duty to consult the First Nation.",
);
// A reversal that comes back unchanged is a FAILED construction. Counting it would charge
// the checker with a miss on a sentence that was never a contradiction.
assert.equal(parseReversal(`{"reversed":${JSON.stringify(ORIG)}}`, ORIG), null, "identical rejected");
assert.equal(parseReversal(`{"reversed":${JSON.stringify(ORIG.toUpperCase())}}`, ORIG), null, "identical modulo case/punct rejected");
assert.equal(parseReversal('{"reversed":"It is not true that the Crown discharged its duty to consult."}', ORIG), null, "meta-commentary rejected");
assert.equal(parseReversal('{"reversed":"No."}', ORIG), null, "too short");
assert.equal(parseReversal('{"reversed":123}', ORIG), null, "non-string");
assert.ok(buildReversalPrompt("SENT_TEXT").includes("SENT_TEXT"));

// --- confusion matrix ------------------------------------------------------------------
{
  const c = emptyConfusion();
  addToConfusion(c, "supported", "entailment");
  addToConfusion(c, "supported", "entailment");
  addToConfusion(c, "overstated", "contradiction");
  assert.equal(c.supported.entailment, 2);
  assert.equal(c.overstated.contradiction, 1);
  assert.equal(rowTotal(c.supported), 2);
  assert.equal(rowTotal(c.unrelated), 0);
  // Distinct counts per cell, so a formatter that printed the wrong row cannot pass.
  const s = formatConfusion(c);
  assert.ok(/supported.*2 \(100\.0%\)/.test(s), "supported row shows 2 entailment at 100%");
  assert.ok(/unrelated.*n\/a/.test(s), "empty row shows n/a, not 0.0% or NaN");
}

// --- call-failure guard ------------------------------------------------------------------
// The 2026-08-07 re-run lost 21 calls to an expired SSO token, printed a matrix identical to
// the previous run, and exited 0 with "VERDICT: SHIP". A failed call is not a data point.
assert.doesNotThrow(() => assertNoCallFailures(0, "arm 1"));
assert.throws(() => assertNoCallFailures(1, "arm 1"), /void/, "one failure is enough to void the run");
assert.throws(() => assertNoCallFailures(21, "arm 2 (synthetic)"), /21 call\(s\) failed/,
  "message must name the count");
assert.throws(() => assertNoCallFailures(21, "arm 2 (synthetic)"), /during arm 2 \(synthetic\)/,
  "message must name the arm, so a reader knows what to re-run");

// --- decision rule ---------------------------------------------------------------------
// Boundaries are inclusive as documented: exactly at the threshold passes.
assert.equal(decide(FALSE_ALARM_MAX, SYNTHETIC_RECALL_MIN), "ship");
assert.equal(decide(0.0, 1.0), "ship");
assert.equal(decide(0.02, 0.5), "safe-but-weak", "quiet but blind");
// A noisy gate is unusable at ANY recall — false alarm is checked first on purpose.
assert.equal(decide(0.2, 1.0), "unusable", "perfect recall does not rescue a noisy gate");
assert.equal(decide(FALSE_ALARM_MAX + 1e-9, 1.0), "unusable", "strictly above the max fails");

// tsx transpiles these scripts to CJS, where top-level await is a transform error, so the
// async assertions live in a function that is awaited at the bottom.
async function asyncTests() {
// --- repair: evict-and-retry decision ---------------------------------------------------
{
  const mkOps = (cached: Set<string>) => {
    const evicted: string[] = [];
    return {
      evicted,
      ops: {
        hasCached: async (id: string, p: string) => cached.has(id + p),
        evictCached: async (id: string, p: string) => { evicted.push(id + p); return cached.delete(id + p); },
      },
    };
  };
  const mkModel = (responses: string[]) => {
    const calls: string[] = [];
    return { calls, m: { id: "m1", call: async (p: string) => { calls.push(p); return responses[calls.length - 1] ?? responses[responses.length - 1]; } } };
  };
  const parse = (s: string) => (s === "GOOD" ? "ok" : null);

  // Parses on the first try: no eviction, exactly one call, regardless of cache state.
  for (const cached of [new Set<string>(), new Set(["m1P"])]) {
    const { evicted, ops } = mkOps(cached);
    const { calls, m } = mkModel(["GOOD"]);
    const r = await callParsed(m, "P", parse, ops);
    assert.deepEqual(r, { value: "ok", repaired: false });
    assert.equal(calls.length, 1);
    assert.deepEqual(evicted, []);
  }

  // FRESH failure: retrying is guaranteed to return the same bytes at temperature 0, so it
  // must NOT retry. A retry here would double the cost of every genuine failure.
  {
    const { evicted, ops } = mkOps(new Set());
    const { calls, m } = mkModel(["TRUNCATED"]);
    const r = await callParsed(m, "P", parse, ops);
    assert.deepEqual(r, { value: null, repaired: false });
    assert.equal(calls.length, 1, "must not retry a fresh failure");
    assert.deepEqual(evicted, [], "nothing to evict");
  }

  // CACHED failure: the stale entry was written under a smaller budget and would replay
  // forever, so it must be evicted and re-fetched exactly once.
  {
    const { evicted, ops } = mkOps(new Set(["m1P"]));
    const { calls, m } = mkModel(["TRUNCATED", "GOOD"]);
    const r = await callParsed(m, "P", parse, ops);
    assert.deepEqual(r, { value: "ok", repaired: true });
    assert.equal(calls.length, 2, "evict then re-fetch");
    assert.deepEqual(evicted, ["m1P"]);
  }

  // Repair that still fails reports null AND repaired:true — the eviction happened and the
  // run is no longer a clean cache replay, which the counter must reflect either way.
  {
    const { ops } = mkOps(new Set(["m1P"]));
    const { calls, m } = mkModel(["TRUNCATED", "STILL BAD"]);
    const r = await callParsed(m, "P", parse, ops);
    assert.deepEqual(r, { value: null, repaired: true });
    assert.equal(calls.length, 2, "retries once, not forever");
  }

  // The pre-check must read the cache BEFORE the call. If it read after, a fresh call would
  // have written its own entry and every fresh failure would look cached — reintroducing
  // the retry-on-fresh-failure cost. Pin the order.
  {
    const order: string[] = [];
    const ops = {
      hasCached: async () => { order.push("hasCached"); return false; },
      evictCached: async () => { order.push("evict"); return true; },
    };
    const m = { id: "m1", call: async () => { order.push("call"); return "TRUNCATED"; } };
    await callParsed(m, "P", parse, ops);
    assert.deepEqual(order, ["hasCached", "call"], "hasCached must precede the call");
  }
}

// --- cache key / eviction round-trip (real filesystem, stub model, no network) -----------
{
  // A `stub:` id runs the deterministic offline stub in ingest/llm.ts — no credentials, no
  // Bedrock call — and the prompt is unique to this test, so nothing else in the shared
  // response cache can collide with it or be evicted by it.
  const stub = modelFromId("stub:nli-probe-cache-test");
  const prompt = `nli-probe cache round-trip ${process.pid}`;

  assert.equal(cacheKeyFor("a", "p"), cacheKeyFor("a", "p"), "deterministic");
  assert.notEqual(cacheKeyFor("a", "p"), cacheKeyFor("b", "p"), "model id is part of the key");
  assert.notEqual(cacheKeyFor("a", "p"), cacheKeyFor("a", "q"), "prompt is part of the key");

  assert.equal(await hasCached(stub.id, prompt), false, "not cached before the first call");
  await cachedCall(stub, prompt);
  assert.equal(await hasCached(stub.id, prompt), true, "cached after");
  assert.equal(await evictCached(stub.id, prompt), true, "eviction reports the removal");
  assert.equal(await hasCached(stub.id, prompt), false, "gone after eviction");
  assert.equal(await evictCached(stub.id, prompt), false, "absent is not an error, and is reported as false");
}
}

asyncTests().then(
  () => console.log("✅ test-cases-nli-probe passed"),
  (e) => { console.error(e); process.exit(1); },
);
