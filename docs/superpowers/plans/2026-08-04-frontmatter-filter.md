# Two-Stage Target Eligibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the answer-quality instrument from building questions out of case captions, party lists, tables of contents, solicitors' registers and lists of authorities.

**Architecture:** Two eligibility stages. Stage 1 is a deterministic shape test (average line length ≥200) inside the existing `pickTargets`; stage 2 is one cached judge call per surviving candidate. Every rejection reason gets its own counter in the provenance line, and the chosen targets are printed so a bad sample is visible instead of silent.

**Tech Stack:** TypeScript (strict), `tsx`, `node:assert/strict`, Bedrock via the existing `LlmModel` abstraction.

**Spec:** `docs/superpowers/specs/2026-08-03-answer-quality-eval-design.md` — §3 "Target eligibility — two stages (2026-08-04 amendment)", §7 guards 6 and 7, §8 final bullet.

---

## Why this exists

The first smoke run built a question from `2002-bcsc-1199 para-1`, which is the docket caption: citation line, party names, registry, no substantive content. The writer composed a lay question from it, the product answered citing it, and the judge rated two of the resulting claims `supported`. **Nothing in the chain could tell it was processing a case header.** The existing ≥300-character floor screens out `"Appeal dismissed."` but not a long caption block.

The bug was invisible for one reason: nothing printed what the instrument had picked. That is why guard 7 exists.

## Facts the implementer needs

Verified on this branch; do not re-derive.

- **`npm test` does not exist and CI runs only `typecheck` and `build`.** Run suites yourself: `npx tsx scripts/test-cases-caseqa-eval.ts`. A failing test will NOT be caught by CI.
- **Current state:** `npx tsc --noEmit -p tsconfig.json` exits 0 and `npx tsx scripts/test-cases-caseqa-eval.ts` prints `✅ test-cases-caseqa-eval passed`. Keep both true.
- **The threshold is measured, not chosen by feel.** Across six judgments, average line length (`text.length / non-empty-line-count`) separates cleanly:

  | | avg line length | examples |
  |---|---|---|
  | front/back matter | 25–131 | caption `2008-scc-41` chunk 0 (52 lines, 37) · party list `2024-scc-39` chunk 1 (98) · counsel list `2021-onca-779` chunk 1 (**131**, the closest to the threshold) · table of contents `2021-onca-779` chunk 2 (74 lines, 25) |
  | body prose | 292–2042 | `2004-bcsc-142` chunk 19 (7 lines, **292**, the closest to the threshold) · `2013-bcca-326` chunk 179 (332) · `2002-bcsc-1199` chunk 1 (989) · `2008-scc-41` chunk 34 (2042) |

  200 sits inside the 131–292 gap. **Tuned to avoid false rejections**, because stage 2 is the backstop and discarding good body prose costs sample size for nothing.
- **Two signals were measured and rejected.** Do not reintroduce them: front-matter keywords fail in both directions (`2008-scc-41` chunk 34 and `2024-scc-39` chunk 2 are body reasoning and match; `2021-onca-779` chunk 2 is a table of contents and does not), and sentence density does not separate at all (front matter 6–9 per 1,000 chars, body 6–17).
- **Stage 1 cannot catch back matter**, which is long single lines: `2024-scc-39` chunk 148 is a 1,123-character solicitors' register, `2008-scc-41` chunk 68 is a 1,346-character list of authorities. Both clear stage 1. That is what stage 2 is for.
- **Existing signatures you will change:**
  ```ts
  export function pickTargets(cases: readonly CaseLike[], seed: number, count: number): Target[]   // construct.ts:38
  export interface Target { caseId: string; paragraph: string; text: string }                       // construct.ts:33
  export interface Provenance extends ModelRoles { … }                                              // guards.ts:19
  export function formatProvenance(p: Provenance): string                                           // guards.ts:43
  ```
- **The runner calls `pickTargets` at `scripts/cases-caseqa-eval.ts:94`** and `formatProvenance` at `:205`. The existing `pickTargets` test block is in `scripts/test-cases-caseqa-eval.ts` under the comment `--- pickTargets: honours the length floor, is seeded, one target per case ---`.
- **No backfill on rejection.** A rejected case is skipped, not substituted. This matches the existing documented behaviour for the character floor ("skipped rather than substituted, so the shortfall is visible") and keeps the sample a deterministic function of the seed rather than of the rejection rate.

## File Structure

| file | change |
|---|---|
| `src/lib/cases/caseqa-eval/construct.ts` | add `MIN_TARGET_AVG_LINE`, `isProseShaped`; `pickTargets` applies stage 1 and returns counts |
| `src/lib/cases/caseqa-eval/judge.ts` | add `buildSubstantivePrompt`, `parseSubstantive` (stage 2, pure) |
| `src/lib/cases/caseqa-eval/guards.ts` | three new `Provenance` counters + `formatChosenTargets` (guard 7) |
| `scripts/cases-caseqa-eval.ts` | run stage 2, print chosen targets, pass the new counters |
| `scripts/test-cases-caseqa-eval.ts` | tests for all of the above |

---

## Task 1: Stage 1 — the shape test, and rejection counts

**Files:**
- Modify: `src/lib/cases/caseqa-eval/construct.ts`
- Modify: `scripts/test-cases-caseqa-eval.ts`

- [ ] **Step 1: Write the failing test**

**Do NOT replace the existing `pickTargets` block wholesale.** It contains an assertion about per-case seeding that a previous implementer verified is load-bearing (they reverted the fix and confirmed the test fails). Instead:

**1a.** In the existing block under `// --- pickTargets: honours the length floor, is seeded, one target per case --------`, `pickTargets` now returns a `TargetDraw` rather than an array. Change **only** the call sites to read `.targets`, leaving every existing assertion and its message intact. There are four: the `const picked = …` line, the two `pickTargets(cases, 1, …)` comparisons, and the per-case-seed assertion at the end of the block. For the `deepEqual(pickTargets(cases, 1, 10), picked)` comparison, compare `.targets` on both sides so it still asserts what it did before.

**1b.** Add a new case to that block's `cases` fixture — a long paragraph with the wrong shape — plus the two counter assertions. Append inside the same block, after the existing assertions:

```ts
    // Stage 1: a chunk can clear the character floor and still be a caption. This fixture is
    // shaped like the real one that got through — 2002-bcsc-1199 para-1, a docket header.
    const caption = "Citation:\n" + Array.from({ length: 40 }, (_, i) => `Field ${i}: value`).join("\n");
    assert.ok(caption.length >= MIN_TARGET_PARA_CHARS, "the fixture must clear the char floor to be a real test");
    const withCaption = [...cases, { id: "cap", chunks: [{ paragraph: "para-1", text: caption }] }];
    const d2 = pickTargets(withCaption, 1, 10);
    assert.ok(!d2.targets.some((t) => t.caseId === "cap"), "a caption must never be chosen as a target");

    // The two skip reasons are counted SEPARATELY: "no long paragraph" is a fact about the
    // corpus, "long but wrong shape" is the front-matter filter doing its job. Merging them
    // would hide whether the shape threshold is throwing away real text.
    assert.equal(d2.rejectedByShape, 1, "the caption case");
    assert.ok(d2.noLongPara >= 1, "c3 has no paragraph over the floor");
```

**1c.** Add a new block for `isProseShaped`, immediately before the existing `pickTargets` block:

```ts
  // --- isProseShaped: the measured front-matter / body split ------------------------
  // Thresholds come from measuring six judgments, not from feel. Fixtures below reproduce
  // the two closest real cases on either side of the gap, so a change to the threshold
  // that would misclassify real corpus text fails here.
  {
    const { isProseShaped, MIN_TARGET_AVG_LINE } = await import("../src/lib/cases/caseqa-eval/construct");
    // Build text with an exact target average line length.
    const shaped = (lines: number, avg: number) =>
      Array.from({ length: lines }, () => "x".repeat(avg - 1)).join("\n");

    // Closest real FRONT matter: 2021-onca-779 chunk 1, a counsel list, avg 131.
    assert.equal(isProseShaped(shaped(13, 131)), false, "a counsel list at avg 131 must be rejected");
    // Closest real BODY prose: 2004-bcsc-142 chunk 19, 7 lines, avg 292.
    assert.equal(isProseShaped(shaped(7, 292)), true, "body prose at avg 292 must be accepted");
    // The extremes.
    assert.equal(isProseShaped(shaped(52, 37)), false, "a caption block (52 lines, avg 37) must be rejected");
    assert.equal(isProseShaped(shaped(74, 25)), false, "a table of contents (74 lines, avg 25) must be rejected");
    assert.equal(isProseShaped(shaped(1, 2042)), true, "a single long paragraph must be accepted");
    // Boundary, exactly at and just under.
    assert.equal(isProseShaped(shaped(1, MIN_TARGET_AVG_LINE + 1)), true, "at the threshold must pass");
    assert.equal(isProseShaped(shaped(10, MIN_TARGET_AVG_LINE - 50)), false, "under the threshold must fail");
    // Degenerate input must not throw or divide by zero.
    assert.equal(isProseShaped(""), false);
    assert.equal(isProseShaped("\n\n\n"), false, "no non-empty line means no prose");
  }
```

**Note on the existing fixture.** The current block builds eligible paragraphs with a helper like `long(MIN_TARGET_PARA_CHARS, "A")` producing a single unbroken run of characters. A single line of ≥300 characters has an average line length of ≥300, so it passes the new shape test unchanged and every existing assertion still holds. Verify that when you run the suite rather than assuming it — if any pre-existing assertion breaks, the fixture needs a line break removed, not the assertion changed.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: FAIL — `isProseShaped is not a function` (the import destructures a name that does not exist yet).

- [ ] **Step 3: Write the implementation**

In `src/lib/cases/caseqa-eval/construct.ts`, add after the `MIN_QUESTION_CHARS` block:

```ts
// Stage 1 of target eligibility (spec §3, 2026-08-04). Front and back matter are laid out as
// SHORT LINES — one field, party, counsel or table-of-contents entry per line — while body
// prose is long lines. Measured across six judgments: front/back matter 25-131, body 292-2042.
// 200 sits inside that gap.
//
// Deliberately tuned to avoid FALSE REJECTIONS rather than to catch everything, because the
// judged stage 2 is the backstop and throwing away real body prose costs sample size for
// nothing.
//
// Two other signals were measured and REJECTED — do not reintroduce them:
//  - front-matter keywords (Docket, Registry, BETWEEN, Coram, Counsel, ...) fail BOTH ways:
//    2008-scc-41 chunk 34 and 2024-scc-39 chunk 2 are body reasoning and match, while
//    2021-onca-779 chunk 2 is a table of contents and does not.
//  - sentence density does not separate at all: front matter 6-9 per 1,000 chars, body 6-17.
export const MIN_TARGET_AVG_LINE = 200;

// `filter(Boolean)` rather than a trim-based filter, matching EXACTLY how the corpus was
// measured — a whitespace-only line is counted, which lowers the average and therefore errs
// toward rejection. Changing this definition invalidates the thresholds above.
export function isProseShaped(text: string): boolean {
  const lines = text.split("\n").filter(Boolean);
  if (!lines.length) return false;
  return text.length / lines.length >= MIN_TARGET_AVG_LINE;
}
```

Then replace the `Target` interface's trailing area and `pickTargets` entirely with:

```ts
export interface Target { caseId: string; paragraph: string; text: string }

// Why the counts ride along instead of being recomputed by the runner: the two skip reasons
// are only distinguishable HERE, inside the loop that applies them. `noLongPara` is a fact
// about the corpus; `rejectedByShape` is the front-matter filter doing its job. Spec §7.6
// requires them apart, because if stage 1 starts rejecting most cases the threshold is wrong
// and that must be visible rather than absorbed into a shrunken sample.
export interface TargetDraw {
  targets: Target[];
  noLongPara: number;      // no paragraph reached MIN_TARGET_PARA_CHARS
  rejectedByShape: number; // had a long paragraph, none of them prose-shaped
}

// One target paragraph per case, for up to `count` cases. Cases with no eligible paragraph are
// skipped rather than substituted, so the shortfall is visible in the counts the runner prints
// instead of being quietly backfilled.
export function pickTargets(cases: readonly CaseLike[], seed: number, count: number): TargetDraw {
  const targets: Target[] = [];
  let noLongPara = 0, rejectedByShape = 0;
  // Case-level shuffle uses the bare `seed` (unchanged); the paragraph shuffle below is keyed
  // per-case (`i`, this case's position in that shuffled order).
  for (const [i, c] of seededShuffle(cases, seed).entries()) {
    if (targets.length >= count) break;
    const longEnough = (c.chunks ?? []).filter((ch) => ch.text.length >= MIN_TARGET_PARA_CHARS);
    if (!longEnough.length) { noLongPara++; continue; }
    // Stage 1: a long chunk can still be a caption, a party list or a table of contents.
    const eligible = longEnough.filter((ch) => isProseShaped(ch.text));
    if (!eligible.length) { rejectedByShape++; continue; }
    // Per-case seed, NOT the bare `seed`: a Fisher-Yates swap sequence for a given seed depends
    // only on the RNG stream and the array length, so reusing the same seed for every case's
    // paragraph shuffle meant every case with the SAME eligible-paragraph count picked the
    // paragraph at the SAME original index — zero within-group variance, and the number of
    // independent position draws collapsed to the number of distinct eligible-counts rather
    // than the number of cases. Offsetting by the case's own index makes each case's draw
    // independent while staying fully deterministic for a fixed `seed`.
    const ch = seededShuffle(eligible, seed + i + 1)[0];
    targets.push({ caseId: c.id, paragraph: ch.paragraph, text: ch.text });
  }
  return { targets, noLongPara, rejectedByShape };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: FAIL — but now in the RUNNER's typecheck, not the test. The test itself should reach `✅`. If the test still fails on an assertion, fix the implementation, not the test.

- [ ] **Step 5: Typecheck — expect exactly two runner errors**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors only in `scripts/cases-caseqa-eval.ts`, where `pickTargets(...)` is now a `TargetDraw` rather than an array (`targets.length`, and the `for (const t of targets)` loop). **This is expected at this task boundary** — Task 4 wires the runner. Do not fix the runner here and do not weaken the types to silence it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/caseqa-eval/construct.ts scripts/test-cases-caseqa-eval.ts
git commit -m "feat(caseqa-eval): stage-1 shape filter for target paragraphs

Average line length >=200, measured across six judgments: front and back matter
cluster at 25-131, body prose at 292-2042. Tuned to avoid false rejections since
the judged stage 2 is the backstop.

pickTargets now reports why it skipped a case — no long paragraph is a corpus fact,
long-but-wrong-shape is the filter working. Spec 7.6 needs them apart: if stage 1
starts rejecting most cases the threshold is wrong and that must be visible."
```

---

## Task 2: Stage 2 — the substance judge

**Files:**
- Modify: `src/lib/cases/caseqa-eval/judge.ts`
- Modify: `scripts/test-cases-caseqa-eval.ts`

- [ ] **Step 1: Write the failing test**

Insert into `scripts/test-cases-caseqa-eval.ts`, immediately after the existing `parseAddressed` test block:

```ts
  // --- parseSubstantive / buildSubstantivePrompt: stage 2 of target eligibility ------
  {
    const { buildSubstantivePrompt, parseSubstantive } =
      await import("../src/lib/cases/caseqa-eval/judge");

    assert.equal(parseSubstantive('{"substantive":true}'), true);
    assert.equal(parseSubstantive('{"substantive":false}'), false);
    assert.equal(parseSubstantive('```json\n{"substantive": false}\n```'), false, "fences must survive");
    assert.equal(parseSubstantive('{"reason":"caption","substantive":false}'), false);
    // Unparseable must be null and NEVER default. A judge failure that defaulted to `true`
    // would readmit exactly the front matter this stage exists to exclude; defaulting to
    // `false` would silently shrink the sample. Both are claims we have not earned.
    assert.equal(parseSubstantive("I think so"), null);
    assert.equal(parseSubstantive('{"substantive":"yes"}'), null, "a string is not a boolean");
    assert.equal(parseSubstantive(""), null);

    const p = buildSubstantivePrompt("The Crown must consult in good faith.", "Nation v Canada");
    assert.ok(p.includes("The Crown must consult in good faith."), "the passage must be present");
    assert.ok(p.includes("Nation v Canada"), "the case must be identified");
    assert.ok(/substantive/.test(p), "the prompt must ask for the `substantive` field");
    // The prompt must name the categories it is screening for, or the judge is guessing.
    ["caption", "counsel", "contents", "authorities"].forEach((k) =>
      assert.ok(new RegExp(k, "i").test(p), `the prompt must name ${k}`));
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: FAIL — `buildSubstantivePrompt is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/lib/cases/caseqa-eval/judge.ts`, add after `parseAddressed`:

```ts
// Stage 2 of target eligibility (spec §3, 2026-08-04). Stage 1's line-shape test cannot catch
// BACK matter, which is long single lines: 2024-scc-39 chunk 148 is a 1,123-character
// solicitors' register and 2008-scc-41 chunk 68 is a 1,346-character list of authorities. Both
// clear stage 1, and a lay question built from either fails the same way the caption did.
//
// A judged screen rather than more regexes: front and back matter formats vary by court, and
// this project has already measured keyword tests failing in both directions. It also mirrors
// what §5 does to validate unanswerable pairs.
export function parseSubstantive(raw: string): boolean | null {
  const j = firstJson(raw);
  return typeof j?.substantive === "boolean" ? j.substantive : null;
}

export function buildSubstantivePrompt(paragraphText: string, styleOfCause: string): string {
  return `You are screening one passage from a Canadian court decision, to decide whether a member of the public could be asked a question that this passage answers.

CASE: ${styleOfCause}

PASSAGE:
${paragraphText}

Answer true only if the passage is substantive reasoning, analysis, findings, or a statement of facts or law from the body of the decision.

Answer false if it is any kind of front or back matter:
- a caption or cover block (citation, docket or file number, registry, date, court name)
- a list of parties, intervenors, counsel, or solicitors
- a table of contents or index of headings
- a list of authorities, cases cited, or a bibliography
- a judges' panel, signature block, or "Reasons for Judgment of ..." line
- headnote or editorial summary material rather than the court's own text

Length is not the test — some of these run to several hundred words. Ask what the passage IS.

Output STRICTLY this JSON, no markdown:
{"substantive":true|false}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: the test reaches `✅ test-cases-caseqa-eval passed`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: still only the `scripts/cases-caseqa-eval.ts` errors from Task 1. No new ones.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/caseqa-eval/judge.ts scripts/test-cases-caseqa-eval.ts
git commit -m "feat(caseqa-eval): stage-2 substance screen for target paragraphs

Stage 1's line-shape test cannot catch back matter, which is long single lines: a
1,123-char solicitors' register and a 1,346-char list of authorities both clear it,
and a lay question built from either fails the way the caption did.

Judged rather than another regex, because front-matter formats vary by court and
keyword tests were already measured failing in both directions. Unparseable returns
null and never defaults: true would readmit the front matter this exists to exclude,
false would silently shrink the sample."
```

---

## Task 3: Provenance counters and the chosen-targets print

**Files:**
- Modify: `src/lib/cases/caseqa-eval/guards.ts`
- Modify: `scripts/test-cases-caseqa-eval.ts`

- [ ] **Step 1: Write the failing test**

In `scripts/test-cases-caseqa-eval.ts`, find the existing guard-5 provenance block and replace the `formatProvenance({...})` call's argument object and the assertion list with:

```ts
    const p = formatProvenance({
      writer: "W-1", answerer: "A-1", judge: "J-1", seed: 7, asOf: "2026-07-15",
      casesWithChunks: 500, targets: 40, built: 38, gimmes: 1, writerFails: 1, writerMalformed: 6,
      pairs: 18, discardedPairs: 2, addressedFails: 1,
      pairingExhausted: 3, targetDroppedByBudget: 4,
      noLongPara: 11, targetsRejectedByShape: 12, targetsRejectedByJudge: 13, targetJudgeUnparsed: 14,
    });
    ["W-1", "A-1", "J-1", "7", "500", "40", "38", "18", "2026-07-15", "3", "4", "6",
     "11", "12", "13", "14"].forEach((s) =>
      assert.ok(p.includes(s), `provenance must include ${s}`));
```

Then append a new block immediately after that guard-5 block:

```ts
  // --- guard 7: the chosen targets are printed ------------------------------------
  // The caption bug survived a whole run for one reason: nothing showed what the instrument
  // had picked. An aggregate over an unseen sample is not evidence.
  {
    const { formatChosenTargets } = await import("../src/lib/cases/caseqa-eval/guards");
    const out = formatChosenTargets([
      { caseId: "2002-bcsc-1199", paragraph: "para-4", text: "The plaintiff joined Canada as a defendant to these actions in October and November of 2000, and Canada takes no position on the relief sought." },
      { caseId: "2008-scc-41", paragraph: "para-34", text: "Short one." },
    ]);
    assert.ok(out.includes("2002-bcsc-1199"), "the case id must appear");
    assert.ok(out.includes("para-4"), "the paragraph id must appear");
    assert.ok(out.includes("The plaintiff joined Canada"), "the text must appear");
    assert.ok(out.includes("2008-scc-41") && out.includes("para-34"), "every target must appear");
    // Long text is truncated so the block stays readable at 40 targets, but the head must
    // be enough to recognise a caption on sight.
    const long = formatChosenTargets([{ caseId: "c", paragraph: "p", text: "y".repeat(400) }]);
    assert.ok(long.includes("y".repeat(120)), "at least 120 characters must survive");
    assert.ok(!long.includes("y".repeat(200)), "and it must not print the whole paragraph");
    // Empty must not throw — it is a real state (everything rejected) and the caller aborts
    // on it separately.
    assert.equal(typeof formatChosenTargets([]), "string");
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: FAIL — the `formatProvenance` object now has excess properties (`noLongPara` etc.) that `Provenance` does not declare, and `formatChosenTargets` does not exist.

- [ ] **Step 3: Write the implementation**

In `src/lib/cases/caseqa-eval/guards.ts`, add these fields to the `Provenance` interface, immediately after `targetDroppedByBudget: number;`:

```ts
  // Target eligibility, spec §7.6 (2026-08-04). FOUR counters, not one total: `noLongPara` is
  // a fact about the corpus, `targetsRejectedByShape` is stage 1 working, and the two judge
  // counters separate "the judge said no" from "the judge could not be parsed". If stage 2
  // starts rejecting most of what stage 1 passes, the deterministic threshold is wrong — and
  // a single merged number would absorb exactly that signal instead of showing it.
  noLongPara: number;
  targetsRejectedByShape: number;
  targetsRejectedByJudge: number;
  targetJudgeUnparsed: number;
```

Add to `formatProvenance`'s returned array, after the `targetDroppedByBudget` line:

```ts
    `targets rejected — no paragraph over the length floor ${p.noLongPara}` +
      ` · wrong shape (front matter) ${p.targetsRejectedByShape}`,
    `  judged not substantive ${p.targetsRejectedByJudge} · substance screen unparseable ${p.targetJudgeUnparsed}`,
```

Then add at the end of the file:

```ts
// Guard 7 (spec §7.7, 2026-08-04). The caption bug survived an entire run because nothing
// printed what the instrument had chosen; the aggregate looked well-formed either way. The
// sample is part of the evidence, so it goes in the output next to the metrics computed from it.
// 120 to match spec §7.7. Enough to recognise a caption on sight — the one that got through
// begins "2002BCSC1199 Citation: William et al. v. Riverside Forest Products..." — while
// keeping a 40-target block readable.
const TARGET_PREVIEW_CHARS = 120;

export function formatChosenTargets(
  targets: readonly { caseId: string; paragraph: string; text: string }[],
): string {
  const rows = targets.map((t) => {
    const head = t.text.replace(/\s+/g, " ").slice(0, TARGET_PREVIEW_CHARS);
    return `  ${t.caseId.padEnd(16)} ${t.paragraph.padEnd(10)} ${JSON.stringify(head)}`;
  });
  return [`\n--- chosen targets (${targets.length}) ---`, ...rows].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-caseqa-eval.ts`
Expected: `✅ test-cases-caseqa-eval passed`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: still only `scripts/cases-caseqa-eval.ts` errors — now also a missing-properties error on its `formatProvenance` call. Task 4 fixes them.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/caseqa-eval/guards.ts scripts/test-cases-caseqa-eval.ts
git commit -m "feat(caseqa-eval): four target-rejection counters and a chosen-targets print

Four counters rather than a total: no-long-paragraph is a corpus fact, wrong-shape is
stage 1 working, and the judge's no is not the same as the judge being unparseable. A
merged number would absorb the one signal that says the stage-1 threshold is wrong.

formatChosenTargets exists because the caption bug survived a whole run for exactly one
reason — nothing printed what the instrument had picked. The sample is part of the
evidence."
```

---

## Task 4: Wire the runner

**Files:**
- Modify: `scripts/cases-caseqa-eval.ts`

- [ ] **Step 1: Consume the `TargetDraw`**

At `scripts/cases-caseqa-eval.ts:94`, replace:

```ts
  const targets = pickTargets(cases, SEED, N_ANSWERABLE);
```

with:

```ts
  const { targets: shapedTargets, noLongPara, rejectedByShape: targetsRejectedByShape } =
    pickTargets(cases, SEED, N_ANSWERABLE);

  // Stage 2 (spec §3): stage 1's line-shape test cannot catch back matter — a solicitors'
  // register and a list of authorities are long single lines that clear it. One cached judge
  // call per candidate. No backfill on rejection: a skipped case stays skipped, matching what
  // the character floor already does, so the sample stays a function of the seed rather than
  // of the rejection rate.
  let targetsRejectedByJudge = 0, targetJudgeUnparsed = 0;
  const targets: typeof shapedTargets = [];
  for (const t of shapedTargets) {
    const c = byIdAll.get(t.caseId)!;
    const substantive = parseSubstantive(await judge.call(buildSubstantivePrompt(t.text, c.styleOfCause)));
    // Unparseable is counted apart from a `false` and never defaulted: defaulting to true
    // readmits the front matter this stage exists to exclude, and defaulting to false shrinks
    // the sample on the strength of a judge failure. Neither is a claim we have earned.
    if (substantive === null) { targetJudgeUnparsed++; continue; }
    if (!substantive) { targetsRejectedByJudge++; continue; }
    targets.push(t);
  }
  if (!targets.length) {
    throw new Error("every candidate target was rejected by the shape filter or the substance screen — nothing to measure");
  }
  console.log(formatChosenTargets(targets));
```

- [ ] **Step 2: Add the `byIdAll` map above it**

The existing `byId` map is built *after* the target selection. Stage 2 needs `styleOfCause` before that, so add immediately after the empty-population guard (`if (!cases.length) throw …`):

```ts
  // Built before target selection because stage 2 needs each candidate's styleOfCause. The
  // existing `byId` below is left as-is so nothing downstream changes.
  const byIdAll = new Map(cases.map((c) => [c.id, c]));
```

- [ ] **Step 3: Add the imports**

In the import block at the top, extend the two existing lines:

```ts
import { pickTargets, buildQuestionPrompt, isLexicalGimme, isWellFormedQuestion } from "../src/lib/cases/caseqa-eval/construct";
import { buildFaithfulnessPrompt, parseVerdict, buildAddressedPrompt, parseAddressed, buildSubstantivePrompt, parseSubstantive, type Verdict } from "../src/lib/cases/caseqa-eval/judge";
import { assertDistinctModels, formatProvenance, formatChosenTargets } from "../src/lib/cases/caseqa-eval/guards";
```

- [ ] **Step 4: Pass the four counters to provenance**

In the `formatProvenance({...})` call at roughly line 205, add after `pairingExhausted, targetDroppedByBudget,`:

```ts
    noLongPara, targetsRejectedByShape, targetsRejectedByJudge, targetJudgeUnparsed,
```

- [ ] **Step 5: Typecheck and tests**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsx scripts/test-cases-caseqa-eval.ts && npx tsx scripts/test-cases-summarizer.ts
```
Expected: `tsc` exits 0 with no output — **all the errors from Tasks 1-3 are now resolved** — and both suites print their `✅ … passed` line.

- [ ] **Step 6: Verify the model-distinctness guard still aborts before any AWS call**

Run: `npx cross-env EVAL_JUDGE_MODEL=us.meta.llama3-3-70b-instruct-v1:0 CASES_TABLE=LegalCases REPO_IMPL=dynamo AWS_REGION=us-east-1 tsx scripts/cases-caseqa-eval.ts`
Expected: exit 1 with `❌ cases-caseqa-eval failed: writer, answerer and judge must be three distinct models — collision(s): answerer=judge …`. This proves the guard still runs before any network call, which is what makes this verification free.

- [ ] **Step 7: Confirm the product path is still untouched**

```bash
git diff --stat origin/main...HEAD -- src/lib/cases/caseqa/ src/lib/cases/ingest/ src/app/
```
Expected: **empty output.** This instrument observes the product; it must not modify it.

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: exit 0. Included because CI runs `typecheck` and `build` and nothing else.

- [ ] **Step 9: Commit**

```bash
git add scripts/cases-caseqa-eval.ts
git commit -m "feat(caseqa-eval): run both target-eligibility stages and print the sample

Stage 2 is one cached judge call per stage-1 survivor, with unparseable counted apart
from a no and never defaulted. No backfill on rejection, matching the character floor,
so the sample stays a function of the seed rather than of the rejection rate.

Aborts if every candidate is rejected — that is an empty population, and this project
has already shipped a runner that printed a full scorecard of zeros and exited 0.

The chosen targets print before the metrics. The caption bug was invisible for exactly
one reason: nothing showed what the instrument had picked."
```

---

## Not in this plan

- **Running the measurement.** After this lands, the next step is a small smoke run (`EVAL_ANSWERABLE=4 EVAL_UNANSWERABLE=2`) to confirm the two stages behave on real data and that no caption survives into the chosen-targets block — then the full 40+20.
- **The `overstated` rubric question.** 13 of 24 claims in the last smoke run were judged `overstated`, and whether that is a real defect or the judge penalising the product for writing the plain language it was told to write is undecided. It needs the samples from a larger run, and it is not a blocker for this change.
- **Any change to `src/lib/cases/caseqa/`.** Out of scope; Task 4 Step 7 enforces it.
