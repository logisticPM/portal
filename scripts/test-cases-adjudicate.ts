// Offline unit tests for the decline-adjudication instrument. No AWS, no LLM calls.
// Run: npx tsx scripts/test-cases-adjudicate.ts
import assert from "node:assert/strict";

(async () => {
  const { buildAdjudicationPrompt, parsePick } = await import("../src/lib/cases/adjudicate/prompt");

  // --- parsePick: three first-class answers, null on anything else -------------------
  {
    assert.equal(parsePick('{"pick":"A"}'), "A");
    assert.equal(parsePick('{"pick":"B"}'), "B");
    assert.equal(parsePick('{"pick":"unsure"}'), "unsure");
    assert.equal(parsePick('```json\n{"pick": "b"}\n```'), "B", "fences and case must survive");
    assert.equal(parsePick('{"reason":"both match","pick":"unsure"}'), "unsure");
    // Unparseable is NOT an abstention: `unsure` is the judge telling us the pair is
    // undecidable, which spec §2 treats as a result. A response we cannot read is OUR
    // failure and must never be counted as the judge's answer.
    assert.equal(parsePick("I think A"), null, "prose is not a verdict");
    assert.equal(parsePick('{"pick":"C"}'), null);
    assert.equal(parsePick('{"pick":true}'), null);
    assert.equal(parsePick(""), null);
  }

  // --- buildAdjudicationPrompt: BLINDING is the whole design (spec §5) ---------------
  {
    const quote = "the Crown owed a fiduciary duty in these circumstances";
    const p = buildAdjudicationPrompt(quote, "First paragraph text about consultation.", "Second paragraph text about title.");
    assert.ok(p.includes(quote), "the quotation must be present");
    assert.ok(p.includes("First paragraph text about consultation."), "paragraph A must be present");
    assert.ok(p.includes("Second paragraph text about title."), "paragraph B must be present");
    assert.ok(/unsure/.test(p), "abstention must be offered explicitly, not grudgingly");
    // What must NOT leak. Any of these turns an independent read into a confirmation.
    [/\bbest\b/i, /\brival\b/i, /overlap/i, /\bcited\b/i, /0\.9\d/, /para-\d/].forEach((re) =>
      assert.ok(!re.test(p), `the prompt must not leak ${re}`));
  }

  // --- the same quote and paragraphs in swapped order give a DIFFERENT prompt --------
  // Position-bias control (spec §4) only works if the two calls really differ, and only if
  // they differ ONLY in order — otherwise the flip rate measures something else.
  {
    const q = "a quotation";
    const one = buildAdjudicationPrompt(q, "alpha text", "beta text");
    const two = buildAdjudicationPrompt(q, "beta text", "alpha text");
    assert.notEqual(one, two, "swapping the order must change the prompt");
    assert.equal(one.length, two.length, "…and must change nothing else");
  }

  const { tally, FLIP_GATE, ABSTENTION_GATE } = await import("../src/lib/cases/adjudicate/tally");
  type Row = Parameters<typeof tally>[0][number];
  const row = (o: Partial<Row>): Row => ({
    caseId: "c", quote: "q", bestPara: "para-1", rivalPara: "para-2", citedPara: "para-1",
    first: "best", second: "best", ...o,
  });

  // --- the chain of narrowing denominators, each with its own exclusion --------------
  {
    const t = tally([
      // consistent, decided, cited names the BEST candidate -> agreement
      row({}),
      // consistent, decided, cited names the RIVAL -> disagreement
      row({ citedPara: "para-2" }),
      // consistent abstention -> excluded from agreement, counted as abstained
      row({ first: "unsure", second: "unsure" }),
      // FLIPPED -> excluded from abstention and agreement both: no stable answer to compare
      row({ first: "best", second: "rival" }),
      // unparseable in one ordering -> its own bucket, never an abstention
      row({ first: "best", second: null }),
      // consistent + decided, but cited names NEITHER candidate. Cannot agree or disagree;
      // counting it as a disagreement would manufacture a negative. #228 found 4 of 15 here.
      row({ citedPara: "para-77" }),
    ]);

    assert.equal(t.pairs, 6);
    assert.equal(t.unparseable, 1);
    assert.equal(t.flipped, 1);
    assert.equal(t.consistent, 4, "6 pairs - 1 flipped - 1 unparseable");
    assert.equal(t.abstained, 1);
    assert.equal(t.decided, 3, "consistent, non-abstained");
    assert.equal(t.citedNamesNeither, 1);
    assert.equal(t.comparable, 2, "decided minus cited-names-neither");
    assert.equal(t.agreed, 1);
    assert.ok(t.agreementRate !== null && Math.abs(t.agreementRate - 0.5) < 1e-9, "1 of 2 comparable");

    // Reconciliation must hold and be asserted, not assumed.
    assert.equal(t.consistent + t.flipped + t.unparseable, t.pairs);
  }

  // --- the pre-registered gates (spec §3), and the flip gate SUPPRESSES agreement ----
  {
    // 2 of 5 flipped = 0.4 >= FLIP_GATE. The agreement metric must not be computed at all —
    // spec §3 says a judge that disagrees with itself on a third of rows cannot support an
    // inference on a denominator this small.
    const flippy = tally([
      row({ first: "best", second: "rival" }), row({ first: "rival", second: "best" }),
      row({}), row({}), row({}),
    ]);
    assert.ok(flippy.flipRate >= FLIP_GATE);
    assert.equal(flippy.flipGateTripped, true);
    assert.equal(flippy.agreementRate, null, "agreement must be withheld, not merely flagged");
    assert.equal(flippy.p, null);

    // Abstention gate: half or more of consistent pairs abstained.
    const unsurey = tally([
      row({ first: "unsure", second: "unsure" }), row({ first: "unsure", second: "unsure" }),
      row({}), row({}),
    ]);
    assert.ok(unsurey.abstentionRate >= ABSTENTION_GATE);
    assert.equal(unsurey.abstentionGateTripped, true);
    assert.equal(unsurey.flipGateTripped, false, "the two gates are independent");
    assert.notEqual(unsurey.agreementRate, null, "the abstention gate does not suppress agreement");
  }

  // --- digit-normalised comparison, matching #228 so the two reports are comparable --
  {
    const t = tally([row({ citedPara: "[para-1]", bestPara: "para-1", rivalPara: "para-2" })]);
    assert.equal(t.agreed, 1, "a bracket-wrapped cited value must still match on the digit run");
    const u = tally([row({ citedPara: "1", bestPara: "para-1", rivalPara: "para-2" })]);
    assert.equal(u.agreed, 1, "a bare digit must match too");
  }

  // --- binomial p, and the empty population -----------------------------------------
  {
    // 5:0 on n=5 -> two-sided p = 2 * (1/32) = 0.0625
    const t = tally([row({}), row({}), row({}), row({}), row({})]);
    assert.ok(t.p !== null && Math.abs(t.p - 0.0625) < 1e-9, `expected 0.0625, got ${t.p}`);
    assert.throws(() => tally([]), /no pairs/i,
      "an empty population is an error, not a scorecard of zeros");
  }

  const { assertJudgeIsNotSummarizer } = await import("../src/lib/cases/adjudicate/guards");

  // --- guard §9.1: the model under test cannot be its own adjudicator ---------------
  {
    assert.doesNotThrow(() => assertJudgeIsNotSummarizer("judge-x", "summarizer-y"));
    assert.throws(() => assertJudgeIsNotSummarizer("same-model", "same-model"), /summarizer/i,
      "the summarizer must not be allowed to adjudicate its own citedPara");
    // The error must name the model, or a failed run sends the reader back to the env vars.
    assert.throws(() => assertJudgeIsNotSummarizer("m-1", "m-1"), /m-1/);
  }

  console.log("✅ test-cases-adjudicate passed");
})();
