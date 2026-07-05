// Tests for the AI summary pipeline (spec 2026-07-03). Offline: stub models and
// counting fakes; the cachedModel test exercises the real disk cache (gitignored).
import assert from "node:assert/strict";

(async () => {
  const { modelFromId, cachedModel } = await import("../src/lib/cases/ingest/llm");

  // modelFromId: stub path stays deterministic and carries the id.
  const m = modelFromId("stub:sum-a");
  assert.equal(m.id, "stub:sum-a");
  const out1 = await m.call("same prompt");
  const out2 = await m.call("same prompt");
  assert.equal(out1, out2, "stub output must be deterministic");
  assert.ok(Array.isArray(JSON.parse(out1)), "stub output is a JSON array");

  // cachedModel: preserves the id; second call with the same prompt is served
  // from the disk cache (the model is called exactly once). Unique prompt per
  // run so a stale cache entry from a previous run can't interfere.
  let calls = 0;
  const counting = { id: "fake:count", call: async () => { calls++; return "counted-output"; } };
  const cm = cachedModel(counting);
  assert.equal(cm.id, "fake:count");
  const uniquePrompt = `cache test ${Date.now()}-${Math.random()}`;
  const first = await cm.call(uniquePrompt);
  const second = await cm.call(uniquePrompt);
  assert.equal(first, "counted-output");
  assert.equal(second, "counted-output");
  assert.equal(calls, 1, "second call must be a cache hit, not a model call");

  const { parseClaims, verifyClaims, normWs } = await import("../src/lib/cases/ingest/summarizer");

  // --- parser ---
  const good = `Here is the summary:\n{"claims":[{"text":"T","quote":"Q","paragraph":12}]}\nDone.`;
  const parsed = parseClaims(good);
  assert.ok(parsed && parsed.length === 1);
  assert.deepEqual(parsed![0], { text: "T", quote: "Q", paragraph: "12" }); // numeric para coerced to string
  assert.equal(parseClaims("no json here"), null);
  assert.equal(parseClaims(`{"claims": "not-an-array"}`), null);
  assert.equal(parseClaims(`{"claims":[{"text":"T"`), null); // truncated JSON

  // --- verifier ---
  const chunks = [
    { paragraph: "12", text: "The Crown owed a duty to consult the Haida Nation before transferring the licence." },
    { paragraph: "48", text: "Compensation of $10 million was awarded for the breach of treaty obligations." },
  ];
  const URL = "https://example.org/case";
  const mk = (text: string, quote: string, paragraph: string) => ({ text, quote, paragraph });

  // valid quote passes and is anchored
  let v = verifyClaims([mk("Plain claim.", "duty to consult the Haida Nation", "12")], chunks, URL);
  assert.equal(v.anchors.length, 1);
  assert.deepEqual(v.anchors[0], { text: "Plain claim.", sourceParagraph: "12", sourceUrl: URL });
  assert.equal(v.dropped, 0);

  // whitespace differences still match (normalization)
  v = verifyClaims([mk("C.", "Compensation of   $10 million\n was awarded", "48")], chunks, URL);
  assert.equal(v.anchors.length, 1);

  // fabricated quote dropped
  v = verifyClaims([mk("C.", "the court awarded punitive damages", "48")], chunks, URL);
  assert.equal(v.anchors.length, 0); assert.equal(v.dropped, 1);

  // right quote, wrong paragraph id → RE-ANCHORED to where the quote actually lives
  v = verifyClaims([mk("C.", "duty to consult the Haida Nation", "48")], chunks, URL);
  assert.equal(v.anchors.length, 1);
  assert.equal(v.anchors[0].sourceParagraph, "12");
  assert.equal(v.dropped, 0);

  // unknown paragraph id, real quote → re-anchored likewise
  v = verifyClaims([mk("C.", "duty to consult the Haida Nation", "99")], chunks, URL);
  assert.equal(v.anchors.length, 1);
  assert.equal(v.anchors[0].sourceParagraph, "12");

  // bare-number id accepted for "para-N" chunk ids (models drop the prefix)
  const prefixed = [{ paragraph: "para-7", text: "The honour of the Crown is always at stake in its dealings." }];
  v = verifyClaims([mk("P.", "honour of the Crown is always at stake", "7")], prefixed, URL);
  assert.equal(v.anchors.length, 1);
  assert.equal(v.anchors[0].sourceParagraph, "para-7");

  // quote spanning two adjacent chunks (no-overlap splitting) → anchored to the FIRST chunk
  const split = [
    { paragraph: "para-1", text: "The Tribunal found that Canada discriminated against First Nations children" },
    { paragraph: "para-2", text: "by underfunding child and family services on reserve." },
  ];
  v = verifyClaims([mk("S.", "First Nations children by underfunding child and family services", "para-1")], split, URL);
  assert.equal(v.anchors.length, 1);
  assert.equal(v.anchors[0].sourceParagraph, "para-1");

  // fabricated quote still cannot pass under any lookup
  v = verifyClaims([mk("F.", "the moon treaty grants mineral rights", "para-1")], split, URL);
  assert.equal(v.anchors.length, 0); assert.equal(v.dropped, 1);

  // ADJACENCY is a constraint, not a convenience: a "quote" stitched from
  // chunk 1's end + chunk 3's start (skipping chunk 2) must be dropped —
  // any-pair joining would break the verbatim-text safety property.
  const three = [
    { paragraph: "para-1", text: "The application for judicial review is allowed in part" },
    { paragraph: "para-2", text: "with costs payable forthwith by the respondent Crown." },
    { paragraph: "para-3", text: "because the consultation record showed no meaningful dialogue." },
  ];
  v = verifyClaims([mk("N.", "allowed in part because the consultation record showed", "para-1")], three, URL);
  assert.equal(v.anchors.length, 0); assert.equal(v.dropped, 1);
  // …while the genuinely adjacent join still verifies
  v = verifyClaims([mk("Y.", "allowed in part with costs payable forthwith", "para-1")], three, URL);
  assert.equal(v.anchors.length, 1);

  // cited chunk takes precedence when the quote exists in multiple chunks
  const dup = [
    { paragraph: "para-1", text: "The honour of the Crown is always at stake, said the trial judge." },
    { paragraph: "para-2", text: "On appeal: the honour of the Crown is always at stake, we agree." },
  ];
  v = verifyClaims([mk("D2.", "honour of the Crown is always at stake", "para-2")], dup, URL);
  assert.equal(v.anchors.length, 1);
  assert.equal(v.anchors[0].sourceParagraph, "para-2");

  // short quote (<15 chars normalized) → dropped
  v = verifyClaims([mk("C.", "duty to", "12")], chunks, URL);
  assert.equal(v.anchors.length, 0);

  // empty text → dropped
  v = verifyClaims([mk("  ", "duty to consult the Haida Nation", "12")], chunks, URL);
  assert.equal(v.anchors.length, 0);

  // more than 6 survivors → first 6 kept, rest counted dropped
  const many = Array.from({ length: 8 }, (_, i) => mk(`claim ${i}`, "duty to consult the Haida Nation", "12"));
  v = verifyClaims(many, chunks, URL);
  assert.equal(v.anchors.length, 6); assert.equal(v.dropped, 2);

  assert.equal(normWs("  a\n\t b  "), "a b");

  // prose braces around otherwise-valid JSON → unparseable slice → null (retry trigger)
  assert.equal(parseClaims(`intro {brace} {"claims":[{"text":"T","quote":"Q","paragraph":"1"}]} outro {brace}`), null);

  // non-object entries become empty claims (counted as dropped downstream)
  const mixed = parseClaims(`{"claims":["junk",{"text":"T","quote":"Q","paragraph":"1"}]}`);
  assert.equal(mixed!.length, 2);
  assert.deepEqual(mixed![0], { text: "", quote: "", paragraph: "" });

  // mixed batch: 2 valid + 1 fabricated → 2 anchors, dropped 1
  v = verifyClaims([
    mk("A.", "duty to consult the Haida Nation", "12"),
    mk("B.", "the moon is made of green cheese!!", "48"),
    mk("C.", "Compensation of $10 million was awarded", "48"),
  ], chunks, URL);
  assert.equal(v.anchors.length, 2); assert.equal(v.dropped, 1);

  // typographic source vs ASCII quote → still verified (symmetric folding)
  const curly = [{ paragraph: "7", text: "The Crown’s honour is engaged — and the “duty to consult” arises." }];
  v = verifyClaims([mk("D.", `The Crown's honour is engaged - and the "duty to consult" arises.`, "7")], curly, URL);
  assert.equal(v.anchors.length, 1);

  const { assembleInput, buildPrompt, summarizeCase, RETRY_SUFFIX } =
    await import("../src/lib/cases/ingest/summarizer");
  type LM = import("../src/lib/cases/ingest/llm").LlmModel;
  type LC = import("../src/lib/cases/types").LegalCase;

  const mkCase = (over: Partial<LC> = {}): LC => ({
    id: "2004-scc-73", citation: "2004 SCC 73", styleOfCause: "Haida Nation v. British Columbia",
    court: "Supreme Court of Canada", level: "scc", year: 2004, jurisdiction: "CA",
    nations: ["Haida"], themes: ["duty_to_consult"],
    outcome: { outcomeType: "precedent", winType: "doctrine_win", whoWon: "Haida Nation",
      holding: "The Crown owed a duty to consult before transferring the licence." },
    casesCited: [], casesCiting: [], citingCount: 0,
    enrichmentLevel: "index", corpusTier: "core",
    fullTextAvailable: true,
    chunks: [
      { paragraph: "12", text: "The Crown owed a duty to consult the Haida Nation before transferring the licence." },
      { paragraph: "48", text: "Compensation of $10 million was awarded for the breach of treaty obligations." },
    ],
    provenance: { source: "a2aj", sourceUrl: "https://example.org/case", upstreamLicense: "open", ingestedAt: "2026-06-28", unofficial: true },
    ...over,
  });

  // --- assembleInput: under budget → all chunks, tagged, document order ---
  const asm = assembleInput(mkCase().chunks!, "duty to consult");
  assert.ok(asm.startsWith("[para 12] The Crown"));
  assert.ok(asm.includes("\n[para 48] Compensation"));

  // --- assembleInput: over budget → first-10 + holding-token + economic chunks, doc order, within budget ---
  const bigChunks = Array.from({ length: 60 }, (_, i) => ({
    paragraph: String(i + 1),
    text: i === 40 ? "The consultation duty framework applies here. ".repeat(20)
      : i === 50 ? "A settlement of $2 million in compensation. ".repeat(20)
      : `Filler paragraph number ${i + 1}. `.repeat(20),
  }));
  const budget = 12_000;
  const out = assembleInput(bigChunks, "consultation duty framework", budget);
  assert.ok(out.length <= budget, "stays within budget");
  assert.ok(out.includes("[para 1]"), "keeps head chunks");
  assert.ok(out.includes("[para 41]"), "keeps holding-token chunk");
  assert.ok(out.includes("[para 51]"), "keeps economic chunk");
  const idx41 = out.indexOf("[para 41]"); const idx51 = out.indexOf("[para 51]");
  assert.ok(idx41 < idx51, "document order preserved");
  assert.equal(assembleInput(bigChunks, "consultation duty framework", budget), out, "deterministic");

  // --- buildPrompt carries case identity + rules + body ---
  const prompt = buildPrompt(mkCase(), "BODY-SENTINEL");
  assert.ok(prompt.includes("Haida Nation v. British Columbia"));
  assert.ok(prompt.includes("2004 SCC 73"));
  assert.ok(prompt.includes("BODY-SENTINEL"));
  assert.ok(prompt.includes('"claims"'));

  // --- summarizeCase: happy path ---
  const goodJson = JSON.stringify({ claims: [
    { text: "The court said the Crown must consult first.", quote: "duty to consult the Haida Nation", paragraph: "12" },
    { text: "Ten million dollars was awarded.", quote: "Compensation of $10 million was awarded", paragraph: "48" },
  ]});
  const fake = (responses: string[]): LM & { calls: string[] } => {
    const calls: string[] = [];
    return { id: "fake:test", calls, call: async (p: string) => { calls.push(p); return responses[Math.min(calls.length - 1, responses.length - 1)]; } };
  };

  let f = fake([goodJson]);
  let r = await summarizeCase(mkCase(), f);
  assert.equal(r.status, "generated");
  assert.equal(r.summary!.claims.length, 2);
  assert.equal(r.summary!.claims[0].sourceUrl, "https://example.org/case");
  assert.equal(r.meta!.method, "llm");
  assert.equal(r.meta!.model, "fake:test");
  assert.equal(r.claimsDropped, 0);
  assert.equal(f.calls.length, 1);

  // --- retry on malformed JSON, corrective suffix changes the prompt ---
  f = fake(["NOT JSON", goodJson]);
  r = await summarizeCase(mkCase(), f);
  assert.equal(r.status, "generated");
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[1].endsWith(RETRY_SUFFIX), "retry appends corrective suffix (new cache key)");

  // --- two malformed responses → failed ---
  f = fake(["NOT JSON", "STILL NOT JSON"]);
  r = await summarizeCase(mkCase(), f);
  assert.equal(r.status, "failed");

  // --- <2 verified claims → failed, nothing written ---
  const oneGood = JSON.stringify({ claims: [
    { text: "ok", quote: "duty to consult the Haida Nation", paragraph: "12" },
    { text: "fabricated", quote: "the moon is made of cheese and treaties", paragraph: "48" },
  ]});
  f = fake([oneGood]);
  r = await summarizeCase(mkCase(), f);
  assert.equal(r.status, "failed");
  assert.equal(r.claimsDropped, 1);
  assert.equal(r.summary, undefined);

  // --- skip rules: no model call happens ---
  const throwing: LM = { id: "fake:never", call: async () => { throw new Error("must not be called"); } };
  r = await summarizeCase(mkCase({ summary: { claims: [{ text: "curated", sourceParagraph: "1", sourceUrl: "u" }] } }), throwing);
  assert.equal(r.status, "skipped_curated");
  r = await summarizeCase(mkCase({ corpusTier: "substrate" }), throwing);
  assert.equal(r.status, "skipped_not_core");
  r = await summarizeCase(mkCase({ chunks: [] }), throwing);
  assert.equal(r.status, "skipped_no_fulltext");
  r = await summarizeCase(mkCase({ chunks: undefined }), throwing);
  assert.equal(r.status, "skipped_no_fulltext");

  // generated with claimsDropped > 0: meta and result carry the same count
  const withFab = JSON.stringify({ claims: [
    { text: "A.", quote: "duty to consult the Haida Nation", paragraph: "12" },
    { text: "B.", quote: "Compensation of $10 million was awarded", paragraph: "48" },
    { text: "C.", quote: "totally fabricated nonsense quote here", paragraph: "48" },
  ]});
  f = fake([withFab]);
  r = await summarizeCase(mkCase(), f);
  assert.equal(r.status, "generated");
  assert.equal(r.meta!.claimsDropped, 1);
  assert.equal(r.claimsDropped, 1);

  // exactly one retry — never a retry loop
  f = fake(["NOT JSON", "STILL NOT JSON", "NEVER REACHED"]);
  r = await summarizeCase(mkCase(), f);
  assert.equal(r.status, "failed");
  assert.equal(f.calls.length, 2, "exactly one retry, no loop");

  // model.call rejection propagates (throttling contract for the batch runner)
  await assert.rejects(summarizeCase(mkCase(), { id: "fake:throws", call: async () => { throw new Error("ThrottlingException"); } }), /ThrottlingException/);

  // dynamo round-trip: summary + summaryMeta must survive caseToItems → reassembleCase
  // (reassembleCase takes (profileItem, chunkItems); caseToItems returns [profile, ...chunks])
  const { caseToItems, reassembleCase } = await import("../src/lib/dynamo/cases-table");
  const withMeta = mkCase({
    summary: { claims: [{ text: "t", sourceParagraph: "12", sourceUrl: "u" }] },
    summaryMeta: { method: "llm", model: "m", generatedAt: "2026-07-04T00:00:00.000Z", claimsDropped: 1 },
  });
  const items = caseToItems(withMeta);
  const back = reassembleCase(items[0], items.slice(1));
  assert.deepEqual(back.summary, withMeta.summary);
  assert.deepEqual(back.summaryMeta, withMeta.summaryMeta);

  console.log("✅ test-cases-summarizer passed");
})();
