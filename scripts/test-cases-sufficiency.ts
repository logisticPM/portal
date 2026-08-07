// Tests for the sufficiency instrument's pure parts.
// Run: npx tsx scripts/test-cases-sufficiency.ts
import assert from "node:assert/strict";
import fsSync from "node:fs";
import { buildSufficiencyPrompt, parseSufficiency, VARIANTS, VARIANT_IDS } from "../src/lib/cases/sufficiency/prompt";
import {
  falseRefusalRate, projectedFalseAnswerRate, decide, assertNoCallFailures,
  FALSE_REFUSAL_MAX, PROJECTED_FALSE_ANSWER_MAX, BASELINE_FALSE_ANSWER,
  wilson, classify, selectOnDev,
} from "../src/lib/cases/sufficiency/tally";
import { splitDevTest, assertDisjoint } from "../src/lib/cases/sufficiency/split";

// --- parseSufficiency --------------------------------------------------------------------
assert.deepEqual(parseSufficiency('{"reason":"para 12 states the test","sufficient":true}'),
  { sufficient: true, reason: "para 12 states the test" });
assert.deepEqual(parseSufficiency('```json\n{"reason":"r","sufficient":false}\n```'),
  { sufficient: false, reason: "r" }, "fenced JSON");
assert.deepEqual(parseSufficiency('Let me think.\n{"reason":" spaced ","sufficient":true}'),
  { sufficient: true, reason: "spaced" }, "prose preamble tolerated, reason trimmed");
// A missing reason is not fatal — the label is what gets scored, the reason is for the
// samples printer. A missing LABEL is fatal.
assert.deepEqual(parseSufficiency('{"sufficient":false}'), { sufficient: false, reason: "" });
// null means THE RATER FAILED. Defaulting to either label would manufacture evidence: a
// default of `false` inflates the gate's apparent catch rate, a default of `true` inflates its
// apparent safety. Both are conclusions invented from a broken response.
assert.equal(parseSufficiency("the judgment does address this"), null, "no JSON");
assert.equal(parseSufficiency('{"reason":"r"}'), null, "no label");
assert.equal(parseSufficiency('{"sufficient":"true"}'), null, "string is not a boolean");
assert.equal(parseSufficiency('{"sufficient":1}'), null, "1 is not a boolean");

// --- buildSufficiencyPrompt --------------------------------------------------------------
{
  const p = buildSufficiencyPrompt("QUESTION_TEXT", "STYLE_TEXT", "BODY_TEXT");
  assert.ok(p.includes("QUESTION_TEXT") && p.includes("STYLE_TEXT") && p.includes("BODY_TEXT"));
  // The rater must be asked about SUFFICIENCY, not groundedness. If it leaks the faithfulness
  // vocabulary it becomes the rung-3 checker again, which #237 measured and rejected.
  for (const w of ["entailment", "supported", "overstated", "contradicted"]) {
    assert.ok(!p.includes(w), `sufficiency prompt leaks faithfulness vocabulary: ${w}`);
  }
  // Reason before label in the output schema, so the model derives before it commits. The
  // project already uses reasoning-first schemas (RM-5) for exactly this reason.
  //
  // Scoped to the SCHEMA LINE, not the whole prompt. A first draft of this compared indexOf
  // over the entire string and failed against a correct prompt: the prose says
  // `Answer "sufficient": true only if ...` well before the schema, so the first occurrence of
  // the quoted key is prose, not schema. Naming the JSON key in the instructions is good prompt
  // writing; the assertion was measuring the wrong span.
  const schema = p.split("\n").find((l) => l.trim().startsWith('{"')) ?? "";
  assert.ok(schema.includes('"reason"') && schema.includes('"sufficient"'),
    "the output schema line must name both keys");
  assert.ok(schema.indexOf('"reason"') < schema.indexOf('"sufficient"'),
    "reason must precede the label in the output schema");
  // The paper's distinction is the whole point: relevant is not sufficient. If the prompt does
  // not say so, the rater collapses to a topic-relevance check — it would pass every cross-case
  // question in arm X, because those judgments are all on the same area of law.
  assert.ok(/relevant/i.test(p) && /not enough|is not sufficient|insufficient/i.test(p),
    "prompt must explicitly separate relevant from sufficient");
}

// --- rate definitions --------------------------------------------------------------------
// The two rates run in OPPOSITE directions over the rater's label, which is exactly the
// mistake worth pinning: on answerable questions `insufficient` is the error, on unanswerable
// questions `sufficient` is the error. A single shared helper would get one of them backwards.
assert.equal(falseRefusalRate({ sufficient: 95, insufficient: 5 }), 0.05,
  "arm S: refusing an answerable question is the error");
assert.equal(projectedFalseAnswerRate({ sufficient: 3, insufficient: 12 }), 0.2,
  "arm X: letting an unanswerable question through is the error");
assert.equal(falseRefusalRate({ sufficient: 0, insufficient: 0 }), 0, "empty arm is 0, not NaN");
assert.equal(projectedFalseAnswerRate({ sufficient: 0, insufficient: 0 }), 0, "empty arm is 0, not NaN");

// --- the pre-registered decision ---------------------------------------------------------
// Boundaries inclusive, as documented.
assert.equal(decide(FALSE_REFUSAL_MAX, PROJECTED_FALSE_ANSWER_MAX), "ship");
assert.equal(decide(0, 0), "ship");
// The gate works and the operating point is wrong — a tuning problem, not a dead end.
assert.equal(decide(0.30, 0.10), "tune-do-not-ship");
// The gate is safe and catches nothing. #237's gate A was exactly this, and it was not built.
assert.equal(decide(0.01, 0.90), "inert");
assert.equal(decide(0.30, 0.90), "unusable");
assert.equal(decide(FALSE_REFUSAL_MAX + 1e-9, 0.10), "tune-do-not-ship", "strictly above fails");
assert.equal(decide(0.01, PROJECTED_FALSE_ANSWER_MAX + 1e-9), "inert", "strictly above fails");
// The baseline is what the 20% is measured against and belongs in the module, not the prose.
assert.equal(BASELINE_FALSE_ANSWER, 0.938);

// --- call-failure guard ------------------------------------------------------------------
// A failed call is not a data point. #237's re-run lost 21 calls to an expired token, printed a
// matrix identical to the previous run, and exited 0 with a SHIP verdict.
assert.doesNotThrow(() => assertNoCallFailures(0, "arm S"));
assert.throws(() => assertNoCallFailures(1, "arm S"), /void/);
assert.throws(() => assertNoCallFailures(7, "arm X"), /7 call\(s\) failed/, "names the count");
assert.throws(() => assertNoCallFailures(7, "arm X"), /during arm X/, "names the arm");

// --- prompt variants ---------------------------------------------------------------------
{
  assert.deepEqual([...VARIANT_IDS], ["P0", "P1", "P2"], "the grid is pre-registered — three variants, in order");

  // P0 must remain byte-identical to what #239 measured, or its 92 cached responses stop
  // replaying and the published baseline silently becomes a different prompt. Compared against
  // a golden file rather than an inline string so a diff is readable when it fires.
  const golden = fsSync.readFileSync("scripts/fixtures/sufficiency-P0.txt", "utf8").replace(/\r\n/g, "\n");
  assert.equal(VARIANTS.P0("Q_TEXT", "S_TEXT", "B_TEXT").replace(/\r\n/g, "\n"), golden,
    "P0 changed — this invalidates the #239 baseline and its cache. If intentional, it is a NEW variant, not an edit to P0.");

  for (const id of VARIANT_IDS) {
    const p = VARIANTS[id]("Q_TEXT", "S_TEXT", "B_TEXT");
    assert.ok(p.includes("Q_TEXT") && p.includes("S_TEXT") && p.includes("B_TEXT"), `${id} interpolates all three`);
    const schema = p.split("\n").find((l) => l.trim().startsWith('{"')) ?? "";
    assert.ok(schema.indexOf('"reason"') < schema.indexOf('"sufficient"'), `${id}: reason must precede the label`);
    for (const w of ["entailment", "supported", "overstated", "contradicted"]) {
      assert.ok(!p.includes(w), `${id} leaks faithfulness vocabulary: ${w}`);
    }
  }

  // The hypothesis under test: every one of #239's ten refusals used the prompt's own word.
  // P0 keeps it; P1 and P2 exist precisely to drop it. If a variant kept it, the experiment
  // would be comparing a thing to itself.
  assert.ok(VARIANTS.P0("q", "s", "b").includes("definitive"), "P0 keeps 'definitive'");
  assert.ok(!VARIANTS.P1("q", "s", "b").includes("definitive"), "P1 must drop 'definitive'");
  assert.ok(!VARIANTS.P2("q", "s", "b").includes("definitive"), "P2 must drop 'definitive'");

  // Distinct text means distinct cache keys, so no variant can replay another's responses.
  const rendered = VARIANT_IDS.map((id) => VARIANTS[id]("q", "s", "b"));
  assert.equal(new Set(rendered).size, 3, "all three variants must render differently");
}

// --- dev/test split ----------------------------------------------------------------------
{
  const items = Array.from({ length: 10 }, (_, i) => ({ qid: `q${i}` }));
  const s = splitDevTest(items, 1, 4);
  assert.equal(s.dev.length, 4);
  assert.equal(s.test.length, 6);
  // Every item lands in exactly one side. A split that drops or duplicates an item silently
  // changes the denominator of every rate in the experiment.
  assert.deepEqual(
    [...s.dev, ...s.test].map((x) => x.qid).sort(),
    items.map((x) => x.qid).sort(),
    "dev + test must partition the input exactly",
  );
  // Deterministic: the whole method rests on test being the SAME held-out set across the dev
  // run and the later test run, which are separate processes.
  assert.deepEqual(splitDevTest(items, 1, 4), s, "same seed, same split");
  assert.notDeepEqual(splitDevTest(items, 2, 4).dev, s.dev, "different seed, different split");
  // Not simply the first N — an unshuffled split would correlate with corpus order.
  assert.notDeepEqual(s.dev.map((x) => x.qid), ["q0", "q1", "q2", "q3"], "split must be shuffled");

  assert.throws(() => splitDevTest(items, 1, 11), /11/, "devCount above the population must throw, naming it");
  assert.throws(() => splitDevTest(items, 1, -1), /-1/, "negative devCount must throw, naming it");
  assert.deepEqual(splitDevTest(items, 1, 0), { dev: [], test: splitDevTest(items, 1, 0).test }, "devCount 0 is legal");
}

// --- assertDisjoint ----------------------------------------------------------------------
{
  const key = (x: { qid: string }) => x.qid;
  assert.doesNotThrow(() => assertDisjoint({ dev: [{ qid: "a" }], test: [{ qid: "b" }] }, key));
  assert.throws(() => assertDisjoint({ dev: [{ qid: "a" }], test: [{ qid: "a" }] }, key), /a/,
    "an overlapping qid must throw, naming it");
  // The guard exists for the cross-process case: the dev run and the test run each recompute
  // the split, and a drift in construction between them could put a question on both sides.
  assert.throws(() => assertDisjoint({ dev: [{ qid: "a" }, { qid: "b" }], test: [{ qid: "b" }] }, key), /1 item/,
    "message must name how many overlapped");
}

// --- Wilson interval ---------------------------------------------------------------------
{
  const [lo, hi] = wilson(0, 80);
  assert.equal(lo, 0, "0 successes gives a lower bound of exactly 0");
  // The number that sized this whole experiment: at n=80, a perfect result clears a 5% bar and
  // a single failure does not. If this drifts, the spec's sizing argument is void.
  assert.ok(hi > 0.045 && hi < 0.047, `n=80, 0 failures should give ~4.6%, got ${(hi * 100).toFixed(2)}%`);
  const [, hi1] = wilson(1, 80);
  assert.ok(hi1 > 0.066 && hi1 < 0.068, `n=80, 1 failure should give ~6.7%, got ${(hi1 * 100).toFixed(2)}%`);
  // Normal approximation would give a negative lower bound here; Wilson must not.
  assert.ok(wilson(1, 100)[0] > 0, "lower bound must never go negative");
  assert.deepEqual(wilson(0, 0), [0, 0], "empty is 0,0 — not NaN");
}

// --- conclusiveness ----------------------------------------------------------------------
// Reported ALONGSIDE the point-estimate rule, never instead of it. #239 used point estimates
// and switching now would move the goalposts mid-experiment.
assert.equal(classify(0, 80, 0.05), "clears", "interval entirely below the bar");
// NOT "fails". The point estimate is 1.25% and the CI is [0.22%, 6.75%] — the upper bound sits
// above 5% but the lower bound is far below it, so at n=80 a single refusal cannot distinguish a
// rate under the bar from one over it. An earlier draft of this line asserted "fails", conflating
// "the upper bound exceeds the bar" with "the rate exceeds the bar". That conflation is exactly
// what classify() exists to prevent, so the test asserting it was self-defeating.
assert.equal(classify(1, 80, 0.05), "inconclusive-at-this-n", "1.25%, but CI [0.22, 6.75] straddles 5%");
assert.equal(classify(10, 38, 0.05), "fails", "the #239 result: 26.3%, CI [15.0, 42.0]");
assert.equal(classify(2, 60, 0.05), "inconclusive-at-this-n", "3.3% but the interval straddles 5%");
// The #239 arm X result. Upper bound 19.36% sits UNDER the 20% bar, so it clears — narrowly, and
// the spec's own status table already records it as a pass. "Just inside" is still inside.
assert.equal(classify(0, 16, 0.20), "clears", "0/16, CI [0.00, 19.36] — entirely under a 20% bar");

// --- dev selection rule ------------------------------------------------------------------
{
  const c = (s: number, i: number) => ({ sufficient: s, insufficient: i });
  // Lowest false refusal among those whose leakage clears the bar.
  const r = selectOnDev([
    { configId: "P0/a", armS: c(35, 5), armX: c(0, 20) },   // FR 12.5%, leak 0%
    { configId: "P0/b", armS: c(38, 2), armX: c(9, 11) },   // FR  5.0%, leak 45% — disqualified
    { configId: "P0/c", armS: c(37, 3), armX: c(2, 18) },   // FR  7.5%, leak 10% — winner
  ]);
  assert.equal(r.chosen?.configId, "P0/c");
  // A better false-refusal number must NOT rescue a config that leaks. Leakage is the defect
  // the gate exists for; a gate that lets questions through is not a gate.
  assert.ok(!/P0\/b/.test(r.reason), "the disqualified config must not be described as the winner");

  // Nothing qualifies -> null and a reason, never a relaxed bar.
  const none = selectOnDev([{ configId: "P0/a", armS: c(40, 0), armX: c(20, 0) }]);
  assert.equal(none.chosen, null);
  assert.match(none.reason, /leak|20/i, "the reason must say why nothing qualified");

  // Deterministic tie-break, so the same dev data always selects the same config.
  const tie = selectOnDev([
    { configId: "P0/z", armS: c(37, 3), armX: c(1, 19) },
    { configId: "P0/a", armS: c(37, 3), armX: c(1, 19) },
  ]);
  assert.equal(tie.chosen?.configId, "P0/a", "exact tie breaks on configId, lexicographically");

  assert.equal(selectOnDev([]).chosen, null, "empty input is null, not a crash");
}

console.log("✅ test-cases-sufficiency passed");
