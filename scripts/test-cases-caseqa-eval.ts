// Offline unit tests for the answer-quality eval instrument. No AWS, no LLM calls —
// every model is a hand-rolled fake. Run: npx tsx scripts/test-cases-caseqa-eval.ts
//
// Modules load via dynamic import inside the IIFE (the house pattern), but the record type
// is imported statically: annotating the fixture is what makes the discriminated union
// check, and a cast would hide exactly the mismatch these tests exist to catch.
import assert from "node:assert/strict";
import type { EvalRecord } from "../src/lib/cases/caseqa-eval/metrics";

(async () => {
  const { makeRng, seededShuffle } = await import("../src/lib/cases/caseqa-eval/rng");

  // --- rng: same seed, same stream ------------------------------------------------
  {
    const a = makeRng(1), b = makeRng(1);
    const xs = [a(), a(), a()], ys = [b(), b(), b()];
    assert.deepEqual(xs, ys, "same seed must produce the same stream");
    xs.forEach((x) => assert.ok(x >= 0 && x < 1, `out of range: ${x}`));
  }
  {
    const a = makeRng(1), b = makeRng(2);
    assert.notEqual(a(), b(), "different seeds must diverge");
  }

  // --- seededShuffle: deterministic, non-mutating, a permutation -------------------
  {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const frozen = [...input];
    const s1 = seededShuffle(input, 42);
    const s2 = seededShuffle(input, 42);
    assert.deepEqual(input, frozen, "shuffle must not mutate its input");
    assert.deepEqual(s1, s2, "same seed must produce the same order");
    assert.deepEqual([...s1].sort((x, y) => x - y), frozen, "must be a permutation");
    assert.notDeepEqual(s1, frozen, "a shuffle of 8 items should reorder them");
  }

  console.log("✅ test-cases-caseqa-eval passed");
})();
