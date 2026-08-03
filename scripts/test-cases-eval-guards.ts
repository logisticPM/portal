import assert from "node:assert/strict";
import { evalAbortReason, type EvalEvidence } from "../src/lib/cases/validate/eval-guards";

const base: EvalEvidence = { caseCount: 5453, emptyRankedLists: 0, totalRankedLists: 54, metrics: [0.403, 0.516, 0.523] };

// A healthy run passes.
assert.equal(evalAbortReason(base), null);

// An empty index cannot score anything, and this is checked before the others so the
// message names the actual cause rather than the symptom.
{
  const r = evalAbortReason({ ...base, caseCount: 0 });
  assert.ok(r, "empty index must abort");
  assert.match(r!, /index is empty/i);
}

// Every ranked list empty — the retriever returned nothing for any query.
{
  const r = evalAbortReason({ ...base, emptyRankedLists: 54, metrics: [0, 0, 0] });
  assert.ok(r, "an all-empty retriever must abort");
  assert.match(r!, /every ranked list/i);
  assert.doesNotMatch(r!, /every metric/i, "the more specific cause wins");
}

// Lists are non-empty but disjoint from every judgment: a different bug, same signature.
{
  const r = evalAbortReason({ ...base, emptyRankedLists: 0, metrics: [0, 0, 0, 0] });
  assert.ok(r, "an all-zero scorecard must abort");
  assert.match(r!, /every metric/i);
}

// THE REGRESSION THAT MATTERS: a genuinely bad retriever still reports its bad numbers.
// The guards exist to catch "measured nothing", never to turn "retrieval is poor" into a
// crash — that would hide the very result the eval is for.
assert.equal(evalAbortReason({ ...base, metrics: [0.02, 0, 0.01] }), null,
  "one zero among non-zeros is a real (bad) score, not a broken instrument");
assert.equal(evalAbortReason({ ...base, emptyRankedLists: 53, totalRankedLists: 54, metrics: [0.01, 0, 0] }), null,
  "53 of 54 empty is terrible retrieval, but it IS a measurement");

// Degenerate inputs must not abort on arithmetic alone.
assert.equal(evalAbortReason({ ...base, totalRankedLists: 0, emptyRankedLists: 0 }), null,
  "no lists at all is not the same as all lists empty");
assert.equal(evalAbortReason({ ...base, metrics: [] }), null,
  "no metrics collected yet is not an all-zero scorecard");

console.log("✅ test-cases-eval-guards passed");
