# Reasoning-First Outcome Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the outcome classifier state its reasoning in two closed-valued fields, so a model that contradicts itself is caught, and build a quote-verified gold set to measure it.

**Architecture:** The model emits `movingPartyIsIndigenous` (boolean) and `granted` (enum) before naming a `winType`. Those two reconstruct the polarity, so the merge can reject a label that contradicts its own derivation. No free-text field is added. A separate gold set, in which every label carries a verbatim quote checked against the judgment text, measures polarity accuracy and self-consistency per model.

**Tech Stack:** TypeScript, `tsx` scripts, Bedrock Converse via `llm.ts`, DynamoDB via `@aws-sdk/lib-dynamodb`, `node:assert/strict` tests.

**Spec:** `docs/superpowers/specs/2026-07-31-reasoning-first-outcome-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/cases/ingest/llm.ts` (modify) | Raise the dual-LLM token budget; make truncation throw instead of returning `""`. Extract the response-to-text step as a pure, testable function. |
| `src/lib/cases/types.ts` (modify) | `OutcomeDerivation`; `CaseOutcome.derivation?`. |
| `src/lib/dynamo/cases-table.ts` (modify) | Carry `outcome.derivation` through `itemToCase`. **The `Required<LegalCase>` canary does not recurse into nested objects, so dropping it would not be a compile error.** The guard is the existing whole-object `assert.deepEqual` round-trip in `test-cases-table.ts`, which the fixture must be extended to exercise. |
| `src/lib/cases/ingest/outcome-rubric.ts` (modify) | Reasoning-first prompt; parse the derivation; `impliedDirection` / `contradictsDerivation`; version bump. |
| `src/lib/cases/ingest/outcome-labeler.ts` (modify) | Reject a self-contradicting model response; always flag `doctrine_win` for review. |
| `src/lib/cases/eval/outcome-gold.ts` (create) | Gold-label type and the quote verifier. New `eval/` directory: this is measurement, not ingest. |
| `scripts/cases-classify-outcome.ts` (modify) | Write the derivation; report contradictions. |
| `scripts/cases-outcome-review.ts` (modify) | Derivation-based review line; drop `dispositionSentence`. |
| `scripts/cases-outcome-eval.ts` (create) | Score candidate models against the gold set. |
| `scripts/test-cases-outcome.ts` (modify) | Tests for all new pure functions. |
| `scripts/test-cases-table.ts` (modify) | Nested round-trip test for `derivation`. |

---

### Task 1: Make truncation loud, and raise the budget

**Files:**
- Modify: `src/lib/cases/ingest/llm.ts`
- Test: `scripts/test-cases-outcome.ts`

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-cases-outcome.ts`, immediately **before** the `// --- mergeOutcome ---` block:

```ts
import { textFromConverse, DUAL_LLM_MAX_TOKENS } from "../src/lib/cases/ingest/llm";

// --- textFromConverse ---
// Normal: join text parts, skip structured reasoning blocks.
assert.equal(
  textFromConverse("m", [{ reasoningContent: { reasoningText: { text: "thinking..." } } }, { text: '{"a":1}' }], "end_turn", 2048),
  '{"a":1}', "reasoning blocks are skipped, text is kept");
assert.equal(textFromConverse("m", [{ text: "a" }, { text: "b" }], "end_turn", 2048), "ab");
// Empty but a clean stop is a legitimate empty answer, not an error.
assert.equal(textFromConverse("m", [], "end_turn", 2048), "");
// THE POINT: a model that spent its whole budget reasoning must NOT look like abstention.
assert.throws(
  () => textFromConverse("kimi", [{ reasoningContent: { reasoningText: { text: "..." } } }], "max_tokens", 256),
  /truncated/,
  "empty text + max_tokens must throw, or truncation is indistinguishable from abstention");
// Truncated but text present: usable, no throw.
assert.equal(textFromConverse("m", [{ text: '{"a":1}' }], "max_tokens", 256), '{"a":1}');
assert.ok(DUAL_LLM_MAX_TOKENS >= 2048, "the reasoning-first prompt needs room");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-outcome.ts`
Expected: FAIL — `textFromConverse` is not exported from `llm.ts`.

- [ ] **Step 3: Implement in `src/lib/cases/ingest/llm.ts`**

Add near the top, after the `CACHE` constant:

```ts
// The reasoning-first outcome prompt makes every model emit a derivation before its
// label, and thinking models spend hundreds of tokens before any text at all. 256
// (the old default) starves them.
export const DUAL_LLM_MAX_TOKENS = 2048;
```

Add this exported function above `bedrockConverse`:

```ts
// Converse response -> text. Structured `reasoningContent` blocks are skipped; only
// text parts are joined.
//
// A model that spends its entire budget on reasoning returns NO text part and
// stopReason "max_tokens". Returning "" there would be parsed downstream as
// "unclassified" — making a truncated model indistinguishable from one that
// scrupulously abstained. This pipeline's whole method rests on abstention meaning
// something, so truncation must be an error, not a quiet empty string.
export function textFromConverse(
  modelId: string, parts: unknown[], stopReason: string | undefined, maxTokens: number,
): string {
  const text = parts
    .map((p) => (p && typeof p === "object" && "text" in p && typeof (p as { text?: unknown }).text === "string"
      ? (p as { text: string }).text : ""))
    .join("");
  if (!text.trim() && stopReason === "max_tokens") {
    throw new Error(`${modelId}: response truncated at maxTokens=${maxTokens} with no text part — raise maxTokens`);
  }
  return text;
}
```

Replace the body of the `send` closure inside `bedrockConverse` with:

```ts
        send: async (modelId: string, prompt: string, opts?: CallOpts) => {
          const maxTokens = opts?.maxTokens ?? 256;
          const res = await client.send(new m.ConverseCommand({
            modelId,
            messages: [{ role: "user", content: [{ text: prompt }] }],
            inferenceConfig: { temperature: 0, maxTokens },
          }));
          return textFromConverse(modelId, res.output?.message?.content ?? [], res.stopReason, maxTokens);
        },
```

Change `configuredModels` so the pair gets the larger budget:

```ts
export function configuredModels(): LlmModel[] {
  const ids = (process.env.LABEL_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length < 2) throw new Error("Set LABEL_MODELS to two comma-separated model ids (different families).");
  // CallOpts are not part of the cache key, so raising this does NOT invalidate any
  // cached response.
  return ids.map((id) => modelFromId(id, { maxTokens: DUAL_LLM_MAX_TOKENS }));
}
```

- [ ] **Step 4: Run tests**

Run: `npx tsx scripts/test-cases-outcome.ts && npx tsx scripts/test-cases-label-llm.ts`
Expected: both PASS. Theme labelling is unaffected — a larger budget cannot change a completed response, and the cache key excludes options.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/ingest/llm.ts scripts/test-cases-outcome.ts
git commit -m "fix(cases): make truncated LLM responses throw instead of reading as abstention"
```

---

### Task 2: `OutcomeDerivation`, the contradiction check, and the reasoning-first prompt

**Files:**
- Modify: `src/lib/cases/types.ts`
- Modify: `src/lib/cases/ingest/outcome-rubric.ts`
- Test: `scripts/test-cases-outcome.ts`

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-cases-outcome.ts`, before the `// --- mergeOutcome ---` block:

```ts
import { impliedDirection, contradictsDerivation, OUTCOME_RUBRIC_VERSION as V2 } from "../src/lib/cases/ingest/outcome-rubric";
import type { OutcomeDerivation } from "../src/lib/cases/types";

const d = (mine: boolean, granted: OutcomeDerivation["granted"]): OutcomeDerivation =>
  ({ movingPartyIsIndigenous: mine, granted });

// --- impliedDirection: all four corners ---
assert.equal(impliedDirection(d(true, "granted")), "prevailed");
assert.equal(impliedDirection(d(true, "refused")), "did_not_prevail");
assert.equal(impliedDirection(d(false, "granted")), "did_not_prevail");
assert.equal(impliedDirection(d(false, "refused")), "prevailed");
assert.equal(impliedDirection(d(true, "partly")), "partly");

// --- contradictsDerivation: exactly two contradictions exist ---
// The nation moved and was refused, yet the label claims it won. THE inversion.
assert.equal(contradictsDerivation("party_win", d(true, "refused")), true);
// The Crown moved and was refused, yet the label claims the nation lost.
assert.equal(contradictsDerivation("loss", d(false, "refused")), true);
// Consistent pairings.
assert.equal(contradictsDerivation("party_win", d(false, "refused")), false);
assert.equal(contradictsDerivation("loss", d(true, "refused")), false);
// doctrine_win is BY DEFINITION relief-refused-but-principle-advanced (Haida), so it
// can never contradict "did not prevail". This is a deliberate escape hatch.
assert.equal(contradictsDerivation("doctrine_win", d(true, "refused")), false);
// Abstention and mixed never contradict anything.
assert.equal(contradictsDerivation("unclassified", d(true, "refused")), false);
assert.equal(contradictsDerivation("mixed", d(true, "refused")), false);
assert.equal(contradictsDerivation("party_win", d(true, "partly")), false);

// --- prompt + version ---
assert.equal(V2, "2026-07-31.1", "rubric version must be bumped — the prompt changed");
{
  const pr = outcomePrompt("Q v. R", [p(1, "The appeal is dismissed.")]);
  assert.match(pr, /movingPartyIsIndigenous/, "prompt must ask for the moving party");
  assert.match(pr, /granted/, "prompt must ask whether relief was granted");
  assert.match(pr, /dismissed/i, "prompt must warn about the dismissed-application trap");
  assert.ok(pr.indexOf("movingPartyIsIndigenous") < pr.indexOf("winType"),
    "the derivation must be requested BEFORE the label — that ordering is the mechanism");
}

// --- parseOutcome now carries the derivation ---
assert.deepEqual(
  parseOutcome('{"movingPartyIsIndigenous":false,"granted":"refused","winType":"party_win","outcomeType":"remand"}'),
  { winType: "party_win", outcomeType: "remand", derivation: { movingPartyIsIndigenous: false, granted: "refused" } });
// A missing or malformed derivation degrades safely, it does not throw.
assert.deepEqual(parseOutcome('{"winType":"loss","outcomeType":"precedent"}').derivation, null);
assert.deepEqual(parseOutcome('{"movingPartyIsIndigenous":"yes","granted":"nope","winType":"loss","outcomeType":"precedent"}').derivation, null);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-outcome.ts`
Expected: FAIL — `impliedDirection` is not exported.

- [ ] **Step 3: Add types to `src/lib/cases/types.ts`**

Insert immediately **before** `export interface CaseOutcome`:

```ts
// The classifier's stated reasoning, reduced to closed values so it can be checked
// against the label it produced. Deliberately NOT the moving party's name — a name is
// free text; this boolean is the only part the outcome depends on.
export interface OutcomeDerivation {
  movingPartyIsIndigenous: boolean;
  granted: "granted" | "refused" | "partly";
}
```

Add to `CaseOutcome`, after `holding`:

```ts
  derivation?: OutcomeDerivation;
```

- [ ] **Step 4: Rewrite the prompt and parser in `src/lib/cases/ingest/outcome-rubric.ts`**

Bump the version:

```ts
export const OUTCOME_RUBRIC_VERSION = "2026-07-31.1";
```

Change the import line to include the new type:

```ts
import type { CaseChunk, OutcomeDerivation, OutcomeType, WinType } from "../types";
```

Replace `outcomePrompt`, `RawOutcome`, and `parseOutcome` entirely with:

```ts
export type Direction = "prevailed" | "did_not_prevail" | "partly";

// The mover prevailed iff what they sought was granted. Relative to the INDIGENOUS
// party, that flips whenever the mover is not the Indigenous party.
export function impliedDirection(d: OutcomeDerivation): Direction {
  if (d.granted === "partly") return "partly";
  return (d.granted === "granted") === d.movingPartyIsIndigenous ? "prevailed" : "did_not_prevail";
}

// True when a label cannot be reconciled with the reasoning that produced it. Exactly
// two such pairings exist; everything else is defensible.
//
// doctrine_win is exempt on purpose: it MEANS "the specific relief was refused but the
// principle advanced" (Haida is precisely this), so it can never contradict a
// did-not-prevail derivation. That makes it the one label this gate cannot check, which
// is why the labeler always flags it for review.
export function contradictsDerivation(winType: WinType, d: OutcomeDerivation): boolean {
  if (winType === "unclassified" || winType === "mixed" || winType === "doctrine_win") return false;
  const dir = impliedDirection(d);
  if (dir === "partly") return false;
  return dir === "prevailed" ? winType === "loss" : winType === "party_win";
}

export interface RawOutcome {
  winType: WinType;
  outcomeType: OutcomeType;
  derivation: OutcomeDerivation | null;
}

const GRANTED = ["granted", "refused", "partly"] as const;

export function outcomePrompt(styleOfCause: string, chunks: CaseChunk[]): string {
  const wins = ALL_WINTYPES.map((k) => `- ${k}: ${WINTYPE_RUBRIC[k]}`).join("\n");
  const types = ALL_OUTCOMETYPES.map((k) => `- ${k}: ${OUTCOMETYPE_RUBRIC[k]}`).join("\n");
  return `You classify the OUTCOME of Canadian legal cases involving Indigenous parties.\n\n` +
    `Work in this order:\n` +
    `1. Identify the MOVING PARTY — who brought this proceeding (appellant / applicant / plaintiff).\n` +
    `   Do NOT infer this from the style of cause. A case named "X v. Y" is often brought by Y.\n` +
    `2. movingPartyIsIndigenous: is that moving party an Indigenous nation, band, or council?\n` +
    `3. granted: was what the moving party sought "granted", "refused", or "partly" given?\n` +
    `4. winType: relative to the INDIGENOUS party — NOT the moving party.\n\n` +
    `CRITICAL: if the Indigenous party was the moving party and its application was DISMISSED or ` +
    `REFUSED, the Indigenous party did NOT win. Never read "application dismissed" as a favourable ` +
    `result without first establishing who brought it.\n\n` +
    `winType is ALWAYS relative to the Indigenous party or interest; where no Indigenous party is ` +
    `involved, answer "unclassified" — never "loss". A purely procedural advance is NOT a victory.\n\n` +
    `Return ONLY this JSON object and no prose:\n` +
    `{"movingPartyIsIndigenous": true|false, "granted": "granted"|"refused"|"partly", ` +
    `"winType": "...", "outcomeType": "..."}\n\n` +
    `rubric ${OUTCOME_RUBRIC_VERSION}\n\nwinType:\n${wins}\n\noutcomeType:\n${types}\n\n` +
    dispositionWindow(styleOfCause, chunks);
}

// Tolerant of prose around the JSON. An absent or malformed derivation yields null
// rather than throwing — the caller decides what an underivable answer is worth.
export function parseOutcome(raw: string): RawOutcome {
  try {
    const o = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const mine = o?.movingPartyIsIndigenous, g = o?.granted;
    const derivation: OutcomeDerivation | null =
      typeof mine === "boolean" && GRANTED.includes(g) ? { movingPartyIsIndigenous: mine, granted: g } : null;
    return {
      winType: ALL_WINTYPES.includes(o?.winType) ? o.winType : "unclassified",
      outcomeType: ALL_OUTCOMETYPES.includes(o?.outcomeType) ? o.outcomeType : "unclassified",
      derivation,
    };
  } catch {
    return { winType: "unclassified", outcomeType: "unclassified", derivation: null };
  }
}
```

Delete `dispositionSentence` and the `DISPOSITION_RE` constant. It is replaced by the derivation and its extraction was unreliable (it returned `"I granted Mr."` for one real case, the splitter breaking on the abbreviation). Remove its assertions from the test file in the same commit.

- [ ] **Step 5: Run tests**

Run: `npx tsx scripts/test-cases-outcome.ts && npm run typecheck`
Expected: tests PASS. Typecheck will FAIL until Task 3 — `outcome-labeler.ts` and the two scripts still reference the old `RawOutcome` shape and `dispositionSentence`. That is expected here and fixed in Task 3.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/types.ts src/lib/cases/ingest/outcome-rubric.ts scripts/test-cases-outcome.ts
git commit -m "feat(cases): reasoning-first outcome prompt with a checkable derivation"
```

---

### Task 3: Contradiction gate, round-trip, and callers

**Files:**
- Modify: `src/lib/cases/ingest/outcome-labeler.ts`
- Modify: `src/lib/dynamo/cases-table.ts`
- Modify: `scripts/test-cases-table.ts`
- Test: `scripts/test-cases-outcome.ts`

- [ ] **Step 1: Write the failing tests**

In `scripts/test-cases-outcome.ts`, **replace** the four existing `mergeOutcome` blocks with these (the signature now takes `RawOutcome` values carrying a derivation):

```ts
const raw = (w: any, t: any, der: OutcomeDerivation | null) => ({ winType: w, outcomeType: t, derivation: der });

// Agreement, consistent derivations.
{
  const r = mergeOutcome(raw("party_win", "remand", d(false, "refused")), raw("party_win", "remand", d(false, "refused")), ["m1", "m2"]);
  assert.equal(r.winType, "party_win");
  assert.equal(r.outcomeMeta.agreement, "full");
  assert.equal(r.outcomeMeta.confidence, "high");
  assert.equal(r.outcomeMeta.needsReview, false);
  assert.equal(r.outcomeMeta.rubricVersion, OUTCOME_RUBRIC_VERSION);
  assert.deepEqual(r.derivation, d(false, "refused"), "an agreed derivation is stored");
}
// Disagreement on winType still abstains.
{
  const r = mergeOutcome(raw("party_win", "remand", d(false, "refused")), raw("loss", "remand", d(true, "refused")), ["m1", "m2"]);
  assert.equal(r.winType, "unclassified");
  assert.equal(r.outcomeMeta.agreement, "partial");
  assert.equal(r.outcomeMeta.needsReview, true);
  assert.equal(r.derivation, undefined, "derivations that disagree are not stored");
}
// Both unclassified: agreement WITHOUT confidence.
{
  const r = mergeOutcome(raw("unclassified", "procedural", null), raw("unclassified", "procedural", null), ["m1", "m2"]);
  assert.equal(r.outcomeMeta.agreement, "full");
  assert.equal(r.outcomeMeta.confidence, "low");
  assert.equal(r.outcomeMeta.needsReview, false);
}
// THE NEW GATE: a model contradicting its own derivation is discarded, so the pair
// cannot agree and the case abstains — even though both said "party_win".
{
  const bad = raw("party_win", "precedent", d(true, "refused"));   // moved and refused, yet claims a win
  const r = mergeOutcome(bad, bad, ["m1", "m2"]);
  assert.equal(r.winType, "unclassified", "a self-contradicting response must not be trusted");
  assert.equal(r.outcomeMeta.needsReview, true);
  assert.equal(r.outcomeMeta.contradictions, 2, "both responses contradicted themselves");
}
// One contradicts, one does not -> no agreement.
{
  const r = mergeOutcome(raw("party_win", "precedent", d(true, "refused")), raw("party_win", "precedent", d(false, "refused")), ["m1", "m2"]);
  assert.equal(r.winType, "unclassified");
  assert.equal(r.outcomeMeta.contradictions, 1);
}
// doctrine_win is always flagged: it is the one label the gate cannot check.
{
  const dw = raw("doctrine_win", "precedent", d(true, "refused"));
  const r = mergeOutcome(dw, dw, ["m1", "m2"]);
  assert.equal(r.winType, "doctrine_win", "still recorded — it is a legitimate label");
  assert.equal(r.outcomeMeta.needsReview, true, "but never unreviewed, since it is uncheckable");
}
```

In `scripts/test-cases-table.ts`, add `derivation` to the `kitchenSink` fixture's existing `outcome`
literal (do **not** add a new assertion block):

```ts
  outcome: { outcomeType: "precedent", winType: "party_win", whoWon: "Test Nation",
    holding: "A holding that exercises every optional field.",
    derivation: { movingPartyIsIndigenous: false, granted: "refused" } },
```

That is sufficient, because the file already ends with a whole-object round-trip:

```ts
const ksItems = caseToItems(kitchenSink);
const ksBack = reassembleCase(ksItems[0], ksItems.slice(1));
assert.deepEqual(ksBack, kitchenSink, "kitchen-sink round-trip preserves every optional field");
```

`assert.deepEqual` compares nested objects, so a `derivation` dropped by `itemToCase` fails it. Note
where the protection actually comes from: **`Required<LegalCase>` would not have caught this** — it
does not recurse into `CaseOutcome` — so the guard is the deepEqual, not the type. The fixture is
annotated `Required<LegalCase>`, so `"refused"` narrows from the target type and needs no `as const`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx scripts/test-cases-outcome.ts`
Expected: FAIL — `outcomeMeta.contradictions` does not exist.

- [ ] **Step 3: Add `contradictions` to `OutcomeMeta` in `src/lib/cases/types.ts`**

Add to the `OutcomeMeta` interface:

```ts
  contradictions?: number;   // responses whose winType contradicted their own derivation
```

- [ ] **Step 4: Rewrite `src/lib/cases/ingest/outcome-labeler.ts`**

```ts
// Dual-LLM outcome classification. Merge rule: EXACT AGREEMENT OR ABSTAIN, per field.
//
// Before any cross-model comparison, each response is checked against ITSELF: a model
// that says the Indigenous party moved, that its application was refused, and that the
// Indigenous party won has contradicted its own reasoning. Such a response is discarded
// rather than compared — it is the failure mode that produced wrong labels in the first
// pass, and it is invisible without the derivation.
import type { CaseChunk, OutcomeDerivation, OutcomeMeta, OutcomeType, WinType } from "../types";
import { cachedCall, configuredModels, type LlmModel } from "./llm";
import {
  OUTCOME_RUBRIC_VERSION, contradictsDerivation, outcomePrompt, parseOutcome, type RawOutcome,
} from "./outcome-rubric";

export interface ClassifiedOutcome {
  winType: WinType;
  outcomeType: OutcomeType;
  derivation?: OutcomeDerivation;
  outcomeMeta: OutcomeMeta;
}

// A response is usable only if it did not contradict itself. A missing derivation is
// NOT a contradiction — the model simply did not show its work.
const selfConsistent = (r: RawOutcome): boolean =>
  r.derivation === null || !contradictsDerivation(r.winType, r.derivation);

export function mergeOutcome(a: RawOutcome, b: RawOutcome, models: [string, string]): ClassifiedOutcome {
  const okA = selfConsistent(a), okB = selfConsistent(b);
  const contradictions = (okA ? 0 : 1) + (okB ? 0 : 1);

  // Discarded responses cannot agree with anything.
  if (!okA || !okB) {
    return {
      winType: "unclassified", outcomeType: "unclassified",
      outcomeMeta: {
        method: "dual_llm", models, agreement: "none", confidence: "low",
        needsReview: true, rubricVersion: OUTCOME_RUBRIC_VERSION, contradictions,
      },
    };
  }

  const winAgrees = a.winType === b.winType;
  const typeAgrees = a.outcomeType === b.outcomeType;
  const winType: WinType = winAgrees ? a.winType : "unclassified";
  const outcomeType: OutcomeType = typeAgrees ? a.outcomeType : "unclassified";

  const matches = (winAgrees ? 1 : 0) + (typeAgrees ? 1 : 0);
  const agreement: OutcomeMeta["agreement"] = matches === 2 ? "full" : matches === 1 ? "partial" : "none";
  const confidence: OutcomeMeta["confidence"] =
    agreement === "full" && winType !== "unclassified" ? "high" : "low";

  // doctrine_win is the one label contradictsDerivation cannot check, so it is never
  // left unreviewed.
  const needsReview = agreement !== "full" || winType === "doctrine_win";

  // Store the derivation only when both models produced the same one — a contested
  // derivation is not evidence of anything.
  const sameDerivation = a.derivation && b.derivation
    && a.derivation.movingPartyIsIndigenous === b.derivation.movingPartyIsIndigenous
    && a.derivation.granted === b.derivation.granted;

  return {
    winType, outcomeType,
    ...(sameDerivation ? { derivation: a.derivation! } : {}),
    outcomeMeta: {
      method: "dual_llm", models, agreement, confidence,
      needsReview, rubricVersion: OUTCOME_RUBRIC_VERSION, contradictions,
    },
  };
}

async function classifyWithModel(m: LlmModel, prompt: string): Promise<RawOutcome> {
  return parseOutcome(await cachedCall(m, prompt));
}

export async function classifyOutcome(
  styleOfCause: string, chunks: CaseChunk[], models?: [LlmModel, LlmModel],
): Promise<ClassifiedOutcome> {
  const [m1, m2] = models ?? configuredModels();
  const prompt = outcomePrompt(styleOfCause, chunks);
  const [a, b] = await Promise.all([classifyWithModel(m1, prompt), classifyWithModel(m2, prompt)]);
  return mergeOutcome(a, b, [m1.id, m2.id]);
}
```

- [ ] **Step 5: Carry `derivation` through `src/lib/dynamo/cases-table.ts`**

In `itemToCase`, the `outcome` object is rebuilt field by field. Add the derivation as a conditional spread, matching the style of the file's other optional fields:

```ts
    outcome: {
      outcomeType: d.outcome.outcomeType,
      winType: d.outcome.winType,
      whoWon: d.outcome.whoWon,
      holding: d.outcome.holding,
      ...(d.outcome.derivation !== undefined ? { derivation: d.outcome.derivation } : {}),
    },
```

- [ ] **Step 6: Run all tests + typecheck**

Run: `npx tsx scripts/test-cases-outcome.ts && npx tsx scripts/test-cases-table.ts && npx tsx scripts/test-cases-label-llm.ts && npm run typecheck`
Expected: tests PASS. Typecheck still FAILS on the two scripts referencing `dispositionSentence` — fixed in Task 4.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cases/types.ts src/lib/cases/ingest/outcome-labeler.ts src/lib/dynamo/cases-table.ts scripts/test-cases-outcome.ts scripts/test-cases-table.ts
git commit -m "feat(cases): reject self-contradicting classifications; round-trip the derivation"
```

---

### Task 4: Runner and review script

**Files:**
- Modify: `scripts/cases-classify-outcome.ts`
- Modify: `scripts/cases-outcome-review.ts`

- [ ] **Step 1: Update the runner**

In `scripts/cases-classify-outcome.ts`, add a contradiction tally to the stats object:

```ts
  const stats = { classified: 0, curated: 0, already: 0, no_chunks: 0, missing: 0, failed: 0 };
  const agree = { full: 0, partial: 0, none: 0 };
  let contradictions = 0;
```

Write the derivation with the outcome — it lives inside `outcome`, so the existing single `#d.#o` assignment already carries it once it is on the object:

```ts
      ExpressionAttributeValues: {
        ":o": {
          ...c.outcome, winType: r.winType, outcomeType: r.outcomeType,
          ...(r.derivation ? { derivation: r.derivation } : {}),
        },
        ":om": r.outcomeMeta,
        ":g": gsi2WinType(r.winType),
      },
```

After `agree[...]++`, accumulate:

```ts
    contradictions += r.outcomeMeta.contradictions ?? 0;
```

Add a line to the summary block:

```ts
  console.log(`   self-contradicting responses discarded: ${contradictions}`);
```

- [ ] **Step 2: Rewrite `scripts/cases-outcome-review.ts`**

The review line is now derivation-based. `dispositionSentence` is gone.

```ts
// Read-only. One reviewable line per classified case: the label beside the reasoning
// that produced it, so a reviewer can check the polarity without opening the judgment.
// Replaces the old disposition-sentence extraction, which was unreliable — it returned
// "I granted Mr." for one real case, the sentence splitter breaking on the abbreviation.
import "./fetch-polyfill";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { impliedDirection } from "../src/lib/cases/ingest/outcome-rubric";

const ONLY = process.env.REVIEW_WINTYPE;

async function main() {
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  let shown = 0, noDerivation = 0, flagged = 0;

  for (const prof of profiles) {
    const meta = prof.outcomeMeta;
    if (meta?.method !== "dual_llm") continue;
    if (ONLY && prof.outcome.winType !== ONLY) continue;
    const der = prof.outcome.derivation;
    if (!der) noDerivation++;
    if (meta.needsReview) flagged++;
    console.log([
      prof.id.padEnd(20),
      prof.outcome.winType.padEnd(13),
      (meta.confidence ?? "?").padEnd(5),
      meta.needsReview ? "REVIEW" : "      ",
      der
        ? `moving=${der.movingPartyIsIndigenous ? "nation" : "other "} ${der.granted.padEnd(8)} => ${impliedDirection(der)}`
        : "(no agreed derivation)",
      prof.styleOfCause.slice(0, 46),
    ].join(" "));
    shown++;
  }
  console.log(`\n${shown} reviewed · ${flagged} flagged needsReview · ${noDerivation} without an agreed derivation`);
  console.log(`Read the flagged ones first: a label whose implied direction reads wrong is the bug this run exists to find.`);
}
main().catch((e) => { console.error("❌ cases-outcome-review failed:", e); process.exit(1); });
```

- [ ] **Step 2: Full gate**

Run: `npx tsx scripts/test-cases-outcome.ts && npx tsx scripts/test-cases-table.ts && npx tsx scripts/test-cases-label-llm.ts && npm run typecheck && npm run build`
Expected: all PASS, typecheck now clean.

**Do NOT run `npm run verify`** — it factory-resets the local corpus.

- [ ] **Step 3: Commit**

```bash
git add scripts/cases-classify-outcome.ts scripts/cases-outcome-review.ts
git commit -m "feat(cases): derivation-based review line; count discarded contradictions"
```

---

### Task 5: Gold set loader and the eval harness

**Files:**
- Create: `src/lib/cases/eval/outcome-gold.ts`
- Create: `scripts/cases-outcome-eval.ts`
- Create: `docs/research/gold/cases-outcome-gold.jsonl`
- Modify: `package.json`
- Test: `scripts/test-cases-outcome.ts`

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-cases-outcome.ts`, before the async IIFE:

```ts
import { verifyGoldLabel, type GoldLabel } from "../src/lib/cases/eval/outcome-gold";

const gold = (over: Partial<GoldLabel> = {}): GoldLabel => ({
  caseId: "c1", movingPartyIsIndigenous: false, granted: "refused", winType: "party_win",
  movingPartyQuote: "The Attorney General of Canada appeals the decision below.",
  citedPara: "para-2", labeller: "consensus-4", confidence: "high", ...over,
});
const goldChunks = [
  p(1, "This is an appeal from a judicial review."),
  p(2, "The Attorney General of Canada appeals the decision below."),
];

// A quote that really is in the cited paragraph passes.
assert.equal(verifyGoldLabel(gold(), goldChunks), null);
// Whitespace differences must not reject a good label.
assert.equal(verifyGoldLabel(gold({ movingPartyQuote: "The Attorney General of Canada   appeals\nthe decision below." }), goldChunks), null);
// A quote in a DIFFERENT paragraph than cited is accepted but reported.
assert.match(String(verifyGoldLabel(gold({ citedPara: "para-1" }), goldChunks)), /para-2/);
// THE POINT: a quote that appears nowhere is rejected. This is what makes an
// unaided inference impossible to record as a label.
assert.match(String(verifyGoldLabel(gold({ movingPartyQuote: "The First Nation brought this application." }), goldChunks)), /not found/);
// An empty quote is rejected — every label must carry evidence.
assert.match(String(verifyGoldLabel(gold({ movingPartyQuote: "  " }), goldChunks)), /empty/);
// A label inconsistent with its own derivation is rejected: gold must be coherent.
assert.match(String(verifyGoldLabel(gold({ movingPartyIsIndigenous: true, winType: "party_win" }), goldChunks)), /contradict/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-outcome.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/eval/outcome-gold'`

- [ ] **Step 3: Create `src/lib/cases/eval/outcome-gold.ts`**

```ts
// Gold labels for outcome classification.
//
// Every label MUST carry a verbatim quote naming the moving party, verified against the
// case's own chunks. This is not ceremony: the first hand-labelled set was wrong because
// the labeller read party roles off the style of cause instead of finding the moving
// party in the text ("fnnnd v yukon" puts the nation first, but Yukon was the applicant).
// An unaided inference produces no quote, so this rule makes that error unrecordable.
import type { CaseChunk, OutcomeDerivation, WinType } from "../types";
import { contradictsDerivation } from "../ingest/outcome-rubric";

export interface GoldLabel {
  caseId: string;
  movingPartyIsIndigenous: boolean;
  granted: OutcomeDerivation["granted"];
  winType: WinType;
  movingPartyQuote: string;   // verbatim, must appear in the case text
  citedPara: string;          // where the labeller says it is
  labeller: string;           // "consensus-4" | "claude" | "user"
  confidence: "high" | "low";
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// Returns null when the label is sound, otherwise a human-readable reason. A quote found
// in a different paragraph than cited is NOT fatal — the label stands, but the drift is
// reported so the citation can be corrected.
export function verifyGoldLabel(g: GoldLabel, chunks: CaseChunk[]): string | null {
  if (!g.movingPartyQuote.trim()) return "movingPartyQuote is empty — every label must carry evidence";

  const der: OutcomeDerivation = { movingPartyIsIndigenous: g.movingPartyIsIndigenous, granted: g.granted };
  if (contradictsDerivation(g.winType, der)) {
    return `winType "${g.winType}" contradicts the label's own derivation (moving=${g.movingPartyIsIndigenous}, ${g.granted})`;
  }

  const q = norm(g.movingPartyQuote);
  const hit = chunks.find((c) => norm(c.text).includes(q));
  if (!hit) return `movingPartyQuote not found in the case text — cannot verify who moved`;
  if (hit.paragraph !== g.citedPara) return `quote found in ${hit.paragraph}, not the cited ${g.citedPara}`;
  return null;
}
```

- [ ] **Step 4: Create the gold file**

Create `docs/research/gold/cases-outcome-gold.jsonl` containing exactly this single seed record — the one case whose moving party was independently confirmed by four models during the 2026-07-31 bake-off, with the quote to be filled from the judgment during the labelling run:

```
{"caseId":"2013-ykca-7","movingPartyIsIndigenous":true,"granted":"granted","winType":"party_win","movingPartyQuote":"REPLACE WITH VERBATIM QUOTE FROM para","citedPara":"para-1","labeller":"consensus-4","confidence":"low"}
```

The file starts near-empty on purpose: labels are produced by the operational labelling run described below, not invented at implementation time. The loader will reject this seed until its quote is real, which is the intended behaviour and the first thing the labelling run fixes.

- [ ] **Step 5: Create `scripts/cases-outcome-eval.ts`**

```ts
// Score candidate models against the quote-verified gold set.
//
// Reports three numbers per model. Polarity accuracy is the elimination metric;
// self-consistency is the number this whole design exists to drive down.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { modelFromId, DUAL_LLM_MAX_TOKENS, cachedCall } from "../src/lib/cases/ingest/llm";
import { outcomePrompt, parseOutcome, impliedDirection, contradictsDerivation } from "../src/lib/cases/ingest/outcome-rubric";
import { verifyGoldLabel, type GoldLabel } from "../src/lib/cases/eval/outcome-gold";

const GOLD = path.join(process.cwd(), "docs", "research", "gold", "cases-outcome-gold.jsonl");
const MODELS = (process.env.EVAL_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

async function main() {
  if (!MODELS.length) throw new Error("Set EVAL_MODELS to a comma-separated list of model ids.");
  const lines = (await fs.readFile(GOLD, "utf8")).split("\n").filter((l) => l.trim());
  const labels: GoldLabel[] = lines.map((l) => JSON.parse(l));

  // Load cases and reject unsound labels BEFORE scoring anything.
  const usable: { g: GoldLabel; style: string; chunks: any[] }[] = [];
  for (const g of labels) {
    const c = await dynamoCaseRepo.getCase(g.caseId);
    if (!c?.chunks) { console.log(`  ✗ ${g.caseId}: no chunks`); continue; }
    const bad = verifyGoldLabel(g, c.chunks);
    if (bad) { console.log(`  ✗ ${g.caseId}: ${bad}`); continue; }
    usable.push({ g, style: c.styleOfCause, chunks: c.chunks });
  }
  console.log(`\ngold: ${usable.length} usable of ${labels.length}\n`);
  if (!usable.length) return;

  for (const id of MODELS) {
    const m = modelFromId(id, { maxTokens: DUAL_LLM_MAX_TOKENS });
    let polarityOk = 0, polarityBad = 0, abstain = 0, selfContra = 0, errored = 0;
    for (const { g, style, chunks } of usable) {
      let r;
      try { r = parseOutcome(await cachedCall(m, outcomePrompt(style, chunks))); }
      catch { errored++; continue; }
      if (r.derivation && contradictsDerivation(r.winType, r.derivation)) selfContra++;
      if (r.winType === "unclassified") { abstain++; continue; }
      const want = impliedDirection({ movingPartyIsIndigenous: g.movingPartyIsIndigenous, granted: g.granted });
      const gotWin = r.winType === "party_win" || r.winType === "doctrine_win";
      if (want === "partly" || r.winType === "mixed") continue;
      if ((want === "prevailed") === gotWin) polarityOk++; else polarityBad++;
    }
    const scored = polarityOk + polarityBad;
    const pct = (n: number) => scored ? `${((n / scored) * 100).toFixed(1)}%` : "n/a";
    console.log(`### ${id}`);
    console.log(`    polarity  ${polarityOk}/${scored} (${pct(polarityOk)})  · INVERTED ${polarityBad}`);
    console.log(`    coverage  ${usable.length - abstain - errored}/${usable.length}  · abstained ${abstain} · errors ${errored}`);
    console.log(`    self-contradictions ${selfContra}\n`);
  }
}
main().catch((e) => { console.error("❌ cases-outcome-eval failed:", e); process.exit(1); });
```

- [ ] **Step 6: Add npm scripts to `package.json`**

Beside the existing `cases:outcome-review` entries:

```json
"cases:outcome-eval": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-outcome-eval.ts",
"cases:outcome-eval:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-outcome-eval.ts"
```

- [ ] **Step 7: Full gate**

Run: `npx tsx scripts/test-cases-outcome.ts && npx tsx scripts/test-cases-table.ts && npx tsx scripts/test-cases-label-llm.ts && npm run typecheck && npm run build`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/cases/eval/outcome-gold.ts scripts/cases-outcome-eval.ts docs/research/gold/cases-outcome-gold.jsonl package.json scripts/test-cases-outcome.ts
git commit -m "feat(cases): quote-verified gold set loader + per-model outcome eval"
```

---

## Operational (after merge — needs credentials)

The prompt changed, so **every one of the 1118 cached responses is stale** and the corpus is fully reclassified. `OUTCOME_FORCE=1` is required because every core case already carries a `dual_llm` outcome.

```bash
LABEL_MODELS="us.anthropic.claude-sonnet-4-6,us.meta.llama3-3-70b-instruct-v1:0" \
  OUTCOME_FORCE=1 npm run cases:classify-outcome:cloud

npm run cases:outcome-review:cloud > outcome-review.txt
```

Then the labelling run, in this order:

1. Run the reasoning-first prompt across the four models confirmed invokable on 2026-07-31
   (`kimi-k2-thinking`, `zai.glm-5`, `openai.gpt-oss-120b-1:0`, `us.deepseek.r1-v1:0`) over a
   stratified ~120-case sample. Where all four agree on `movingPartyIsIndigenous` **and** `granted`,
   emit a gold record with `labeller: "consensus-4"`, quoting the sentence the models point at.
2. Adjudicate the disagreements, recording a verbatim quote for each. The loader rejects any label
   whose quote is not in the text.
3. Escalate the residue the quote cannot settle to the user, with the competing readings.
4. `EVAL_MODELS="..." npm run cases:outcome-eval:cloud` to score.

Expect the published count to move. The five bake-off labels are discarded and relabelled — one is
known wrong and the rest came from the same flawed method.

---

## Self-Review

**Spec coverage.** Reasoning-first prompt with ordering enforced → T2. Closed-valued derivation
(`movingPartyIsIndigenous` + `granted`) → T2 types, T3 storage. Contradiction gate → T2 pure function,
T3 wired into the merge. `doctrine_win` always reviewed → T3. Derivation stored only on agreement →
T3. Round-trip through `itemToCase` → T3 (with the explicit nested test, since the `Required<>` canary
does not recurse). `maxTokens` raised and truncation made loud → T1. `parseOutcome`'s brace scan left
alone → no task touches it, and T2's replacement keeps the same `indexOf`/`lastIndexOf` logic.
`dispositionSentence` removed → T2, with its consumer rewritten in T4. Gold set with mandatory
verified quote → T5. Polarity / coverage / self-consistency reported per model → T5. Same model pair,
no swap → nothing changes `LABEL_MODELS`.

**Placeholder scan.** No TBD. Every code step carries complete code; every run step names the command
and its expected result, including the two steps where typecheck is *expected* to fail mid-sequence
(T2 Step 5, T3 Step 6) so an implementer does not chase it. The one intentional placeholder — the
gold seed's `REPLACE WITH VERBATIM QUOTE` — is called out as intentional, and the loader rejects it
until fixed, so it cannot be mistaken for real data.

**Type consistency.** `RawOutcome` gains `derivation: OutcomeDerivation | null` and is declared once
in `outcome-rubric.ts`; `ClassifiedOutcome.derivation` is `OutcomeDerivation | undefined` (optional
property, absent when the two models disagree) — the two differ deliberately, `null` meaning "the
model showed no work" and absent meaning "the pair did not agree". `OutcomeDerivation` lives in
`types.ts` because it is stored. `impliedDirection` and `contradictsDerivation` are imported by
`outcome-labeler.ts` (T3), `cases-outcome-review.ts` (T4), `outcome-gold.ts` (T5), and
`cases-outcome-eval.ts` (T5) under those exact names. `contradictions` is optional on `OutcomeMeta`,
so the runner reads it as `?? 0`.
