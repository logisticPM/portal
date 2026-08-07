// Tests for the sufficiency instrument's pure parts.
// Run: npx tsx scripts/test-cases-sufficiency.ts
import assert from "node:assert/strict";
import { buildSufficiencyPrompt, parseSufficiency } from "../src/lib/cases/sufficiency/prompt";
import { stripTarget, assertTargetAbsent } from "../src/lib/cases/sufficiency/arms";

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
  // not say so, the rater collapses to a topic-relevance check and arm L becomes unpassable.
  assert.ok(/relevant/i.test(p) && /not enough|is not sufficient|insufficient/i.test(p),
    "prompt must explicitly separate relevant from sufficient");
}

// --- stripTarget -------------------------------------------------------------------------
{
  const chunks = [
    { paragraph: "para-1", text: "first" },
    { paragraph: "para-2", text: "second" },
    { paragraph: "para-3", text: "third" },
  ];
  const { kept } = stripTarget(chunks, "para-2");
  assert.deepEqual(kept.map((c) => c.paragraph), ["para-1", "para-3"], "removes exactly the target");
  assert.equal(chunks.length, 3, "must not mutate the caller's array");

  // A target that is not present means the caller and the corpus disagree about what the
  // target IS. Silently returning all three chunks would make arm L identical to arm S while
  // being scored as a negative — every rater would 'fail' it, and the failure would be ours.
  assert.throws(() => stripTarget(chunks, "para-9"), /para-9/,
    "absent target must throw, naming the paragraph");

  // Duplicate ids would remove two paragraphs, so the item is no longer a controlled
  // single-paragraph deletion and its label no longer means what the report says it means.
  const dup = [{ paragraph: "para-1", text: "a" }, { paragraph: "para-1", text: "b" }];
  assert.throws(() => stripTarget(dup, "para-1"), /2/, "duplicate ids must throw, naming the count");
}

// --- assertTargetAbsent ------------------------------------------------------------------
{
  // assembleInput emits `[para <id>] <text>` lines, so absence is checked against that exact
  // tag. Checking for the bare id would false-positive on any paragraph whose TEXT mentions it.
  assert.doesNotThrow(() => assertTargetAbsent("[para para-1] first\n[para para-3] third", "para-2"));
  assert.throws(() => assertTargetAbsent("[para para-1] a\n[para para-2] b", "para-2"), /para-2/,
    "target still in the assembled body must throw");
  // The guard must not fire merely because the id appears inside prose.
  assert.doesNotThrow(() => assertTargetAbsent("[para para-1] see para-2 above", "para-2"),
    "a mention in prose is not the paragraph itself");
}

console.log("✅ test-cases-sufficiency passed");
