// Tests for the sufficiency instrument's pure parts.
// Run: npx tsx scripts/test-cases-sufficiency.ts
import assert from "node:assert/strict";
import fsSync from "node:fs";
import { buildSufficiencyPrompt, parseSufficiency, VARIANTS, VARIANT_IDS } from "../src/lib/cases/sufficiency/prompt";
import {
  falseRefusalRate, projectedFalseAnswerRate, decide, assertNoCallFailures,
  FALSE_REFUSAL_MAX, PROJECTED_FALSE_ANSWER_MAX, BASELINE_FALSE_ANSWER,
} from "../src/lib/cases/sufficiency/tally";

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

console.log("✅ test-cases-sufficiency passed");
