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
    // Spec §9.8 (strengthened after review): the original keyword list missed leak shapes a
    // reviewer actually simulated passing — `PARAGRAPH A (1.00):`, `From 2008-scc-41:`, and
    // `Case: Tsilhqot'in Nation v British Columbia` (§5 explicitly forbids the case name and no
    // earlier regex covered it). Added: a neutral-citation shape, a bare parenthesised number,
    // and a case-name ("... v ...") shape.
    [
      /\bbest\b/i, /\brival\b/i, /overlap/i, /\bcited\b/i, /0\.9\d/, /para-\d/,
      /\b\d{4}-[a-z]+-\d+\b/i,     // neutral citation shape, e.g. "2008-scc-41"
      /\(\s*\d+(\.\d+)?\s*\)/,     // bare parenthesised number, e.g. "(1.00)"
      /\bv\.?\s+[A-Z]/,            // case-name shape, e.g. "... v British Columbia" / "... v. Y"
    ].forEach((re) => assert.ok(!re.test(p), `the prompt must not leak ${re}`));
  }

  // --- self-check: the new regexes above actually catch the leaks the reviewer found ---------
  // A regex that cannot match the leak it was written for would guard nothing while looking
  // like coverage. `PARAGRAPH A (preferred by our scoring):` is covered instead by the golden
  // exact-match test below, since it is not a citation or a bare number.
  {
    assert.ok(/\b\d{4}-[a-z]+-\d+\b/i.test("From 2008-scc-41:"), "citation regex must catch its own target");
    assert.ok(/\(\s*\d+(\.\d+)?\s*\)/.test("PARAGRAPH A (1.00):"), "parenthesised-number regex must catch its own target");
    assert.ok(/\bv\.?\s+[A-Z]/.test("Case: Tsilhqot'in Nation v British Columbia"), "case-name regex must catch its own target");
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

  // --- pin the prompt's exact shape (spec §9.8) --------------------------------------
  // The keyword checks above only reject specific known leaks. Nothing pinned the template's
  // ARITY or exact wording: a fourth `caseId` argument woven into the text would compile and
  // every check above would still pass. This asserts full equality against a golden value for
  // fixed inputs, so ANY change to the template — a new leaked field, reworded instructions,
  // reordered sections — fails this test instead of sailing through.
  {
    const golden = `A sentence was quoted from a court decision, but the quotation was copied imperfectly — a word may be altered or the ending clipped. Two paragraphs from that decision are candidates for where it came from.

QUOTATION:
q1

PARAGRAPH A:
pA

PARAGRAPH B:
pB

Which paragraph is the quotation from? Judge only by comparing the wording. If both paragraphs could equally be the source, or you genuinely cannot tell them apart on this evidence, answer "unsure" — that is a real and useful answer here, not a failure, and guessing is worse than abstaining.

Output STRICTLY this JSON, no markdown:
{"pick":"A"|"B"|"unsure"}`;
    assert.equal(buildAdjudicationPrompt("q1", "pA", "pB"), golden, "the template must match exactly — any change here is a change worth reviewing");
  }

  const { tally, FLIP_GATE, ABSTENTION_GATE, reconcileBuckets, citedSide } = await import("../src/lib/cases/adjudicate/tally");
  type Row = Parameters<typeof tally>[0][number];
  const row = (o: Partial<Row>): Row => ({
    caseId: "c", quote: "q", bestPara: "para-1", rivalPara: "para-2", citedPara: "para-1",
    bestLen: 200, rivalLen: 190, bestOverlap: 0.97, rivalOverlap: 0.4,
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
      // counting it as a disagreement would manufacture a negative. #228 found 6 of 15 here
      // (15 - (cited=best 6 + cited=rival 3) = 6; the code once said "4 of 15", which was a
      // different quantity — #228's "4 of 15 to the rival").
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
    assert.equal(t.agreementWithheldReason, null, "computed, not withheld");

    // Reconciliation must hold (this is the identity FIX 2 replaced as the guard itself — see
    // the dedicated reconcileBuckets tests below for the real guard).
    assert.equal(t.consistent + t.flipped + t.unparseable, t.pairs);
  }

  // --- reconciliation is a REAL guard (spec §9.6), not the identity it replaced ------
  // `consistent + flipped + unparseable === rows.length` can never fail: the three cases are
  // exhaustive by construction (every loop iteration hits exactly one before any later
  // `continue`). `reconcileBuckets` instead reclassifies every row from scratch and compares
  // against what the loop counted, so it can fire on a case the identity cannot: below, the
  // asserted counts still sum to `rows.length` (3) but assign the wrong row to the wrong bucket.
  {
    const rows = [
      row({}),                                      // consistent
      row({ first: "best", second: "rival" }),      // flipped
      row({ first: "best", second: null }),         // unparseable
    ];
    assert.doesNotThrow(() => reconcileBuckets(rows, { unparseable: 1, flipped: 1, consistent: 1 }),
      "correct counts must not throw");
    assert.throws(() => reconcileBuckets(rows, { unparseable: 0, flipped: 2, consistent: 1 }),
      /reconciliation failed/i, "wrong bucket, right sum — the identity would have missed this");
    assert.throws(() => reconcileBuckets(rows, { unparseable: 1, flipped: 0, consistent: 2 }),
      /reconciliation failed/i, "wrong bucket, right sum — the identity would have missed this");
  }

  // --- citedSide: shared by tally() and the runner's per-row print (spec §9.5) -------
  {
    assert.equal(citedSide("para-1", "para-1", "para-2"), "best");
    assert.equal(citedSide("[para-2]", "para-1", "para-2"), "rival", "digit-run rule applies here too");
    assert.equal(citedSide("para-77", "para-1", "para-2"), null);
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
    assert.equal(flippy.agreementWithheldReason, "flip_gate_tripped");
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
    assert.equal(unsurey.agreementWithheldReason, null);
  }

  // --- agreementRate === null has TWO DISTINCT causes (spec §8), and callers must be able to
  // tell them apart: the flip gate tripping is one, `comparable === 0` is the other, and #228
  // found `citedPara` naming neither candidate in 6 of 15 rows — this is not a corner case. -----
  {
    // Cause 1: decided rows exist, but citedPara names neither candidate in every one of them.
    const neitherAll = tally([
      row({ citedPara: "para-77" }), row({ citedPara: "para-77" }), row({ citedPara: "para-77" }),
    ]);
    assert.equal(neitherAll.flipGateTripped, false, "flip rate is 0 here — this must NOT be reported as the flip gate");
    assert.equal(neitherAll.comparable, 0);
    assert.equal(neitherAll.agreementRate, null);
    assert.equal(neitherAll.agreementWithheldReason, "no_comparable_rows");

    // Cause 2: every pair unparseable (decided === 0). An unparseable pair can never flip, so
    // this must not be reported as the flip gate tripping either.
    const allUnparseable = tally([
      row({ first: null, second: null }), row({ first: null, second: null }), row({ first: null, second: null }),
    ]);
    assert.equal(allUnparseable.flipGateTripped, false);
    assert.equal(allUnparseable.comparable, 0);
    assert.equal(allUnparseable.agreementRate, null);
    assert.equal(allUnparseable.agreementWithheldReason, "no_comparable_rows",
      "an all-unparseable population must not be reported as the flip gate tripping");

    // Cause 2, second shape: every pair an order-consistent abstention (decided === 0 again).
    const allUnsure = tally([
      row({ first: "unsure", second: "unsure" }), row({ first: "unsure", second: "unsure" }),
      row({ first: "unsure", second: "unsure" }),
    ]);
    assert.equal(allUnsure.flipGateTripped, false);
    assert.equal(allUnsure.comparable, 0);
    assert.equal(allUnsure.agreementRate, null);
    assert.equal(allUnsure.agreementWithheldReason, "no_comparable_rows",
      "an all-unsure population must not be reported as the flip gate tripping");
  }

  // --- flip-rate denominator is READABLE pairs, not all pairs (spec §8, amended 2026-08-04) ---
  {
    // Reviewer's exact case: 4 flipped + 5 unparseable + 6 consistent. Diluted by all 15 pairs
    // that would be 4/15 = 26.7%, under FLIP_GATE — but among the 10 pairs actually readable it
    // is 4/10 = 40%, which trips it. An unparseable row can never enter the flip numerator, so
    // counting it in the denominator can only ever push the rate down.
    const rows = [
      ...Array.from({ length: 4 }, () => row({ first: "best" as const, second: "rival" as const })),
      ...Array.from({ length: 5 }, () => row({ first: null, second: null })),
      ...Array.from({ length: 6 }, () => row({})),
    ];
    const t = tally(rows);
    assert.equal(t.pairs, 15);
    assert.equal(t.unparseable, 5);
    assert.equal(t.readable, 10);
    assert.equal(t.flipped, 4);
    assert.ok(Math.abs(t.flipRate - 0.4) < 1e-9, `expected 0.4, got ${t.flipRate}`);
    assert.equal(t.flipGateTripped, true, "diluting the denominator with unparseable rows would have hidden a real trip");
  }

  // --- readable === 0 must give rate 0, not NaN (guarded division) -------------------
  {
    const t = tally([row({ first: null, second: null }), row({ first: null, second: null })]);
    assert.equal(t.readable, 0);
    assert.equal(t.flipped, 0);
    assert.equal(t.flipRate, 0, "0 readable pairs must give rate 0, not NaN");
    assert.equal(t.flipGateTripped, false);
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

  // --- guard §9.1: the model under test cannot be its own adjudicator, INCLUDING via an
  // equivalent id (spec §7 amendment: normalise, don't compare with ===) -------------
  {
    assert.doesNotThrow(() => assertJudgeIsNotSummarizer("judge-x", "summarizer-y"));
    assert.throws(() => assertJudgeIsNotSummarizer("same-model", "same-model"), /summarizer/i,
      "the summarizer must not be allowed to adjudicate its own citedPara");
    // The error must name the model, or a failed run sends the reader back to the env vars.
    assert.throws(() => assertJudgeIsNotSummarizer("m-1", "m-1"), /m-1/);

    // The bare id and the "us." cross-region-prefixed id name the SAME model. An exact string
    // compare would let this pass unnoticed; the normalising compare must not.
    assert.throws(
      () => assertJudgeIsNotSummarizer("meta.llama3-3-70b-instruct-v1:0", "us.meta.llama3-3-70b-instruct-v1:0"),
      /summarizer/i,
      "dropping the us. cross-region prefix must not defeat the guard",
    );
    assert.throws(
      () => assertJudgeIsNotSummarizer("us.meta.llama3-3-70b-instruct-v1:0", "meta.llama3-3-70b-instruct-v1:0"),
      /summarizer/i,
      "…and the reverse direction must be caught too",
    );
    // A full inference-profile ARN naming the same model must also be caught.
    assert.throws(
      () => assertJudgeIsNotSummarizer(
        "arn:aws:bedrock:us-east-1:111111111111:inference-profile/us.meta.llama3-3-70b-instruct-v1:0",
        "meta.llama3-3-70b-instruct-v1:0",
      ),
      /summarizer/i,
      "an ARN naming the same model must not defeat the guard",
    );

    // Genuinely different models must still pass — normalising must not make everything equal.
    assert.doesNotThrow(() =>
      assertJudgeIsNotSummarizer("us.anthropic.claude-opus-4-5-20251101-v1:0", "us.meta.llama3-3-70b-instruct-v1:0"),
      "genuinely different models must not be blocked from judging");
  }

  console.log("✅ test-cases-adjudicate passed");
})();
