// Tests for single-case Q&A (spec 2026-07-19). Offline, fake models, no network.
import assert from "node:assert/strict";

(async () => {
  const { buildAskPrompt, answerCaseQuestion } = await import("../src/lib/cases/caseqa/generator");
  type LM = import("../src/lib/cases/ingest/llm").LlmModel;
  type LC = import("../src/lib/cases/types").LegalCase;
  type CC = import("../src/lib/cases/types").CaseChunk;

  const c = {
    styleOfCause: "Haida Nation v. British Columbia", citation: "2004 SCC 73", court: "SCC", year: 2004,
    outcome: { holding: "The Crown must consult." }, provenance: { sourceUrl: "https://src/haida" },
  } as unknown as LC;
  const chunks: CC[] = [
    { paragraph: "para-1", text: "The duty to consult arises when the Crown has knowledge of a potential Aboriginal right." },
    { paragraph: "para-2", text: "Good faith consultation is required before the decision is made." },
  ];
  const fake = (responses: string[]): LM & { calls: string[] } => {
    const calls: string[] = [];
    return { id: "fake:qa", calls, call: async (p: string) => { calls.push(p); return responses[Math.min(calls.length - 1, responses.length - 1)]; } };
  };

  // prompt carries question + JSON contract + empty-claims refusal instruction
  const prompt = buildAskPrompt(c, "When does the duty arise?", "[para para-1] body");
  assert.ok(prompt.includes("When does the duty arise?"));
  assert.ok(prompt.includes('"claims"'));
  assert.ok(prompt.includes('{"claims":[]}'));

  // happy: quote verbatim in a chunk → done + anchored
  const good = JSON.stringify({ claims: [{ text: "The duty arises with Crown knowledge.", quote: "The duty to consult arises when the Crown has knowledge", paragraph: "para-1" }] });
  let f = fake([good]);
  let r = await answerCaseQuestion(c, chunks, "Q?", f);
  assert.equal(r.status, "done");
  if (r.status === "done") { assert.equal(r.answer.claims.length, 1); assert.equal(r.answer.claims[0].sourceParagraph, "para-1"); }
  assert.equal(f.calls.length, 1);

  // model returns empty claims → refuse
  f = fake([JSON.stringify({ claims: [] })]);
  r = await answerCaseQuestion(c, chunks, "Q?", f);
  assert.equal(r.status, "failed");
  if (r.status === "failed") assert.ok(/does not appear to address/.test(r.failReason));

  // quote not in the judgment → dropped → refuse (fabrication cannot pass)
  f = fake([JSON.stringify({ claims: [{ text: "x", quote: "a fabricated sentence that is not in the judgment", paragraph: "para-1" }] })]);
  r = await answerCaseQuestion(c, chunks, "Q?", f);
  assert.equal(r.status, "failed");

  // unreadable → retry with suffix → recovers
  f = fake(["NOT JSON", good]);
  r = await answerCaseQuestion(c, chunks, "Q?", f);
  assert.equal(r.status, "done");
  assert.equal(f.calls.length, 2);

  // empty chunks → failed without calling the model
  const never: LM = { id: "fake:never", call: async () => { throw new Error("must not be called"); } };
  r = await answerCaseQuestion(c, [], "Q?", never);
  assert.equal(r.status, "failed");

  const { caseQuestionHash, caseQaKeys } = await import("../src/lib/cases/caseqa/repo");
  // per-case scoping: same question, different case ⇒ different hash
  assert.notEqual(caseQuestionHash("2004-scc-73", "what is the duty?"), caseQuestionHash("2014-scc-44", "what is the duty?"));
  // deterministic + normalized (case/space/trailing punct fold)
  assert.equal(caseQuestionHash("c1", "What is the DUTY??"), caseQuestionHash("c1", "what is the duty"));
  assert.equal(caseQuestionHash("c1", "x").length, 32);
  assert.deepEqual(caseQaKeys.qa("abc"), { PK: "CASEQA#abc", SK: "CASEQA" });
  assert.deepEqual(caseQaKeys.qhash("h1"), { PK: "CQHASH#h1", SK: "CQHASH" });
  assert.deepEqual(caseQaKeys.quota("2026-07-19", "company:c-1"), { PK: "CQUOTA#2026-07-19#company:c-1", SK: "CQUOTA" });

  console.log("✅ test-cases-caseqa passed");
})().catch((e) => { console.error(e); process.exit(1); });
