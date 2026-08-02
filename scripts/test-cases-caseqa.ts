import assert from "node:assert/strict";
import type { CaseChunk, LegalCase } from "../src/lib/cases/types";
import type { LlmModel } from "../src/lib/cases/ingest/llm";
import { answerCaseQuestion, NEAR_MISS_OVERLAP } from "../src/lib/cases/caseqa/generator";
import { caseFixtures } from "../src/lib/cases/query";

const chunks: CaseChunk[] = [
  { paragraph: "para-1", text: "The Crown owed a fiduciary duty to the Nation in these circumstances of dispossession." },
  { paragraph: "para-2", text: "Compensation was assessed at fair market value as of the date of the taking of the land." },
];
const c: LegalCase = { ...caseFixtures[0], chunks, provenance: { ...caseFixtures[0].provenance, sourceUrl: "https://example.test/j" } };

// A stub model that returns canned responses in order and counts its calls.
function stub(responses: string[]) {
  const calls: string[] = [];
  const model: LlmModel = {
    id: "stub:qa",
    call: async (prompt: string) => { calls.push(prompt); return responses[Math.min(calls.length - 1, responses.length - 1)]; },
  } as LlmModel;
  return { model, calls };
}
const claimJson = (text: string, quote: string, paragraph: string) =>
  JSON.stringify({ claims: [{ text, quote, paragraph }] });

async function main() {
// 1. A verbatim quote verifies.
{
  const { model, calls } = stub([claimJson("The Crown had a duty.", "The Crown owed a fiduciary duty to the Nation", "para-1")]);
  const r = await answerCaseQuestion(c, chunks, "What duty did the Crown owe?", model);
  assert.equal(r.status, "done");
  if (r.status !== "done") throw new Error("unreachable");
  assert.equal(r.answer.claims.length, 1);
  assert.equal(r.dropped, 0);
  assert.equal(calls.length, 1, "a clean answer costs exactly one call");
}

// 2. The model says the judgment is silent -> that message, and NO retry. Retrying a correct
//    refusal is a wasted call and the old code could not tell this case apart at all.
{
  const { model, calls } = stub([JSON.stringify({ claims: [] })]);
  const r = await answerCaseQuestion(c, chunks, "What did the court say about patents?", model);
  assert.equal(r.status, "failed");
  if (r.status !== "failed") throw new Error("unreachable");
  assert.equal(r.failKind, "not_addressed");
  assert.match(r.failReason, /does not appear to address/);
  assert.equal(calls.length, 1, "a correct refusal must not be retried");
}

// 3. Quotes that share nothing with the judgment -> the VERIFICATION message, not the
//    "does not address" one, and no retry (below the near-miss floor).
{
  const { model, calls } = stub([claimJson("Something else.", "The tribunal awarded punitive damages of four million", "para-1")]);
  const r = await answerCaseQuestion(c, chunks, "What duty did the Crown owe?", model);
  assert.equal(r.status, "failed");
  if (r.status !== "failed") throw new Error("unreachable");
  assert.equal(r.failKind, "unverifiable");
  assert.doesNotMatch(r.failReason, /does not appear to address/,
    "a verification failure must never be reported as the judgment being silent");
  assert.ok((r.bestOverlap ?? 1) < NEAR_MISS_OVERLAP);
  assert.equal(calls.length, 1, "below the near-miss floor there is nothing to retry for");
}

// 4. THE CASE THE RETRY EXISTS FOR: a near-miss quote (one character off), then a clean retry.
{
  const near = "The Crown owed a fiduciary duty to the Nation in these circumstancesX";
  const { model, calls } = stub([
    claimJson("The Crown had a duty.", near, "para-1"),
    claimJson("The Crown had a duty.", "The Crown owed a fiduciary duty to the Nation", "para-1"),
  ]);
  const r = await answerCaseQuestion(c, chunks, "What duty did the Crown owe?", model);
  assert.equal(r.status, "done", "a one-character near miss should be recovered by the retry");
  assert.equal(calls.length, 2);
  assert.ok(calls[1].length > calls[0].length, "the retry uses the suffixed prompt, so it has a different cache key");
}

// 5. Near miss twice -> fail, and EXACTLY two calls. Asserted so a loop cannot creep in later.
{
  const near = "The Crown owed a fiduciary duty to the Nation in these circumstancesX";
  const { model, calls } = stub([claimJson("The Crown had a duty.", near, "para-1")]);
  const r = await answerCaseQuestion(c, chunks, "What duty did the Crown owe?", model);
  assert.equal(r.status, "failed");
  if (r.status !== "failed") throw new Error("unreachable");
  assert.equal(r.failKind, "unverifiable");
  assert.ok((r.bestOverlap ?? 0) >= NEAR_MISS_OVERLAP);
  assert.equal(calls.length, 2, "one retry, never a loop");
}

// 6. Unparseable output still retries (pre-existing behaviour must survive).
{
  const { model, calls } = stub(["not json at all", claimJson("The Crown had a duty.", "The Crown owed a fiduciary duty to the Nation", "para-1")]);
  const r = await answerCaseQuestion(c, chunks, "What duty did the Crown owe?", model);
  assert.equal(r.status, "done");
  assert.equal(calls.length, 2);
}
{
  const { model, calls } = stub(["not json at all"]);
  const r = await answerCaseQuestion(c, chunks, "What duty?", model);
  assert.equal(r.status, "failed");
  if (r.status !== "failed") throw new Error("unreachable");
  assert.equal(r.failKind, "unparseable");
  assert.equal(calls.length, 2);
}

// 7. A partial answer keeps what verified and reports what it lost.
{
  const body = JSON.stringify({ claims: [
    { text: "Kept.", quote: "The Crown owed a fiduciary duty to the Nation", paragraph: "para-1" },
    { text: "Lost.", quote: "The tribunal awarded punitive damages of four million", paragraph: "para-2" },
  ] });
  const { model } = stub([body]);
  const r = await answerCaseQuestion(c, chunks, "What duty did the Crown owe?", model);
  assert.equal(r.status, "done");
  if (r.status !== "done") throw new Error("unreachable");
  assert.equal(r.answer.claims.length, 1);
  assert.equal(r.dropped, 1, "the reader is relying on a partial answer and has to be told");
}

// 8. No full text is its own kind, and costs no model call.
{
  const { model, calls } = stub([claimJson("x", "y", "para-1")]);
  const r = await answerCaseQuestion(c, [], "What duty?", model);
  assert.equal(r.status, "failed");
  if (r.status !== "failed") throw new Error("unreachable");
  assert.equal(r.failKind, "no_full_text");
  assert.equal(calls.length, 0);
}

console.log("✅ test-cases-caseqa passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
