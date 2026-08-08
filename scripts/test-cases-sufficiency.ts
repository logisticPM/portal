// Tests for the sufficiency instrument's pure parts.
// Run: npx tsx scripts/test-cases-sufficiency.ts
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSufficiencyPrompt, parseSufficiency, VARIANTS, VARIANT_IDS } from "../src/lib/cases/sufficiency/prompt";
import {
  falseRefusalRate, projectedFalseAnswerRate, decide, assertNoCallFailures,
  FALSE_REFUSAL_MAX, PROJECTED_FALSE_ANSWER_MAX, BASELINE_FALSE_ANSWER,
  wilson, classify, selectOnDev,
} from "../src/lib/cases/sufficiency/tally";
import { splitDevTest, assertDisjoint } from "../src/lib/cases/sufficiency/split";
import { readTestRuns, appendTestRun } from "../src/lib/cases/sufficiency/manifest";
import { isTransient, retryingModel } from "../src/lib/cases/sufficiency/retrying";

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

// --- retry-on-throttle: isTransient classification --------------------------------------
// Conservative by design: only the Bedrock/service exceptions this module names, or the
// literal throttling message, count as transient. Everything else — including this run's own
// truncation guard — must return false, because a wrongly-transient classification silently
// retries a real failure and, if the retry happens to succeed for an unrelated reason, reports
// it as though nothing went wrong.
{
  for (const name of [
    "ThrottlingException", "TooManyRequestsException", "ServiceUnavailableException",
    "ModelTimeoutException", "InternalServerException",
  ]) {
    const e = new Error("some detail");
    e.name = name;
    assert.equal(isTransient(e), true, `${name} must be transient`);
  }
  assert.equal(
    isTransient(new Error("Too many requests, please wait before trying again.")),
    true, "the literal Bedrock throttling message must be transient even under a generic Error name",
  );
  assert.equal(isTransient(new Error("boom")), false, "an ordinary error must not be treated as transient");
  assert.equal(
    isTransient(new Error("us.amazon.nova-pro-v1:0: response truncated at maxTokens=1024 with no text part — raise maxTokens")),
    false, "a truncation error is a real failure of the run's own making, not infrastructure noise",
  );
  assert.equal(isTransient("boom"), false, "a non-Error throw must not be treated as transient");
  assert.equal(isTransient(undefined), false, "undefined must not be treated as transient");
}

// --- prompt variants ---------------------------------------------------------------------
{
  assert.deepEqual([...VARIANT_IDS], ["P0", "P1", "P2"], "the grid is pre-registered — three variants, in order");

  // P0 must remain byte-identical to what #239 measured, or its 92 cached responses stop
  // replaying and the published baseline silently becomes a different prompt. Compared against
  // a golden file rather than an inline string so a diff is readable when it fires.
  //
  // Raw bytes, deliberately NOT normalised. The cache key is sha256(modelId + "\n" + prompt) over
  // the exact string sent to the model, so an \r\n-stripping comparison here could pass while a
  // `core.autocrlf=true` checkout had already changed the bytes inside this template literal —
  // the golden test would be green and the cache key would be a different one anyway.
  const golden = fsSync.readFileSync("scripts/fixtures/sufficiency-P0.txt", "utf8");
  const renderedP0 = VARIANTS.P0("Q_TEXT", "S_TEXT", "B_TEXT");
  assert.equal(renderedP0, golden,
    "P0 changed — this invalidates the #239 baseline and its cache. If intentional, it is a NEW variant, not an edit to P0.");
  // The #239 cache identity, pinned as a literal rather than derived from the fixture file at
  // runtime: sha256 of P0("Q_TEXT","S_TEXT","B_TEXT") exactly as it would be sent to the rater.
  // A corrupting checkout could rewrite the golden file's line endings along with the source,
  // in which case the raw-byte comparison above would still pass — this constant does not move
  // just because both sides of that comparison moved together.
  assert.equal(
    crypto.createHash("sha256").update(renderedP0, "utf8").digest("hex"),
    "ba7ecd128725722c1c30f8ffbeb49ff34d4907282f10605dd078cd81ac5036cc",
    "P0's rendered sha256 no longer matches the #239 cache identity",
  );

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

// n=0 must throw, not return the most favourable label. wilson(k,0) is [0,0], which sits under
// every bar, so an arm that measured nothing would otherwise report "clears" — and decide() would
// turn that into SHIP.
assert.throws(() => classify(0, 0, 0.05), /empty arm/, "n=0 has no conclusiveness");
assert.throws(() => classify(0, -1, 0.05), /empty arm/, "negative n too");

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

  // A rate computed over the survivors of a parse failure is not comparable to one computed over
  // a full arm. This config's false refusal (0%) is the lowest of the two AND it clears the
  // leakage bar, but 30 of its 40 arm-S items never parsed (30/60 = 50% combined) — it must lose
  // to a configuration with a worse false refusal but a clean parse, not win on a number bought by
  // discarding the hard cases.
  const highUnparsed = selectOnDev([
    { configId: "P0/lowfr-highunparsed", armS: c(10, 0), armX: c(0, 20), unparsed: { S: 30, X: 0 } },
    { configId: "P0/higherfr-clean", armS: c(37, 3), armX: c(2, 18), unparsed: { S: 0, X: 0 } },
  ]);
  assert.equal(highUnparsed.chosen?.configId, "P0/higherfr-clean",
    "the high-unparsed config must not win even though its false refusal on survivors is lowest");
  assert.ok(!/lowfr-highunparsed/.test(highUnparsed.reason),
    "the disqualified-by-unparsed config must not be described as the winner");
}

// tsx transpiles these scripts to CJS, where top-level await is a transform error, so the async
// assertions live in a function that is awaited at the bottom. Same pattern as
// scripts/test-cases-nli-probe.ts. The manifest is the first async-tested module here; every
// other assertion in this file is synchronous and stays at top level.
async function asyncTests() {
// --- test-run manifest -------------------------------------------------------------------
{
  const dir = path.join(os.tmpdir(), `suff-manifest-${process.pid}`);
  assert.deepEqual(await readTestRuns(dir), [], "no manifest yet is an empty list, not a crash");
  await appendTestRun(dir, { configId: "P1/nova-pro", at: "2026-08-07T00:00:00Z", armS: { sufficient: 78, insufficient: 2 }, armX: { sufficient: 0, insufficient: 40 } });
  await appendTestRun(dir, { configId: "P2/nova-pro", at: "2026-08-08T00:00:00Z", armS: { sufficient: 79, insufficient: 1 }, armX: { sufficient: 1, insufficient: 39 } });
  const runs = await readTestRuns(dir);
  assert.equal(runs.length, 2, "appends, does not overwrite — a second test run must not erase the first");
  assert.equal(runs[0].configId, "P1/nova-pro", "order preserved, so 'which was first' is answerable");
  assert.equal(runs[1].configId, "P2/nova-pro");
  fsSync.rmSync(dir, { recursive: true, force: true });
}

// --- retryingModel: bounded retry-on-throttle -------------------------------------------
// Mirrors nli-probe/repair.ts's callParsed tests: a small mock model recording its calls, and
// injected sleep/onRetry so nothing here waits on a real clock.
{
  const throttle = (): Error => {
    const e = new Error("Too many requests, please wait before trying again.");
    e.name = "ThrottlingException";
    return e;
  };

  // Transient on attempt 1, then succeeds: the call returns the value, and exactly one retry
  // was recorded — not zero (the failure must be seen) and not more (one success ends the loop).
  {
    const calls: string[] = [];
    const m = { id: "rater-1", call: async (p: string) => { calls.push(p); if (calls.length === 1) throw throttle(); return "OK"; } };
    const sleeps: number[] = [];
    const retries: Array<[number, unknown]> = [];
    const wrapped = retryingModel(m, {
      attempts: 5, baseDelayMs: 100,
      sleep: async (ms) => { sleeps.push(ms); },
      onRetry: (attempt, e) => retries.push([attempt, e]),
    });
    const out = await wrapped.call("PROMPT");
    assert.equal(out, "OK");
    assert.equal(wrapped.id, "rater-1", "the wrapper preserves the model id — same shape as cachedModel");
    assert.deepEqual(calls, ["PROMPT", "PROMPT"], "retried with the SAME prompt");
    assert.equal(retries.length, 1, "onRetry called exactly once");
    assert.equal(sleeps.length, 1, "sleep called exactly once");
  }

  // Non-transient error: rethrown immediately — no retry budget spent on a failure retrying
  // cannot fix.
  {
    const calls: string[] = [];
    const m = { id: "rater-1", call: async (p: string) => { calls.push(p); throw new Error("boom"); } };
    const sleeps: number[] = [];
    const retries: unknown[] = [];
    const wrapped = retryingModel(m, {
      attempts: 5, baseDelayMs: 100,
      sleep: async (ms) => { sleeps.push(ms); },
      onRetry: (_attempt, e) => retries.push(e),
    });
    await assert.rejects(wrapped.call("PROMPT"), /boom/);
    assert.equal(calls.length, 1, "a non-transient error must not be retried");
    assert.equal(sleeps.length, 0, "sleep must never be called for a non-transient error");
    assert.equal(retries.length, 0, "onRetry must never be called for a non-transient error");
  }

  // Transient every time: rethrows the LAST attempt's error, unchanged (same object), after
  // exactly `attempts` calls — not attempts+1, not an earlier attempt's error, and not a new
  // error of this module's own making.
  {
    let n = 0;
    let lastThrown: Error | null = null;
    const m = { id: "rater-1", call: async () => { n++; const e = throttle(); lastThrown = e; throw e; } };
    const sleeps: number[] = [];
    const wrapped = retryingModel(m, { attempts: 4, baseDelayMs: 50, sleep: async (ms) => { sleeps.push(ms); } });
    let caught: unknown = null;
    try { await wrapped.call("PROMPT"); assert.fail("must throw once attempts are exhausted"); }
    catch (e) { caught = e; }
    assert.equal(n, 4, "exactly `attempts` calls, no more");
    assert.equal(sleeps.length, 3, "one sleep between each pair of attempts, none after the last");
    assert.equal(caught, lastThrown, "must rethrow the LAST attempt's error object, unchanged");
  }

  // Backoff grows: recorded sleep durations must be non-decreasing. baseDelayMs bounds the
  // jitter to less than one doubling step, so this pins a guaranteed-by-construction ordering
  // (see retrying.ts), not a flaky assertion about Math.random().
  {
    const m = { id: "rater-1", call: async () => { throw throttle(); } };
    const sleeps: number[] = [];
    const wrapped = retryingModel(m, { attempts: 5, baseDelayMs: 20, sleep: async (ms) => { sleeps.push(ms); } });
    await assert.rejects(wrapped.call("PROMPT"));
    assert.equal(sleeps.length, 4);
    for (let i = 1; i < sleeps.length; i++) {
      assert.ok(sleeps[i] >= sleeps[i - 1], `sleep durations must be non-decreasing, got ${JSON.stringify(sleeps)}`);
    }
  }
}
}

asyncTests().then(
  () => console.log("✅ test-cases-sufficiency passed"),
  (e) => { console.error(e); process.exit(1); },
);
