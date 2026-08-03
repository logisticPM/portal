# Answer-Quality Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only instrument that measures whether "Ask this judgment" answers questions correctly, producing three objective metrics and one LLM-judged one.

**Architecture:** Known-answer construction — pick a target paragraph first, then have a model write a lay question that paragraph answers, so the target is ground truth by construction. Three pure modules (`construct` / `judge` / `metrics`) hold all logic and are unit-tested offline; one runner does I/O and enforces the guards. Nothing in `src/lib/cases/caseqa/` is modified — the instrument observes the product path, it does not change it.

**Tech Stack:** TypeScript (strict), `tsx`, `node:assert/strict`, DynamoDB read, Bedrock via the existing `LlmModel` abstraction.

**Spec:** `docs/superpowers/specs/2026-08-03-answer-quality-eval-design.md`

---

## Facts the implementer needs before starting

These were verified against the branch; do not re-derive them.

- **`npm test` does not exist, and CI runs only `typecheck` and `build`** (`.github/workflows/ci.yml`). Test suites are plain scripts run with `npx tsx scripts/test-<name>.ts`, and a failing test will NOT be caught by CI. Run them yourself.
- **Reuse, do not rewrite:** `longestCommonSubstringLen` (`src/lib/cases/ingest/summarizer.ts:105`) and `normWs` (`:23`) are both exported.
- **Existing interfaces:**
  ```ts
  export interface LlmModel { id: string; call: (prompt: string) => Promise<string>; }   // ingest/llm.ts:19
  export const cachedModel = (m: LlmModel): LlmModel => …                               // ingest/llm.ts:131
  export function modelFromId(id: string, opts?: CallOpts): LlmModel                    // ingest/llm.ts:36
  export interface CaseChunk { paragraph: string; text: string; }                        // types.ts:103
  export interface CitationAnchor { text: string; sourceParagraph: string; sourceUrl: string; matched?: "exact" | "near"; }  // types.ts:94
  ```
- **The product entry point being measured:**
  ```ts
  answerCaseQuestion(c: LegalCase, chunks: CaseChunk[], question: string, model: LlmModel): Promise<QaResult>
  ```
  where `QaResult` is `{status:"done"; answer:{claims:CitationAnchor[]}; dropped:number}` or
  `{status:"failed"; failReason:string; failKind:QaFailKind; bestOverlap?:number}` and
  `QaFailKind = "no_full_text" | "unparseable" | "not_addressed" | "unverifiable"`.
- **`CitationAnchor` has no quote field.** Faithfulness is judged against the cited *paragraph*, looked up from `chunks` by `sourceParagraph`. This is spec §6 and is deliberate.
- **Repo access pattern** (copy from `scripts/cases-anchor-signals.ts`):
  ```ts
  import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  const c = await dynamoCaseRepo.getCase(prof.id);   // c.chunks may be undefined/empty
  ```
- **`scripts/.cache/llm` is gitignored and warm (2,935 entries).** Construction and judging go through `cachedModel`; answer calls do not (spec §10).

## File Structure

| file | responsibility |
|---|---|
| `src/lib/cases/caseqa-eval/rng.ts` | seeded PRNG + non-mutating shuffle. Pure. |
| `src/lib/cases/caseqa-eval/construct.ts` | target selection, question prompt, lexical-gimme rejection. Pure. |
| `src/lib/cases/caseqa-eval/judge.ts` | faithfulness + unanswerability prompts, verdict parsing. Pure. |
| `src/lib/cases/caseqa-eval/metrics.ts` | record types, the four metrics, reconciliation. Pure. |
| `src/lib/cases/caseqa-eval/guards.ts` | model-distinctness assertion + provenance formatting. Pure. |
| `scripts/cases-caseqa-eval.ts` | runner: construct → answer → judge → report. All I/O. |
| `scripts/test-cases-caseqa-eval.ts` | unit tests for the four pure modules. |
| `package.json` | two npm scripts. |

`rng.ts` is split out from `construct.ts` because seeded determinism is the property every objective metric rests on, and it deserves its own tests. `guards.ts` exists for the same reason: spec §11 requires every guard to have a test that fails when the guard is removed, and a guard living inside an I/O runner cannot have one.

---

## Task 1: Seeded RNG

**Files:**
- Create: `src/lib/cases/caseqa-eval/rng.ts`
- Test: `scripts/test-cases-caseqa-eval.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-caseqa-eval.ts`:

```ts
// Offline unit tests for the answer-quality eval instrument. No AWS, no LLM calls —
// every model is a hand-rolled fake. Run: npx tsx scripts/test-cases-caseqa-eval.ts
//
// Modules load via dynamic import inside the IIFE (the house pattern), but the record type
// is imported statically: annotating the fixture is what makes the discriminated union
// check, and a cast would hide exactly the mismatch these tests exist to catch.
import assert from "node:assert/strict";
import type { EvalRecord } from "../src/lib/cases/caseqa-eval/metrics";

(async () => {
  const { makeRng, seededShuffle } = await import("../src/lib/cases/caseqa-eval/rng");

  // --- rng: same seed, same stream ------------------------------------------------
  {
    const a = makeRng(1), b = makeRng(1);
    const xs = [a(), a(), a()], ys = [b(), b(), b()];
    assert.deepEqual(xs, ys, "same seed must produce the same stream");
    xs.forEach((x) => assert.ok(x >= 0 && x < 1, `out of range: ${x}`));
  }
  {
    const a = makeRng(1), b = makeRng(2);
    assert.notEqual(a(), b(), "different seeds must diverge");
  }

  // --- seededShuffle: deterministic, non-mutating, a permutation -------------------
  {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const frozen = [...input];
    const s1 = seededShuffle(input, 42);
    const s2 = seededShuffle(input, 42);
    assert.deepEqual(input, frozen, "shuffle must not mutate its input");
    assert.deepEqual(s1, s2, "same seed must produce the same order");
    assert.deepEqual([...s1].sort((x, y) => x - y), frozen, "must be a permutation");
    assert.notDeepEqual(s1, frozen, "a shuffle of 8 items should reorder them");
  }

  console.log("✅ test-cases-caseqa-eval passed");
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/caseqa-eval/rng'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/cases/caseqa-eval/rng.ts`:

```ts
// Seeded determinism is the property every objective metric in this instrument rests on:
// re-running after a prompt change must measure the SAME questions, or the before/after
// comparison is meaningless. Hence a explicit PRNG rather than Math.random.
//
// mulberry32 — 32-bit state, uniform enough for sampling, and short enough to audit.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates over a COPY. Returning a new array rather than shuffling in place matters
// here: the runner shuffles the same case list twice (once for cases, once for pairing),
// and an in-place shuffle would make the second draw depend on the first.
export function seededShuffle<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  const rng = makeRng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: `✅ test-cases-caseqa-eval passed`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit 0

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/caseqa-eval/rng.ts scripts/test-cases-caseqa-eval.ts
git commit -m "feat(caseqa-eval): seeded rng and non-mutating shuffle"
```

---

## Task 2: Target selection, question prompt, lexical-gimme rejection

**Files:**
- Create: `src/lib/cases/caseqa-eval/construct.ts`
- Modify: `scripts/test-cases-caseqa-eval.ts` (append a block before the final `console.log`)

- [ ] **Step 1: Write the failing test**

Insert into `scripts/test-cases-caseqa-eval.ts`, immediately before the `console.log("✅ …")` line:

```ts
  const { MIN_TARGET_PARA_CHARS, GIMME_MIN_RUN, pickTargets, buildQuestionPrompt, isLexicalGimme } =
    await import("../src/lib/cases/caseqa-eval/construct");

  // --- pickTargets: honours the length floor, is seeded, one target per case --------
  {
    const long = (n: number, tag: string) => tag + "x".repeat(n);
    const cases = [
      { id: "c1", chunks: [
        { paragraph: "para-1", text: "Appeal dismissed." },                    // too short
        { paragraph: "para-2", text: long(MIN_TARGET_PARA_CHARS, "A") },       // eligible
        { paragraph: "para-3", text: long(MIN_TARGET_PARA_CHARS, "B") } ] },   // eligible
      { id: "c2", chunks: [
        { paragraph: "para-9", text: long(MIN_TARGET_PARA_CHARS, "C") } ] },
      { id: "c3", chunks: [
        { paragraph: "para-1", text: "Costs to the respondent." } ] },         // no eligible para
    ];

    const picked = pickTargets(cases, 1, 10);
    assert.equal(picked.length, 2, "c3 has no paragraph over the floor and must be skipped");
    assert.deepEqual(picked.map((p) => p.caseId).sort(), ["c1", "c2"]);
    picked.forEach((p) => assert.ok(p.text.length >= MIN_TARGET_PARA_CHARS));
    assert.ok(!picked.some((p) => p.paragraph === "para-1" && p.caseId === "c1"),
      "the short paragraph must never be chosen");

    // Seeded: same seed same picks, and `count` caps the number of CASES.
    assert.deepEqual(pickTargets(cases, 1, 10), picked, "same seed must pick the same targets");
    assert.equal(pickTargets(cases, 1, 1).length, 1, "count caps the case list");
  }

  // --- isLexicalGimme: rejects a long verbatim run, at the boundary ----------------
  {
    const para = "The honour of the Crown requires that the duty to consult be discharged before the permit issues.";
    const run = para.slice(0, GIMME_MIN_RUN);                       // exactly at the threshold
    assert.equal(isLexicalGimme(`So what happens when ${run}`, para), true,
      `a verbatim run of ${GIMME_MIN_RUN} chars is a gimme`);
    assert.equal(isLexicalGimme(`So what happens when ${para.slice(0, GIMME_MIN_RUN - 1)}`, para), false,
      "one char under the threshold is not a gimme");
    assert.equal(isLexicalGimme("Do we get told before they approve the mine?", para), false,
      "a genuine lay paraphrase is not a gimme");
    // Whitespace must not smuggle a match past the check.
    assert.equal(isLexicalGimme(`x  ${run.replace(/ /g, "   ")}`, para), true,
      "normalisation must apply before matching");
  }

  // --- buildQuestionPrompt: carries the paragraph and forbids quoting it -----------
  {
    const p = buildQuestionPrompt(
      { styleOfCause: "Nation v Canada", citation: "2020 SCC 1", court: "SCC", year: 2020 },
      { paragraph: "para-7", text: "The Crown must consult in good faith." });
    assert.ok(p.includes("The Crown must consult in good faith."), "the paragraph text must be present");
    assert.ok(p.includes("Nation v Canada"), "the case must be identified");
    assert.ok(/first person/i.test(p), "the register must be instructed");
    assert.ok(/do not (quote|copy)/i.test(p), "verbatim copying must be forbidden in the prompt");
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/caseqa-eval/construct'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/cases/caseqa-eval/construct.ts`:

```ts
// Known-answer construction: pick the paragraph FIRST, then write the question for it.
// That ordering is what makes responsiveness, false-refusal and false-answer objective —
// the target paragraph is ground truth by construction, with no human and no judge.
import { normWs, longestCommonSubstringLen } from "../ingest/summarizer";
import { seededShuffle } from "./rng";

// Below this, a paragraph is procedural boilerplate — "Appeal dismissed.", "Costs to the
// respondent." — that no lay question can be built from. Including them would score
// construction failures as product failures.
export const MIN_TARGET_PARA_CHARS = 300;

// A constructed question sharing this much verbatim text with its target is a lexical
// gimme: the retriever would match on string overlap and responsiveness would measure
// nothing. 40 chars is well past incidental phrases like "the duty to consult" (19).
export const GIMME_MIN_RUN = 40;

export interface CaseLike { id: string; chunks?: { paragraph: string; text: string }[] }
export interface Target { caseId: string; paragraph: string; text: string }

// One target paragraph per case, for up to `count` cases. Cases with no paragraph over the
// floor are skipped rather than substituted, so the shortfall is visible in the count the
// runner prints instead of being quietly backfilled.
export function pickTargets(cases: readonly CaseLike[], seed: number, count: number): Target[] {
  const out: Target[] = [];
  for (const c of seededShuffle(cases, seed)) {
    if (out.length >= count) break;
    const eligible = (c.chunks ?? []).filter((ch) => ch.text.length >= MIN_TARGET_PARA_CHARS);
    if (!eligible.length) continue;
    // A second shuffle with the same seed: deterministic, and independent of the case order
    // because seededShuffle copies rather than advancing one shared stream.
    const ch = seededShuffle(eligible, seed)[0];
    out.push({ caseId: c.id, paragraph: ch.paragraph, text: ch.text });
  }
  return out;
}

// Normalised on both sides before matching, or "the   Crown" would slip past a check that
// "the Crown" fails.
export function isLexicalGimme(question: string, paragraphText: string, minRun = GIMME_MIN_RUN): boolean {
  return longestCommonSubstringLen(normWs(question), normWs(paragraphText)) >= minRun;
}

export interface CaseHeader { styleOfCause: string; citation: string; court: string; year: number }

export function buildQuestionPrompt(c: CaseHeader, target: { paragraph: string; text: string }): string {
  return `You are writing ONE realistic question for a legal-information website, of the kind a member of the public with no legal training would type.

The question must be answerable from the PARAGRAPH below, taken from ${c.styleOfCause}, ${c.citation} (${c.court}, ${c.year}).

PARAGRAPH [${target.paragraph}]:
${target.text}

Rules:
- Write in the FIRST PERSON, the way a worried non-lawyer writes. Describe a concrete situation, then ask.
- 2 to 4 sentences.
- Do NOT quote or copy any phrase from the paragraph. Use everyday words for the legal ideas.
- Do NOT mention the case name, the citation, the court, or any paragraph number.
- The paragraph must genuinely answer your question.

Output ONLY the question text. No preamble, no quotation marks, no JSON.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: `✅ test-cases-caseqa-eval passed`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit 0

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/caseqa-eval/construct.ts scripts/test-cases-caseqa-eval.ts
git commit -m "feat(caseqa-eval): target selection, question prompt, gimme rejection"
```

---

## Task 3: Judge prompts and verdict parsing

**Files:**
- Create: `src/lib/cases/caseqa-eval/judge.ts`
- Modify: `scripts/test-cases-caseqa-eval.ts` (append before the final `console.log`)

- [ ] **Step 1: Write the failing test**

Insert into `scripts/test-cases-caseqa-eval.ts`, before the `console.log("✅ …")` line:

```ts
  const { buildFaithfulnessPrompt, parseVerdict, buildAddressedPrompt, parseAddressed } =
    await import("../src/lib/cases/caseqa-eval/judge");

  // --- parseVerdict: the four verdicts, tolerant of wrapping, null on garbage ------
  {
    assert.equal(parseVerdict('{"verdict":"supported"}'), "supported");
    assert.equal(parseVerdict('{"verdict":"overstated"}'), "overstated");
    assert.equal(parseVerdict('{"verdict":"contradicted"}'), "contradicted");
    assert.equal(parseVerdict('{"verdict":"unrelated"}'), "unrelated");
    // Models wrap JSON in prose and fences; both must survive.
    assert.equal(parseVerdict('Here is my answer:\n```json\n{"verdict": "SUPPORTED"}\n```'), "supported");
    assert.equal(parseVerdict('{"reason":"...","verdict":"contradicted"}'), "contradicted");
    // Unparseable must be null, NOT a default verdict — a silent default would count a
    // judge failure as evidence about the product.
    assert.equal(parseVerdict("I cannot tell."), null);
    assert.equal(parseVerdict('{"verdict":"mostly ok"}'), null);
    assert.equal(parseVerdict(""), null);
  }

  // --- parseAddressed: boolean, null on garbage -----------------------------------
  {
    assert.equal(parseAddressed('{"addressed":true}'), true);
    assert.equal(parseAddressed('{"addressed":false}'), false);
    assert.equal(parseAddressed('```json\n{"addressed": false}\n```'), false);
    assert.equal(parseAddressed("maybe"), null);
    assert.equal(parseAddressed('{"addressed":"yes"}'), null);
  }

  // --- prompts carry what they must ------------------------------------------------
  {
    const f = buildFaithfulnessPrompt("The Crown had to consult first.", "The Crown must consult in good faith before issuing.");
    assert.ok(f.includes("The Crown had to consult first."));
    assert.ok(f.includes("The Crown must consult in good faith before issuing."));
    ["supported", "overstated", "contradicted", "unrelated"].forEach((v) =>
      assert.ok(f.includes(v), `the prompt must name the ${v} verdict`));

    const a = buildAddressedPrompt("Can they take my land?", "Nation v Canada", "[para 1] Something about fishing.");
    assert.ok(a.includes("Can they take my land?"));
    assert.ok(a.includes("[para 1] Something about fishing."));
    assert.ok(/addressed/.test(a), "the prompt must ask for the `addressed` field");
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/caseqa-eval/judge'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/cases/caseqa-eval/judge.ts`:

```ts
// The only LLM-judged part of this instrument, kept deliberately narrow: given ONE
// published sentence and ONE paragraph, is the sentence supported? That is a local
// entailment question, not open-ended legal judgment.
//
// Judged against the PARAGRAPH, not the model's quote, for two reasons (spec §6): the
// quote is discarded by design (CitationAnchor has no quote field), and the paragraph is
// what the product's link shows the reader. It is therefore more permissive than judging
// against the quote — a sentence supported by a DIFFERENT sentence of the same paragraph
// passes — and that is recorded as a limitation rather than hidden.

export type Verdict = "supported" | "overstated" | "contradicted" | "unrelated";
const VERDICTS: readonly Verdict[] = ["supported", "overstated", "contradicted", "unrelated"];

// Shared JSON extraction: models wrap output in prose and code fences.
function firstJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

// null means THE JUDGE FAILED, and callers must count it separately. Returning a default
// verdict would turn a parse failure into evidence about the product.
export function parseVerdict(raw: string): Verdict | null {
  const j = firstJson(raw);
  const v = typeof j?.verdict === "string" ? j.verdict.trim().toLowerCase() : "";
  return (VERDICTS as readonly string[]).includes(v) ? (v as Verdict) : null;
}

export function parseAddressed(raw: string): boolean | null {
  const j = firstJson(raw);
  return typeof j?.addressed === "boolean" ? j.addressed : null;
}

export function buildFaithfulnessPrompt(claimText: string, paragraphText: string): string {
  return `You are checking one sentence from a legal-information website against the court paragraph it cites.

SENTENCE:
${claimText}

PARAGRAPH IT CITES:
${paragraphText}

Choose exactly one verdict:
- "supported" — the paragraph says this, allowing for plain-language rewording.
- "overstated" — directionally right, but the sentence drops a qualifier, or asserts more certainty or breadth than the paragraph does.
- "contradicted" — the sentence says something the paragraph denies or reverses.
- "unrelated" — the paragraph does not address what the sentence claims.

Judge ONLY against the paragraph above. Do not use outside legal knowledge.

Output STRICTLY this JSON, no markdown:
{"verdict":"supported|overstated|contradicted|unrelated"}`;
}

export function buildAddressedPrompt(question: string, styleOfCause: string, body: string): string {
  return `Decide whether a court decision addresses a question. This is a screening step: we need to know if the decision contains material an answer could be drawn from.

QUESTION:
${question}

DECISION (${styleOfCause}), as paragraphs:
${body}

Answer true only if the decision contains material that genuinely bears on the question. Topical adjacency is not enough.

Output STRICTLY this JSON, no markdown:
{"addressed":true|false}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: `✅ test-cases-caseqa-eval passed`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit 0

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/caseqa-eval/judge.ts scripts/test-cases-caseqa-eval.ts
git commit -m "feat(caseqa-eval): faithfulness and addressedness prompts with strict parsing"
```

---

## Task 4: Metrics and reconciliation

**Files:**
- Create: `src/lib/cases/caseqa-eval/metrics.ts`
- Modify: `scripts/test-cases-caseqa-eval.ts` (append before the final `console.log`)

- [ ] **Step 1: Write the failing test**

Insert into `scripts/test-cases-caseqa-eval.ts`, before the `console.log("✅ …")` line:

```ts
  const { score } = await import("../src/lib/cases/caseqa-eval/metrics");

  // --- the four metrics on a hand-built population --------------------------------
  {
    const records: EvalRecord[] = [
      // answered, cited the target -> responsive
      { kind: "answerable", caseId: "c1", qid: "q1", targetParagraph: "para-5",
        outcome: "answered", citedParagraphs: ["para-5", "para-6"], droppedClaims: 0,
        claims: [{ text: "a", sourceParagraph: "para-5", verdict: "supported" },
                 { text: "b", sourceParagraph: "para-6", verdict: "overstated" }] },
      // answered, missed the target -> not responsive
      { kind: "answerable", caseId: "c2", qid: "q2", targetParagraph: "para-9",
        outcome: "answered", citedParagraphs: ["para-2"], droppedClaims: 1,
        claims: [{ text: "c", sourceParagraph: "para-2", verdict: "contradicted" }] },
      // refused a question we know is answerable -> false refusal
      { kind: "answerable", caseId: "c3", qid: "q3", targetParagraph: "para-1",
        outcome: "refused", failKind: "not_addressed", citedParagraphs: [], claims: [],
        droppedClaims: 0 },
      // errored -> excluded from every rate, reported separately
      { kind: "answerable", caseId: "c4", qid: "q4", targetParagraph: "para-1",
        outcome: "errored", citedParagraphs: [], claims: [], droppedClaims: 0 },
      // unanswerable, correctly refused
      { kind: "unanswerable", caseId: "c5", qid: "q1x", outcome: "refused",
        failKind: "not_addressed", claims: [], droppedClaims: 0 },
      // unanswerable, answered anyway -> false answer
      { kind: "unanswerable", caseId: "c6", qid: "q2x", outcome: "answered", droppedClaims: 0,
        claims: [{ text: "d", sourceParagraph: "para-3", verdict: null }] },
    ];

    const m = score(records);

    assert.equal(m.answerable.attempted, 4);
    assert.equal(m.answerable.answered, 2);
    assert.equal(m.answerable.refused, 1);
    assert.equal(m.answerable.errored, 1);
    assert.equal(m.answerable.responsive, 1);
    assert.equal(m.answerable.responsivenessAtPara, 0.5, "1 of 2 answered cited the target");
    // Rates exclude `errored`: a network failure is not a refusal. Denominator is 2+1=3.
    assert.ok(Math.abs(m.answerable.falseRefusalRate - 1 / 3) < 1e-9,
      `falseRefusalRate must exclude errored, got ${m.answerable.falseRefusalRate}`);
    assert.deepEqual(m.answerable.failKinds, { not_addressed: 1 });

    assert.equal(m.unanswerable.attempted, 2);
    assert.equal(m.unanswerable.falseAnswerRate, 0.5);

    // Faithfulness spans BOTH buckets, and `null` is counted as unparsed, never as a verdict.
    assert.equal(m.faithfulness.judged, 3, "4 claims, 1 unparsed");
    assert.equal(m.faithfulness.unparsed, 1);
    assert.deepEqual(m.faithfulness.counts,
      { supported: 1, overstated: 1, contradicted: 1, unrelated: 0 });
    assert.ok(Math.abs(m.faithfulness.supportedRate - 1 / 3) < 1e-9);
  }

  // --- reconciliation throws rather than printing a wrong table --------------------
  {
    const bad = [{ kind: "answerable", caseId: "c1", qid: "q1", targetParagraph: "para-1",
      outcome: "teleported", citedParagraphs: [], claims: [], droppedClaims: 0 }] as unknown as EvalRecord[];
    assert.throws(() => score(bad), /reconcil|outcome/i,
      "an unknown outcome must abort, not vanish from the denominator");
  }

  // --- empty population is an error, not a scorecard of zeros ----------------------
  {
    assert.throws(() => score([]), /no records/i,
      "cases-eval.ts once printed all-zero rows and exited 0; that must not recur");
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/caseqa-eval/metrics'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/cases/caseqa-eval/metrics.ts`:

```ts
// Pure scoring. Every denominator is stated in a comment beside it, because the difference
// between "of those attempted" and "of those decided" is the difference between two
// defensible numbers and one misleading one.
import type { Verdict } from "./judge";

export type Outcome = "answered" | "refused" | "errored";

export interface ClaimRecord {
  text: string;
  sourceParagraph: string;
  // null means the JUDGE failed to return a parseable verdict — counted as `unparsed`,
  // never folded into a verdict bucket.
  verdict: Verdict | null;
}

export interface AnswerableRecord {
  kind: "answerable";
  caseId: string; qid: string;
  targetParagraph: string;       // ground truth by construction
  outcome: Outcome;
  failKind?: string;             // when refused
  citedParagraphs: string[];     // when answered
  claims: ClaimRecord[];
  droppedClaims: number;
  bestOverlap?: number;
}

export interface UnanswerableRecord {
  kind: "unanswerable";
  caseId: string; qid: string;
  outcome: Outcome;
  failKind?: string;
  claims: ClaimRecord[];
  droppedClaims: number;
}

export type EvalRecord = AnswerableRecord | UnanswerableRecord;

export interface BucketMetrics {
  attempted: number; answered: number; refused: number; errored: number;
  failKinds: Record<string, number>;
}
export interface Metrics {
  answerable: BucketMetrics & { responsive: number; responsivenessAtPara: number; falseRefusalRate: number };
  unanswerable: BucketMetrics & { falseAnswerRate: number };
  faithfulness: { judged: number; unparsed: number; counts: Record<Verdict, number>; supportedRate: number };
  droppedClaims: number;
}

const emptyBucket = (): BucketMetrics =>
  ({ attempted: 0, answered: 0, refused: 0, errored: 0, failKinds: {} });

function tally(b: BucketMetrics, r: EvalRecord) {
  b.attempted++;
  if (r.outcome === "answered") b.answered++;
  else if (r.outcome === "refused") b.refused++;
  else if (r.outcome === "errored") b.errored++;
  else throw new Error(`unknown outcome ${JSON.stringify(r.outcome)} on ${r.qid} — refusing to reconcile`);
  if (r.failKind) b.failKinds[r.failKind] = (b.failKinds[r.failKind] ?? 0) + 1;
}

export function score(records: readonly EvalRecord[]): Metrics {
  if (!records.length) throw new Error("no records — this run measured nothing, refusing to print a scorecard");

  const answerable = emptyBucket(), unanswerable = emptyBucket();
  let responsive = 0, droppedClaims = 0, unparsed = 0;
  const counts: Record<Verdict, number> = { supported: 0, overstated: 0, contradicted: 0, unrelated: 0 };

  for (const r of records) {
    droppedClaims += r.droppedClaims;
    for (const c of r.claims) {
      if (c.verdict === null) unparsed++;
      else counts[c.verdict]++;
    }
    if (r.kind === "answerable") {
      tally(answerable, r);
      // Responsive means the target is AMONG the cited paragraphs. Not "only" the target:
      // an answer that also cites neighbours is fuller, not wrong, and exclusivity would
      // penalise it for a failure mode we are not measuring.
      if (r.outcome === "answered" && r.citedParagraphs.includes(r.targetParagraph)) responsive++;
    } else tally(unanswerable, r);
  }

  for (const [name, b] of [["answerable", answerable], ["unanswerable", unanswerable]] as const) {
    if (b.answered + b.refused + b.errored !== b.attempted) {
      throw new Error(`${name}: ${b.answered}+${b.refused}+${b.errored} does not reconcile with ${b.attempted} attempted`);
    }
  }

  // `decided` excludes errored: a call that failed to complete is not a product judgment.
  const decidedA = answerable.answered + answerable.refused;
  const decidedU = unanswerable.answered + unanswerable.refused;
  const judged = counts.supported + counts.overstated + counts.contradicted + counts.unrelated;

  return {
    answerable: { ...answerable, responsive,
      // of ANSWERED, not of attempted: a refusal cannot cite anything.
      responsivenessAtPara: answerable.answered ? responsive / answerable.answered : 0,
      falseRefusalRate: decidedA ? answerable.refused / decidedA : 0 },
    unanswerable: { ...unanswerable,
      falseAnswerRate: decidedU ? unanswerable.answered / decidedU : 0 },
    faithfulness: { judged, unparsed, counts,
      // of JUDGED, not of all claims: an unparsed verdict is our failure, not the model's.
      supportedRate: judged ? counts.supported / judged : 0 },
    droppedClaims,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: `✅ test-cases-caseqa-eval passed`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit 0

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/caseqa-eval/metrics.ts scripts/test-cases-caseqa-eval.ts
git commit -m "feat(caseqa-eval): four metrics with stated denominators and reconciliation"
```

---

## Task 5: Guards as testable units

Spec §11: *"Every guard in §7 covered by a test that fails when the guard is removed."* Guards 2, 3 and 4 are already tested in Tasks 2 and 4. Guards 1 and 5 would live inside the I/O runner, where they cannot be, so they become pure functions here.

**Files:**
- Create: `src/lib/cases/caseqa-eval/guards.ts`
- Modify: `scripts/test-cases-caseqa-eval.ts` (append before the final `console.log`)

- [ ] **Step 1: Write the failing test**

Insert into `scripts/test-cases-caseqa-eval.ts`, before the `console.log("✅ …")` line:

```ts
  const { assertDistinctModels, formatProvenance } = await import("../src/lib/cases/caseqa-eval/guards");

  // --- guard 1: three distinct models ---------------------------------------------
  {
    assert.doesNotThrow(() => assertDistinctModels({ writer: "a", answerer: "b", judge: "c" }));
    // The two that matter: a model judging its own output, and a model answering its own question.
    assert.throws(() => assertDistinctModels({ writer: "a", answerer: "b", judge: "b" }),
      /distinct/i, "judge must not equal answerer");
    assert.throws(() => assertDistinctModels({ writer: "a", answerer: "a", judge: "c" }),
      /distinct/i, "writer must not equal answerer");
    assert.throws(() => assertDistinctModels({ writer: "a", answerer: "a", judge: "a" }), /distinct/i);
    // The error must name the roles, or a failed run is a puzzle.
    assert.throws(() => assertDistinctModels({ writer: "x", answerer: "x", judge: "c" }),
      /writer.*answerer|answerer.*writer/i);
  }

  // --- guard 5: provenance names the models and every count -----------------------
  {
    const p = formatProvenance({
      writer: "W-1", answerer: "A-1", judge: "J-1", seed: 7,
      casesWithChunks: 500, targets: 40, built: 38, gimmes: 1, writerFails: 1,
      pairs: 18, discardedPairs: 2, addressedFails: 1,
    });
    ["W-1", "A-1", "J-1", "7", "500", "40", "38", "18"].forEach((s) =>
      assert.ok(p.includes(s), `provenance must include ${s}`));
    // The discard counts are the ones a reader needs to see a set that silently shrank.
    assert.ok(/gimme/i.test(p) && /discard/i.test(p), "discard reasons must be named, not just counted");
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/caseqa-eval/guards'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/cases/caseqa-eval/guards.ts`:

```ts
// Guards 1 and 5 from spec §7, as pure functions so each can have a test that fails when
// the guard is removed. A guard buried in an I/O runner cannot have one, and this project
// has already shipped a runner that printed a full scorecard of zeros and exited 0.

export interface ModelRoles { writer: string; answerer: string; judge: string }

// A model grading its own output measures self-consistency; a model answering its own
// question measures nothing at all. Names the colliding roles, because "not distinct" on
// its own sends the reader back to the env vars to work out which.
export function assertDistinctModels(m: ModelRoles): void {
  const pairs: [keyof ModelRoles, keyof ModelRoles][] = [["writer", "answerer"], ["writer", "judge"], ["answerer", "judge"]];
  const clashes = pairs.filter(([a, b]) => m[a] === m[b]).map(([a, b]) => `${a}=${b}`);
  if (clashes.length) {
    throw new Error(`writer, answerer and judge must be three distinct models — collision(s): ${clashes.join(", ")} ` +
      `(writer=${m.writer} answerer=${m.answerer} judge=${m.judge})`);
  }
}

export interface Provenance extends ModelRoles {
  seed: number;
  casesWithChunks: number; targets: number;
  built: number; gimmes: number; writerFails: number;
  pairs: number; discardedPairs: number; addressedFails: number;
}

// Printed BEFORE any metric. Every discard is named as well as counted: a question set that
// shrank from 40 to 12 produces perfectly well-formed percentages, and the only way a reader
// can tell is if the shrinkage is on the page next to them.
export function formatProvenance(p: Provenance): string {
  return [
    ``,
    `writer   ${p.writer}`,
    `answerer ${p.answerer}`,
    `judge    ${p.judge}`,
    `seed ${p.seed} · core cases with chunks ${p.casesWithChunks} · targets ${p.targets}`,
    `questions built ${p.built} · rejected as lexical gimmes ${p.gimmes} · writer returned nothing ${p.writerFails}`,
    `unanswerable pairs ${p.pairs} · discarded ${p.discardedPairs} (unparseable screen ${p.addressedFails})`,
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: `✅ test-cases-caseqa-eval passed`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit 0

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/caseqa-eval/guards.ts scripts/test-cases-caseqa-eval.ts
git commit -m "feat(caseqa-eval): model-distinctness and provenance guards as pure units"
```

---

## Task 6: Runner and npm scripts

**Files:**
- Create: `scripts/cases-caseqa-eval.ts`
- Modify: `package.json` (add two scripts after the `cases:anchor-signals*` pair)

- [ ] **Step 1: Write the runner**

Create `scripts/cases-caseqa-eval.ts`:

```ts
// Answer-quality evaluation for "Ask this judgment" (spec 2026-08-03).
//
// Known-answer construction: pick a target paragraph, have one model write a lay question
// it answers, have the PRODUCT answer that question, then have a THIRD model judge whether
// each published sentence is supported by the paragraph it cites. Three of the four metrics
// are objective because the target paragraph is ground truth by construction.
//
// Needs DynamoDB read + Bedrock. Writes nothing to the table.
import "./fetch-polyfill";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { modelFromId, cachedModel } from "../src/lib/cases/ingest/llm";
import { assembleInput } from "../src/lib/cases/ingest/summarizer";
import { answerCaseQuestion } from "../src/lib/cases/caseqa/generator";
import { pickTargets, buildQuestionPrompt, isLexicalGimme } from "../src/lib/cases/caseqa-eval/construct";
import { buildFaithfulnessPrompt, parseVerdict, buildAddressedPrompt, parseAddressed } from "../src/lib/cases/caseqa-eval/judge";
import { score, type EvalRecord, type ClaimRecord } from "../src/lib/cases/caseqa-eval/metrics";
import { assertDistinctModels, formatProvenance } from "../src/lib/cases/caseqa-eval/guards";

const SEED = Number(process.env.EVAL_SEED ?? 1);
const N_ANSWERABLE = Number(process.env.EVAL_ANSWERABLE ?? 40);
const N_UNANSWERABLE = Number(process.env.EVAL_UNANSWERABLE ?? 20);

const WRITER = process.env.EVAL_WRITER_MODEL ?? "us.anthropic.claude-3-5-sonnet-20241022-v2:0";
const ANSWERER = process.env.EVAL_ANSWER_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";
const JUDGE = process.env.EVAL_JUDGE_MODEL ?? "us.anthropic.claude-3-7-sonnet-20250219-v1:0";

async function main() {
  // Guard 1 (spec §7), in guards.ts so it has a test.
  assertDistinctModels({ writer: WRITER, answerer: ANSWERER, judge: JUDGE });
  // Construction and judging are cached so re-running after an ANSWERER change replays the
  // same questions and the same verdicts. The answerer is deliberately uncached — it is the
  // thing under measurement.
  const writer = cachedModel(modelFromId(WRITER));
  const judge = cachedModel(modelFromId(JUDGE));
  const answerer = modelFromId(ANSWERER);

  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  const cases = [];
  for (const p of profiles) {
    const c = await dynamoCaseRepo.getCase(p.id);
    if (c?.chunks?.length) cases.push(c);
  }
  // Guard 3: an empty population is an error. cases-eval.ts printed a full scorecard of
  // zeros and exited 0 on 2026-08-02.
  if (!cases.length) throw new Error("no core case has chunks — this run would measure nothing");

  const targets = pickTargets(cases, SEED, N_ANSWERABLE);
  const byId = new Map(cases.map((c) => [c.id, c]));

  // --- construct questions -------------------------------------------------------
  let gimmes = 0, writerFails = 0;
  const built: { caseId: string; qid: string; question: string; targetParagraph: string }[] = [];
  for (const t of targets) {
    const c = byId.get(t.caseId)!;
    const question = (await writer.call(buildQuestionPrompt(c, t))).trim();
    if (!question) { writerFails++; continue; }
    // Guard 2: a verbatim run would let the retriever win on string overlap.
    if (isLexicalGimme(question, t.text)) { gimmes++; continue; }
    built.push({ caseId: t.caseId, qid: `ans-${built.length + 1}`, question, targetParagraph: t.paragraph });
  }
  if (!built.length) throw new Error("every constructed question was rejected — nothing to measure");

  // --- pair unanswerables, then VALIDATE them (spec §5) --------------------------
  let discardedPairs = 0, addressedFails = 0;
  const pairs: { caseId: string; qid: string; question: string }[] = [];
  for (const b of built.slice(0, N_UNANSWERABLE)) {
    const other = built.find((x) => x.caseId !== b.caseId && !pairs.some((p) => p.caseId === x.caseId));
    if (!other) continue;
    const target = byId.get(other.caseId)!;
    const raw = await judge.call(buildAddressedPrompt(b.question, target.styleOfCause,
      assembleInput(target.chunks!, target.outcome.holding)));
    const addressed = parseAddressed(raw);
    // Unparseable or genuinely addressed: DISCARD, do not count as either bucket.
    // Counting an addressed pair as unanswerable would inflate false-answer rate with
    // correct answers.
    if (addressed === null) { addressedFails++; discardedPairs++; continue; }
    if (addressed) { discardedPairs++; continue; }
    pairs.push({ caseId: other.caseId, qid: `un-${pairs.length + 1}`, question: b.question });
  }

  // --- ask the product, then judge each published claim --------------------------
  const judgeClaims = async (c: { chunks?: { paragraph: string; text: string }[] }, claims: { text: string; sourceParagraph: string }[]) => {
    const out: ClaimRecord[] = [];
    for (const cl of claims) {
      const para = (c.chunks ?? []).find((ch) => ch.paragraph === cl.sourceParagraph);
      // An anchor pointing at a paragraph that is not in chunks would be a product bug,
      // not a faithfulness question. Surface it rather than scoring it.
      if (!para) throw new Error(`anchor cites ${cl.sourceParagraph}, absent from chunks`);
      out.push({ text: cl.text, sourceParagraph: cl.sourceParagraph,
        verdict: parseVerdict(await judge.call(buildFaithfulnessPrompt(cl.text, para.text))) });
    }
    return out;
  };

  const records: EvalRecord[] = [];
  for (const b of built) {
    const c = byId.get(b.caseId)!;
    try {
      const r = await answerCaseQuestion(c, c.chunks!, b.question, answerer);
      if (r.status === "done") {
        records.push({ kind: "answerable", caseId: b.caseId, qid: b.qid, targetParagraph: b.targetParagraph,
          outcome: "answered", citedParagraphs: r.answer.claims.map((x) => x.sourceParagraph),
          claims: await judgeClaims(c, r.answer.claims), droppedClaims: r.dropped });
      } else {
        records.push({ kind: "answerable", caseId: b.caseId, qid: b.qid, targetParagraph: b.targetParagraph,
          outcome: "refused", failKind: r.failKind, citedParagraphs: [], claims: [],
          droppedClaims: 0, bestOverlap: r.bestOverlap });
      }
    } catch (e) {
      console.warn(`   ⚠ ${b.qid} errored: ${e instanceof Error ? e.message : String(e)}`);
      records.push({ kind: "answerable", caseId: b.caseId, qid: b.qid, targetParagraph: b.targetParagraph,
        outcome: "errored", citedParagraphs: [], claims: [], droppedClaims: 0 });
    }
  }
  for (const p of pairs) {
    const c = byId.get(p.caseId)!;
    try {
      const r = await answerCaseQuestion(c, c.chunks!, p.question, answerer);
      if (r.status === "done") {
        records.push({ kind: "unanswerable", caseId: p.caseId, qid: p.qid, outcome: "answered",
          claims: await judgeClaims(c, r.answer.claims), droppedClaims: r.dropped });
      } else {
        records.push({ kind: "unanswerable", caseId: p.caseId, qid: p.qid, outcome: "refused",
          failKind: r.failKind, claims: [], droppedClaims: 0 });
      }
    } catch (e) {
      console.warn(`   ⚠ ${p.qid} errored: ${e instanceof Error ? e.message : String(e)}`);
      records.push({ kind: "unanswerable", caseId: p.caseId, qid: p.qid, outcome: "errored",
        claims: [], droppedClaims: 0 });
    }
  }

  // --- Guard 5: provenance BEFORE the metrics ------------------------------------
  console.log(formatProvenance({
    writer: WRITER, answerer: ANSWERER, judge: JUDGE, seed: SEED,
    casesWithChunks: cases.length, targets: targets.length,
    built: built.length, gimmes, writerFails,
    pairs: pairs.length, discardedPairs, addressedFails,
  }));
  console.log(`(requested ${N_ANSWERABLE} answerable / ${N_UNANSWERABLE} unanswerable)`);

  const m = score(records);
  console.log(`\n--- answerable (target paragraph known by construction) ---`);
  console.log(`  attempted ${m.answerable.attempted} · answered ${m.answerable.answered}` +
    ` · refused ${m.answerable.refused} · errored ${m.answerable.errored}`);
  console.log(`  responsiveness@para  ${(m.answerable.responsivenessAtPara * 100).toFixed(1)}%` +
    `  (${m.answerable.responsive}/${m.answerable.answered} answered cited the target)`);
  console.log(`  false-refusal rate   ${(m.answerable.falseRefusalRate * 100).toFixed(1)}%` +
    `  (of answered+refused; errored excluded)`);
  console.log(`  failKinds ${JSON.stringify(m.answerable.failKinds)}`);
  // Spec §4: bestOverlap conditions the `unverifiable` count. A refusal at 0.94 is a
  // near-miss the guard declined; one at 0.10 is the model not quoting the judgment at all,
  // and the two should never be read as the same failure.
  const unver = records.filter((r): r is Extract<EvalRecord, { kind: "answerable" }> =>
    r.kind === "answerable" && r.failKind === "unverifiable" && r.bestOverlap !== undefined);
  if (unver.length) {
    const os = unver.map((r) => r.bestOverlap!).sort((a, b) => a - b);
    const med = os[Math.floor(os.length / 2)];
    console.log(`  unverifiable bestOverlap (n=${os.length}): min ${os[0].toFixed(2)}` +
      ` · median ${med.toFixed(2)} · max ${os[os.length - 1].toFixed(2)}`);
  }

  console.log(`\n--- unanswerable (cross-case; correct behaviour is refusal) ---`);
  console.log(`  attempted ${m.unanswerable.attempted} · answered ${m.unanswerable.answered}` +
    ` · refused ${m.unanswerable.refused} · errored ${m.unanswerable.errored}`);
  console.log(`  false-answer rate    ${(m.unanswerable.falseAnswerRate * 100).toFixed(1)}%`);
  console.log(`  failKinds ${JSON.stringify(m.unanswerable.failKinds)}`);

  console.log(`\n--- faithfulness (LLM-judged, against the cited paragraph) ---`);
  console.log(`  judged ${m.faithfulness.judged} claims · unparsed verdicts ${m.faithfulness.unparsed}`);
  console.log(`  ${JSON.stringify(m.faithfulness.counts)}`);
  console.log(`  supported ${(m.faithfulness.supportedRate * 100).toFixed(1)}% of judged`);
  console.log(`  CONTRADICTED ${m.faithfulness.counts.contradicted} — this is the count that must be zero`);
  console.log(`\n  claims dropped by verifyClaims across all answers: ${m.droppedClaims}`);
}
main().catch((e) => { console.error("❌ cases-caseqa-eval failed:", e instanceof Error ? e.message : String(e)); process.exit(1); });
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit 0

- [ ] **Step 3: Add the npm scripts**

In `package.json`, immediately after the `"cases:anchor-signals:cloud"` entry, add:

```json
    "cases:caseqa-eval": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-caseqa-eval.ts",
    "cases:caseqa-eval:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-caseqa-eval.ts",
```

- [ ] **Step 4: Verify the guards fire, without spending Bedrock calls**

Run: `npx cross-env EVAL_JUDGE_MODEL=us.meta.llama3-3-70b-instruct-v1:0 CASES_TABLE=LegalCases REPO_IMPL=dynamo AWS_REGION=us-east-1 tsx scripts/cases-caseqa-eval.ts`
Expected: exits 1 with `❌ cases-caseqa-eval failed: writer, answerer and judge must be three distinct models — collision(s): answerer=judge …` — the guard aborts before any AWS call, which is why this verification is free.

- [ ] **Step 5: Confirm package.json is still valid JSON**

Run: `node -e "console.log(Object.keys(require('./package.json').scripts).filter(k=>k.startsWith('cases:caseqa')))"`
Expected: `[ 'cases:caseqa-eval', 'cases:caseqa-eval:cloud' ]`

- [ ] **Step 6: Commit**

```bash
git add scripts/cases-caseqa-eval.ts package.json
git commit -m "feat(caseqa-eval): runner with model-distinctness, gimme and population guards"
```

---

## Task 7: Full offline test pass and branch hygiene

**Files:**
- Modify: none expected

- [ ] **Step 1: Run every test suite that touches what this branch changed**

```bash
npx tsx scripts/test-cases-caseqa-eval.ts && npx tsx scripts/test-cases-summarizer.ts
```
Expected: both print their `✅ … passed` line. `test-cases-summarizer.ts` must still pass — this branch imports `normWs`, `longestCommonSubstringLen` and `assembleInput` from the summarizer but must not modify it.

- [ ] **Step 2: Confirm the product path was not modified**

```bash
git diff --stat origin/main...HEAD -- src/lib/cases/caseqa/ src/lib/cases/ingest/
```
Expected: **empty output.** This instrument observes the product; if either directory shows changes, the isolation the spec promises has been broken.

- [ ] **Step 3: Typecheck and build**

```bash
npx tsc --noEmit -p tsconfig.json && npm run build
```
Expected: both exit 0. `build` is included because CI runs it and nothing else.

- [ ] **Step 4: Commit any fixes**

```bash
git commit -am "fix(caseqa-eval): address full-suite findings" || echo "nothing to fix"
```

---

## Not in this plan

- **Running the measurement.** Needs credentials and ~450 Bedrock calls; it is an ops step after merge, and its output becomes `docs/research/2026-08-03-answer-quality-results.md`.
- **The findings doc.** Written from the real run, and per the pattern of the three preceding forensics reports it will **recommend nothing**.
- **Expanding the retrieval eval (RM-3 sub-project A)** and **the 15-row decline adjudication (sub-project C)** — separate specs.
- **Any change to `src/lib/cases/caseqa/`.** Out of scope by design; Task 6 Step 2 enforces it.
