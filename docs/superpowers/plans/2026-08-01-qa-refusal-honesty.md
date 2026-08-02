# Q&A Refusal Honesty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop "Ask this judgment" from telling a reader that a judgment is silent on their question when in fact the model answered and every quote failed verification — and make the rate at which that happens observable.

**Architecture:** `answerCaseQuestion` gains a typed failure kind and a measured best-overlap, computed from diagnostics `verifyClaims` already produces but the Q&A path never requested. A single extra model call is spent only when the evidence says the answer was real (best overlap ≥ 0.8). The failure kind and overlap are persisted on the record and the page renders the honest message. Verification itself is unchanged: nothing unverified reaches the page.

**Tech Stack:** TypeScript (strict), Next.js App Router server components, DynamoDB single-table via `@aws-sdk/lib-dynamodb` (`removeUndefinedValues: true`), `node:assert/strict` offline test scripts run with `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-01-qa-refusal-honesty-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/cases/caseqa/types.ts` | The CASE-QA seam. | Add `QaFailKind`; add `failKind?` / `bestOverlap?` to `CaseQa`. |
| `src/lib/cases/caseqa/generator.ts` | Pure-ish generation + verification. No I/O beyond `model.call`. | Split the two failures, measure overlap, retry once on a near miss. |
| `src/lib/cases/caseqa/repo.ts` | DynamoDB persistence. | `setCaseQaFailed` records the kind and overlap. |
| `src/lib/cases/caseqa/run.ts` | Worker glue. | Pass the new fields through. |
| `src/app/cases/[id]/page.tsx` | Render. | Show `droppedClaims` on a partial answer. |
| `scripts/test-cases-caseqa.ts` | Offline tests with a stub model. | New file. |

`generator.ts` stays free of DynamoDB so the tests need no credentials — that property is why the test file can exist at all, and it must survive this change.

---

### Task 1: Typed failure kinds and the measured near miss

**Files:**
- Modify: `src/lib/cases/caseqa/types.ts`, `src/lib/cases/caseqa/generator.ts`
- Test: `scripts/test-cases-caseqa.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `scripts/test-cases-caseqa.ts`:

```ts
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

// 2. The model says the judgment is silent → that message, and NO retry. Retrying a correct
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

// 3. Quotes that share nothing with the judgment → the VERIFICATION message, not the
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

// 5. Near miss twice → fail, and EXACTLY two calls. Asserted so a loop cannot creep in later.
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
```

Note: this file uses top-level `await`, which `tsx` rejects under the repo's CJS output. Wrap the whole body in `async function main() { … } main().catch((e) => { console.error(e); process.exit(1); });` if the runner complains — the other `scripts/test-*.ts` files are synchronous, so this is the first async one.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx tsx scripts/test-cases-caseqa.ts
```

Expected: FAIL — `NEAR_MISS_OVERLAP` is not exported and `failKind` does not exist.

- [ ] **Step 3: Add the failure kinds to the seam**

In `src/lib/cases/caseqa/types.ts`, add above `CaseQa`:

```ts
// Why an answer could not be produced. `not_addressed` and `unverifiable` are the two the
// old code collapsed into one message: the first is the judgment being silent, the second
// is our verifier rejecting the model's quotes. Saying the first when it was the second
// tells the reader something false about a court decision.
export type QaFailKind = "no_full_text" | "unparseable" | "not_addressed" | "unverifiable";
```

and add two fields to `CaseQa`, after `droppedClaims?`:

```ts
  failKind?: QaFailKind;   // when failed
  bestOverlap?: number;    // when failed as `unverifiable`: how close the best quote came
```

- [ ] **Step 4: Rewrite the generator**

Replace everything in `src/lib/cases/caseqa/generator.ts` from `export type QaResult` to the end of the file with:

```ts
// A quote at or above this shares a contiguous run of at least 80% of its length with real
// judgment text — the model was quoting the judgment and mistyped it, not inventing.
//
// Calibrated against the 2026-07-31 drop forensics, not picked by feel: one substituted word
// splits a quote and leaves the longer surviving fragment at roughly 0.5, so 0.8 sits well
// clear of ordinary one-word garbling, while the bulk of real near misses measured 0.95+.
export const NEAR_MISS_OVERLAP = 0.8;

export type QaFailKind = QaFailKindT;
export type QaResult =
  | { status: "done"; answer: CaseQaAnswer; dropped: number }
  | { status: "failed"; failReason: string; failKind: QaFailKindT; bestOverlap?: number };

const REASON: Record<QaFailKindT, string> = {
  no_full_text: "this judgment has no full text to answer from",
  unparseable: "the model did not return a readable answer — please try again",
  not_addressed: "this judgment does not appear to address that question",
  // Deliberately says nothing about whether the judgment covers the question, because we
  // do not know: the model answered and we could not tie the answer to the text.
  unverifiable: "an answer was drafted but could not be matched to this judgment's text, so it was not shown — please try again",
};

// One parse + verify pass. `measureOverlap` is on so a total verification failure can be
// told apart from a fabrication; the cost is bounded because overlap is only computed for
// claims that are already being dropped.
function attempt(raw: string, c: LegalCase, chunks: CaseChunk[]) {
  const claims = parseClaims(raw);
  if (!claims) return { parsed: false as const };
  const { anchors, dropped, drops } = verifyClaims(claims, chunks, c.provenance.sourceUrl, { measureOverlap: true });
  const bestOverlap = drops.reduce((m, d) => (d.overlapMeasured && d.bestOverlap > m ? d.bestOverlap : m), 0);
  return { parsed: true as const, claimCount: claims.length, anchors, dropped, bestOverlap };
}

export async function answerCaseQuestion(
  c: LegalCase, chunks: CaseChunk[], question: string, model: LlmModel,
): Promise<QaResult> {
  if (!chunks.length) return { status: "failed", failKind: "no_full_text", failReason: REASON.no_full_text };
  const prompt = buildAskPrompt(c, question, assembleInput(chunks, c.outcome.holding));

  const first = attempt(await model.call(prompt), c, chunks);
  if (first.parsed) {
    if (first.anchors.length > 0) return { status: "done", answer: { claims: first.anchors }, dropped: first.dropped };
    // The model itself said the judgment is silent. That is a correct refusal, and retrying
    // it would spend a call to be told the same thing.
    if (first.claimCount === 0) return { status: "failed", failKind: "not_addressed", failReason: REASON.not_addressed };
    if (first.bestOverlap < NEAR_MISS_OVERLAP) {
      return { status: "failed", failKind: "unverifiable", failReason: REASON.unverifiable, bestOverlap: first.bestOverlap };
    }
    // Fall through: a near miss earns exactly one more call.
  }

  const second = attempt(await model.call(prompt + RETRY_SUFFIX), c, chunks);
  if (!second.parsed) {
    return { status: "failed", failKind: "unparseable", failReason: REASON.unparseable };
  }
  if (second.anchors.length > 0) return { status: "done", answer: { claims: second.anchors }, dropped: second.dropped };
  if (second.claimCount === 0) return { status: "failed", failKind: "not_addressed", failReason: REASON.not_addressed };
  return { status: "failed", failKind: "unverifiable", failReason: REASON.unverifiable, bestOverlap: second.bestOverlap };
}
```

and change the imports at the top of the file to:

```ts
import type { LegalCase, CaseChunk } from "../types";
import type { LlmModel } from "../ingest/llm";
import type { CaseQaAnswer, QaFailKind as QaFailKindT } from "./types";
import { assembleInput, parseClaims, verifyClaims, RETRY_SUFFIX } from "../ingest/summarizer";
```

Leave `buildAskPrompt` exactly as it is.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx tsx scripts/test-cases-caseqa.ts
```

Expected: `✅ test-cases-caseqa passed`

**If test 4 fails** (the near miss is not recovered), print the actual `bestOverlap` before changing anything. The fixture appends one character to a 68-character quote, which should score ≈0.99. A much lower number means `drops[].bestOverlap` is not being populated — check that `{ measureOverlap: true }` reached `verifyClaims`. Do **not** lower `NEAR_MISS_OVERLAP` to make the test pass.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. `run.ts` will still compile — `setCaseQaFailed` keeps its two-argument form until Task 2.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cases/caseqa/types.ts src/lib/cases/caseqa/generator.ts scripts/test-cases-caseqa.ts
git commit -m "fix(caseqa): stop reporting a verification failure as the judgment being silent"
```

---

### Task 2: Persist the kind, and show the reader what was dropped

**Files:**
- Modify: `src/lib/cases/caseqa/repo.ts`, `src/lib/cases/caseqa/run.ts`, `src/app/cases/[id]/page.tsx`

- [ ] **Step 1: Widen the repo write**

In `src/lib/cases/caseqa/repo.ts`, replace `setCaseQaFailed` with:

```ts
export async function setCaseQaFailed(
  id: string, failReason: string, failKind?: QaFailKind, bestOverlap?: number,
): Promise<void> {
  // Built conditionally rather than always SETting all four: DynamoDB rejects an
  // ExpressionAttributeValues entry that is never referenced, and the client's
  // removeUndefinedValues would strip the value while leaving the path in the expression.
  const names: Record<string, string> = { "#d": "data", "#s": "status", "#f": "failReason" };
  const values: Record<string, unknown> = { ":s": "failed", ":f": failReason };
  const sets = ["#d.#s = :s", "#d.#f = :f"];
  if (failKind !== undefined) { names["#fk"] = "failKind"; values[":fk"] = failKind; sets.push("#d.#fk = :fk"); }
  if (bestOverlap !== undefined) { names["#bo"] = "bestOverlap"; values[":bo"] = bestOverlap; sets.push("#d.#bo = :bo"); }
  await ddbDoc.send(new UpdateCommand({
    TableName: TABLE, Key: caseQaKeys.qa(id),
    UpdateExpression: "SET " + sets.join(", "),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}
```

and add `QaFailKind` to the type import at the top of that file (it already imports from `./types`).

- [ ] **Step 2: Pass it through the worker**

In `src/lib/cases/caseqa/run.ts`, replace

```ts
    else await setCaseQaFailed(id, r.failReason);
```

with

```ts
    else await setCaseQaFailed(id, r.failReason, r.failKind, r.bestOverlap);
```

- [ ] **Step 3: Show the dropped count on a partial answer**

In `src/app/cases/[id]/page.tsx`, replace

```tsx
                  <p className="mt-1 text-xs text-ink3">Drawn only from this judgment · not legal advice.</p>
```

with

```tsx
                  <p className="mt-1 text-xs text-ink3">
                    Drawn only from this judgment · not legal advice.
                    {!!qa.droppedClaims && (
                      <> · {qa.droppedClaims} further point{qa.droppedClaims === 1 ? "" : "s"} {qa.droppedClaims === 1 ? "was" : "were"} withheld because {qa.droppedClaims === 1 ? "its quotation" : "their quotations"} could not be matched to the judgment text.</>
                    )}
                  </p>
```

- [ ] **Step 4: Typecheck and re-run the tests**

```bash
npx tsc --noEmit
npx tsx scripts/test-cases-caseqa.ts
```

Expected: clean, and `✅ test-cases-caseqa passed`.

- [ ] **Step 5: Production build**

```bash
npm run build
```

Expected: build succeeds. This is the strongest verification available offline — the page cannot be rendered in the preview browser because `/cases` requires a session.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/caseqa/repo.ts src/lib/cases/caseqa/run.ts src/app/cases/[id]/page.tsx
git commit -m "feat(caseqa): persist the failure kind and disclose withheld points"
```

---

## After the tasks (controller, not a subagent)

1. Final whole-branch review.
2. Open the PR. Wait for explicit approval before merging.

## Self-review notes

- **Spec coverage:** separate the two failures (T1 S4), measure overlap (T1 S4, `measureOverlap: true`), retry once at ≥0.8 (T1 S4 + tests 4/5), disclose dropped claims (T2 S3), persist for observability (T2 S1–2). Explicitly-not-doing list is respected: `verifyClaims`, `locate()`, `normWs`, `assembleInput`, the briefings path and `summarizeCase` are untouched.
- **Naming consistency:** `QaFailKind`, `NEAR_MISS_OVERLAP`, `failKind`, `bestOverlap`, `droppedClaims` used identically across types, generator, repo, run and page.
- **Call-count discipline:** every failure path is asserted for exact call count, so the "one retry, never a loop" property is enforced by tests rather than by comment.
