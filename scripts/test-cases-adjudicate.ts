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

  console.log("✅ test-cases-adjudicate passed");
})();
