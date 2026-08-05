// Offline unit tests for the answer-quality eval instrument. No AWS, no LLM calls —
// every model is a hand-rolled fake. Run: npx tsx scripts/test-cases-caseqa-eval.ts
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

  // --- isProseShaped: the measured front-matter / body split ------------------------
  // Thresholds come from measuring six judgments, not from feel. Fixtures below reproduce
  // the two closest real cases on either side of the gap, so a change to the threshold
  // that would misclassify real corpus text fails here.
  {
    const { isProseShaped, MIN_TARGET_AVG_LINE } = await import("../src/lib/cases/caseqa-eval/construct");
    // Build text with an exact target average line length.
    const shaped = (lines: number, avg: number) =>
      Array.from({ length: lines }, () => "x".repeat(avg - 1)).join("\n");

    // Closest real FRONT matter: 2021-onca-779 chunk 1, a counsel list, avg 131.
    assert.equal(isProseShaped(shaped(13, 131)), false, "a counsel list at avg 131 must be rejected");
    // Closest real BODY prose: 2004-bcsc-142 chunk 19, 7 lines, avg 292.
    assert.equal(isProseShaped(shaped(7, 292)), true, "body prose at avg 292 must be accepted");
    // The extremes.
    assert.equal(isProseShaped(shaped(52, 37)), false, "a caption block (52 lines, avg 37) must be rejected");
    assert.equal(isProseShaped(shaped(74, 25)), false, "a table of contents (74 lines, avg 25) must be rejected");
    assert.equal(isProseShaped(shaped(1, 2042)), true, "a single long paragraph must be accepted");
    // Boundary, exactly at and just under (parameterised by the constant — catches an
    // off-by-one in the comparison itself, e.g. `>` instead of `>=`).
    assert.equal(isProseShaped(shaped(1, MIN_TARGET_AVG_LINE + 1)), true, "at the threshold must pass");
    assert.equal(isProseShaped(shaped(10, MIN_TARGET_AVG_LINE - 50)), false, "under the threshold must fail");
    // FIX 3 (2026-08-04 review): the two assertions above are expressed IN TERMS OF the
    // constant, so if the constant itself drifts — the reviewer set MIN_TARGET_AVG_LINE to 150
    // and every assertion in this block, including the one 50-chars-under one above, stayed
    // green, because 149.9 is under 150 just as surely as it is under 200 — they drift right
    // along with it and catch nothing. These two are pinned with LITERAL numbers instead, so
    // moving the constant cannot move the test with it:
    //   shaped(n, avg) joins `n` lines of length `avg - 1` with `n - 1` newlines, so
    //   text.length = n*avg - 1 and the computed average is exactly avg - 1/n.
    // shaped(1, 201): avg = 201 - 1/1 = 200.0 exactly — the literal spec threshold.
    assert.equal(shaped(1, 201).length, 200, "arithmetic check: this fixture must actually compute to avg 200.0");
    assert.equal(isProseShaped(shaped(1, 201)), true,
      "avg 200.0, pinned as a literal number (not MIN_TARGET_AVG_LINE + 1)");
    // shaped(1, 200): avg = 200 - 1/1 = 199.0 exactly — one unit under the literal threshold.
    // This is the assertion that actually catches the drift: with the threshold moved to 150,
    // 199.0 >= 150 is true, so a mutant that lowered the constant would flip this to `true` and
    // this line — expecting `false`, pinned independently of the constant — fails.
    assert.equal(shaped(1, 200).length, 199, "arithmetic check: this fixture must actually compute to avg 199.0");
    assert.equal(isProseShaped(shaped(1, 200)), false,
      "avg 199.0, one unit under the literal 200 threshold (not MIN_TARGET_AVG_LINE - 1)");
    // Degenerate input must not throw or divide by zero.
    assert.equal(isProseShaped(""), false);
    assert.equal(isProseShaped("\n\n\n"), false, "no non-empty line means no prose");
  }

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

    const picked = pickTargets(cases, 1, 10).targets;
    assert.equal(picked.length, 2, "c3 has no paragraph over the floor and must be skipped");
    assert.deepEqual(picked.map((p) => p.caseId).sort(), ["c1", "c2"]);
    picked.forEach((p) => assert.ok(p.text.length >= MIN_TARGET_PARA_CHARS));
    assert.ok(!picked.some((p) => p.paragraph === "para-1" && p.caseId === "c1"),
      "the short paragraph must never be chosen");

    // Seeded: same seed same picks, and `count` caps the number of CASES.
    assert.deepEqual(pickTargets(cases, 1, 10).targets, picked, "same seed must pick the same targets");
    assert.equal(pickTargets(cases, 1, 1).targets.length, 1, "count caps the case list");

    // Stage 1: a chunk can clear the character floor and still be a caption. This fixture is
    // shaped like the real one that got through — 2002-bcsc-1199 para-1, a docket header.
    const caption = "Citation:\n" + Array.from({ length: 40 }, (_, i) => `Field ${i}: value`).join("\n");
    assert.ok(caption.length >= MIN_TARGET_PARA_CHARS, "the fixture must clear the char floor to be a real test");
    const withCaption = [...cases, { id: "cap", chunks: [{ paragraph: "para-1", text: caption }] }];
    const d2 = pickTargets(withCaption, 1, 10);
    assert.ok(!d2.targets.some((t) => t.caseId === "cap"), "a caption must never be chosen as a target");

    // The two skip reasons are counted SEPARATELY: "no long paragraph" is a fact about the
    // corpus, "long but wrong shape" is the front-matter filter doing its job. Merging them
    // would hide whether the shape threshold is throwing away real text.
    assert.equal(d2.rejectedByShape, 1, "the caption case");
    // PARAGRAPH-level count, which is the only one that moves when a case survives through a
    // different paragraph — exactly what 2002-bcsc-1199 does in the real corpus. c1 has no
    // wrong-shape paragraph over the floor, so this is the caption alone.
    assert.equal(d2.paragraphsRejectedByShape, 1, "the caption paragraph itself");
    assert.ok(d2.noLongPara >= 1, "c3 has no paragraph over the floor");

    // FIX 1 (2026-08-04 review) — the DISCRIMINATING fixture. The reviewer proved the "cap"
    // fixture above is not enough: it has ONLY a caption, so `rejectedByShape` (case-level) and
    // `paragraphsRejectedByShape` (paragraph-level) both read 1, and an implementation that
    // simply aliased `paragraphsRejectedByShape = rejectedByShape` — exactly the confusion this
    // counter exists to prevent — would pass it too. This fixture is modelled on the REAL case
    // that motivated the filter: 2002-bcsc-1199 para-1 is the docket caption that slipped
    // through as a target in the smoke run, but that SAME case has two good body paragraphs.
    // Only a fixture where the case-level and paragraph-level counters must DIVERGE (0 vs 1)
    // can distinguish the real counter from an alias of the other one.
    const discriminating = { id: "2002-bcsc-1199", chunks: [
      { paragraph: "para-1", text: caption },                          // the docket caption
      { paragraph: "para-2", text: long(MIN_TARGET_PARA_CHARS, "E") },  // good body prose
      { paragraph: "para-3", text: long(MIN_TARGET_PARA_CHARS, "F") },  // good body prose
    ] };
    const d3 = pickTargets([discriminating], 1, 10);
    assert.equal(d3.targets.length, 1,
      "the case must still be SAMPLED — it has two usable paragraphs despite the caption");
    assert.equal(d3.targets[0].caseId, "2002-bcsc-1199");
    assert.notEqual(d3.targets[0].paragraph, "para-1", "the caption itself must never be the chosen target");
    assert.equal(d3.rejectedByShape, 0,
      "the case-level counter must stay 0 — the case IS sampled, via para-2 or para-3, exactly " +
      "as the real 2002-bcsc-1199 run did");
    assert.equal(d3.paragraphsRejectedByShape, 1,
      "the paragraph-level counter must still increment for the rejected caption — this is the " +
      "one fixture that kills an implementation that aliases paragraphsRejectedByShape to rejectedByShape");
  }

  // --- pickTargets: paragraph choice is a per-case draw, not one shared draw --------
  // Two cases with the SAME eligible-paragraph count must be able to land on DIFFERENT
  // original indices. Before the per-case seed fix, seededShuffle(eligible, seed) used the
  // identical seed for every case, and a Fisher-Yates swap sequence for a fixed seed depends
  // only on array length — so every case with the same eligible count picked the same
  // original index, giving zero within-group variance across the whole sample.
  {
    const mkEligible = (tag: string, n: number) =>
      Array.from({ length: n }, (_, k) => ({ paragraph: `${tag}-${k}`, text: `${tag}` + "x".repeat(MIN_TARGET_PARA_CHARS) }));
    const sameCount = [
      { id: "same-count-1", chunks: mkEligible("X", 5) },
      { id: "same-count-2", chunks: mkEligible("Y", 5) },
    ];
    const picked = pickTargets(sameCount, 2, 2).targets;
    const origIndex = (p: { paragraph: string }) => Number(p.paragraph.split("-")[1]);
    const p1 = picked.find((p) => p.caseId === "same-count-1")!;
    const p2 = picked.find((p) => p.caseId === "same-count-2")!;
    assert.notEqual(origIndex(p1), origIndex(p2),
      "two cases with the same eligible-paragraph count must not be forced onto the same original index");
  }

  // --- pickTargets: casesExamined counts a PREFIX, not the corpus (FIX 2, 2026-08-04 review) ---
  // pickTargets breaks out of its loop the moment it has `count` targets, so cases after that
  // point are never inspected — the three shape counters therefore describe a prefix of the
  // corpus, not the whole population. Without casesExamined, a run where the first N shuffled
  // cases happen to be clean prints all-zero rejection counts, indistinguishable from "the
  // corpus has no front matter", and a reader cannot reconcile e.g. 500 cases / 40 targets / 0
  // rejections against a whole-corpus casesWithChunks.
  {
    const long = (n: number, tag: string) => tag + "x".repeat(n);
    const allEligible = Array.from({ length: 10 }, (_, i) => ({
      id: `e${i}`, chunks: [{ paragraph: "para-1", text: long(MIN_TARGET_PARA_CHARS, `E${i}`) }],
    }));
    const stoppedEarly = pickTargets(allEligible, 1, 3);
    assert.equal(stoppedEarly.targets.length, 3, "count caps the targets found");
    assert.equal(stoppedEarly.casesExamined, 3,
      "must stop counting the moment the cap is hit — the other 7 cases were never inspected, " +
      "so casesExamined must NOT read 10");

    const smallPopulation = Array.from({ length: 3 }, (_, i) => ({
      id: `s${i}`, chunks: [{ paragraph: "para-1", text: long(MIN_TARGET_PARA_CHARS, `S${i}`) }],
    }));
    const examinedAll = pickTargets(smallPopulation, 1, 10); // cap of 10 is never reached
    assert.equal(examinedAll.casesExamined, 3, "when the cap is never reached, every case examined counts");

    // Rejections still count as "examined": a case that fails stage 1 was inspected, not skipped.
    const rejectedButExamined = pickTargets(
      [{ id: "no-para", chunks: [{ paragraph: "para-1", text: "Too short." }] }], 1, 10);
    assert.equal(rejectedButExamined.casesExamined, 1,
      "a case rejected for having no long-enough paragraph was still examined");
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

  // --- isWellFormedQuestion: rejects a TRUNCATED question, not just an empty one ----
  // The runner's other check is `!question`, which an empty response trips but a question cut
  // mid-sentence does not — and that one would reach the answerer and be scored as if the
  // product could not answer it.
  {
    const { isWellFormedQuestion, MIN_QUESTION_CHARS } =
      await import("../src/lib/cases/caseqa-eval/construct");
    const good = "I left my job for a summer contract and now my benefits claim is pending. Will they deny it?";
    assert.equal(isWellFormedQuestion(good), true, "a complete lay question must pass");
    assert.equal(isWellFormedQuestion(good + "  \n"), true, "trailing whitespace must not matter");
    // Truncation: ends mid-word or on a comma, with no terminal punctuation.
    assert.equal(isWellFormedQuestion("I left my job for a summer contract and now my benefits claim is pen"), false,
      "a question cut mid-word must be rejected");
    assert.equal(isWellFormedQuestion("I lost my job. What now? And then the employer said,"), false,
      "a '?' earlier in the text must not rescue a truncated tail");
    // Too short to carry the "describe a situation, then ask" shape.
    assert.equal(isWellFormedQuestion("Why?"), false, "shorter than the floor must be rejected");
    assert.ok("Why?".length < MIN_QUESTION_CHARS, "that fixture must actually be under the floor");
    // A statement is not a question.
    assert.equal(isWellFormedQuestion("My employer terminated me without notice last March in Alberta."), false,
      "a declarative sentence with no '?' is not a question");
    assert.equal(isWellFormedQuestion(""), false);
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

  // --- parseSubstantive / buildSubstantivePrompt: stage 2 of target eligibility ------
  {
    const { buildSubstantivePrompt, parseSubstantive } =
      await import("../src/lib/cases/caseqa-eval/judge");

    assert.equal(parseSubstantive('{"substantive":true}'), true);
    assert.equal(parseSubstantive('{"substantive":false}'), false);
    assert.equal(parseSubstantive('```json\n{"substantive": false}\n```'), false, "fences must survive");
    assert.equal(parseSubstantive('{"reason":"caption","substantive":false}'), false);
    // Unparseable must be null and NEVER default. A judge failure that defaulted to `true`
    // would readmit exactly the front matter this stage exists to exclude; defaulting to
    // `false` would silently shrink the sample. Both are claims we have not earned.
    assert.equal(parseSubstantive("I think so"), null);
    assert.equal(parseSubstantive('{"substantive":"yes"}'), null, "a string is not a boolean");
    assert.equal(parseSubstantive(""), null);

    const p = buildSubstantivePrompt("The Crown must consult in good faith.", "Nation v Canada");
    assert.ok(p.includes("The Crown must consult in good faith."), "the passage must be present");
    assert.ok(p.includes("Nation v Canada"), "the case must be identified");
    assert.ok(/substantive/.test(p), "the prompt must ask for the `substantive` field");
    // The prompt must name the categories it is screening for, or the judge is guessing.
    ["caption", "counsel", "contents", "authorities"].forEach((k) =>
      assert.ok(new RegExp(k, "i").test(p), `the prompt must name ${k}`));
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

    // Faithfulness is split by bucket (the 3 answerable claims vs the 1 unanswerable claim),
    // plus a combined total. `null` is counted as unparsed, never as a verdict, in every bucket.
    assert.equal(m.faithfulness.answerable.judged, 3, "all 3 answerable-bucket claims parsed");
    assert.equal(m.faithfulness.answerable.unparsed, 0);
    assert.deepEqual(m.faithfulness.answerable.counts,
      { supported: 1, overstated: 1, contradicted: 1, unrelated: 0 });
    assert.ok(Math.abs(m.faithfulness.answerable.supportedRate - 1 / 3) < 1e-9);

    assert.equal(m.faithfulness.unanswerable.judged, 0, "the only unanswerable-bucket claim was unparsed");
    assert.equal(m.faithfulness.unanswerable.unparsed, 1);
    assert.deepEqual(m.faithfulness.unanswerable.counts,
      { supported: 0, overstated: 0, contradicted: 0, unrelated: 0 });
    assert.equal(m.faithfulness.unanswerable.supportedRate, 0, "judged is 0, so the rate must not divide by zero into NaN");

    // combined-total assertions (must keep working): 4 claims total, 1 unparsed.
    assert.equal(m.faithfulness.combined.judged, 3, "4 claims, 1 unparsed");
    assert.equal(m.faithfulness.combined.unparsed, 1);
    assert.deepEqual(m.faithfulness.combined.counts,
      { supported: 1, overstated: 1, contradicted: 1, unrelated: 0 });
    assert.ok(Math.abs(m.faithfulness.combined.supportedRate - 1 / 3) < 1e-9);
  }

  // --- reconciliation throws rather than printing a wrong table --------------------
  {
    const bad = [{ kind: "answerable", caseId: "c1", qid: "q1", targetParagraph: "para-1",
      outcome: "teleported", citedParagraphs: [], claims: [], droppedClaims: 0 }] as unknown as EvalRecord[];
    assert.throws(() => score(bad), /reconcil|outcome/i,
      "an unknown outcome must abort, not vanish from the denominator");
  }

  // --- guard 4: a record of an unrecognised `kind` must abort, not vanish ----------
  // This is the guard the reviewer proved was dead: answered+refused+errored===attempted
  // per bucket is an identity (tally() enforces it or throws), so it can never catch anything.
  // What it must catch instead is a record that never reaches EITHER bucket — exactly what a
  // new EvalRecord `kind` added without a branch in score() would do, silently shrinking every
  // denominator instead of erroring.
  {
    const weird = [{ kind: "mysterious", caseId: "c1", qid: "q1", outcome: "answered",
      claims: [], droppedClaims: 0 }] as unknown as EvalRecord[];
    assert.throws(() => score(weird), /neither bucket/i,
      "a record of an unrecognised kind must abort loudly, not disappear from every denominator");
  }

  // --- empty population is an error, not a scorecard of zeros ----------------------
  {
    assert.throws(() => score([]), /no records/i,
      "cases-eval.ts once printed all-zero rows and exited 0; that must not recur");
  }

  const { assertDistinctModels, formatProvenance } = await import("../src/lib/cases/caseqa-eval/guards");

  // --- guard 1: three distinct models ---------------------------------------------
  {
    assert.doesNotThrow(() => assertDistinctModels({ writer: "a", answerer: "b", judge: "c" }));
    // The two that matter: a model judging its own output, and a model answering its own question.
    assert.throws(() => assertDistinctModels({ writer: "a", answerer: "b", judge: "b" }),
      /distinct/i, "judge must not equal answerer");
    assert.throws(() => assertDistinctModels({ writer: "a", answerer: "a", judge: "c" }),
      /distinct/i, "writer must not equal answerer");
    assert.throws(() => assertDistinctModels({ writer: "a", answerer: "a", judge: "a" }), /distinct/i);
    // The error must name the roles, or a failed run is a puzzle.
    assert.throws(() => assertDistinctModels({ writer: "x", answerer: "x", judge: "c" }),
      /writer.*answerer|answerer.*writer/i);
  }

  // --- guard 5: provenance names the models and every count -----------------------
  {
    const p = formatProvenance({
      writer: "W-1", answerer: "A-1", judge: "J-1", seed: 7, asOf: "2026-07-15",
      casesWithChunks: 500, targets: 40, built: 38, gimmes: 1, writerFails: 1, writerMalformed: 6,
      pairs: 18, discardedPairs: 2, addressedFails: 1,
      pairingExhausted: 3, targetDroppedByBudget: 4,
      // FIX 1 (2026-08-04 review): these six were 11/12/13/14/15 before, and the reviewer
      // proved `p.includes("15")` for paragraphsRejectedByShape passed even with the line that
      // prints it DELETED entirely — because the fixture's own `asOf: "2026-07-15"` ends in
      // "15", coincidentally satisfying the check on its own. Every value below is a two- or
      // three-digit prime with no shared two-digit substring against any other field here
      // (seed 7; the digit-pairs inside "2026-07-15", which are only "20","02","26","07","15";
      // casesWithChunks 500; targets 40; built 38; pairs 18; and the small 1-6 counts) or
      // against each other, so no accidental match can substitute for the real line.
      casesExamined: 149,
      noLongPara: 61, targetsRejectedByShape: 67, paragraphsRejectedByShape: 79,
      targetsRejectedByJudge: 83, targetJudgeUnparsed: 97,
    });
    ["W-1", "A-1", "J-1", "7", "500", "40", "38", "18", "2026-07-15", "3", "4", "6",
     "149", "61", "67", "79", "83", "97"].forEach((s) =>
      assert.ok(p.includes(s), `provenance must include ${s}`));
    // asOf is the corpus stamp: without it a reader cannot tell a prompt regression from the
    // corpus growing underneath a reproducibility-by-seed sample (spec §7 guard 5).
    // The discard counts are the ones a reader needs to see a set that silently shrank.
    assert.ok(/gimme/i.test(p) && /discard/i.test(p), "discard reasons must be named, not just counted");
    // FIX B/D named counters must reach the provenance line too, not just exist internally.
    assert.ok(/exhausted/i.test(p), "the pairing-exhausted count must be named, not just discardedPairs");
    assert.ok(/budget/i.test(p), "the target-dropped-by-budget count must be named");
    // FIX 1: pin the LABEL itself, the same way /exhausted/i and /budget/i already pin theirs.
    // A numeric-only check cannot tell "the line was deleted" from "the number coincidentally
    // matched something else" — this is what a bare `.includes("79")` alone cannot catch, and
    // what the mutant that deletes the paragraphsRejectedByShape print line must fail.
    assert.ok(/paragraphs[^\n]*rejected by the line-shape test/i.test(p),
      "the paragraph-level shape-rejection line must be present, labelled distinctly from the case-level line");
    // FIX 2: casesExamined must be labelled, not just a bare number indistinguishable from any
    // other count in the block.
    assert.ok(/cases examined/i.test(p), "casesExamined must be labelled");
    // FIX 6: the case-level and paragraph-level shape counts overlap (a fully-rejected case's
    // paragraphs are counted in both), and that must be stated or a reader can sum them as if
    // they were disjoint.
    assert.ok(/overlap/i.test(p), "the case/paragraph overlap must be disclosed, not left implicit");
  }

  // --- guard 7: the chosen targets are printed ------------------------------------
  // The caption bug survived a whole run for one reason: nothing showed what the instrument
  // had picked. An aggregate over an unseen sample is not evidence.
  {
    const { formatChosenTargets, TARGET_PREVIEW_CHARS } = await import("../src/lib/cases/caseqa-eval/guards");
    const out = formatChosenTargets([
      { caseId: "2002-bcsc-1199", paragraph: "para-4", text: "The plaintiff joined Canada as a defendant to these actions in October and November of 2000, and Canada takes no position on the relief sought." },
      { caseId: "2008-scc-41", paragraph: "para-34", text: "Short one." },
    ]);
    assert.ok(out.includes("2002-bcsc-1199"), "the case id must appear");
    assert.ok(out.includes("para-4"), "the paragraph id must appear");
    assert.ok(out.includes("The plaintiff joined Canada"), "the text must appear");
    assert.ok(out.includes("2008-scc-41") && out.includes("para-34"), "every target must appear");
    // FIX 10 (2026-08-04 review, spec §7.7): this block prints BEFORE question construction, so
    // a target later dropped as a gimme, malformed, or outside the assembly budget still
    // appears here — the header must say so, or the row count will not reconcile with `built`.
    assert.ok(/superset/i.test(out), "the header must state the block is a superset of what gets measured");
    // Long text is truncated so the block stays readable at 40 targets, but the head must
    // be enough to recognise a caption on sight.
    const long = formatChosenTargets([{ caseId: "c", paragraph: "p", text: "y".repeat(400) }]);
    assert.ok(long.includes("y".repeat(120)), "at least 120 characters must survive");
    assert.ok(!long.includes("y".repeat(200)), "and it must not print the whole paragraph");
    // FIX 9 (2026-08-04 review): the two assertions above only bracket the constant into
    // [120, 199] — anything in that range would still pass both. Pin it directly instead, so
    // it cannot drift from the spec §7.7 value of 120 without this failing.
    assert.equal(TARGET_PREVIEW_CHARS, 120, "spec §7.7 pins the preview length to exactly 120");
    // Empty must not throw — it is a real state (everything rejected) and the caller aborts
    // on it separately.
    assert.equal(typeof formatChosenTargets([]), "string");
  }

  // --- screenSubstantiveTargets: stage 2 wiring extracted from the runner (FIX 4, 2026-08-04
  // review) --------------------------------------------------------------------------------
  // Guard 6 asserts this about stage 2: null is counted apart from `false` and never defaulted,
  // `false` increments targetsRejectedByJudge (not targetJudgeUnparsed), there is no backfill on
  // rejection, and survivors are exactly the accepted candidates, in order. Before this fix all
  // of that lived as a ~12-line loop inside main() in scripts/cases-caseqa-eval.ts, which this
  // test file never imports — only the parser (parseSubstantive) and the prompt text were
  // tested, not the wiring. Concretely, someone could collapse the `=== null` and `!substantive`
  // branches into one, and typecheck plus every OTHER test here would still pass while
  // "substance screen unparseable" printed 0 forever.
  {
    const { screenSubstantiveTargets } = await import("../src/lib/cases/caseqa-eval/substanceScreen");
    const candidates = [
      { caseId: "keep-1" }, { caseId: "reject" }, { caseId: "unparsed" }, { caseId: "keep-2" },
    ];
    const verdicts: Record<string, boolean | null> = {
      "keep-1": true, "reject": false, "unparsed": null, "keep-2": true,
    };
    const calls: string[] = [];
    const r = await screenSubstantiveTargets(candidates, async (c) => {
      calls.push(c.caseId);
      return verdicts[c.caseId];
    });
    assert.deepEqual(calls, candidates.map((c) => c.caseId),
      "every candidate must be screened exactly once, in order — no backfill on rejection");
    assert.deepEqual(r.targets.map((t) => t.caseId), ["keep-1", "keep-2"],
      "survivors must be EXACTLY the accepted candidates, in their original order");
    assert.equal(r.targetsRejectedByJudge, 1, "false must increment targetsRejectedByJudge");
    assert.equal(r.targetJudgeUnparsed, 1,
      "null must increment targetJudgeUnparsed, counted apart from a false — never defaulted to either");
    assert.equal(r.targets.length + r.targetsRejectedByJudge + r.targetJudgeUnparsed, candidates.length,
      "every candidate must land in exactly one bucket — nothing dropped silently");
  }

  // --- pairing: candidate drawing (FIX B, 2026-08-03 review) -----------------------
  {
    const { buildUnanswerablePairs } = await import("../src/lib/cases/caseqa-eval/pairing");
    type Src = { caseId: string; qid: string; question: string };
    const mk = (n: number): Src[] =>
      Array.from({ length: n }, (_, i) => ({ caseId: `c${i}`, qid: `ans-${i + 1}`, question: `q${i}` }));

    // Deterministic and non-degenerate: same seed, same result; a candidate is never its own
    // source; every source pairs when nothing is ever rejected.
    {
      const built = mk(10);
      const screenAlwaysOk = async (_s: Src, _c: Src) => false; // never addressed -> always pairs
      const r1 = await buildUnanswerablePairs(built, 5, 3, screenAlwaysOk);
      const r2 = await buildUnanswerablePairs(built, 5, 3, screenAlwaysOk);
      assert.deepEqual(r1, r2, "same seed must produce the same pairing");
      assert.equal(r1.pairs.length, 5, "every source should pair when nothing is ever rejected");
      assert.ok(r1.pairs.every((p, i) => p.caseId !== `c${i}`), "a source must never pair with its own case");
      assert.equal(r1.exhausted, 0);
      assert.equal(r1.discardedPairs, 0);
    }

    // --- the jam scenario the reviewer simulated: one candidate always reads as "addressed" ---
    // Before the fix, a rejected candidate was never marked used, so `built.find` kept handing
    // the SAME rejected candidate to every later source — the reviewer's simulation produced
    // 1 pair out of 20, with 18 of 20 paid judge calls spent re-screening that one case.
    //
    // Small, forced, hand-verifiable version first: 2 sources, 1 always-addressed candidate
    // ("poison"), seed 5 chosen so the FIRST source's draw lands on poison. If the old bug
    // were present, the second source could be handed poison again and reject it too, wasting
    // its only candidate slot. Instead: poison is screened exactly once (by source 1, and
    // discarded), which marks it attempted, so source 2's draw is forced past it onto the one
    // remaining case and still succeeds.
    {
      const built: Src[] = [
        { caseId: "s1", qid: "ans-1", question: "q1" },
        { caseId: "s2", qid: "ans-2", question: "q2" },
        { caseId: "poison", qid: "ans-3", question: "q3" },
      ];
      const screened: string[] = [];
      const screen = async (_source: Src, candidate: Src) => {
        screened.push(candidate.caseId);
        return candidate.caseId === "poison";
      };
      const r = await buildUnanswerablePairs(built, 2, 5, screen);
      assert.deepEqual(screened, ["poison", "s1"],
        "source 1 must draw the poisoned candidate first and source 2 must be forced past it, not retry it");
      assert.equal(r.discardedPairs, 1, "the poisoned candidate is discarded exactly once");
      assert.equal(r.pairs.length, 1, "source 2 must still pair despite source 1's candidate being poisoned");
      assert.equal(r.pairs[0].caseId, "s1", "source 2's only remaining candidate after poison is attempted is s1");
      assert.equal(r.exhausted, 0);
    }

    // --- the same scenario at scale: 20 sources, 1 always-addressed candidate --------
    // A candidate-only case (never itself a source) that every one of 20 sources could draw.
    // Seed 5 puts it at the very front of source 1's draw — the worst case for the old bug,
    // which would have kept handing it to every subsequent source once rejected. Here it is
    // screened exactly once (proven by `screened` having 20 DISTINCT entries — one per
    // source, no repeats) and every other source still finds a fresh, never-before-attempted
    // candidate and pairs successfully.
    {
      const built = mk(21); // c0..c19 are sources; c20 is the always-addressed candidate-only case
      const screened: string[] = [];
      const screen = async (_source: Src, candidate: Src) => {
        screened.push(candidate.caseId);
        return candidate.caseId === "c20";
      };
      const r = await buildUnanswerablePairs(built, 20, 5, screen);

      assert.equal(screened.length, 20, "one screen call per source — no source should be starved of a draw");
      assert.equal(new Set(screened).size, 20,
        "no candidate may be screened twice — that duplication IS the jam the old loop had");
      assert.equal(screened.filter((c) => c === "c20").length, 1,
        "the poisoned candidate must be screened exactly once, never retried by a later source");
      assert.equal(r.discardedPairs, 1, "only the poisoned candidate is ever discarded");
      assert.equal(r.pairs.length, 19,
        "19 of 20 sources must still pair — the old loop's simulated failure mode was 1 of 20");
      assert.equal(r.exhausted, 0, "20 sources against 21 candidates must never run out of options");
    }

    // --- unparseable screen result is a distinct discard reason ----------------------
    {
      const built = mk(4);
      const r = await buildUnanswerablePairs(built, 4, 1, async () => null);
      assert.equal(r.pairs.length, 0);
      assert.equal(r.addressedFails, r.discardedPairs, "every discard here came from an unparseable screen");
    }

    // --- exhaustion: every OTHER case has already been attempted --------------------
    // 3 cases, all 3 sources, everything ever screened is rejected. Source 1 attempts c1,
    // source 2 attempts c0 — between them every case but c2 itself is now attempted, so
    // source 3 (c2) has nothing left to draw: its candidate pool {c0, c1} is entirely
    // attempted. That must be a named, counted skip (`exhausted`), not a silent retry of an
    // already-rejected candidate and not a wasted screen call.
    {
      const built = mk(3);
      const attempts: string[] = [];
      const screen = async (_s: Src, c: Src) => { attempts.push(c.caseId); return true; }; // always rejected
      const r = await buildUnanswerablePairs(built, 3, 1, screen);
      assert.equal(r.exhausted, 1, "the third source must find every candidate already attempted");
      assert.equal(r.discardedPairs, 2, "only the first two sources ever got a candidate to reject");
      assert.equal(attempts.length, 2, "an exhausted source must not spend a screen call");
      assert.equal(new Set(attempts).size, 2, "the two attempted candidates must be distinct, not a repeat");
    }
  }

  console.log("✅ test-cases-caseqa-eval passed");
})();
