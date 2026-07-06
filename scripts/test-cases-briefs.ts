// Tests for the briefing-notes pipeline (spec 2026-07-05). Offline: fake models.
import assert from "node:assert/strict";

(async () => {
  const { buildBriefContext, buildBriefPrompt, parseBriefing, verifyBriefing, generateBriefing } =
    await import("../src/lib/cases/briefs/generator");
  const { RETRY_SUFFIX } = await import("../src/lib/cases/ingest/summarizer");
  type LM = import("../src/lib/cases/ingest/llm").LlmModel;
  type LC = import("../src/lib/cases/types").LegalCase;

  const mkCase = (id: string, over: Partial<LC> = {}): LC => ({
    id, citation: id.toUpperCase(), styleOfCause: `Nation v. Crown (${id})`,
    court: "SCC", level: "scc", year: 2004, jurisdiction: "CA",
    nations: ["Testwa"], themes: ["duty_to_consult"],
    outcome: { outcomeType: "precedent", winType: "doctrine_win", whoWon: "Nation",
      holding: "The Crown owed a duty to consult before acting." },
    casesCited: [], casesCiting: [], citingCount: 0,
    enrichmentLevel: "index", corpusTier: "core", fullTextAvailable: true,
    summary: { claims: [{ text: "The court required consultation first.", sourceParagraph: "para-1", sourceUrl: "u" }] },
    summaryMeta: { method: "llm" },
    provenance: { source: "a2aj", sourceUrl: "u", upstreamLicense: "open", ingestedAt: "2026-07-05", unofficial: true },
    ...over,
  });
  const cases = [mkCase("case-a"), mkCase("case-b"), mkCase("case-c")];

  // --- context: tagged per case, includes holding + summary claim text; summary-less degrades ---
  const ctx = buildBriefContext(cases);
  assert.ok(ctx.includes("[case case-a]"));
  assert.ok(ctx.includes("duty to consult before acting"));
  assert.ok(ctx.includes("The court required consultation first."));
  const noSum = buildBriefContext([mkCase("case-x", { summary: undefined, summaryMeta: undefined })]);
  assert.ok(noSum.includes("[case case-x]") && noSum.includes("holding:"));
  assert.equal(buildBriefContext(cases), ctx, "deterministic");

  // --- prompt carries question, rules, context ---
  const prompt = buildBriefPrompt("What duties before mining on treaty land?", "CTX-SENTINEL");
  assert.ok(prompt.includes("What duties before mining on treaty land?"));
  assert.ok(prompt.includes("CTX-SENTINEL"));
  assert.ok(prompt.includes('"precedents"'));
  assert.ok(/do NOT give advice/i.test(prompt));

  // --- parser ---
  const goodBody = {
    background: "BG.",
    precedents: [
      { caseId: "case-a", establishes: "Duty to consult.", relevance: "Directly on point." },
      { caseId: "case-b", establishes: "Accommodation follows.", relevance: "Extends the duty." },
    ],
    principles: [{ text: "Consult before acting.", caseIds: ["case-a", "case-b"] }],
    considerations: "The precedents establish consultation obligations.",
  };
  const goodJson = JSON.stringify(goodBody);
  assert.deepEqual(parseBriefing(`intro\n${goodJson}\nout`), goodBody);
  assert.equal(parseBriefing("no json"), null);
  assert.equal(parseBriefing(`{"background":"x","precedents":"nope","principles":[],"considerations":"y"}`), null);
  assert.equal(parseBriefing(`{"background":1,"precedents":[],"principles":[],"considerations":"y"}`), null);

  // --- verifier: hallucinated caseId dropped; principle ids filtered; empty principle dropped ---
  const retrieved = ["case-a", "case-b", "case-c"];
  const withHallucination = {
    ...goodBody,
    precedents: [...goodBody.precedents, { caseId: "1997-fake-99", establishes: "X.", relevance: "Y." }],
    principles: [
      { text: "Real.", caseIds: ["case-a", "1997-fake-99"] },
      { text: "All fake.", caseIds: ["2001-fake-1"] },
    ],
  };
  const v = verifyBriefing(withHallucination, retrieved);
  assert.ok(v);
  assert.equal(v!.body.precedents.length, 2);
  assert.ok(v!.body.precedents.every((p) => retrieved.includes(p.caseId)));
  assert.deepEqual(v!.body.principles, [{ text: "Real.", caseIds: ["case-a"] }]);
  assert.equal(v!.dropped, 2); // 1 fake precedent + 1 all-fake principle

  // --- verifier: <2 surviving precedents → null ---
  const thin = { ...goodBody, precedents: [goodBody.precedents[0], { caseId: "9999-nope-1", establishes: "X.", relevance: "Y." }] };
  assert.equal(verifyBriefing(thin, retrieved), null);

  // --- generateBriefing: happy path ---
  const fake = (responses: string[]): LM & { calls: string[] } => {
    const calls: string[] = [];
    return { id: "fake:brief", calls, call: async (p: string) => { calls.push(p); return responses[Math.min(calls.length - 1, responses.length - 1)]; } };
  };
  let f = fake([goodJson]);
  let r = await generateBriefing("Q?", cases, f);
  assert.equal(r.status, "done");
  if (r.status === "done") { assert.equal(r.body.precedents.length, 2); assert.equal(r.dropped, 0); }
  assert.equal(f.calls.length, 1);

  // --- retry with suffix, then success ---
  f = fake(["NOT JSON", goodJson]);
  r = await generateBriefing("Q?", cases, f);
  assert.equal(r.status, "done");
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[1].endsWith(RETRY_SUFFIX));

  // --- double malformed → failed; hallucination-only → failed; <2 cases → failed without model call ---
  f = fake(["NOT JSON", "STILL NOT"]);
  r = await generateBriefing("Q?", cases, f);
  assert.equal(r.status, "failed");
  const allFake = JSON.stringify({ ...goodBody, precedents: [{ caseId: "fake-1", establishes: "X.", relevance: "Y." }, { caseId: "fake-2", establishes: "X.", relevance: "Y." }] });
  f = fake([allFake]);
  r = await generateBriefing("Q?", cases, f);
  assert.equal(r.status, "failed");
  if (r.status === "failed") assert.ok(r.failReason.length > 0);
  const throwing: LM = { id: "fake:never", call: async () => { throw new Error("must not be called"); } };
  r = await generateBriefing("Q?", [cases[0]], throwing);
  assert.equal(r.status, "failed");

  console.log("✅ test-cases-briefs passed");
})().catch((e) => { console.error(e); process.exit(1); });
