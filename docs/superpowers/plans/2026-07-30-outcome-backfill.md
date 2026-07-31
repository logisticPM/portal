# Outcome Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `outcome.winType` and `outcome.outcomeType` across the 561 core cases by dual-LLM classification, so the corpus can answer "how many wins" instead of returning 272 `unclassified` rows.

**Architecture:** Mirrors the existing theme-labelling pair (`rubric.ts` + `labeler.ts`) with one deliberate divergence: the prompt window is **head + tail**, not head-only, because a judgment's disposition is at the end. Merge rule is exact-agreement-or-abstain. Only closed enums are written — no free text.

**Tech Stack:** TypeScript, `tsx` scripts, Bedrock Converse via the existing `llm.ts`, DynamoDB via `@aws-sdk/lib-dynamodb`, `node:assert/strict` tests.

**Spec:** `docs/superpowers/specs/2026-07-30-outcome-backfill-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/cases/ingest/outcome-rubric.ts` (create) | The versioned methodology: rubric text, the head+tail window, the prompt, and the response parser. Pure — no I/O. |
| `src/lib/cases/ingest/outcome-labeler.ts` (create) | Dual-model orchestration and the merge rule. |
| `src/lib/cases/types.ts` (modify) | `OutcomeMeta` + `outcomeMeta?` on `LegalCase`. Additive only. |
| `scripts/test-cases-outcome.ts` (create) | Offline tests for both modules. |
| `scripts/cases-classify-outcome.ts` (create) | Batch runner. Writes the PROFILE item only. |
| `scripts/cases-outcome-review.ts` (create) | Read-only. One line per case for human review. |
| `package.json` (modify) | Four npm scripts. |

`dispositionSentence` lives in `outcome-rubric.ts` next to `dispositionWindow` — both answer "where is the disposition in these chunks", and grouping them keeps the review script free of parsing logic.

---

### Task 1: Rubric, window, prompt, parser

**Files:**
- Create: `src/lib/cases/ingest/outcome-rubric.ts`
- Test: `scripts/test-cases-outcome.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-outcome.ts`:

```ts
import assert from "node:assert/strict";
import type { CaseChunk } from "../src/lib/cases/types";
import {
  OUTCOME_RUBRIC_VERSION, WINTYPE_RUBRIC, ALL_WINTYPES, ALL_OUTCOMETYPES,
  dispositionWindow, dispositionSentence, outcomePrompt, parseOutcome,
} from "../src/lib/cases/ingest/outcome-rubric";

const p = (n: number, text: string): CaseChunk => ({ paragraph: `para-${n}`, text });
const long = (n: number, fill: string) => p(n, fill.repeat(400)); // ~2400 chars each

// --- dispositionWindow ---
// Short case: everything, exactly once, no omission line.
{
  const chunks = [p(1, "The applicant seeks judicial review."), p(2, "The application is dismissed.")];
  const out = dispositionWindow("A v. B", chunks);
  assert.match(out, /\[FULL TEXT\]/);
  assert.doesNotMatch(out, /\[OPENING\]|\[DISPOSITION\]|omitted/);
  assert.equal(out.split("para-2:").length - 1, 1, "para-2 must appear exactly once");
  assert.match(out, /\[CASE\] A v\. B/);
}
// Long case: head + tail with an omission line; the LAST paragraph must survive.
{
  const chunks = [
    ...Array.from({ length: 8 }, (_, i) => long(i + 1, "opening ")),
    p(9, "For these reasons, the appeal is allowed."),
  ];
  const out = dispositionWindow("C v. D", chunks);
  assert.match(out, /\[OPENING\]/);
  assert.match(out, /\[DISPOSITION\]/);
  assert.match(out, /\[\.\.\. \d+ paragraphs? omitted \.\.\.\]/);
  assert.match(out, /para-9: For these reasons, the appeal is allowed\./,
    "the disposition paragraph is the whole point — it must always be present");
  assert.match(out, /para-1:/, "head must be present");
}
// A final paragraph larger than the tail budget keeps its END, not its start.
{
  const chunks = [long(1, "x "), p(2, "y ".repeat(4000) + "THE APPEAL IS ALLOWED.")];
  const out = dispositionWindow("E v. F", chunks);
  assert.match(out, /THE APPEAL IS ALLOWED\./, "must not truncate away the disposition");
}
// Mirror rule: a FIRST paragraph larger than the head budget keeps its START and is
// still included. Dropping it would lose the party names that winType is relative to.
{
  const chunks = [
    p(1, "PARTIES: Alpha Nation v. Beta. " + "z ".repeat(3000)),
    long(2, "mid "),
    p(3, "The appeal is dismissed."),
  ];
  const out = dispositionWindow("M v. N", chunks);
  assert.match(out, /\[OPENING\]/, "an oversized opening must be truncated, not dropped");
  assert.match(out, /para-1: PARTIES: Alpha Nation v\. Beta\./, "the opening keeps its START");
  assert.match(out, /para-3: The appeal is dismissed\./);
}

// --- dispositionSentence ---
assert.equal(
  dispositionSentence([p(1, "Background here."), p(2, "The appeal is dismissed with costs.")]),
  "The appeal is dismissed with costs.");
assert.equal(
  dispositionSentence([p(1, "The appeal is allowed."), p(2, "Costs are granted to the applicant.")]),
  "Costs are granted to the applicant.", "prefers the LAST disposition match");
assert.equal(dispositionSentence([p(1, "Nothing decisive here.")]), null);
assert.equal(dispositionSentence([]), null);

// --- outcomePrompt ---
{
  const prompt = outcomePrompt("G v. H", [p(1, "The application is dismissed.")]);
  for (const k of ALL_WINTYPES) assert.ok(prompt.includes(k), `prompt must list winType ${k}`);
  assert.ok(prompt.includes(OUTCOME_RUBRIC_VERSION), "prompt must carry the rubric version");
  assert.ok(prompt.includes("The application is dismissed."), "prompt must carry the case text");
}

// --- parseOutcome (raw model output, prose and all) ---
assert.deepEqual(
  parseOutcome('Here is my answer:\n{"winType":"party_win","outcomeType":"remand"}\nHope that helps.'),
  { winType: "party_win", outcomeType: "remand" }, "must tolerate prose around the JSON");
assert.deepEqual(parseOutcome('{"winType":"nonsense","outcomeType":"remand"}'),
  { winType: "unclassified", outcomeType: "remand" }, "unknown enum values fall back");
assert.deepEqual(parseOutcome("not json at all"),
  { winType: "unclassified", outcomeType: "unclassified" });
assert.ok(ALL_OUTCOMETYPES.includes("procedural"));
assert.ok(WINTYPE_RUBRIC.party_win.length > 0);

console.log("✅ test-cases-outcome (rubric) passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-outcome.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/ingest/outcome-rubric'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/cases/ingest/outcome-rubric.ts`:

```ts
// The outcome rubric IS the methodology — versioned and committed, like rubric.ts.
//
// WINDOWING: labelPrompt takes text.slice(0, 6000) — the HEAD of a judgment. That is
// correct for themes (stated early) and exactly wrong for outcome: the disposition
// ("the appeal is allowed") is at the END. This module spends the same 6000-character
// budget head+tail so the classifier always sees the operative sentence.
import type { CaseChunk, OutcomeType, WinType } from "../types";

export const OUTCOME_RUBRIC_VERSION = "2026-07-30.1";

// winType is ALWAYS relative to the Indigenous party or interest.
export const WINTYPE_RUBRIC: Record<WinType, string> = {
  party_win: "The court granted the Indigenous party substantive relief — approval quashed, infringement declared, consultation ordered redone.",
  doctrine_win: "The specific relief was refused, but the legal principle advanced in the Indigenous party's favour.",
  loss: "Relief was refused, or the duty was found not triggered or already discharged.",
  mixed: "Substantive relief was granted in part and refused in part.",
  unclassified: "A purely procedural step (leave, standing, stay, extension, costs) with no substantive relief, or no Indigenous party or interest is involved.",
};

export const OUTCOMETYPE_RUBRIC: Record<OutcomeType, string> = {
  precedent: "Resolves the merits and states a legal rule intended to govern future cases.",
  procedural: "Resolves a procedural step (leave, standing, stay, extension, costs) without deciding the merits.",
  remand: "Sends the matter back to a decision-maker or lower court for redetermination.",
  regulatory: "Reviews the decision of a regulator or tribunal (board, commission, ministerial authorization).",
  settlement: "Approves, interprets, or enforces a settlement agreement.",
  unclassified: "None of the above is the best fit.",
};

export const ALL_WINTYPES = Object.keys(WINTYPE_RUBRIC) as WinType[];
export const ALL_OUTCOMETYPES = Object.keys(OUTCOMETYPE_RUBRIC) as OutcomeType[];

const HEAD_CHARS = 2000;
const TAIL_CHARS = 4000;

const render = (c: CaseChunk) => `${c.paragraph}: ${c.text}`;

// Head + tail, tail-weighted. Invariant: the FINAL paragraph is always present —
// a final paragraph longer than the budget keeps its end, not its start.
export function dispositionWindow(styleOfCause: string, chunks: CaseChunk[]): string {
  const header = `[CASE] ${styleOfCause}`;
  if (chunks.length === 0) return `${header}\n\n[FULL TEXT]\n(no paragraphs available)`;

  const lines = chunks.map(render);
  const total = lines.reduce((n, s) => n + s.length + 1, 0);
  if (total <= HEAD_CHARS + TAIL_CHARS) {
    return `${header}\n\n[FULL TEXT]\n${lines.join("\n")}`;
  }

  // Tail first, and never empty: the disposition is why this function exists.
  let tailStart = lines.length - 1;
  let used = lines[tailStart].length;
  while (tailStart > 0 && used + lines[tailStart - 1].length + 1 <= TAIL_CHARS) {
    used += lines[tailStart - 1].length + 1;
    tailStart--;
  }
  const tailLines = lines.slice(tailStart);
  if (tailLines[0].length > TAIL_CHARS) tailLines[0] = "…" + tailLines[0].slice(-TAIL_CHARS);

  let headEnd = 0;
  used = 0;
  while (headEnd < tailStart && used + lines[headEnd].length + 1 <= HEAD_CHARS) {
    used += lines[headEnd].length + 1;
    headEnd++;
  }
  // A first paragraph larger than the head budget keeps its START — the mirror of the
  // tail rule. Dropping the opening outright would lose who the parties are, and
  // winType is defined relative to the Indigenous party, so that loss is not survivable.
  const truncatedHead = headEnd === 0 && tailStart > 0;
  const headLines = truncatedHead ? [lines[0].slice(0, HEAD_CHARS) + "…"] : lines.slice(0, headEnd);

  const omitted = tailStart - (truncatedHead ? 1 : headEnd);
  const parts = [header, ""];
  if (headLines.length > 0) parts.push("[OPENING]", headLines.join("\n"), "");
  if (omitted > 0) parts.push(`[... ${omitted} paragraph${omitted === 1 ? "" : "s"} omitted ...]`, "");
  parts.push("[DISPOSITION]", tailLines.join("\n"));
  return parts.join("\n");
}

const DISPOSITION_RE = /\b(allow|dismiss|grant|quash|set aside|declare|remit)\w*\b/i;

// The last sentence in the last paragraph that reads like a disposition. Sentence
// splitting is crude on purpose — the reviewer also sees the paragraph id and can
// pull the full window when a line looks wrong.
export function dispositionSentence(chunks: CaseChunk[]): string | null {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const sentences = chunks[i].text.split(/(?<=[.!?])\s+/);
    for (let j = sentences.length - 1; j >= 0; j--) {
      if (DISPOSITION_RE.test(sentences[j])) return sentences[j].trim();
    }
  }
  return null;
}

export function outcomePrompt(styleOfCause: string, chunks: CaseChunk[]): string {
  const wins = ALL_WINTYPES.map((k) => `- ${k}: ${WINTYPE_RUBRIC[k]}`).join("\n");
  const types = ALL_OUTCOMETYPES.map((k) => `- ${k}: ${OUTCOMETYPE_RUBRIC[k]}`).join("\n");
  return `You classify the OUTCOME of Canadian legal cases involving Indigenous parties. ` +
    `Read the disposition and decide who prevailed. winType is ALWAYS relative to the Indigenous ` +
    `party or interest; if there is no Indigenous party, answer "unclassified" — never "loss". ` +
    `A purely procedural advance is NOT a victory. Pick the single best fit for each field. ` +
    `Return ONLY a JSON object {"winType": "...", "outcomeType": "..."} and no prose.\n\n` +
    `rubric ${OUTCOME_RUBRIC_VERSION}\n\nwinType:\n${wins}\n\noutcomeType:\n${types}\n\n` +
    dispositionWindow(styleOfCause, chunks);
}

export interface RawOutcome { winType: WinType; outcomeType: OutcomeType }

// Tolerant of prose around the JSON, same as parseThemes. Anything unrecognized
// degrades to "unclassified" rather than throwing.
export function parseOutcome(raw: string): RawOutcome {
  try {
    const o = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    return {
      winType: ALL_WINTYPES.includes(o?.winType) ? o.winType : "unclassified",
      outcomeType: ALL_OUTCOMETYPES.includes(o?.outcomeType) ? o.outcomeType : "unclassified",
    };
  } catch {
    return { winType: "unclassified", outcomeType: "unclassified" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-outcome.ts`
Expected: PASS — `✅ test-cases-outcome (rubric) passed`

- [ ] **Step 5: Verify theme labelling is untouched**

Run: `npx tsx scripts/test-cases-label-llm.ts`
Expected: PASS, unchanged. This module must not perturb `rubric.ts` or `labeler.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/ingest/outcome-rubric.ts scripts/test-cases-outcome.ts
git commit -m "feat(cases): outcome rubric with head+tail disposition window"
```

---

### Task 2: `OutcomeMeta` type and the dual-model merge

**Files:**
- Modify: `src/lib/cases/types.ts` (add `OutcomeMeta` after `SummaryMeta` ~line 27; add `outcomeMeta?` to `LegalCase`)
- Create: `src/lib/cases/ingest/outcome-labeler.ts`
- Test: `scripts/test-cases-outcome.ts` (append)

- [ ] **Step 1: Write the failing test**

Two edits to `scripts/test-cases-outcome.ts`.

**(a)** Add these to the import block at the **top** of the file (the package has no
`"type": "module"`, so tsx compiles these as CJS — imports must stay hoisted at the top and
**top-level `await` is not available**, which is why the existing `test-cases-label-llm.ts` wraps
async work in an IIFE):

```ts
import type { LlmModel } from "../src/lib/cases/ingest/llm";
import { mergeOutcome, classifyOutcome } from "../src/lib/cases/ingest/outcome-labeler";
```

**(b)** Replace the final line `console.log("✅ test-cases-outcome (rubric) passed");` with
everything below. The success message moves **inside** the IIFE so it cannot print before the async
assertions have run:

```ts
// --- mergeOutcome ---
{
  const r = mergeOutcome(
    { winType: "party_win", outcomeType: "remand" },
    { winType: "party_win", outcomeType: "remand" }, ["m1", "m2"]);
  assert.equal(r.winType, "party_win");
  assert.equal(r.outcomeType, "remand");
  assert.equal(r.outcomeMeta.agreement, "full");
  assert.equal(r.outcomeMeta.confidence, "high");
  assert.equal(r.outcomeMeta.needsReview, false);
  assert.equal(r.outcomeMeta.method, "dual_llm");
  assert.deepEqual(r.outcomeMeta.models, ["m1", "m2"]);
  assert.equal(r.outcomeMeta.rubricVersion, OUTCOME_RUBRIC_VERSION);
}
// Disagreement on winType abstains and flags for review.
{
  const r = mergeOutcome(
    { winType: "party_win", outcomeType: "remand" },
    { winType: "loss", outcomeType: "remand" }, ["m1", "m2"]);
  assert.equal(r.winType, "unclassified", "disagreement must abstain, never pick a side");
  assert.equal(r.outcomeType, "remand", "the agreeing field survives independently");
  assert.equal(r.outcomeMeta.agreement, "partial");
  assert.equal(r.outcomeMeta.needsReview, true);
  assert.equal(r.outcomeMeta.confidence, "low");
}
// Neither field agrees.
{
  const r = mergeOutcome(
    { winType: "party_win", outcomeType: "remand" },
    { winType: "loss", outcomeType: "precedent" }, ["m1", "m2"]);
  assert.equal(r.outcomeMeta.agreement, "none");
  assert.equal(r.winType, "unclassified");
  assert.equal(r.outcomeType, "unclassified");
}
// THE EASY ONE TO GET WRONG: both models answering "unclassified" AGREE,
// but that is not a confident classification.
{
  const r = mergeOutcome(
    { winType: "unclassified", outcomeType: "procedural" },
    { winType: "unclassified", outcomeType: "procedural" }, ["m1", "m2"]);
  assert.equal(r.outcomeMeta.agreement, "full");
  assert.equal(r.outcomeMeta.confidence, "low", "agreed-unclassified is agreement WITHOUT confidence");
  assert.equal(r.outcomeMeta.needsReview, false, "the models did not disagree, so no review is owed");
}

// --- classifyOutcome with injected models (merge wiring, end to end) ---
// Async work lives in an IIFE: this file compiles as CJS, so there is no top-level await.
(async () => {
  const mk = (id: string, w: string): LlmModel =>
    ({ id, call: async () => JSON.stringify({ winType: w, outcomeType: "precedent" }) });
  const chunks = [p(1, "The appeal is allowed.")];
  const agree = await classifyOutcome("I v. J", chunks,
    [mk("fake:agree-a", "party_win"), mk("fake:agree-b", "party_win")]);
  assert.equal(agree.winType, "party_win");
  assert.equal(agree.outcomeMeta.confidence, "high");

  const clash = await classifyOutcome("K v. L", chunks,
    [mk("fake:clash-a", "party_win"), mk("fake:clash-b", "loss")]);
  assert.equal(clash.winType, "unclassified");
  assert.equal(clash.outcomeMeta.needsReview, true);

  console.log("✅ test-cases-outcome passed");
})();
```

`classifyWithModel` routes through `cachedCall`, so these fake responses land in
`scripts/.cache/llm` keyed by `(id, prompt)`. That is harmless — the fakes are deterministic, so a
cache hit returns the same value — but it is why each fake gets a distinct id.

Note: the injected-model test proves the merge wiring, not the prompt or the parser — those are covered directly by the Task 1 `parseOutcome` and `outcomePrompt` assertions. (This split is deliberate: the Yukon harvest bug hid behind an injected fetcher that bypassed the real gate.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-outcome.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/ingest/outcome-labeler'`

- [ ] **Step 3: Add `OutcomeMeta` to `src/lib/cases/types.ts`**

Insert immediately after the `SummaryMeta` interface (ends line 27):

```ts
// Provenance for the classified outcome. Separate from ThemeLabelMeta (rather than
// reused) because it pins the rubric version and the two will drift.
export interface OutcomeMeta {
  method: "curated" | "dual_llm";
  models?: string[];
  agreement?: "full" | "partial" | "none";
  confidence: "high" | "low";
  needsReview: boolean;
  rubricVersion?: string;
}
```

In `interface LegalCase`, add immediately after the `outcome: CaseOutcome;` line:

```ts
  outcomeMeta?: OutcomeMeta;
```

- [ ] **Step 4: Write `src/lib/cases/ingest/outcome-labeler.ts`**

```ts
// Dual-LLM outcome classification. Merge rule: EXACT AGREEMENT OR ABSTAIN, per field.
// No superclass collapsing, no tie-breaking, no third model — an `unclassified` row is
// a known gap, whereas a wrong `party_win` is a false claim in a client-facing count.
import type { CaseChunk, OutcomeMeta, OutcomeType, WinType } from "../types";
import { cachedCall, configuredModels, type LlmModel } from "./llm";
import { OUTCOME_RUBRIC_VERSION, outcomePrompt, parseOutcome, type RawOutcome } from "./outcome-rubric";

export interface ClassifiedOutcome {
  winType: WinType;
  outcomeType: OutcomeType;
  outcomeMeta: OutcomeMeta;
}

export function mergeOutcome(a: RawOutcome, b: RawOutcome, models: [string, string]): ClassifiedOutcome {
  const winAgrees = a.winType === b.winType;
  const typeAgrees = a.outcomeType === b.outcomeType;
  const winType: WinType = winAgrees ? a.winType : "unclassified";
  const outcomeType: OutcomeType = typeAgrees ? a.outcomeType : "unclassified";

  const matches = (winAgrees ? 1 : 0) + (typeAgrees ? 1 : 0);
  const agreement: OutcomeMeta["agreement"] = matches === 2 ? "full" : matches === 1 ? "partial" : "none";
  // Two models both answering "unclassified" agree, but that is not a confident
  // classification — hence the second clause.
  const confidence: OutcomeMeta["confidence"] =
    agreement === "full" && winType !== "unclassified" ? "high" : "low";

  return {
    winType,
    outcomeType,
    outcomeMeta: {
      method: "dual_llm", models, agreement, confidence,
      needsReview: agreement !== "full",
      rubricVersion: OUTCOME_RUBRIC_VERSION,
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

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-outcome.ts`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean. (`outcomeMeta?` is optional, so no existing `LegalCase` literal breaks.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/cases/types.ts src/lib/cases/ingest/outcome-labeler.ts scripts/test-cases-outcome.ts
git commit -m "feat(cases): dual-LLM outcome merge (exact agreement or abstain)"
```

---

### Task 3: Batch runner, review script, npm scripts

**Files:**
- Create: `scripts/cases-classify-outcome.ts`
- Create: `scripts/cases-outcome-review.ts`
- Modify: `package.json`

- [ ] **Step 1: Write `scripts/cases-classify-outcome.ts`**

There is no offline test for this file — it is I/O orchestration over DynamoDB, and the logic it
carries (window, prompt, parse, merge) is already covered by Task 1 and Task 2. Correctness here is
established by the credentialed dry run in Step 4.

```ts
// Batch dual-LLM outcome classification over core cases (spec 2026-07-30).
// Idempotent: responses are disk-cached (scripts/.cache/llm), so re-runs and the
// cloud replay are free. Writes outcome + outcomeMeta onto the PROFILE item ONLY —
// never rewrites CHUNK items (that would wipe embedded vectors; the promote lesson).
import "./fetch-polyfill";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseKeys } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { classifyOutcome } from "../src/lib/cases/ingest/outcome-labeler";
import { ALL_WINTYPES } from "../src/lib/cases/ingest/outcome-rubric";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
// OUTCOME_FORCE=1: re-classify rows already carrying a dual_llm outcome. Curated
// values stay immune either way.
const FORCE = process.env.OUTCOME_FORCE === "1";

async function main() {
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  console.log(`classifying ${profiles.length} core cases${FORCE ? " (FORCE)" : ""}`);

  const stats = { classified: 0, curated: 0, already: 0, no_chunks: 0, failed: 0 };
  const agree = { full: 0, partial: 0, none: 0 };
  const wins = Object.fromEntries(ALL_WINTYPES.map((w) => [w, 0])) as Record<string, number>;
  let done = 0;

  for (const prof of profiles) {
    // Curated outcomes are never touched. Cases seeded before outcomeMeta existed have
    // no meta but DO have a real winType — that pre-existing value is curated too.
    if (prof.outcomeMeta?.method === "curated"
      || (!prof.outcomeMeta && prof.outcome?.winType && prof.outcome.winType !== "unclassified")) {
      stats.curated++; continue;
    }
    if (prof.outcomeMeta?.method === "dual_llm" && !FORCE) { stats.already++; continue; }

    const c = await dynamoCaseRepo.getCase(prof.id);
    if (!c) continue;
    if (!c.chunks || c.chunks.length === 0) { stats.no_chunks++; continue; }

    let r;
    try {
      r = await classifyOutcome(c.styleOfCause, c.chunks);
    } catch (e) {
      stats.failed++;
      console.log(`   ⚠ ${c.id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    await ddbDoc.send(new UpdateCommand({
      TableName: TABLE,
      Key: caseKeys.profile(c.id),
      // Case fields live under the PROFILE's `data` attribute, and DATA is a
      // DynamoDB reserved word — alias every path segment.
      UpdateExpression: "SET #d.#o = :o, #d.#om = :om",
      ExpressionAttributeNames: { "#d": "data", "#o": "outcome", "#om": "outcomeMeta" },
      ExpressionAttributeValues: {
        ":o": { ...c.outcome, winType: r.winType, outcomeType: r.outcomeType },
        ":om": r.outcomeMeta,
      },
    }));

    stats.classified++;
    agree[r.outcomeMeta.agreement ?? "none"]++;
    wins[r.winType]++;
    if (++done % 25 === 0) console.log(`… ${done}/${profiles.length} · classified ${stats.classified}`);
  }

  console.log(`✅ classify-outcome: classified ${stats.classified} · curated ${stats.curated} · already ${stats.already} · no-chunks ${stats.no_chunks} · failed ${stats.failed}`);
  console.log(`   agreement: full ${agree.full} · partial ${agree.partial} · none ${agree.none}`);
  console.log(`   winType: ${ALL_WINTYPES.map((w) => `${w} ${wins[w]}`).join(" · ")}`);
}
main().catch((e) => { console.error("❌ cases-classify-outcome failed:", e); process.exit(1); });
```

Note `":o": { ...c.outcome, ... }` — `whoWon` and `holding` are carried through untouched, never
written. Only the two enum fields change.

- [ ] **Step 2: Write `scripts/cases-outcome-review.ts`**

```ts
// Read-only. Compresses every classified case to one reviewable line: the model's
// verdict beside the disposition sentence it should have come from. Reviewing 561
// of these in one pass is what makes full coverage (rather than a sample) feasible —
// the AGREED rows are the ones that feed a published count, and correlated model
// error is exactly what a sample would miss.
import "./fetch-polyfill";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { dispositionSentence } from "../src/lib/cases/ingest/outcome-rubric";

const ONLY = process.env.REVIEW_WINTYPE; // optional filter, e.g. party_win

async function main() {
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  let shown = 0, noSentence = 0;

  for (const prof of profiles) {
    if (prof.outcomeMeta?.method !== "dual_llm") continue;
    if (ONLY && prof.outcome.winType !== ONLY) continue;
    const c = await dynamoCaseRepo.getCase(prof.id);
    const s = c?.chunks ? dispositionSentence(c.chunks) : null;
    if (!s) noSentence++;
    console.log([
      prof.id.padEnd(20),
      prof.outcome.winType.padEnd(13),
      (prof.outcomeMeta.confidence ?? "?").padEnd(5),
      s ? `"${s.slice(0, 150)}"` : "(no disposition sentence found)",
    ].join(" "));
    shown++;
  }
  console.log(`\n${shown} reviewed · ${noSentence} with no disposition sentence (read these first)`);
}
main().catch((e) => { console.error("❌ cases-outcome-review failed:", e); process.exit(1); });
```

- [ ] **Step 3: Add npm scripts to `package.json`**

Add beside the existing `cases:summarize` entries, matching their shape exactly (local runs point at
the local DynamoDB; `:cloud` drops `DYNAMO_ENDPOINT` and sets `AWS_REGION`):

```json
"cases:classify-outcome": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-classify-outcome.ts",
"cases:classify-outcome:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-classify-outcome.ts",
"cases:outcome-review": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-outcome-review.ts",
"cases:outcome-review:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-outcome-review.ts"
```

- [ ] **Step 4: Verify the whole branch builds**

Run: `npx tsx scripts/test-cases-outcome.ts && npx tsx scripts/test-cases-label-llm.ts && npm run typecheck && npm run build`
Expected: all pass.

**Do NOT run `npm run verify`** — it factory-resets the local corpus.

- [ ] **Step 5: Commit**

```bash
git add scripts/cases-classify-outcome.ts scripts/cases-outcome-review.ts package.json
git commit -m "feat(cases): outcome classification runner + review script"
```

---

## Operational (after merge — needs credentials, not part of implementation)

`configuredModels()` throws unless `LABEL_MODELS` names two comma-separated ids from different
families; outcome classification reuses that pair deliberately — it is the same dual-LLM
consistency device.

```bash
LABEL_MODELS="<model-a>,<model-b>" npm run cases:classify-outcome:cloud
npm run cases:outcome-review:cloud > /tmp/outcome-review.txt
```

Then: review every line, write findings to `docs/research/2026-07-30-outcome-review.md`, and
escalate the borderline rubric calls to the user with the disposition quoted.

No re-embedding and no index rebuild — `outcome` is a facet field, not part of the search artifact.

---

## Self-Review

**Spec coverage.** Rubric text + version → T1. Head+tail window with the full-text overlap case and
the always-present final paragraph → T1. `dispositionSentence` → T1. `OutcomeMeta` → T2. Exact
agreement or abstain, and the three metadata fields each meaning one thing → T2. Curated immunity,
PROFILE-only write, idempotence, `OUTCOME_FORCE`, no-chunks skip, the reported histogram → T3.
Review script → T3. Every "Explicitly NOT doing" item is absent: no `whoWon`/`holding` write (T3
Step 1 spreads `...c.outcome`), no enum change, no retrieval or UI change, core tier only.

**Placeholder scan.** No TBD/TODO. Every code step carries complete code; every run step carries an
exact command and expected result. The one file without a unit test (the runner) says so and says
why.

**Type consistency.** `RawOutcome` is declared once, in `outcome-rubric.ts`, and imported by
`outcome-labeler.ts` — not redeclared. `ClassifiedOutcome` is returned by both `mergeOutcome` and
`classifyOutcome`. `OutcomeMeta["agreement"]` is optional in the type, so the runner's
`agree[r.outcomeMeta.agreement ?? "none"]` handles it. `ALL_WINTYPES`/`ALL_OUTCOMETYPES` are
exported from `outcome-rubric.ts` and consumed by the parser, the runner, and the tests under those
exact names.
