# Sufficient-Context Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure whether a prompted sufficiency rater can tell "this judgment can answer this question" from "it cannot", accurately enough to gate the product's Q&A.

**Architecture:** Pure modules under `src/lib/cases/sufficiency/` (prompt, arm construction, tally with pre-registered thresholds), driven by one three-arm runner script. Phase 1 is measurement only — nothing in the product changes. Reuses the answer-quality eval's existing construction modules so both instruments measure the same questions; does not modify `scripts/cases-caseqa-eval.ts`.

**Tech Stack:** TypeScript, `tsx` for scripts, Bedrock Converse via `src/lib/cases/ingest/llm.ts`, `node:assert/strict` for tests.

**Spec:** [`docs/superpowers/specs/2026-08-07-sufficient-context-gate-design.md`](../specs/2026-08-07-sufficient-context-gate-design.md)

---

## File Structure

| File | Responsibility |
| --- | --- |
| `scripts/cases-probe-models.ts` (create) | One-token Converse probe to find a fourth invocable model id. Ops-only, no product code depends on it. |
| `src/lib/cases/sufficiency/prompt.ts` (create) | Build the rater prompt; parse its response. Nothing else. |
| `src/lib/cases/sufficiency/arms.ts` (create) | Leave-one-out construction: remove the target chunk, prove it is gone. Pure. |
| `src/lib/cases/sufficiency/tally.ts` (create) | Pre-registered thresholds, the two rate definitions, the decision function. Pure. |
| `scripts/cases-sufficiency-eval.ts` (create) | Three-arm runner: construction reuse, rating, residual-answerability, persistence, guards. |
| `scripts/test-cases-sufficiency.ts` (create) | Tests for all three pure modules. |
| `package.json` (modify) | Two npm scripts. |

Deliberately **not** modified: `scripts/cases-caseqa-eval.ts`. Its construction pieces are already separate importable modules (`pickTargets`, `screenSubstantiveTargets`, `buildQuestionPrompt`, `isWellFormedQuestion`, `isLexicalGimme`, `buildUnanswerablePairs`), so the new runner imports those directly. Task 5 adds a cross-check proving both runners produce the same questions, which is what an extraction refactor would have bought, without touching the project's most-corrected script.

---

### Task 1: Model probe — find a fourth invocable id

Spec §5: four roles, no model may hold two, and the three verified ids are all taken. This finds a fourth or records that there is none.

**Files:**
- Create: `scripts/cases-probe-models.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the probe script**

```ts
// Which model ids can this account actually invoke? `aws bedrock list-inference-profiles`
// reporting ACTIVE is NOT the same thing — this project has already had a plan blocked by two
// EOL Claude ids and one profile that was listed ACTIVE but not available to this account.
// The only reliable test is a real Converse call, so this makes one, with a one-token budget.
//
// Ops-only. No product code imports this.
import { modelFromId } from "../src/lib/cases/ingest/llm";

// Candidates, not a recommendation. The three ids already spoken for by other roles
// (llama3-3-70b = answerer, opus-4-5 = judge, sonnet-4-6 = writer) are included so the output
// doubles as a re-confirmation that they still work.
const DEFAULT_CANDIDATES = [
  "us.anthropic.claude-sonnet-4-6",
  "us.anthropic.claude-opus-4-5-20251101-v1:0",
  "us.meta.llama3-3-70b-instruct-v1:0",
  "us.amazon.nova-pro-v1:0",
  "us.amazon.nova-lite-v1:0",
  "mistral.mistral-large-2407-v1:0",
  "cohere.command-r-plus-v1:0",
  "us.meta.llama4-maverick-17b-instruct-v1:0",
  "us.deepseek.r1-v1:0",
];

async function main() {
  const ids = (process.env.PROBE_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const candidates = ids.length ? ids : DEFAULT_CANDIDATES;
  console.log(`probing ${candidates.length} candidate model id(s) with a real 1-token Converse call\n`);
  const ok: string[] = [];
  for (const id of candidates) {
    // Uncached on purpose: a cached "yes" from a previous probe would not prove the id is
    // invocable NOW, which is the only thing this script exists to establish.
    try {
      await modelFromId(id, { maxTokens: 1 }).call("hi");
      console.log(`  INVOCABLE   ${id}`);
      ok.push(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A max_tokens truncation means the call REACHED the model and it started generating —
      // that is a success for this probe, not a failure. llm.ts throws on truncation with no
      // text part, which is exactly what a 1-token budget produces.
      if (/truncated at maxTokens/.test(msg)) {
        console.log(`  INVOCABLE   ${id}   (reached the model; truncated at 1 token as expected)`);
        ok.push(id);
      } else {
        console.log(`  no          ${id}\n                ${msg.slice(0, 160)}`);
      }
    }
  }
  console.log(`\n${ok.length} invocable:\n${ok.map((i) => `  ${i}`).join("\n")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the npm script**

In `package.json`, after the `"cases:nli-probe:cloud"` line, add:

```json
    "cases:probe-models:cloud": "cross-env AWS_REGION=us-east-1 BEDROCK_REGION=us-east-1 tsx scripts/cases-probe-models.ts",
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0, no output.

- [ ] **Step 4: Commit**

```bash
git add scripts/cases-probe-models.ts package.json
git commit -m "feat(ops): probe which Bedrock model ids this account can actually invoke"
```

- [ ] **Step 5: STOP — report to the controller**

This script needs credentials to produce its finding. Report `DONE_WITH_CONCERNS` noting that
`AWS_PROFILE=bedrock npm run cases:probe-models:cloud` must be run by the operator before Task 5
can pick a rater model. Do **not** run it yourself and do **not** block on it — Tasks 2–4 are
independent of the result.

---

### Task 2: The rater prompt and parser

**Files:**
- Create: `src/lib/cases/sufficiency/prompt.ts`
- Create: `scripts/test-cases-sufficiency.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-sufficiency.ts`:

```ts
// Tests for the sufficiency instrument's pure parts.
// Run: npx tsx scripts/test-cases-sufficiency.ts
import assert from "node:assert/strict";
import { buildSufficiencyPrompt, parseSufficiency } from "../src/lib/cases/sufficiency/prompt";

// --- parseSufficiency --------------------------------------------------------------------
assert.deepEqual(parseSufficiency('{"reason":"para 12 states the test","sufficient":true}'),
  { sufficient: true, reason: "para 12 states the test" });
assert.deepEqual(parseSufficiency('```json\n{"reason":"r","sufficient":false}\n```'),
  { sufficient: false, reason: "r" }, "fenced JSON");
assert.deepEqual(parseSufficiency('Let me think.\n{"reason":" spaced ","sufficient":true}'),
  { sufficient: true, reason: "spaced" }, "prose preamble tolerated, reason trimmed");
// A missing reason is not fatal — the label is what gets scored, the reason is for the
// samples printer. A missing LABEL is fatal.
assert.deepEqual(parseSufficiency('{"sufficient":false}'), { sufficient: false, reason: "" });
// null means THE RATER FAILED. Defaulting to either label would manufacture evidence: a
// default of `false` inflates the gate's apparent catch rate, a default of `true` inflates its
// apparent safety. Both are conclusions invented from a broken response.
assert.equal(parseSufficiency("the judgment does address this"), null, "no JSON");
assert.equal(parseSufficiency('{"reason":"r"}'), null, "no label");
assert.equal(parseSufficiency('{"sufficient":"true"}'), null, "string is not a boolean");
assert.equal(parseSufficiency('{"sufficient":1}'), null, "1 is not a boolean");

// --- buildSufficiencyPrompt --------------------------------------------------------------
{
  const p = buildSufficiencyPrompt("QUESTION_TEXT", "STYLE_TEXT", "BODY_TEXT");
  assert.ok(p.includes("QUESTION_TEXT") && p.includes("STYLE_TEXT") && p.includes("BODY_TEXT"));
  // The rater must be asked about SUFFICIENCY, not groundedness. If it leaks the faithfulness
  // vocabulary it becomes the rung-3 checker again, which #237 measured and rejected.
  for (const w of ["entailment", "supported", "overstated", "contradicted"]) {
    assert.ok(!p.includes(w), `sufficiency prompt leaks faithfulness vocabulary: ${w}`);
  }
  // Reason before label in the output schema, so the model derives before it commits. The
  // project already uses reasoning-first schemas (RM-5) for exactly this reason.
  //
  // Scoped to the SCHEMA LINE, not the whole prompt. A first draft of this compared indexOf
  // over the entire string and failed against a correct prompt: the prose says
  // `Answer "sufficient": true only if ...` well before the schema, so the first occurrence of
  // the quoted key is prose, not schema. Naming the JSON key in the instructions is good prompt
  // writing; the assertion was measuring the wrong span.
  const schema = p.split("\n").find((l) => l.trim().startsWith('{"')) ?? "";
  assert.ok(schema.includes('"reason"') && schema.includes('"sufficient"'),
    "the output schema line must name both keys");
  assert.ok(schema.indexOf('"reason"') < schema.indexOf('"sufficient"'),
    "reason must precede the label in the output schema");
  // The paper's distinction is the whole point: relevant is not sufficient. If the prompt does
  // not say so, the rater collapses to a topic-relevance check and arm L becomes unpassable.
  assert.ok(/relevant/i.test(p) && /not enough|is not sufficient|insufficient/i.test(p),
    "prompt must explicitly separate relevant from sufficient");
}

console.log("✅ test-cases-sufficiency passed");
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx scripts/test-cases-sufficiency.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/sufficiency/prompt'`.

- [ ] **Step 3: Write the module**

Create `src/lib/cases/sufficiency/prompt.ts`:

```ts
// Rung 0 of the verification ladder: does this judgment contain enough to answer this question
// AT ALL? Every existing check — verifyClaims (rungs 1-2) and the rung-3 NLI probe — compares a
// CLAIM to a PARAGRAPH and has never seen the question. That is why the product returned
// {"claims":[]} zero times in 54 questions (2026-08-06 answer-quality run) while answering 15 of
// 16 questions about judgments that do not address them.
//
// Sufficiency is NOT groundedness. Joren et al. (ICLR 2025, arXiv:2411.06037) separate them:
// context can be relevant, on-topic, and quotable while still not containing the answer. Their
// prompted rater beat both an NLI baseline and a finetuned rater, which is why this is a prompt
// and not a classifier — and independently corroborates #237's finding that entailment is the
// wrong tool for this family of question.

export interface Sufficiency { sufficient: boolean; reason: string }

function firstJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

// null means THE RATER FAILED, and callers must count it separately — never default a label.
// Defaulting to false would inflate the gate's catch rate; defaulting to true would inflate its
// safety. Both invent evidence out of a broken response.
export function parseSufficiency(raw: string): Sufficiency | null {
  const j = firstJson(raw);
  if (typeof j?.sufficient !== "boolean") return null;
  return { sufficient: j.sufficient, reason: typeof j.reason === "string" ? j.reason.trim() : "" };
}

export function buildSufficiencyPrompt(question: string, styleOfCause: string, body: string): string {
  return `You are deciding ONE thing about a Canadian court decision: does its text contain enough information to answer a question?

You are NOT being asked whether an answer would be well written, whether the decision is about the right area of law, or whether any particular sentence is accurate. Only whether the answer is IN THERE.

CASE: ${styleOfCause}

QUESTION:
${question}

Answer "sufficient": true only if the judgment text below contains the information needed to give a definitive answer to that question.

Answer "sufficient": false if the text lacks that information, addresses it only incompletely or inconclusively, or is contradictory about it.

Being relevant is not enough. A passage can be on the same topic, discuss the same area of law, and use the same words as the question while still not containing the answer — that is insufficient, not sufficient. Ask what a reader could actually conclude from this text alone.

Give your reasoning FIRST, then the label.

Output STRICTLY this JSON, no markdown:
{"reason":"one or two sentences","sufficient":true|false}

JUDGMENT TEXT:
${body}`;
}
```

- [ ] **Step 4: Run the test**

Run: `npx tsx scripts/test-cases-sufficiency.ts`
Expected: `✅ test-cases-sufficiency passed`

- [ ] **Step 5: Prove the tests are load-bearing**

Each mutation below MUST make the suite fail. If one passes, the assertion is decoration — say so
in your report rather than moving on. **Verify each edit actually applied** before trusting the
result: this project has twice been misled by a mutation that silently missed (a same-named
expression elsewhere in the file, and a CRLF line-ending mismatch), each of which looks exactly
like "the test is not load-bearing".

1. In `parseSufficiency`, change `if (typeof j?.sufficient !== "boolean") return null;` to
   `if (typeof j?.sufficient !== "boolean") return { sufficient: false, reason: "" };`
   → must fail on `"no JSON"`.
2. In the prompt, delete the paragraph beginning `Being relevant is not enough.`
   → must fail on `"prompt must explicitly separate relevant from sufficient"`.
3. In the prompt, swap the output schema line to
   `{"sufficient":true|false,"reason":"one or two sentences"}`
   → must fail on `"reason must precede the label in the output schema"`. (This is the mutation
   that proves the narrowed scope did not make the assertion vacuous.)

Restore the file after each. Then run the suite once more and confirm it passes.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/cases/sufficiency/prompt.ts scripts/test-cases-sufficiency.ts
git commit -m "feat(sufficiency): rater prompt and parser"
```

---

### Task 3: Leave-one-out arm construction

Spec §4, arm L. This is the arm that makes the measurement worth doing: insufficiency created by
construction rather than certified by a screen.

**Files:**
- Create: `src/lib/cases/sufficiency/arms.ts`
- Modify: `scripts/test-cases-sufficiency.ts`

- [ ] **Step 1: Write the failing test**

In `scripts/test-cases-sufficiency.ts`, add the import at the top (beside the existing one):

```ts
import { stripTarget, assertTargetAbsent } from "../src/lib/cases/sufficiency/arms";
```

and add this block immediately **before** the final `console.log`:

```ts
// --- stripTarget -------------------------------------------------------------------------
{
  const chunks = [
    { paragraph: "para-1", text: "first" },
    { paragraph: "para-2", text: "second" },
    { paragraph: "para-3", text: "third" },
  ];
  const { kept } = stripTarget(chunks, "para-2");
  assert.deepEqual(kept.map((c) => c.paragraph), ["para-1", "para-3"], "removes exactly the target");
  assert.equal(chunks.length, 3, "must not mutate the caller's array");

  // A target that is not present means the caller and the corpus disagree about what the
  // target IS. Silently returning all three chunks would make arm L identical to arm S while
  // being scored as a negative — every rater would 'fail' it, and the failure would be ours.
  assert.throws(() => stripTarget(chunks, "para-9"), /para-9/,
    "absent target must throw, naming the paragraph");

  // Duplicate ids would remove two paragraphs, so the item is no longer a controlled
  // single-paragraph deletion and its label no longer means what the report says it means.
  const dup = [{ paragraph: "para-1", text: "a" }, { paragraph: "para-1", text: "b" }];
  assert.throws(() => stripTarget(dup, "para-1"), /2/, "duplicate ids must throw, naming the count");
}

// --- assertTargetAbsent ------------------------------------------------------------------
{
  // assembleInput emits `[para <id>] <text>` lines, so absence is checked against that exact
  // tag. Checking for the bare id would false-positive on any paragraph whose TEXT mentions it.
  assert.doesNotThrow(() => assertTargetAbsent("[para para-1] first\n[para para-3] third", "para-2"));
  assert.throws(() => assertTargetAbsent("[para para-1] a\n[para para-2] b", "para-2"), /para-2/,
    "target still in the assembled body must throw");
  // The guard must not fire merely because the id appears inside prose.
  assert.doesNotThrow(() => assertTargetAbsent("[para para-1] see para-2 above", "para-2"),
    "a mention in prose is not the paragraph itself");
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx scripts/test-cases-sufficiency.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/sufficiency/arms'`.

- [ ] **Step 3: Write the module**

Create `src/lib/cases/sufficiency/arms.ts`:

```ts
// Arm L of the sufficiency measurement (spec §4).
//
// The eval's unanswerable pairs are cross-case, and their "does not address" label was produced
// by an LLM screen running on the JUDGE model (cases-caseqa-eval.ts). Scoring a rater against
// that label measures agreement between two judges, not accuracy. Arm L avoids the screen
// entirely: take a question that IS answerable — ground truth by construction, because the
// target paragraph was chosen first and the question written from it — and delete that
// paragraph. Insufficiency is then created, not certified.
//
// It is also the hardest possible negative: everything that remains is the same judgment, same
// parties, same area of law, same vocabulary. A rater that passes arm L is doing more than
// topic matching.
//
// The known weakness, stated rather than hidden: a judgment can state the same proposition in
// more than one paragraph, so deleting the target does not STRICTLY guarantee the question
// became unanswerable. That residual is measured by the runner (an independent model is asked
// whether the stripped body still addresses the question) and published as a contamination
// bound. It is not subtracted out.

export interface Chunk { paragraph: string; text: string }

// Returns a NEW array. The caller goes on to use the original for arm S, and an in-place
// removal would silently turn arm S into arm L.
export function stripTarget<T extends Chunk>(chunks: readonly T[], targetParagraph: string): { kept: T[] } {
  const hits = chunks.filter((c) => c.paragraph === targetParagraph).length;
  if (hits !== 1) {
    throw new Error(
      `leave-one-out needs exactly one chunk with paragraph "${targetParagraph}", found ${hits}. ` +
      `Zero means the caller and the corpus disagree about what the target is; more than one means ` +
      `the deletion would not be the controlled single-paragraph removal this arm is defined as.`,
    );
  }
  return { kept: chunks.filter((c) => c.paragraph !== targetParagraph) };
}

// assembleInput has a 240,000-char budget and re-picks which chunks survive when the input
// shrinks, so what it emits after a removal is not simply "the same minus one". This confirms
// the removal actually reached the assembled text rather than trusting that it did.
//
// Matches the `[para <id>]` tag that assembleInput emits, NOT a bare id: judgments routinely
// refer to their own paragraph numbers in prose, and a bare-id check would report the target as
// present whenever another paragraph cited it.
export function assertTargetAbsent(assembledBody: string, targetParagraph: string): void {
  const tag = `[para ${targetParagraph}]`;
  if (assembledBody.includes(tag)) {
    throw new Error(`leave-one-out body still contains ${tag} — the removal did not take`);
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx tsx scripts/test-cases-sufficiency.ts`
Expected: `✅ test-cases-sufficiency passed`

- [ ] **Step 5: Prove the tests are load-bearing**

Verify each edit applies, then confirm each mutation fails the suite:

1. In `stripTarget`, change `if (hits !== 1)` to `if (hits > 1)` → must fail on the absent-target case.
2. In `stripTarget`, change the return to `{ kept: chunks as T[] }` → must fail on `"removes exactly the target"`.
3. In `assertTargetAbsent`, change `const tag = \`[para ${targetParagraph}]\`;` to
   `const tag = targetParagraph;` → must fail on `"a mention in prose is not the paragraph itself"`.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/cases/sufficiency/arms.ts scripts/test-cases-sufficiency.ts
git commit -m "feat(sufficiency): leave-one-out arm construction with removal guards"
```

---

### Task 4: Pre-registered thresholds and the decision

Spec §6. Both rates are defined here once so they cannot be computed two ways.

**Files:**
- Create: `src/lib/cases/sufficiency/tally.ts`
- Modify: `scripts/test-cases-sufficiency.ts`

- [ ] **Step 1: Write the failing test**

Add the import beside the others:

```ts
import {
  falseRefusalRate, projectedFalseAnswerRate, decide, assertNoCallFailures,
  FALSE_REFUSAL_MAX, PROJECTED_FALSE_ANSWER_MAX, BASELINE_FALSE_ANSWER,
} from "../src/lib/cases/sufficiency/tally";
```

and this block before the final `console.log`:

```ts
// --- rate definitions --------------------------------------------------------------------
// The two rates run in OPPOSITE directions over the rater's label, which is exactly the
// mistake worth pinning: on answerable questions `insufficient` is the error, on unanswerable
// questions `sufficient` is the error. A single shared helper would get one of them backwards.
assert.equal(falseRefusalRate({ sufficient: 95, insufficient: 5 }), 0.05,
  "arm S: refusing an answerable question is the error");
assert.equal(projectedFalseAnswerRate({ sufficient: 3, insufficient: 12 }), 0.2,
  "arm X: letting an unanswerable question through is the error");
assert.equal(falseRefusalRate({ sufficient: 0, insufficient: 0 }), 0, "empty arm is 0, not NaN");
assert.equal(projectedFalseAnswerRate({ sufficient: 0, insufficient: 0 }), 0, "empty arm is 0, not NaN");

// --- the pre-registered decision ---------------------------------------------------------
// Boundaries inclusive, as documented.
assert.equal(decide(FALSE_REFUSAL_MAX, PROJECTED_FALSE_ANSWER_MAX), "ship");
assert.equal(decide(0, 0), "ship");
// The gate works and the operating point is wrong — a tuning problem, not a dead end.
assert.equal(decide(0.30, 0.10), "tune-do-not-ship");
// The gate is safe and catches nothing. #237's gate A was exactly this, and it was not built.
assert.equal(decide(0.01, 0.90), "inert");
assert.equal(decide(0.30, 0.90), "unusable");
assert.equal(decide(FALSE_REFUSAL_MAX + 1e-9, 0.10), "tune-do-not-ship", "strictly above fails");
assert.equal(decide(0.01, PROJECTED_FALSE_ANSWER_MAX + 1e-9), "inert", "strictly above fails");
// The baseline is what the 20% is measured against and belongs in the module, not the prose.
assert.equal(BASELINE_FALSE_ANSWER, 0.938);

// --- call-failure guard ------------------------------------------------------------------
// A failed call is not a data point. #237's re-run lost 21 calls to an expired token, printed a
// matrix identical to the previous run, and exited 0 with a SHIP verdict.
assert.doesNotThrow(() => assertNoCallFailures(0, "arm S"));
assert.throws(() => assertNoCallFailures(1, "arm S"), /void/);
assert.throws(() => assertNoCallFailures(7, "arm L"), /7 call\(s\) failed/, "names the count");
assert.throws(() => assertNoCallFailures(7, "arm L"), /during arm L/, "names the arm");
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx scripts/test-cases-sufficiency.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/sufficiency/tally'`.

- [ ] **Step 3: Write the module**

Create `src/lib/cases/sufficiency/tally.ts`:

```ts
// Pre-registered 2026-08-07, BEFORE any rater response was read. Constants rather than inline
// literals so the rule cannot be quietly relaxed after seeing the numbers — the discipline this
// project has kept on every instrument, and the one that made #237's result honest when the
// pre-registered rule passed and the finding was still negative.

export interface ArmCounts { sufficient: number; insufficient: number }

// The product's CURRENT false-refusal rate is 0.0% (2026-08-06 run, 38 answerable questions,
// zero refusals of any kind). Every refusal this gate introduces is therefore a NEW cost that
// did not exist before, paid on questions the product answers correctly today. 5% is the level
// at which the trade is worth making.
export const FALSE_REFUSAL_MAX = 0.05;

// Against a measured baseline of 93.8% (15 of 16 unanswerable questions answered).
export const PROJECTED_FALSE_ANSWER_MAX = 0.20;
export const BASELINE_FALSE_ANSWER = 0.938;

const rate = (n: number, d: number): number => (d === 0 ? 0 : n / d);

// Arm S: the questions are answerable by construction. The rater calling one `insufficient`
// would make the product refuse a question it answers correctly today.
export const falseRefusalRate = (c: ArmCounts): number =>
  rate(c.insufficient, c.sufficient + c.insufficient);

// Arm X: the gate only blocks what it calls insufficient, so everything it calls `sufficient`
// reaches the answerer and is answered at today's rate. This is an UPPER BOUND on the resulting
// false-answer rate — a question the gate passes can still be refused downstream by
// verifyClaims, as one was — and the bound is what the threshold is set against.
export const projectedFalseAnswerRate = (c: ArmCounts): number =>
  rate(c.sufficient, c.sufficient + c.insufficient);

export type Decision = "ship" | "tune-do-not-ship" | "inert" | "unusable";

// Order matters and is not arbitrary. False refusal is checked first because it is the cost the
// product does not currently pay at all; a gate that refuses good questions is a regression
// however well it catches bad ones. "inert" is the #237 gate-A outcome: safe, correct, and not
// worth building.
export function decide(falseRefusal: number, projectedFalseAnswer: number): Decision {
  const refusalOk = falseRefusal <= FALSE_REFUSAL_MAX;
  const catchOk = projectedFalseAnswer <= PROJECTED_FALSE_ANSWER_MAX;
  if (refusalOk && catchOk) return "ship";
  if (!refusalOk && catchOk) return "tune-do-not-ship";
  if (refusalOk && !catchOk) return "inert";
  return "unusable";
}

// An UNPARSED response is evidence: the rater was asked and produced something no parser
// accepts. A FAILED CALL is not evidence about anything — the request never reached the model.
// Rates computed over the survivors of an outage are not rates, so this throws rather than
// annotating: a caveat printed under a headline number gets read as a caveat.
export function assertNoCallFailures(callFailures: number, context: string): void {
  if (callFailures > 0) {
    throw new Error(
      `${callFailures} call(s) failed outright during ${context} — the run is void, not merely ` +
      `incomplete. Unlike an unparsed response, a failed call says nothing about the rater, so ` +
      `every rate below it would be computed over an arbitrary subset. Fix the cause (most often: ` +
      `expired credentials) and re-run; responses already cached will replay for free.`,
    );
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx tsx scripts/test-cases-sufficiency.ts`
Expected: `✅ test-cases-sufficiency passed`

- [ ] **Step 5: Prove the tests are load-bearing**

Verify each edit applies, then confirm each mutation fails:

1. Make `projectedFalseAnswerRate` return `rate(c.insufficient, ...)` → must fail on the arm X rate.
2. In `decide`, swap the two middle branches (`tune-do-not-ship` ↔ `inert`) → must fail.
3. In `decide`, change `falseRefusal <= FALSE_REFUSAL_MAX` to `<` → must fail on the inclusive boundary.
4. In `assertNoCallFailures`, change `callFailures > 0` to `callFailures > 10` → must fail.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/cases/sufficiency/tally.ts scripts/test-cases-sufficiency.ts
git commit -m "feat(sufficiency): pre-registered thresholds and decision rule"
```

---

### Task 5: The three-arm runner

**Files:**
- Create: `scripts/cases-sufficiency-eval.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the runner**

Create `scripts/cases-sufficiency-eval.ts`:

```ts
// Three-arm measurement of the sufficiency rater (spec 2026-08-07). Phase 1: measurement only —
// this changes NOTHING in the product. Wiring is conditional on the pre-registered thresholds in
// sufficiency/tally.ts and is not in this script.
//
// Run: AWS_PROFILE=bedrock npm run cases:sufficiency-eval:cloud
//
//   arm S  answerable questions, full body        — ground truth SUFFICIENT by construction
//   arm X  cross-case unanswerable, full body     — INSUFFICIENT per an LLM screen (see below)
//   arm L  answerable questions, target removed   — INSUFFICIENT by construction
//
// Arms X and L have opposite biases and bracket the answer. X is the easy negative and its label
// came from a screen run on the JUDGE model, so a rater that is also the judge would be scoring
// its own homework. L is the adversarial negative — same judgment, same vocabulary, one
// paragraph gone — but a judgment can state a proposition twice, so L reports its own residual
// answerability instead of assuming it is zero.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { modelFromId, cachedModel, hasCached, evictCached } from "../src/lib/cases/ingest/llm";
import { assembleInput } from "../src/lib/cases/ingest/summarizer";
import { buildSufficiencyPrompt, parseSufficiency, type Sufficiency } from "../src/lib/cases/sufficiency/prompt";
import { stripTarget, assertTargetAbsent } from "../src/lib/cases/sufficiency/arms";
import {
  falseRefusalRate, projectedFalseAnswerRate, decide, assertNoCallFailures,
  FALSE_REFUSAL_MAX, PROJECTED_FALSE_ANSWER_MAX, BASELINE_FALSE_ANSWER, type ArmCounts,
} from "../src/lib/cases/sufficiency/tally";
import { callParsed, type CacheOps } from "../src/lib/cases/nli-probe/repair";
import { pickTargets, buildQuestionPrompt, isWellFormedQuestion, isLexicalGimme } from "../src/lib/cases/caseqa-eval/construct";
import { screenSubstantiveTargets } from "../src/lib/cases/caseqa-eval/substanceScreen";
import { buildUnanswerablePairs } from "../src/lib/cases/caseqa-eval/pairing";
import { buildSubstantivePrompt, parseSubstantive, buildAddressedPrompt, parseAddressed } from "../src/lib/cases/caseqa-eval/judge";

// Four roles, no model may hold two (spec §5). RATER must differ from all three; the runner
// refuses to start otherwise, because a rater that is also the judge scores arm X against labels
// it produced itself, and that agreement would be reported as accuracy.
const WRITER = process.env.EVAL_WRITER ?? "us.anthropic.claude-sonnet-4-6";
const JUDGE = process.env.EVAL_JUDGE ?? "us.anthropic.claude-opus-4-5-20251101-v1:0";
const ANSWERER = process.env.EVAL_ANSWERER ?? "us.meta.llama3-3-70b-instruct-v1:0";
const RATER = process.env.SUFFICIENCY_RATER ?? "us.anthropic.claude-sonnet-4-6";

// Budgets explicit. #237 lost a whole arm to maxTokens 64: "output STRICTLY this JSON" does not
// stop a model reasoning in prose first, a response truncated mid-reasoning still has a text
// part so llm.ts does not throw, and the label silently fails to parse — non-randomly, skewed
// toward the hard cases. This prompt asks for reasoning FIRST, so it needs room for it.
const RATER_MAX_TOKENS = 1024;
const WRITER_MAX_TOKENS = 512;
const JUDGE_MAX_TOKENS = 1024;

const SEED = Number(process.env.EVAL_SEED ?? 1);
const N_ANSWERABLE = Number(process.env.EVAL_ANSWERABLE ?? 40);
const N_UNANSWERABLE = Number(process.env.EVAL_UNANSWERABLE ?? 20);

let repairs = 0;
const CACHE_OPS: CacheOps = { hasCached, evictCached };

async function main() {
  // Spec §5's fallback: if no fourth id is invocable, the rater may share the WRITER's id and
  // the report carries a contamination caveat (the rater would be grading questions its own
  // family wrote). Sharing the JUDGE's id is never allowed under any flag — the judge produced
  // arm X's labels, so that pairing turns arm X into self-agreement, which is the one result
  // this whole design exists to avoid.
  const shared = new Set([WRITER, JUDGE, ANSWERER, RATER]).size !== 4;
  const allowShared = process.env.SUFFICIENCY_ALLOW_SHARED === "1";
  if (RATER === JUDGE) {
    throw new Error(
      `rater must not be the judge (${JUDGE}): the judge produced arm X's "does not address" ` +
      `labels, so scoring the rater against them would measure self-agreement and report it as ` +
      `accuracy. No flag overrides this. Run 'npm run cases:probe-models:cloud' and set SUFFICIENCY_RATER.`,
    );
  }
  if (shared && !allowShared) {
    throw new Error(
      `four roles must be four DIFFERENT models, got writer=${WRITER} judge=${JUDGE} ` +
      `answerer=${ANSWERER} rater=${RATER}. Run 'npm run cases:probe-models:cloud' to find a ` +
      `fourth invocable id and set SUFFICIENCY_RATER. If none exists, re-run with ` +
      `SUFFICIENCY_ALLOW_SHARED=1 — arms X and L stay clean, but arm S carries a ` +
      `writer-contamination caveat that MUST appear in the findings doc.`,
    );
  }
  if (shared) console.warn(`⚠ CONTAMINATED RUN: rater shares an id with another role. Arm S's false-refusal number carries a writer-contamination caveat.\n`);

  const writer = cachedModel(modelFromId(WRITER, { maxTokens: WRITER_MAX_TOKENS }));
  const judge = cachedModel(modelFromId(JUDGE, { maxTokens: JUDGE_MAX_TOKENS }));
  const rater = cachedModel(modelFromId(RATER, { maxTokens: RATER_MAX_TOKENS }));

  let callFailures = 0;
  const rate = async (question: string, styleOfCause: string, body: string): Promise<Sufficiency | null> => {
    try {
      const { value, repaired } = await callParsed(
        rater, buildSufficiencyPrompt(question, styleOfCause, body), parseSufficiency, CACHE_OPS);
      if (repaired) repairs++;
      return value;
    } catch (e) {
      callFailures++;
      console.warn("  [rater failed]", e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  // --- construction: the SAME modules the answer-quality eval uses ------------------------
  // Not a copy of its logic — these are the shared, unit-tested modules it imports. Same seed
  // and the same warm cache reproduce the same question set; step 2 below verifies that against
  // the persisted rows rather than assuming it.
  // Exactly how cases-caseqa-eval.ts loads them: listCases returns PROFILES, which carry no
  // chunks, so each one has to be fetched individually. Filtering `corpusTier`/`chunks` off the
  // profile list instead would silently yield an empty population.
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  const cases = [];
  for (const p of profiles) {
    const c = await dynamoCaseRepo.getCase(p.id);
    if (c?.chunks?.length) cases.push(c);
  }
  if (!cases.length) throw new Error("no core case has chunks — this run would measure nothing");
  const byId = new Map(cases.map((c) => [c.id, c]));

  const { targets: shaped } = pickTargets(cases, SEED, N_ANSWERABLE);
  const { targets } = await screenSubstantiveTargets(shaped, async (t) =>
    parseSubstantive(await judge.call(buildSubstantivePrompt(t.text, byId.get(t.caseId)!.styleOfCause))));
  if (!targets.length) throw new Error("no eligible target survived — run the answer-quality eval first to warm the cache");

  const built: { caseId: string; qid: string; question: string; targetParagraph: string }[] = [];
  for (const t of targets) {
    const c = byId.get(t.caseId)!;
    const question = (await writer.call(buildQuestionPrompt(c, t))).trim();
    if (!question || !isWellFormedQuestion(question) || isLexicalGimme(question, t.text)) continue;
    built.push({ caseId: t.caseId, qid: `ans-${built.length + 1}`, question, targetParagraph: t.paragraph });
  }
  const { pairs } = await buildUnanswerablePairs(built, N_UNANSWERABLE, SEED, async (source, candidate) => {
    const target = byId.get(candidate.caseId)!;
    return parseAddressed(await judge.call(buildAddressedPrompt(source.question, target.styleOfCause,
      assembleInput(target.chunks!, target.outcome.holding))));
  });
  console.log(`construction: ${built.length} answerable · ${pairs.length} unanswerable (seed ${SEED})`);
  console.log(`models: writer ${WRITER} · judge ${JUDGE} · answerer ${ANSWERER} · RATER ${RATER}\n`);

  // --- verify we are measuring the same questions the 93.8% baseline was measured on ------
  // The threshold in tally.ts is stated against a specific run's baseline. If construction has
  // drifted, that comparison is meaningless. The persisted eval rows carry qid -> question, so
  // any qid in both must have the identical text. Missing rows are fine (a refused question
  // produced no claim rows); a MISMATCH is not.
  const rowsDir = path.join(process.cwd(), "scripts", ".cache", "eval-rows");
  let checked = 0;
  try {
    const files = (await fs.readdir(rowsDir)).filter((f) => f.endsWith(".jsonl") && !f.endsWith(".nli.jsonl")).sort();
    const latest = files[files.length - 1];
    if (latest) {
      const prior = new Map<string, string>();
      for (const line of (await fs.readFile(path.join(rowsDir, latest), "utf8")).trim().split("\n")) {
        const r = JSON.parse(line);
        if (r.kind === "claim" && r.question) prior.set(r.qid, r.question);
      }
      for (const q of [...built, ...pairs]) {
        const was = prior.get(q.qid);
        if (was === undefined) continue;
        if (was !== q.question) {
          throw new Error(`construction drift: ${q.qid} was "${was.slice(0, 60)}..." in ${latest}, now "${q.question.slice(0, 60)}..." — the ${(BASELINE_FALSE_ANSWER * 100).toFixed(1)}% baseline does not apply to this question set`);
        }
        checked++;
      }
      console.log(`construction cross-check: ${checked} qid(s) matched against ${latest}\n`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("construction drift")) throw e;
    console.warn(`construction cross-check skipped (${e instanceof Error ? e.message : String(e)})\n`);
  }

  // --- arms -------------------------------------------------------------------------------
  const rows: string[] = [];
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const score = async (
    label: "S" | "X" | "L",
    items: { caseId: string; qid: string; question: string; body: string; targetParagraph?: string }[],
  ): Promise<{ counts: ArmCounts; unparsed: number }> => {
    const counts: ArmCounts = { sufficient: 0, insufficient: 0 };
    let unparsed = 0;
    process.stdout.write(`arm ${label} (${items.length}): `);
    for (const [i, it] of items.entries()) {
      const c = byId.get(it.caseId)!;
      const v = await rate(it.question, c.styleOfCause, it.body);
      if (v === null) { unparsed++; continue; }
      if (v.sufficient) counts.sufficient++; else counts.insufficient++;
      rows.push(JSON.stringify({ kind: "rating", runId, arm: label, caseId: it.caseId, qid: it.qid,
        question: it.question, targetParagraph: it.targetParagraph ?? null,
        sufficient: v.sufficient, reason: v.reason }));
      if ((i + 1) % 10 === 0) process.stdout.write(`${i + 1} `);
    }
    console.log(`done (${counts.sufficient} sufficient, ${counts.insufficient} insufficient, ${unparsed} unparsed)`);
    return { counts, unparsed };
  };

  // Arm S. The budget guard is FIX D from the answer-quality eval: assembleInput drops chunks
  // over 240,000 chars, so on a very long judgment the by-construction target can be absent from
  // the body the rater sees — which would score as a rater error when the cause is upstream.
  const armSItems: { caseId: string; qid: string; question: string; body: string; targetParagraph: string }[] = [];
  let targetDroppedByBudget = 0;
  for (const b of built) {
    const c = byId.get(b.caseId)!;
    const body = assembleInput(c.chunks!, c.outcome.holding);
    if (!body.includes(`[para ${b.targetParagraph}]`)) { targetDroppedByBudget++; continue; }
    armSItems.push({ ...b, body });
  }
  if (targetDroppedByBudget) console.log(`(${targetDroppedByBudget} answerable question(s) skipped: target dropped by the assembly budget)`);
  const S = await score("S", armSItems);
  assertNoCallFailures(callFailures, "arm S");

  // Arm X.
  const armXItems = pairs.map((p) => {
    const c = byId.get(p.caseId)!;
    return { ...p, body: assembleInput(c.chunks!, c.outcome.holding) };
  });
  const X = await score("X", armXItems);
  assertNoCallFailures(callFailures, "arm X");

  // Arm L: the same arm-S questions with the target paragraph deleted.
  const armLItems = armSItems.map((it) => {
    const c = byId.get(it.caseId)!;
    const { kept } = stripTarget(c.chunks!, it.targetParagraph);
    const body = assembleInput(kept, c.outcome.holding);
    assertTargetAbsent(body, it.targetParagraph);
    return { ...it, body };
  });
  const L = await score("L", armLItems);
  assertNoCallFailures(callFailures, "arm L");

  // Arm L's contamination, measured rather than assumed: a judgment can state the same
  // proposition twice, so removing the target does not strictly guarantee unanswerability. The
  // JUDGE is asked — independent of the RATER, which is the separation that matters here.
  process.stdout.write(`arm L residual answerability (${armLItems.length}): `);
  let stillAddressed = 0, residualUnparsed = 0;
  for (const it of armLItems) {
    const c = byId.get(it.caseId)!;
    try {
      const a = parseAddressed(await judge.call(buildAddressedPrompt(it.question, c.styleOfCause, it.body)));
      if (a === null) residualUnparsed++; else if (a) stillAddressed++;
    } catch (e) { callFailures++; console.warn("  [judge failed]", e instanceof Error ? e.message : String(e)); }
  }
  console.log("done");
  assertNoCallFailures(callFailures, "arm L residual check");

  // --- report -----------------------------------------------------------------------------
  const fr = falseRefusalRate(S.counts);
  const pfa = projectedFalseAnswerRate(X.counts);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`\n--- arm S (answerable, SUFFICIENT by construction) ---`);
  console.log(`  false refusal: ${S.counts.insufficient}/${S.counts.sufficient + S.counts.insufficient} = ${pct(fr)}   (max ${pct(FALSE_REFUSAL_MAX)})`);
  console.log(`--- arm X (cross-case, INSUFFICIENT per an LLM screen) ---`);
  console.log(`  projected false answer: ${X.counts.sufficient}/${X.counts.sufficient + X.counts.insufficient} = ${pct(pfa)}   (max ${pct(PROJECTED_FALSE_ANSWER_MAX)}, baseline ${pct(BASELINE_FALSE_ANSWER)})`);
  console.log(`--- arm L (target removed, INSUFFICIENT by construction) — REPORTED, NO THRESHOLD ---`);
  console.log(`  rater says sufficient: ${L.counts.sufficient}/${L.counts.sufficient + L.counts.insufficient}`);
  console.log(`  residual answerability: ${stillAddressed}/${armLItems.length} still judged addressed after removal (unparsed ${residualUnparsed})`);
  console.log(`  ^ contamination bound. Arm L's number is NOT corrected by it — both are published.`);
  console.log(`\n  unparsed ratings: S ${S.unparsed} · X ${X.unparsed} · L ${L.unparsed}`);
  console.log(`  cache entries evicted and re-fetched: ${repairs}`);
  console.log(`\n--- pre-registered decision ---`);
  console.log(`  VERDICT: ${decide(fr, pfa).toUpperCase()}`);

  const outDir = path.join(process.cwd(), "scripts", ".cache", "sufficiency-rows");
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `${runId}.jsonl`);
  await fs.writeFile(outFile, [
    // `contaminated` travels with the rows, not just the console: a findings doc written weeks
    // later from the JSONL must not be able to lose the caveat.
    JSON.stringify({ kind: "run", runId, writer: WRITER, judge: JUDGE, answerer: ANSWERER, rater: RATER,
      contaminated: shared, seed: SEED, armS: S.counts, armX: X.counts, armL: L.counts, stillAddressed,
      residualUnparsed, falseRefusal: fr, projectedFalseAnswer: pfa, decision: decide(fr, pfa) }),
    ...rows,
  ].join("\n") + "\n", "utf8");
  console.log(`\nrows -> ${outFile}`);

  // Reconciliation computed WITHOUT reusing the counters under test.
  const persisted = rows.length;
  const tallied = S.counts.sufficient + S.counts.insufficient + X.counts.sufficient
    + X.counts.insufficient + L.counts.sufficient + L.counts.insufficient;
  if (persisted !== tallied) throw new Error(`persisted ${persisted} rows but tallied ${tallied} ratings`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the npm scripts**

In `package.json`, after `"cases:probe-models:cloud"`, add:

```json
    "cases:sufficiency-eval": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-sufficiency-eval.ts",
    "cases:sufficiency-eval:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-sufficiency-eval.ts",
```

- [ ] **Step 3: Typecheck and run the whole suite**

```bash
npx tsc --noEmit
npx tsx scripts/test-cases-sufficiency.ts
npx tsx scripts/test-cases-caseqa-eval.ts
npx tsx scripts/test-cases-nli-probe.ts
npx tsx scripts/test-cases-caseqa.ts
```

Expected: `tsc` silent; all four suites print their `✅` line.

- [ ] **Step 4: Verify both role guards fire**

These are the controls that keep arm X from being self-agreement, and they are the one part of
this script that cannot be unit-tested without a live corpus. Prove each fires, **before** any
Bedrock call or DynamoDB read — if either reaches the network, it is in the wrong place and must
move above the model construction.

Rater is the judge — must be refused unconditionally:

```bash
SUFFICIENCY_RATER=us.anthropic.claude-opus-4-5-20251101-v1:0 npx tsx scripts/cases-sufficiency-eval.ts
```

Expected: non-zero exit, `rater must not be the judge`.

The same id under the override — must STILL be refused, because no flag covers the judge:

```bash
SUFFICIENCY_ALLOW_SHARED=1 SUFFICIENCY_RATER=us.anthropic.claude-opus-4-5-20251101-v1:0 npx tsx scripts/cases-sufficiency-eval.ts
```

Expected: non-zero exit, same message. If this one succeeds, the override is checked before the
judge test and the ordering is wrong.

Rater shares the writer's id (the documented spec §5 fallback) — refused by default:

```bash
SUFFICIENCY_RATER=us.anthropic.claude-sonnet-4-6 npx tsx scripts/cases-sufficiency-eval.ts
```

Expected: non-zero exit, `four roles must be four DIFFERENT models`.

- [ ] **Step 5: Commit**

```bash
git add scripts/cases-sufficiency-eval.ts package.json
git commit -m "feat(sufficiency): three-arm runner with role separation and construction cross-check"
```

- [ ] **Step 6: STOP — hand back to the controller**

Report `DONE`. Do **not** run the credentialed measurement; that is an operator step requiring
`AWS_PROFILE=bedrock`, and the rater model id depends on Task 1's probe result.

---

### Task 6: Whole-branch review

**Files:** none created; review only.

- [ ] **Step 1: Confirm the product is untouched**

```bash
git diff --name-only origin/main..HEAD -- src/ | grep -v "^src/lib/cases/sufficiency/" || echo "none — product untouched"
```

Expected: `none — product untouched`. Phase 1 is measurement only. If any file outside
`src/lib/cases/sufficiency/` appears, that is a spec violation — report it rather than fixing it.

Use `--name-only`, not `--stat`: `--stat` emits a trailing `N files changed, ...` summary line
that survives the `grep -v` and reads exactly like a violation. A check that cries wolf on a
clean branch gets ignored on a dirty one.

- [ ] **Step 2: Confirm the eval runner is untouched**

```bash
git diff --stat origin/main..HEAD -- scripts/cases-caseqa-eval.ts
```

Expected: empty output.

- [ ] **Step 3: Full verification**

```bash
npx tsc --noEmit && npm run build
```

Expected: both succeed.

- [ ] **Step 4: Report**

Summarise for the controller: which mutations were confirmed to apply and fail, anything that
passed a mutation (i.e. an assertion that is not load-bearing), and the Task 1 probe status.

---

## After the plan

1. Operator runs `AWS_PROFILE=bedrock npm run cases:probe-models:cloud`, picks a fourth id.
2. Operator runs `AWS_PROFILE=bedrock SUFFICIENCY_RATER=<id> npm run cases:sufficiency-eval:cloud`.
3. Findings doc → `docs/research/2026-08-XX-sufficient-context-results.md`, recommending nothing.
4. Phase 2 wiring **only if** the verdict is `ship`.
