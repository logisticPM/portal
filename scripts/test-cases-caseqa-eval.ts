// Offline unit tests for the answer-quality eval instrument. No AWS, no LLM calls —
// every model is a hand-rolled fake. Run: npx tsx scripts/test-cases-caseqa-eval.ts
//
// Modules load via dynamic import inside the IIFE (the house pattern), but the record type
// is imported statically: annotating the fixture is what makes the discriminated union
// check, and a cast would hide exactly the mismatch these tests exist to catch.
import assert from "node:assert/strict";

// Modules load via dynamic import inside the IIFE (the house pattern), but the record type is
// imported statically: annotating the fixture is what makes TypeScript check the discriminated
// union, and a cast would hide exactly the mismatch these tests exist to catch.
//
// This import belongs to THIS task, not an earlier one. `tsx` erases type-only imports before
// resolving them, so a forward reference to a module that does not exist yet runs fine and
// fails only under `tsc` — which is what CI runs. An earlier draft of this plan put the line
// in Task 1 and broke `typecheck` at three task boundaries.
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

  const { MIN_TARGET_PARA_CHARS, GIMME_MIN_RUN, pickTargets, buildQuestionPrompt, isLexicalGimme } =
    await import("../src/lib/cases/caseqa-eval/construct");

  // --- pickTargets: honours the length floor, is seeded, one target per case --------
  {
    const long = (n: number, tag: string) => tag + "x".repeat(n);
    const cases = [
      { id: "c1", chunks: [
        { paragraph: "para-1", text: "Appeal dismissed." },                    // too short
        { paragraph: "para-2", text: long(MIN_TARGET_PARA_CHARS, "A") },       // eligible
        { paragraph: "para-3", text: long(MIN_TARGET_PARA_CHARS, "B") } ] },   // eligible
      { id: "c2", chunks: [
        { paragraph: "para-9", text: long(MIN_TARGET_PARA_CHARS, "C") } ] },
      { id: "c3", chunks: [
        { paragraph: "para-1", text: "Costs to the respondent." } ] },         // no eligible para
    ];

    const picked = pickTargets(cases, 1, 10);
    assert.equal(picked.length, 2, "c3 has no paragraph over the floor and must be skipped");
    assert.deepEqual(picked.map((p) => p.caseId).sort(), ["c1", "c2"]);
    picked.forEach((p) => assert.ok(p.text.length >= MIN_TARGET_PARA_CHARS));
    assert.ok(!picked.some((p) => p.paragraph === "para-1" && p.caseId === "c1"),
      "the short paragraph must never be chosen");

    // Seeded: same seed same picks, and `count` caps the number of CASES.
    assert.deepEqual(pickTargets(cases, 1, 10), picked, "same seed must pick the same targets");
    assert.equal(pickTargets(cases, 1, 1).length, 1, "count caps the case list");
  }

  // --- isLexicalGimme: rejects a long verbatim run, at the boundary ----------------
  {
    const para = "The honour of the Crown requires that the duty to consult be discharged before the permit issues.";
    const run = para.slice(0, GIMME_MIN_RUN);                       // exactly at the threshold
    assert.equal(isLexicalGimme(`So what happens when ${run}`, para), true,
      `a verbatim run of ${GIMME_MIN_RUN} chars is a gimme`);
    assert.equal(isLexicalGimme(`So what happens when ${para.slice(0, GIMME_MIN_RUN - 1)}`, para), false,
      "one char under the threshold is not a gimme");
    assert.equal(isLexicalGimme("Do we get told before they approve the mine?", para), false,
      "a genuine lay paraphrase is not a gimme");
    // Whitespace must not smuggle a match past the check.
    assert.equal(isLexicalGimme(`x  ${run.replace(/ /g, "   ")}`, para), true,
      "normalisation must apply before matching");
  }

  // --- buildQuestionPrompt: carries the paragraph and forbids quoting it -----------
  {
    const p = buildQuestionPrompt(
      { styleOfCause: "Nation v Canada", citation: "2020 SCC 1", court: "SCC", year: 2020 },
      { paragraph: "para-7", text: "The Crown must consult in good faith." });
    assert.ok(p.includes("The Crown must consult in good faith."), "the paragraph text must be present");
    assert.ok(p.includes("Nation v Canada"), "the case must be identified");
    assert.ok(/first person/i.test(p), "the register must be instructed");
    assert.ok(/do not (quote|copy)/i.test(p), "verbatim copying must be forbidden in the prompt");
  }

  const { buildFaithfulnessPrompt, parseVerdict, buildAddressedPrompt, parseAddressed } =
    await import("../src/lib/cases/caseqa-eval/judge");

  // --- parseVerdict: the four verdicts, tolerant of wrapping, null on garbage ------
  {
    assert.equal(parseVerdict('{"verdict":"supported"}'), "supported");
    assert.equal(parseVerdict('{"verdict":"overstated"}'), "overstated");
    assert.equal(parseVerdict('{"verdict":"contradicted"}'), "contradicted");
    assert.equal(parseVerdict('{"verdict":"unrelated"}'), "unrelated");
    // Models wrap JSON in prose and fences; both must survive.
    assert.equal(parseVerdict('Here is my answer:\n```json\n{"verdict": "SUPPORTED"}\n```'), "supported");
    assert.equal(parseVerdict('{"reason":"...","verdict":"contradicted"}'), "contradicted");
    // Unparseable must be null, NOT a default verdict — a silent default would count a
    // judge failure as evidence about the product.
    assert.equal(parseVerdict("I cannot tell."), null);
    assert.equal(parseVerdict('{"verdict":"mostly ok"}'), null);
    assert.equal(parseVerdict(""), null);
  }

  // --- parseAddressed: boolean, null on garbage -----------------------------------
  {
    assert.equal(parseAddressed('{"addressed":true}'), true);
    assert.equal(parseAddressed('{"addressed":false}'), false);
    assert.equal(parseAddressed('```json\n{"addressed": false}\n```'), false);
    assert.equal(parseAddressed("maybe"), null);
    assert.equal(parseAddressed('{"addressed":"yes"}'), null);
  }

  // --- prompts carry what they must ------------------------------------------------
  {
    const f = buildFaithfulnessPrompt("The Crown had to consult first.", "The Crown must consult in good faith before issuing.");
    assert.ok(f.includes("The Crown had to consult first."));
    assert.ok(f.includes("The Crown must consult in good faith before issuing."));
    ["supported", "overstated", "contradicted", "unrelated"].forEach((v) =>
      assert.ok(f.includes(v), `the prompt must name the ${v} verdict`));

    const a = buildAddressedPrompt("Can they take my land?", "Nation v Canada", "[para 1] Something about fishing.");
    assert.ok(a.includes("Can they take my land?"));
    assert.ok(a.includes("[para 1] Something about fishing."));
    assert.ok(/addressed/.test(a), "the prompt must ask for the `addressed` field");
  }

  const { score } = await import("../src/lib/cases/caseqa-eval/metrics");

  // --- the four metrics on a hand-built population --------------------------------
  {
    const records: EvalRecord[] = [
      // answered, cited the target -> responsive
      { kind: "answerable", caseId: "c1", qid: "q1", targetParagraph: "para-5",
        outcome: "answered", citedParagraphs: ["para-5", "para-6"], droppedClaims: 0,
        claims: [{ text: "a", sourceParagraph: "para-5", verdict: "supported" },
                 { text: "b", sourceParagraph: "para-6", verdict: "overstated" }] },
      // answered, missed the target -> not responsive
      { kind: "answerable", caseId: "c2", qid: "q2", targetParagraph: "para-9",
        outcome: "answered", citedParagraphs: ["para-2"], droppedClaims: 1,
        claims: [{ text: "c", sourceParagraph: "para-2", verdict: "contradicted" }] },
      // refused a question we know is answerable -> false refusal
      { kind: "answerable", caseId: "c3", qid: "q3", targetParagraph: "para-1",
        outcome: "refused", failKind: "not_addressed", citedParagraphs: [], claims: [],
        droppedClaims: 0 },
      // errored -> excluded from every rate, reported separately
      { kind: "answerable", caseId: "c4", qid: "q4", targetParagraph: "para-1",
        outcome: "errored", citedParagraphs: [], claims: [], droppedClaims: 0 },
      // unanswerable, correctly refused
      { kind: "unanswerable", caseId: "c5", qid: "q1x", outcome: "refused",
        failKind: "not_addressed", claims: [], droppedClaims: 0 },
      // unanswerable, answered anyway -> false answer
      { kind: "unanswerable", caseId: "c6", qid: "q2x", outcome: "answered", droppedClaims: 0,
        claims: [{ text: "d", sourceParagraph: "para-3", verdict: null }] },
    ];

    const m = score(records);

    assert.equal(m.answerable.attempted, 4);
    assert.equal(m.answerable.answered, 2);
    assert.equal(m.answerable.refused, 1);
    assert.equal(m.answerable.errored, 1);
    assert.equal(m.answerable.responsive, 1);
    assert.equal(m.answerable.responsivenessAtPara, 0.5, "1 of 2 answered cited the target");
    // Rates exclude `errored`: a network failure is not a refusal. Denominator is 2+1=3.
    assert.ok(Math.abs(m.answerable.falseRefusalRate - 1 / 3) < 1e-9,
      `falseRefusalRate must exclude errored, got ${m.answerable.falseRefusalRate}`);
    assert.deepEqual(m.answerable.failKinds, { not_addressed: 1 });

    assert.equal(m.unanswerable.attempted, 2);
    assert.equal(m.unanswerable.falseAnswerRate, 0.5);

    // Faithfulness spans BOTH buckets, and `null` is counted as unparsed, never as a verdict.
    assert.equal(m.faithfulness.judged, 3, "4 claims, 1 unparsed");
    assert.equal(m.faithfulness.unparsed, 1);
    assert.deepEqual(m.faithfulness.counts,
      { supported: 1, overstated: 1, contradicted: 1, unrelated: 0 });
    assert.ok(Math.abs(m.faithfulness.supportedRate - 1 / 3) < 1e-9);
  }

  // --- reconciliation throws rather than printing a wrong table --------------------
  {
    const bad = [{ kind: "answerable", caseId: "c1", qid: "q1", targetParagraph: "para-1",
      outcome: "teleported", citedParagraphs: [], claims: [], droppedClaims: 0 }] as unknown as EvalRecord[];
    assert.throws(() => score(bad), /reconcil|outcome/i,
      "an unknown outcome must abort, not vanish from the denominator");
  }

  // --- empty population is an error, not a scorecard of zeros ----------------------
  {
    assert.throws(() => score([]), /no records/i,
      "cases-eval.ts once printed all-zero rows and exited 0; that must not recur");
  }

  console.log("✅ test-cases-caseqa-eval passed");
})();
