# Sufficiency Rater Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find a sufficiency-rater configuration under a pre-registered grid, choosing it on a dev split and reporting it on a test split never used to choose it.

**Architecture:** Extends the existing `src/lib/cases/sufficiency/` modules. Arm L is deleted. New pure modules for the dev/test split, the Wilson interval and dev selection rule, and the test-run manifest. The runner gains two modes: `dev` runs the whole pre-registered grid and prints the chosen configuration; `test` runs exactly one named configuration once. Still measurement only — no product file changes.

**Tech Stack:** TypeScript, `tsx`, Bedrock Converse via `src/lib/cases/ingest/llm.ts`, `node:assert/strict`.

**Spec:** [`docs/superpowers/specs/2026-08-07-sufficiency-tuning-design.md`](../specs/2026-08-07-sufficiency-tuning-design.md)

**Line endings are MIXED in this repo, and it matters.** `core.autocrlf=true` with no `.gitattributes`,
so files that arrived via a git checkout are CRLF (`scripts/cases-sufficiency-eval.ts`,
`scripts/cases-caseqa-eval.ts`, `src/lib/cases/ingest/llm.ts`, `package.json`) while files created
recently by an editor are LF (`src/lib/cases/sufficiency/{prompt,tally}.ts`,
`scripts/test-cases-sufficiency.ts`). Task 6 does byte-exact replacements in a CRLF file.

Use the Edit tool, which handles either. Do **not** use shell one-liners (`perl -0pi`, `sed`) for
multi-line matches: earlier in this project a `perl -0pi` substitution silently failed on a CRLF
boundary and, separately, corrupted two bytes into NULs. A mutation that does not apply reads
exactly like "the test is not load-bearing", which is the wrong conclusion drawn from a real
failure to edit.

**Mutation testing, and the trap of the masking assertion.** Every task below names mutations that
must fail the suite. Two things to check each time:

1. *Did the edit apply?* Re-read the region. See above for why.
2. *Did the assertion you were aiming at actually fire?* `assert` throws on the first failure, so a
   mutation can be caught by an **earlier** assertion while the one it targets never runs — leaving
   that one unverified, and it could be dead. This happened in Task 3: removing the shuffle was
   caught by a cross-seed determinism check sitting above `"split must be shuffled"`, and an
   off-by-one slice was caught by a length check sitting above the partition assertion.

   When the message that fires is not the one predicted, do **not** reorder the shipped test to
   force it. Isolate: temporarily comment out the earlier guard, re-apply the mutation, confirm the
   intended assertion fires, then restore both. Both Task 3 assertions were confirmed load-bearing
   this way.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/cases/sufficiency/arms.ts` | **DELETE** — leave-one-out measured at 86.8% contamination |
| `src/lib/cases/sufficiency/prompt.ts` (modify) | Gains P1 and P2 builders and a `VARIANTS` map. **P0 must stay byte-identical.** |
| `src/lib/cases/sufficiency/split.ts` (create) | Seeded dev/test split + a disjointness guard. Pure. |
| `src/lib/cases/sufficiency/tally.ts` (modify) | Gains `wilson`, `classify`, `selectOnDev`. Existing thresholds untouched. |
| `src/lib/cases/sufficiency/manifest.ts` (create) | Test-run log so a second test run cannot quietly become "the" result. |
| `scripts/fixtures/sufficiency-P0.txt` (create) | Golden render of P0, so any edit to it fails loudly. |
| `scripts/cases-sufficiency-eval.ts` (rewrite) | Two modes, pool-ceiling check, staged grid. |
| `scripts/test-cases-sufficiency.ts` (modify) | Drop arm-L tests, add the new modules'. |

`package.json` is **not** modified: mode is selected by `SUFFICIENCY_MODE`, not by a separate npm
script, so the dev and test runs cannot drift in their env — which matters because they must
reconstruct the identical split from the same seed.

Unchanged and not to be touched: `scripts/cases-caseqa-eval.ts`, everything under `src/app/`, `src/lib/cases/caseqa/`.

---

### Task 1: Delete arm L

Leave-one-out was measured and does not work on this corpus (86.8% of stripped bodies were still judged answerable). The knowledge lives in the merged findings doc. Unreachable code with load-bearing-looking tests is worse than no code.

**Files:**
- Delete: `src/lib/cases/sufficiency/arms.ts`
- Modify: `scripts/test-cases-sufficiency.ts`, `scripts/cases-sufficiency-eval.ts`

- [ ] **Step 1: Delete the module**

```bash
git rm src/lib/cases/sufficiency/arms.ts
```

- [ ] **Step 2: Remove its tests**

In `scripts/test-cases-sufficiency.ts`, delete the import line:

```ts
import { stripTarget, assertTargetAbsent } from "../src/lib/cases/sufficiency/arms";
```

and delete both blocks in their entirety — the one beginning `// --- stripTarget ---` and the one beginning `// --- assertTargetAbsent ---`, including their surrounding braces.

- [ ] **Step 3: Remove arm L from the runner**

In `scripts/cases-sufficiency-eval.ts`:

- Delete the import of `stripTarget, assertTargetAbsent`.
- Delete the whole `// Arm L: the same arm-S questions with the target paragraph deleted.` block through `assertNoCallFailures(callFailures, "arm L");`.
- Delete the whole `// Arm L's contamination, measured rather than assumed:` block through `assertNoCallFailures(callFailures, "arm L residual check");`.
- Delete the four `console.log` lines reporting arm L and the residual (`--- arm L (target removed...`, `rater says sufficient...`, `residual answerability...`, and the `^ contamination bound...` line).
- Rewrite the file's top-of-file header comment, which documents arm L as a live arm. Replace the block from `// Three-arm measurement` through `// answerability instead of assuming it is zero.` with a two-arm description that records *why* arm L is gone — the 86.8% contamination — and points at the findings doc. A header describing a deleted arm is exactly the stale-comment problem this deletion exists to avoid.
- Fix the `SUFFICIENCY_ALLOW_SHARED` error message, which says `arms X and L stay clean`. It becomes `arm X stays clean`. (Task 6 removes this whole block, but a factually wrong operator message must not sit in the tree for four tasks.)
- In the `unparsed ratings` line, drop `· L ${L.unparsed}`.
- In the persisted run row, drop `armL: L.counts`, `stillAddressed`, `residualUnparsed`, `residualScored`, and the `L` entries inside `unparsed` and `callFailures`.
- In the final reconciliation, drop the two `L.counts` terms.

Anything left referencing `L` will fail typecheck, which is the check that this was done completely.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npx tsx scripts/test-cases-sufficiency.ts
grep -rnE "stripTarget|assertTargetAbsent|residualUnparsed|residualScored|stillAddressed" src/ scripts/ --exclude-dir=.cache
```

Expected: `tsc` silent; suite prints its `✅`; the grep returns **nothing**.

**Identifiers only — deliberately not prose.** This check took two attempts to get right, and both
failures are instructive:

1. The first version matched the bare substring `arms` and was case-sensitive. It fired on a
   generic `// --- arms ---` divider referring to the two *surviving* arms, and silently missed
   the file header describing arm L as live, because that header capitalises `Arms`.
2. The second version added `arm ?L` and `leave-one-out`. Those are prose, and this task
   *requires* prose about arm L — the rewritten header explains why it was deleted. A check that
   the mandated text guarantees will fail is not a check.

So: match the identifiers that must be gone, and leave the explanation alone. Prose describing
why something was removed is the thing you want to keep; a symbol that survives its module is the
thing you want to catch. `--exclude-dir=.cache` skips gitignored run artifacts from earlier runs,
which are data, not source.

Separately, update the two stale references the identifier grep will *not* catch, because they are
prose and string literals rather than symbols: the comment in the prompt test that ends "...and arm
L becomes unpassable" (rewrite it in terms of arm X, which is where topic-relevance collapse would
actually show), and the two `assertNoCallFailures(7, "arm L")` calls, whose context string should
name a surviving arm.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(sufficiency): delete arm L — leave-one-out measured at 86.8% contamination"
```

---

### Task 2: Prompt variants

**Files:**
- Modify: `src/lib/cases/sufficiency/prompt.ts`
- Create: `scripts/fixtures/sufficiency-P0.txt`
- Modify: `scripts/test-cases-sufficiency.ts`

- [ ] **Step 1: Write the failing test**

Add to `scripts/test-cases-sufficiency.ts`, before the final `console.log`:

```ts
// --- prompt variants ---------------------------------------------------------------------
{
  const { VARIANTS, VARIANT_IDS } = await import("../src/lib/cases/sufficiency/prompt");
  assert.deepEqual([...VARIANT_IDS], ["P0", "P1", "P2"], "the grid is pre-registered — three variants, in order");

  // P0 must remain byte-identical to what #239 measured, or its 92 cached responses stop
  // replaying and the published baseline silently becomes a different prompt. Compared against
  // a golden file rather than an inline string so a diff is readable when it fires.
  const golden = fsSync.readFileSync("scripts/fixtures/sufficiency-P0.txt", "utf8").replace(/\r\n/g, "\n");
  assert.equal(VARIANTS.P0("Q_TEXT", "S_TEXT", "B_TEXT").replace(/\r\n/g, "\n"), golden,
    "P0 changed — this invalidates the #239 baseline and its cache. If intentional, it is a NEW variant, not an edit to P0.");

  for (const id of VARIANT_IDS) {
    const p = VARIANTS[id]("Q_TEXT", "S_TEXT", "B_TEXT");
    assert.ok(p.includes("Q_TEXT") && p.includes("S_TEXT") && p.includes("B_TEXT"), `${id} interpolates all three`);
    const schema = p.split("\n").find((l) => l.trim().startsWith('{"')) ?? "";
    assert.ok(schema.indexOf('"reason"') < schema.indexOf('"sufficient"'), `${id}: reason must precede the label`);
    for (const w of ["entailment", "supported", "overstated", "contradicted"]) {
      assert.ok(!p.includes(w), `${id} leaks faithfulness vocabulary: ${w}`);
    }
  }

  // The hypothesis under test: every one of #239's ten refusals used the prompt's own word.
  // P0 keeps it; P1 and P2 exist precisely to drop it. If a variant kept it, the experiment
  // would be comparing a thing to itself.
  assert.ok(VARIANTS.P0("q", "s", "b").includes("definitive"), "P0 keeps 'definitive'");
  assert.ok(!VARIANTS.P1("q", "s", "b").includes("definitive"), "P1 must drop 'definitive'");
  assert.ok(!VARIANTS.P2("q", "s", "b").includes("definitive"), "P2 must drop 'definitive'");

  // Distinct text means distinct cache keys, so no variant can replay another's responses.
  const rendered = VARIANT_IDS.map((id) => VARIANTS[id]("q", "s", "b"));
  assert.equal(new Set(rendered).size, 3, "all three variants must render differently");
}
```

Add these imports at the top of the test file if not present:

```ts
import fsSync from "node:fs";
```

The `await import` requires this block to sit inside the existing `asyncTests()` function if the file has one; if the file is top-level only, convert this block to a plain static import of `VARIANTS, VARIANT_IDS` alongside the existing prompt import and drop the `await import` line.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx scripts/test-cases-sufficiency.ts`
Expected: FAIL — `VARIANT_IDS` is not exported (or the fixture file does not exist).

- [ ] **Step 3: Add the variants**

Append to `src/lib/cases/sufficiency/prompt.ts`:

```ts
// The tuning grid's prompt axis (spec 2026-08-07 §5).
//
// P0 is the prompt #239 measured, and it must stay BYTE-IDENTICAL: its 92 cached responses are
// the published baseline, and the cache key is sha256(modelId + "\n" + prompt), so a single
// changed character silently turns the baseline into a different experiment. A golden fixture
// pins it.
//
// P1 and P2 exist because all ten of #239's false refusals gave the same reason — "does not
// provide a definitive answer" — which is P0's own word. That is an observation, not a measured
// cause, which is exactly why it is being tested rather than assumed.

export type VariantId = "P0" | "P1" | "P2";
export const VARIANT_IDS: readonly VariantId[] = ["P0", "P1", "P2"];

// P1: drops "definitive" and says plainly that answering the substance is enough. The failure
// P0 exhibits is refusing text that answers the question but does not settle every sub-part or
// state a general rule.
export function buildSufficiencyPromptP1(question: string, styleOfCause: string, body: string): string {
  return `You are deciding ONE thing about a Canadian court decision: does its text contain enough information to answer a question?

You are NOT being asked whether an answer would be well written, whether the decision is about the right area of law, or whether any particular sentence is accurate. Only whether the answer is IN THERE.

CASE: ${styleOfCause}

QUESTION:
${question}

Answer "sufficient": true if the judgment text below answers the substance of that question — enough that a reader could come away knowing the answer.

It does not have to resolve every sub-part of a multi-part question, and it does not have to state a general rule. Text that answers the question as it was actually asked is sufficient.

Answer "sufficient": false if the text does not contain the answer at all, or only touches the topic without saying anything that answers the question.

Being relevant is not enough. A passage can be on the same topic, discuss the same area of law, and use the same words as the question while still not containing the answer — that is insufficient.

Give your reasoning FIRST, then the label.

Output STRICTLY this JSON, no markdown:
{"reason":"one or two sentences","sufficient":true|false}

JUDGMENT TEXT:
${body}`;
}

// P2: P1 plus the reminder that a judgment answering in its own vocabulary still answers. The
// questions are lay-language rewrites of a paragraph, so a rater matching surface form rather
// than substance would refuse text that does answer.
export function buildSufficiencyPromptP2(question: string, styleOfCause: string, body: string): string {
  return `You are deciding ONE thing about a Canadian court decision: does its text contain enough information to answer a question?

You are NOT being asked whether an answer would be well written, whether the decision is about the right area of law, or whether any particular sentence is accurate. Only whether the answer is IN THERE.

CASE: ${styleOfCause}

QUESTION:
${question}

Answer "sufficient": true if the judgment text below answers the substance of that question — enough that a reader could come away knowing the answer.

It does not have to resolve every sub-part of a multi-part question, and it does not have to state a general rule. Text that answers the question as it was actually asked is sufficient.

The question is written in everyday language and the judgment is not. Do not require the text to use the question's words, or to address it in the same order or framing. Ask whether the substance is present, however the court phrased it.

Answer "sufficient": false if the text does not contain the answer at all, or only touches the topic without saying anything that answers the question.

Being relevant is not enough. A passage can be on the same topic, discuss the same area of law, and use the same words as the question while still not containing the answer — that is insufficient.

Give your reasoning FIRST, then the label.

Output STRICTLY this JSON, no markdown:
{"reason":"one or two sentences","sufficient":true|false}

JUDGMENT TEXT:
${body}`;
}

export const VARIANTS: Record<VariantId, (question: string, styleOfCause: string, body: string) => string> = {
  P0: buildSufficiencyPrompt,
  P1: buildSufficiencyPromptP1,
  P2: buildSufficiencyPromptP2,
};
```

- [ ] **Step 4: Generate the golden fixture**

Create `scripts/tmp-golden.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { VARIANTS } from "../src/lib/cases/sufficiency/prompt";

async function main() {
  const dir = path.join(process.cwd(), "scripts", "fixtures");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "sufficiency-P0.txt"), VARIANTS.P0("Q_TEXT", "S_TEXT", "B_TEXT"), "utf8");
  console.log("wrote scripts/fixtures/sufficiency-P0.txt");
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run it, then delete it:

```bash
npx tsx scripts/tmp-golden.ts
rm scripts/tmp-golden.ts
```

- [ ] **Step 5: Verify P0 really is unchanged**

The fixture was generated *from* the code, so it cannot fail on its own. Prove it pins the right thing by checking the fixture against the prompt #239 actually used — the cached response for a known rating must still be found:

```bash
head -c 200 scripts/fixtures/sufficiency-P0.txt
grep -c "definitive" scripts/fixtures/sufficiency-P0.txt
```

Expected: the fixture starts `You are deciding ONE thing about a Canadian court decision:` and contains `definitive` at least once. Report both outputs.

- [ ] **Step 6: Run the test**

Run: `npx tsx scripts/test-cases-sufficiency.ts`
Expected: `✅ test-cases-sufficiency passed`

- [ ] **Step 7: Mutation testing**

Verify each edit actually applied before trusting its result — this project has twice been misled by a mutation that silently missed (a same-named expression elsewhere in the file; CRLF line endings). Files are CRLF; prefer the Edit tool.

1. In `buildSufficiencyPrompt` (P0), change `definitive answer` to `clear answer`
   → MUST fail on the golden-fixture assertion.
2. In `buildSufficiencyPromptP1`, add the word `definitive` anywhere in the prose
   → MUST fail on `"P1 must drop 'definitive'"`.
3. Make `VARIANTS.P2` point at `buildSufficiencyPromptP1`
   → MUST fail on `"all three variants must render differently"`.
4. Swap `"reason"` and `"sufficient"` in P1's output schema line
   → MUST fail on `"P1: reason must precede the label"`.

Restore after each; confirm the suite passes at the end.

- [ ] **Step 8: Commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat(sufficiency): P1 and P2 prompt variants, with P0 pinned by a golden fixture"
```

---

### Task 3: The dev/test split

**Files:**
- Create: `src/lib/cases/sufficiency/split.ts`
- Modify: `scripts/test-cases-sufficiency.ts`

- [ ] **Step 1: Write the failing test**

Add the import beside the others:

```ts
import { splitDevTest, assertDisjoint } from "../src/lib/cases/sufficiency/split";
```

and this block before the final `console.log`:

```ts
// --- dev/test split ----------------------------------------------------------------------
{
  const items = Array.from({ length: 10 }, (_, i) => ({ qid: `q${i}` }));
  const s = splitDevTest(items, 1, 4);
  assert.equal(s.dev.length, 4);
  assert.equal(s.test.length, 6);
  // Every item lands in exactly one side. A split that drops or duplicates an item silently
  // changes the denominator of every rate in the experiment.
  assert.deepEqual(
    [...s.dev, ...s.test].map((x) => x.qid).sort(),
    items.map((x) => x.qid).sort(),
    "dev + test must partition the input exactly",
  );
  // Deterministic: the whole method rests on test being the SAME held-out set across the dev
  // run and the later test run, which are separate processes.
  assert.deepEqual(splitDevTest(items, 1, 4), s, "same seed, same split");
  assert.notDeepEqual(splitDevTest(items, 2, 4).dev, s.dev, "different seed, different split");
  // Not simply the first N — an unshuffled split would correlate with corpus order.
  assert.notDeepEqual(s.dev.map((x) => x.qid), ["q0", "q1", "q2", "q3"], "split must be shuffled");

  assert.throws(() => splitDevTest(items, 1, 11), /11/, "devCount above the population must throw, naming it");
  assert.throws(() => splitDevTest(items, 1, -1), /-1/, "negative devCount must throw, naming it");
  assert.deepEqual(splitDevTest(items, 1, 0), { dev: [], test: splitDevTest(items, 1, 0).test }, "devCount 0 is legal");
}

// --- assertDisjoint ----------------------------------------------------------------------
{
  const key = (x: { qid: string }) => x.qid;
  assert.doesNotThrow(() => assertDisjoint({ dev: [{ qid: "a" }], test: [{ qid: "b" }] }, key));
  assert.throws(() => assertDisjoint({ dev: [{ qid: "a" }], test: [{ qid: "a" }] }, key), /a/,
    "an overlapping qid must throw, naming it");
  // The guard exists for the cross-process case: the dev run and the test run each recompute
  // the split, and a drift in construction between them could put a question on both sides.
  assert.throws(() => assertDisjoint({ dev: [{ qid: "a" }, { qid: "b" }], test: [{ qid: "b" }] }, key), /1 item/,
    "message must name how many overlapped");
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx scripts/test-cases-sufficiency.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/sufficiency/split'`.

- [ ] **Step 3: Write the module**

Create `src/lib/cases/sufficiency/split.ts`:

```ts
// The dev/test split, and the guard that it stayed a split.
//
// Why this exists: after #239 we have data, so tuning against the same questions and reporting
// the improvement is fitting to the test set. All tuning looks at dev; the chosen configuration
// runs on test once. That only works if test is genuinely untouched, which is a property of
// this file.
//
// Determinism is load-bearing in a way that is easy to miss: the dev run and the test run are
// SEPARATE PROCESSES, each recomputing the split from the same seed. If they disagreed, the
// "held-out" set would contain questions the tuning already saw, and no number in the report
// would mean what it says.
import { seededShuffle } from "../caseqa-eval/rng";

export interface Split<T> { dev: T[]; test: T[] }

export function splitDevTest<T>(items: readonly T[], seed: number, devCount: number): Split<T> {
  if (!Number.isInteger(devCount) || devCount < 0 || devCount > items.length) {
    throw new Error(`devCount ${devCount} is not a valid split of ${items.length} item(s)`);
  }
  // Shuffled, not sliced off the front: pickTargets walks the corpus in a stable order, so an
  // unshuffled split would correlate dev and test with whatever that order encodes (court, year,
  // ingestion batch) and the two halves would not be exchangeable.
  const shuffled = seededShuffle(items, seed);
  return { dev: shuffled.slice(0, devCount), test: shuffled.slice(devCount) };
}

// Cheap, and checks the one property everything else rests on. Called by the runner on every
// run rather than trusted from the slice arithmetic above, because the inputs are rebuilt from
// the corpus each time and a construction change could reorder or duplicate them.
export function assertDisjoint<T>(s: Split<T>, key: (t: T) => string): void {
  const dev = new Set(s.dev.map(key));
  const overlap = s.test.map(key).filter((k) => dev.has(k));
  if (overlap.length) {
    throw new Error(
      `dev and test overlap on ${overlap.length} item(s): ${overlap.slice(0, 5).join(", ")}` +
      `${overlap.length > 5 ? ", ..." : ""} — every number in this experiment depends on them being disjoint`,
    );
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx tsx scripts/test-cases-sufficiency.ts`
Expected: `✅ test-cases-sufficiency passed`

- [ ] **Step 5: Mutation testing**

Confirm each edit applies, then that each fails the suite:

1. Replace `seededShuffle(items, seed)` with `[...items]` → MUST fail on `"split must be shuffled"`.
2. Change `shuffled.slice(devCount)` to `shuffled.slice(devCount - 1)` → MUST fail on the partition assertion.
3. Change `devCount > items.length` to `devCount > items.length + 100` → MUST fail on the throw test.
4. In `assertDisjoint`, change `if (overlap.length)` to `if (overlap.length > 1)` → MUST fail on the single-overlap test.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat(sufficiency): seeded dev/test split with a disjointness guard"
```

---

### Task 4: Wilson interval, conclusiveness, and the dev selection rule

**Files:**
- Modify: `src/lib/cases/sufficiency/tally.ts`
- Modify: `scripts/test-cases-sufficiency.ts`

- [ ] **Step 1: Write the failing test**

Extend the tally import to add the new names, and add before the final `console.log`:

```ts
// --- Wilson interval ---------------------------------------------------------------------
{
  const [lo, hi] = wilson(0, 80);
  assert.equal(lo, 0, "0 successes gives a lower bound of exactly 0");
  // The number that sized this whole experiment: at n=80, a perfect result clears a 5% bar and
  // a single failure does not. If this drifts, the spec's sizing argument is void.
  assert.ok(hi > 0.045 && hi < 0.047, `n=80, 0 failures should give ~4.6%, got ${(hi * 100).toFixed(2)}%`);
  const [, hi1] = wilson(1, 80);
  assert.ok(hi1 > 0.066 && hi1 < 0.068, `n=80, 1 failure should give ~6.7%, got ${(hi1 * 100).toFixed(2)}%`);
  // Normal approximation would give a negative lower bound here; Wilson must not.
  assert.ok(wilson(1, 100)[0] > 0, "lower bound must never go negative");
  assert.deepEqual(wilson(0, 0), [0, 0], "empty is 0,0 — not NaN");
}

// --- conclusiveness ----------------------------------------------------------------------
// Reported ALONGSIDE the point-estimate rule, never instead of it. #239 used point estimates
// and switching now would move the goalposts mid-experiment.
assert.equal(classify(0, 80, 0.05), "clears", "interval entirely below the bar");
assert.equal(classify(1, 80, 0.05), "fails", "interval entirely above the bar");
assert.equal(classify(10, 38, 0.05), "fails", "the #239 result: 26.3%, CI [15.0, 42.0]");
assert.equal(classify(2, 60, 0.05), "inconclusive-at-this-n", "3.3% but the interval straddles 5%");
assert.equal(classify(0, 16, 0.20), "inconclusive-at-this-n", "the #239 arm X: 0/16, upper bound 19.4% — just inside");

// --- dev selection rule ------------------------------------------------------------------
{
  const c = (s: number, i: number) => ({ sufficient: s, insufficient: i });
  // Lowest false refusal among those whose leakage clears the bar.
  const r = selectOnDev([
    { configId: "P0/a", armS: c(35, 5), armX: c(0, 20) },   // FR 12.5%, leak 0%
    { configId: "P0/b", armS: c(38, 2), armX: c(9, 11) },   // FR  5.0%, leak 45% — disqualified
    { configId: "P0/c", armS: c(37, 3), armX: c(2, 18) },   // FR  7.5%, leak 10% — winner
  ]);
  assert.equal(r.chosen?.configId, "P0/c");
  // A better false-refusal number must NOT rescue a config that leaks. Leakage is the defect
  // the gate exists for; a gate that lets questions through is not a gate.
  assert.ok(!/P0\/b/.test(r.reason), "the disqualified config must not be described as the winner");

  // Nothing qualifies -> null and a reason, never a relaxed bar.
  const none = selectOnDev([{ configId: "P0/a", armS: c(40, 0), armX: c(20, 0) }]);
  assert.equal(none.chosen, null);
  assert.match(none.reason, /leak|20/i, "the reason must say why nothing qualified");

  // Deterministic tie-break, so the same dev data always selects the same config.
  const tie = selectOnDev([
    { configId: "P0/z", armS: c(37, 3), armX: c(1, 19) },
    { configId: "P0/a", armS: c(37, 3), armX: c(1, 19) },
  ]);
  assert.equal(tie.chosen?.configId, "P0/a", "exact tie breaks on configId, lexicographically");

  assert.equal(selectOnDev([]).chosen, null, "empty input is null, not a crash");
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx scripts/test-cases-sufficiency.ts`
Expected: FAIL — `wilson is not exported`.

- [ ] **Step 3: Write the code**

Append to `src/lib/cases/sufficiency/tally.ts`:

```ts
// Wilson score interval — the right one for proportions near 0 or 1, where the normal
// approximation produces negative lower bounds. Both this experiment's bars sit near 0.
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

// Reported ALONGSIDE the point-estimate rule in `decide`, never instead of it. #239 judged on
// point estimates; switching to an interval rule now would move the goalposts mid-experiment,
// even though it moves them in the harder direction.
//
// What this adds is honesty about power: at n=80 a perfect arm S clears a 5% bar and ONE failure
// does not, so most outcomes in between settle nothing. Saying so up front prevents a later
// argument that 1 of 80 is "basically 5%".
export type Confidence = "clears" | "fails" | "inconclusive-at-this-n";

export function classify(k: number, n: number, bar: number): Confidence {
  const [lo, hi] = wilson(k, n);
  if (lo <= bar && bar <= hi) return "inconclusive-at-this-n";
  return hi < bar ? "clears" : "fails";
}

export interface DevResult { configId: string; armS: ArmCounts; armX: ArmCounts }

// Pre-registered (spec §6): lowest arm-S false refusal AMONG those whose arm-X leakage clears
// its bar. The order is not cosmetic — leakage is the defect the gate exists to fix, so a
// configuration that lets questions through is disqualified no matter how few good questions it
// refuses. Ties break on configId so the same dev data always yields the same choice.
export function selectOnDev(results: readonly DevResult[]): { chosen: DevResult | null; reason: string } {
  if (results.length === 0) return { chosen: null, reason: "no configurations were evaluated" };
  const qualified = results.filter((r) => projectedFalseAnswerRate(r.armX) <= PROJECTED_FALSE_ANSWER_MAX);
  if (qualified.length === 0) {
    const best = Math.min(...results.map((r) => projectedFalseAnswerRate(r.armX)));
    return {
      chosen: null,
      reason: `no configuration kept leakage at or below ${(PROJECTED_FALSE_ANSWER_MAX * 100).toFixed(0)}% ` +
        `(best was ${(best * 100).toFixed(1)}%) — the bar is not relaxed, so there is nothing to test`,
    };
  }
  const sorted = [...qualified].sort((a, b) =>
    falseRefusalRate(a.armS) - falseRefusalRate(b.armS) ||
    projectedFalseAnswerRate(a.armX) - projectedFalseAnswerRate(b.armX) ||
    a.configId.localeCompare(b.configId));
  const chosen = sorted[0];
  return {
    chosen,
    reason: `${chosen.configId}: false refusal ${(falseRefusalRate(chosen.armS) * 100).toFixed(1)}%, ` +
      `leakage ${(projectedFalseAnswerRate(chosen.armX) * 100).toFixed(1)}% — lowest false refusal of ` +
      `${qualified.length} configuration(s) that cleared the leakage bar, out of ${results.length} evaluated`,
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx tsx scripts/test-cases-sufficiency.ts`
Expected: `✅ test-cases-sufficiency passed`

- [ ] **Step 5: Mutation testing**

1. In `wilson`, drop the `Math.max(0, ...)` → MUST fail on `"0 successes gives a lower bound of exactly 0"` or the negative-bound test.
2. In `classify`, return `hi < bar ? "clears" : "fails"` before the straddle check → MUST fail on an `inconclusive-at-this-n` case.
3. In `selectOnDev`, drop the `qualified` filter (sort all results) → MUST fail on the disqualified-config test.
4. In `selectOnDev`, remove the `a.configId.localeCompare(b.configId)` tie-break → MUST fail on the tie test.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat(sufficiency): Wilson bounds, conclusiveness labelling, and the dev selection rule"
```

---

### Task 5: The test-run manifest

**Files:**
- Create: `src/lib/cases/sufficiency/manifest.ts`
- Modify: `scripts/test-cases-sufficiency.ts`

- [ ] **Step 1: Write the failing test**

Add the import:

```ts
import { readTestRuns, appendTestRun } from "../src/lib/cases/sufficiency/manifest";
```

and inside the async test function, before the final report:

```ts
// --- test-run manifest -------------------------------------------------------------------
{
  const dir = path.join(os.tmpdir(), `suff-manifest-${process.pid}`);
  assert.deepEqual(await readTestRuns(dir), [], "no manifest yet is an empty list, not a crash");
  await appendTestRun(dir, { configId: "P1/nova-pro", at: "2026-08-07T00:00:00Z", armS: { sufficient: 78, insufficient: 2 }, armX: { sufficient: 0, insufficient: 40 } });
  await appendTestRun(dir, { configId: "P2/nova-pro", at: "2026-08-08T00:00:00Z", armS: { sufficient: 79, insufficient: 1 }, armX: { sufficient: 1, insufficient: 39 } });
  const runs = await readTestRuns(dir);
  assert.equal(runs.length, 2, "appends, does not overwrite — a second test run must not erase the first");
  assert.equal(runs[0].configId, "P1/nova-pro", "order preserved, so 'which was first' is answerable");
  assert.equal(runs[1].configId, "P2/nova-pro");
  fsSync.rmSync(dir, { recursive: true, force: true });
}
```

Add `import os from "node:os";` and `import path from "node:path";` at the top if absent.

- [ ] **Step 2: Run it and confirm it fails**

Expected: FAIL — `Cannot find module '../src/lib/cases/sufficiency/manifest'`.

- [ ] **Step 3: Write the module**

Create `src/lib/cases/sufficiency/manifest.ts`:

```ts
// A log of every test-set run.
//
// The test set can only be spent once. The pre-registered rule (spec §2) is that a failing test
// result does NOT license going back and choosing another configuration — that would turn test
// into a second dev set. This file makes a second run visible rather than preventing it: the
// runner prints every prior entry at startup, so a later reader can see that the reported number
// was the third attempt, not the first.
//
// Append-only by design. Overwriting would erase exactly the evidence this exists to keep.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ArmCounts } from "./tally";

export interface TestRun { configId: string; at: string; armS: ArmCounts; armX: ArmCounts }

const FILE = "test-runs.jsonl";

// A missing manifest means no test run has happened yet, which is the normal first case — not
// an error.
export async function readTestRuns(dir: string): Promise<TestRun[]> {
  try {
    const raw = await fs.readFile(path.join(dir, FILE), "utf8");
    return raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as TestRun);
  } catch { return []; }
}

export async function appendTestRun(dir: string, run: TestRun): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(path.join(dir, FILE), JSON.stringify(run) + "\n", "utf8");
}
```

- [ ] **Step 4: Run the test**

Expected: `✅ test-cases-sufficiency passed`

- [ ] **Step 5: Mutation testing**

1. Change `appendFile` to `writeFile` → MUST fail on `"appends, does not overwrite"`.
2. Make `readTestRuns` rethrow instead of returning `[]` → MUST fail on the empty-list assertion.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat(sufficiency): append-only test-run manifest"
```

---

### Task 6: Runner — dev/test modes, the pre-registered grid, the manifest

One file, rewritten in place. Kept as a single task because the intermediate states do not
typecheck: the `score` signature changes, the single-rater constant disappears, and the old
single-config block must go in the same pass.

**Files:**
- Modify: `scripts/cases-sufficiency-eval.ts`
- Modify: `package.json`

- [ ] **Step 1: Imports, sizing, mode, and the grid**

Add to the imports:

```ts
import { VARIANTS, VARIANT_IDS, type VariantId } from "../src/lib/cases/sufficiency/prompt";
import { splitDevTest, assertDisjoint } from "../src/lib/cases/sufficiency/split";
import { wilson, classify, selectOnDev, type DevResult } from "../src/lib/cases/sufficiency/tally";
import { readTestRuns, appendTestRun } from "../src/lib/cases/sufficiency/manifest";
```

and add `MIN_TARGET_PARA_CHARS, isProseShaped` to the existing import from `caseqa-eval/construct`.

Replace:

```ts
const SEED = Number(process.env.EVAL_SEED ?? 1);
const N_ANSWERABLE = Number(process.env.EVAL_ANSWERABLE ?? 40);
const N_UNANSWERABLE = Number(process.env.EVAL_UNANSWERABLE ?? 20);
```

with:

```ts
const SEED = Number(process.env.EVAL_SEED ?? 1);
// Sized by what a 5% bar can be measured against, not by round numbers (spec §3): n=73 is the
// smallest arm-S test set where a perfect result clears a 5% Wilson upper bound. At 80, zero
// refusals gives 4.6% and clears; ONE gives 6.7% and does not.
const N_ANSWERABLE = Number(process.env.EVAL_ANSWERABLE ?? 120);
const N_UNANSWERABLE = Number(process.env.EVAL_UNANSWERABLE ?? 60);
const DEV_ANSWERABLE = Number(process.env.SUFFICIENCY_DEV_ANSWERABLE ?? 40);
const DEV_UNANSWERABLE = Number(process.env.SUFFICIENCY_DEV_UNANSWERABLE ?? 20);

const MODE = process.env.SUFFICIENCY_MODE ?? "dev";

// The grid, pre-registered (spec §5). Not "until something passes".
//
// us.deepseek.r1-v1:0 is invocable and deliberately excluded: it is a reasoning model, this
// prompt already asks for reasoning before the label, and that combination is the
// budget-starvation shape that cost #237 an entire arm.
const STAGE1_RATERS = [
  "us.amazon.nova-pro-v1:0",
  "us.meta.llama4-maverick-17b-instruct-v1:0",
  "cohere.command-r-plus-v1:0",
  "us.amazon.nova-lite-v1:0",
];
const STAGE2_VARIANTS: VariantId[] = ["P1", "P2"];
```

Delete the `RATER` constant entirely — the rater now varies across the grid.

- [ ] **Step 2: Replace the role guard**

Delete the whole existing guard block (the `RATER === JUDGE` throw, the `shared` / `allowShared`
logic, and the `⚠ CONTAMINATED RUN` warning) and put in its place:

```ts
  // Role separation, now against every rater in the grid rather than one. A rater that is also
  // the judge would be scored against arm X labels the judge itself produced; one that is the
  // writer wrote arm S's questions; one that is the answerer is the subject under test.
  //
  // The #239 `SUFFICIENCY_ALLOW_SHARED` escape hatch is gone. It existed because only three
  // invocable ids were known; the probe has since found eight, so a contaminated run is no
  // longer a necessary compromise and the flag would only be a way to make one by accident.
  for (const r of STAGE1_RATERS) {
    if (r === JUDGE) throw new Error(`grid contains the judge (${JUDGE}) as a rater — that scores it against its own arm-X labels`);
    if (r === WRITER) throw new Error(`grid contains the writer (${WRITER}) as a rater — it wrote arm S's questions`);
    if (r === ANSWERER) throw new Error(`grid contains the answerer (${ANSWERER}) as a rater — it is the subject under test`);
  }
  if (new Set(STAGE1_RATERS).size !== STAGE1_RATERS.length) throw new Error("STAGE1_RATERS contains a duplicate");
```

Then delete every remaining reference to `shared` and `contaminated` (the persisted run row in
Step 6 does not carry them).

- [ ] **Step 3: Pool-ceiling check**

Immediately after `if (!cases.length) throw ...`, insert:

```ts
  // pickTargets draws at most ONE target per case, so N_ANSWERABLE questions needs N_ANSWERABLE
  // cases with an eligible paragraph. Checked BEFORE spending anything: silently drawing fewer
  // would report every rate over a smaller n than the spec sized for, and that sizing is the
  // entire argument that a 5% bar is measurable at all.
  const eligibleCases = cases.filter((c) =>
    (c.chunks ?? []).some((ch) => ch.text.length >= MIN_TARGET_PARA_CHARS && isProseShaped(ch.text))).length;
  console.log(`pool: ${cases.length} core case(s) with chunks · ${eligibleCases} with a stage-1-eligible paragraph`);
  if (eligibleCases < N_ANSWERABLE) {
    throw new Error(
      `need ${N_ANSWERABLE} eligible cases for ${N_ANSWERABLE} answerable questions (one target per case), ` +
      `have ${eligibleCases}. Lower EVAL_ANSWERABLE and re-derive the split sizes from spec §3's power ` +
      `table — do NOT keep an 80-question test target on a smaller pool, because the 5% bar stops ` +
      `being measurable.`,
    );
  }
```

- [ ] **Step 4: Fix the construction cross-check for the new sizes**

This is a real trap. `buildUnanswerablePairs` draws candidates from `built`, and `built` grows
from 39 to ~120. Its qids are assigned `un-${pairs.length + 1}` against a *different* candidate
draw, so **arm X's questions legitimately differ from the prior run** — and the existing check
would abort with "construction drift" on a change that is intended.

(Arm S does *not* drift: `pickTargets` shuffles the case list once by seed and takes a prefix, and
the per-case target draw is seeded by index, so the first 40 targets of a 120-draw are the same 40.
That half of the check stays meaningful and worth keeping.)

Change the header comparison so a differently-sized prior run is reported as not comparable,
exactly as a different seed already is. Replace:

```ts
      if (header && header.seed !== SEED) {
        crossCheck = `prior rows ${latest} are seed ${header.seed}, this run is seed ${SEED} — not comparable, NOT cross-checked`;
      } else {
```

with:

```ts
      // A prior run at a different seed OR a different draw size is a mismatched reference, not
      // a regression. buildUnanswerablePairs draws its candidates from `built`, so changing
      // N_ANSWERABLE changes arm X's pairings by design — reporting that as drift would train
      // the operator to ignore the check.
      const sizeChanged = header && (header.answerable !== N_ANSWERABLE || header.unanswerable !== N_UNANSWERABLE);
      if (header && header.seed !== SEED) {
        crossCheck = `prior rows ${latest} are seed ${header.seed}, this run is seed ${SEED} — not comparable, NOT cross-checked`;
      } else if (sizeChanged) {
        crossCheck = `prior rows ${latest} drew ${header!.answerable}/${header!.unanswerable}, this run draws ${N_ANSWERABLE}/${N_UNANSWERABLE} — arm X pairings differ by design, NOT cross-checked`;
      } else {
```

- [ ] **Step 5: The split**

Insert immediately after the `console.log(\`construction cross-check: ...\`)` line:

```ts
  // Split ONCE, before any rating. Both modes recompute it from the same seed in separate
  // processes; if they disagreed, "held out" would be false and every number in the test report
  // would be a dev number wearing a test label.
  const splitS = splitDevTest(built, SEED, DEV_ANSWERABLE);
  const splitX = splitDevTest(pairs, SEED, DEV_UNANSWERABLE);
  assertDisjoint(splitS, (q) => q.qid);
  assertDisjoint(splitX, (q) => q.qid);
  console.log(`split (seed ${SEED}): arm S dev ${splitS.dev.length} / test ${splitS.test.length} · arm X dev ${splitX.dev.length} / test ${splitX.test.length}`);
  console.log(`  dev  S: ${splitS.dev.map((q) => q.qid).join(" ")}`);
  console.log(`  test S: ${splitS.test.map((q) => q.qid).join(" ")}`);
  console.log(`  dev  X: ${splitX.dev.map((q) => q.qid).join(" ")}`);
  console.log(`  test X: ${splitX.test.map((q) => q.qid).join(" ")}\n`);
```

- [ ] **Step 6: Variable rater and prompt, and the item lists**

Delete the fixed `rater` model, the old `rate` helper, the old `score` function, and the whole
existing arm S / arm X / report / persist section. Replace with:

```ts
  // One cached model per rater id, built lazily so a grid entry never reached costs nothing.
  const raterCache = new Map<string, ReturnType<typeof cachedModel>>();
  const raterFor = (id: string) => {
    if (!raterCache.has(id)) raterCache.set(id, cachedModel(modelFromId(id, { maxTokens: RATER_MAX_TOKENS })));
    return raterCache.get(id)!;
  };

  let callFailures = 0;
  const rate = async (raterId: string, variant: VariantId, question: string, styleOfCause: string, body: string) => {
    try {
      const { value, repaired } = await callParsed(
        raterFor(raterId), VARIANTS[variant](question, styleOfCause, body), parseSufficiency, CACHE_OPS);
      if (repaired) repairs++;
      return value;
    } catch (e) {
      callFailures++;
      console.warn("  [rater failed]", e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const rows: string[] = [];
  const runId = new Date().toISOString().replace(/[:.]/g, "-");

  const score = async (
    configId: string, raterId: string, variant: VariantId, arm: "S" | "X",
    items: { caseId: string; qid: string; question: string; body: string }[],
  ): Promise<{ counts: ArmCounts; unparsed: number; failed: number }> => {
    const counts: ArmCounts = { sufficient: 0, insufficient: 0 };
    let unparsed = 0, failed = 0;
    process.stdout.write(`  ${configId} arm ${arm} (${items.length}): `);
    for (const [i, it] of items.entries()) {
      const c = byId.get(it.caseId)!;
      // `rate` returns null for BOTH a parse failure and a call failure, and those are not the
      // same thing: an unparsed response is evidence about the rater, a failed call is evidence
      // about nothing.
      const failedBefore = callFailures;
      const v = await rate(raterId, variant, it.question, c.styleOfCause, it.body);
      if (v === null) { if (callFailures > failedBefore) failed++; else unparsed++; continue; }
      if (v.sufficient) counts.sufficient++; else counts.insufficient++;
      rows.push(JSON.stringify({ kind: "rating", runId, mode: MODE, configId, rater: raterId, variant,
        arm, caseId: it.caseId, qid: it.qid, question: it.question, sufficient: v.sufficient, reason: v.reason }));
      if ((i + 1) % 20 === 0) process.stdout.write(`${i + 1} `);
    }
    console.log(`done (${counts.sufficient}S ${counts.insufficient}I, ${unparsed} unparsed, ${failed} failed)`);
    return { counts, unparsed, failed };
  };

  // Bodies assembled once and indexed by qid, so either half of the split can be materialised
  // without re-assembling. The budget guard is FIX D from the answer-quality eval: assembleInput
  // drops chunks over 240,000 chars, so on a very long judgment the by-construction target can be
  // absent from the body the rater sees — which would score as a rater error when the cause is
  // upstream of it.
  const bodyOf = new Map<string, { caseId: string; qid: string; question: string; body: string }>();
  let targetDroppedByBudget = 0;
  for (const b of built) {
    const c = byId.get(b.caseId)!;
    const body = assembleInput(c.chunks!, c.outcome.holding);
    if (!body.includes(`[para ${b.targetParagraph}]`)) { targetDroppedByBudget++; continue; }
    bodyOf.set(b.qid, { caseId: b.caseId, qid: b.qid, question: b.question, body });
  }
  for (const p of pairs) {
    const c = byId.get(p.caseId)!;
    bodyOf.set(p.qid, { caseId: p.caseId, qid: p.qid, question: p.question, body: assembleInput(c.chunks!, c.outcome.holding) });
  }
  if (targetDroppedByBudget) console.log(`(${targetDroppedByBudget} answerable question(s) skipped: target dropped by the assembly budget)`);
  const itemsFor = (qs: { qid: string }[]) =>
    qs.map((q) => bodyOf.get(q.qid)).filter((x): x is NonNullable<typeof x> => x !== undefined);

  const outDir = path.join(process.cwd(), "scripts", ".cache", "sufficiency-rows");
  const persist = async (header: Record<string, unknown>) => {
    await fs.mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, `${runId}.jsonl`);
    await fs.writeFile(outFile, [
      // Attrition and the split travel with the rows. A findings doc written weeks later from
      // the JSONL alone must be able to tell whether a rate came from 80 of 80 or 80 of 120,
      // and which questions were held out.
      JSON.stringify({ ...header, seed: SEED, writer: WRITER, judge: JUDGE, answerer: ANSWERER,
        nAnswerable: N_ANSWERABLE, nUnanswerable: N_UNANSWERABLE,
        devS: splitS.dev.map((q) => q.qid), testS: splitS.test.map((q) => q.qid),
        devX: splitX.dev.map((q) => q.qid), testX: splitX.test.map((q) => q.qid),
        targetDroppedByBudget, repairs, crossCheck,
        construction: { targetsRejectedByJudge, targetJudgeUnparsed, writerFails, writerMalformed, gimmes,
          discardedPairs, addressedFails, exhausted } }),
      ...rows,
    ].join("\n") + "\n", "utf8");
    console.log(`\nrows -> ${outFile}`);
  };
```

- [ ] **Step 7: Dev mode**

```ts
  if (MODE === "dev") {
    const devS = itemsFor(splitS.dev), devX = itemsFor(splitX.dev);
    const results: DevResult[] = [];

    console.log(`--- stage 1: ${STAGE1_RATERS.length} rater(s) at P0 ---`);
    for (const raterId of STAGE1_RATERS) {
      const configId = `P0/${raterId}`;
      const S = await score(configId, raterId, "P0", "S", devS);
      const X = await score(configId, raterId, "P0", "X", devX);
      assertNoCallFailures(callFailures, `stage 1, ${configId}`);
      results.push({ configId, armS: S.counts, armX: X.counts });
    }

    const stage1 = selectOnDev(results);
    console.log(`\nstage 1 winner: ${stage1.reason}`);
    if (!stage1.chosen) {
      console.log("\nno configuration cleared the leakage bar at stage 1 — stopping. The bar is not relaxed.");
      await persist({ kind: "dev", runId, results, chosen: null, reason: stage1.reason });
      return;
    }
    // configId is `P0/<rater>` and a rater id can itself contain "/", so rejoin everything after
    // the first segment rather than taking [1].
    const winner = stage1.chosen.configId.split("/").slice(1).join("/");

    console.log(`\n--- stage 2: ${STAGE2_VARIANTS.join(", ")} at ${winner} ---`);
    for (const variant of STAGE2_VARIANTS) {
      const configId = `${variant}/${winner}`;
      const S = await score(configId, winner, variant, "S", devS);
      const X = await score(configId, winner, variant, "X", devX);
      assertNoCallFailures(callFailures, `stage 2, ${configId}`);
      results.push({ configId, armS: S.counts, armX: X.counts });
    }

    console.log(`\n--- all ${results.length} configuration(s) on dev ---`);
    for (const r of results) {
      const fr = falseRefusalRate(r.armS), pfa = projectedFalseAnswerRate(r.armX);
      console.log(`  ${r.configId.padEnd(48)} false refusal ${(fr * 100).toFixed(1).padStart(5)}%  leakage ${(pfa * 100).toFixed(1).padStart(5)}%`);
    }
    const final = selectOnDev(results);
    console.log(`\n--- chosen (pre-registered rule) ---\n  ${final.reason}`);
    if (final.chosen) {
      console.log(`\nRun the test set ONCE with:\n  AWS_PROFILE=bedrock SUFFICIENCY_MODE=test SUFFICIENCY_CONFIG=${final.chosen.configId} npm run cases:sufficiency-eval:cloud`);
    }
    await persist({ kind: "dev", runId, results, chosen: final.chosen?.configId ?? null, reason: final.reason });
    return;
  }
```

- [ ] **Step 8: Test mode**

```ts
  // --- test mode --------------------------------------------------------------------------
  // The test set can be spent once. The pre-registered rule (spec §2) is that a FAILING result
  // does not license choosing another configuration and trying again — that turns test into a
  // second dev set. This does not prevent a second run; it makes one impossible to hide.
  const configId = process.env.SUFFICIENCY_CONFIG;
  if (!configId) {
    throw new Error(
      "SUFFICIENCY_MODE=test requires SUFFICIENCY_CONFIG=<variant>/<rater>. It is deliberately not " +
      "re-derived from dev: the operator states which configuration was chosen, and that statement " +
      "is what the manifest records.",
    );
  }
  const [variant, ...raterParts] = configId.split("/");
  const raterId = raterParts.join("/");
  if (!(VARIANT_IDS as readonly string[]).includes(variant) || !raterId) {
    throw new Error(`SUFFICIENCY_CONFIG must be <variant>/<rater>, e.g. P1/us.amazon.nova-pro-v1:0 — got "${configId}"`);
  }
  if (raterId === JUDGE || raterId === WRITER || raterId === ANSWERER) {
    throw new Error(`rater ${raterId} holds another role (judge/writer/answerer) — see the grid guard`);
  }

  const prior = await readTestRuns(outDir);
  if (prior.length) {
    console.log(`⚠ THE TEST SET HAS ALREADY BEEN RUN ${prior.length} TIME(S):`);
    for (const p of prior) {
      console.log(`    ${p.at}  ${p.configId}  arm S refused ${p.armS.insufficient}/${p.armS.sufficient + p.armS.insufficient} · arm X leaked ${p.armX.sufficient}/${p.armX.sufficient + p.armX.insufficient}`);
    }
    console.log(`  This is attempt ${prior.length + 1}. Any report MUST say so — a configuration selected by\n  re-running on the held-out set is a dev result wearing a test label.\n`);
  }

  const testS = itemsFor(splitS.test), testX = itemsFor(splitX.test);
  console.log(`--- TEST SET, ${configId} ---`);
  const S = await score(configId, raterId, variant as VariantId, "S", testS);
  assertNoCallFailures(callFailures, "test arm S");
  const X = await score(configId, raterId, variant as VariantId, "X", testX);
  assertNoCallFailures(callFailures, "test arm X");

  const fr = falseRefusalRate(S.counts), pfa = projectedFalseAnswerRate(X.counts);
  const nS = S.counts.sufficient + S.counts.insufficient, nX = X.counts.sufficient + X.counts.insufficient;
  const [frLo, frHi] = wilson(S.counts.insufficient, nS);
  const [pfaLo, pfaHi] = wilson(X.counts.sufficient, nX);
  const frConf = classify(S.counts.insufficient, nS, FALSE_REFUSAL_MAX);
  const pfaConf = classify(X.counts.sufficient, nX, PROJECTED_FALSE_ANSWER_MAX);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`\n--- result ---`);
  console.log(`  false refusal:          ${S.counts.insufficient}/${nS} = ${pct(fr)}  95% CI [${pct(frLo)}, ${pct(frHi)}]  bar ${pct(FALSE_REFUSAL_MAX)}  ${frConf}`);
  console.log(`  projected false answer: ${X.counts.sufficient}/${nX} = ${pct(pfa)}  95% CI [${pct(pfaLo)}, ${pct(pfaHi)}]  bar ${pct(PROJECTED_FALSE_ANSWER_MAX)}  ${pfaConf}`);
  console.log(`  unparsed: S ${S.unparsed} · X ${X.unparsed}   cache evictions: ${repairs}`);
  console.log(`\n  VERDICT (point estimate, same rule as #239): ${decide(fr, pfa).toUpperCase()}`);
  console.log(`  attempt ${prior.length + 1} on the test set`);

  await appendTestRun(outDir, { configId, at: new Date().toISOString(), armS: S.counts, armX: X.counts });
  await persist({ kind: "test", runId, configId, rater: raterId, variant,
    armS: S.counts, armX: X.counts, falseRefusal: fr, projectedFalseAnswer: pfa,
    frCI: [frLo, frHi], pfaCI: [pfaLo, pfaHi], frConfidence: frConf, pfaConfidence: pfaConf,
    decision: decide(fr, pfa), attempt: prior.length + 1,
    unparsed: { S: S.unparsed, X: X.unparsed }, callFailures: { S: S.failed, X: X.failed } });

  // Kept as a tripwire for a future edit that separates the counter from the row push. NOT an
  // independent reconciliation: in `score` the two are unconditionally adjacent, so this cannot
  // fire today.
  const tallied = S.counts.sufficient + S.counts.insufficient + X.counts.sufficient + X.counts.insufficient;
  if (rows.length !== tallied) throw new Error(`persisted ${rows.length} rows but tallied ${tallied} ratings`);
```

- [ ] **Step 9: npm scripts**

Leave the two `cases:sufficiency-eval*` lines in `package.json` **unchanged**. Mode is selected by
`SUFFICIENCY_MODE`, not by a separate script, so the two modes cannot drift in their env — which
matters because they must reconstruct the identical split.

- [ ] **Step 10: Verify**

```bash
npx tsc --noEmit
npx tsx scripts/test-cases-sufficiency.ts
npx tsx scripts/test-cases-caseqa-eval.ts
npx tsx scripts/test-cases-nli-probe.ts
npm run build
```

All must pass. `tsc` is the check that Step 6's deletions were complete — anything still
referencing the removed `RATER`, `shared`, `contaminated`, or the old `score` signature will fail.

- [ ] **Step 11: Verify the guards fire before any network or DynamoDB call**

Each must exit non-zero with only its own message. If any reaches a credentials or connection
error first, the guard is in the wrong place — report that, do not move code to make it pass.

```bash
SUFFICIENCY_MODE=test npx tsx scripts/cases-sufficiency-eval.ts
```
Expected: `SUFFICIENCY_MODE=test requires SUFFICIENCY_CONFIG`.

```bash
SUFFICIENCY_MODE=test SUFFICIENCY_CONFIG=P9/whatever npx tsx scripts/cases-sufficiency-eval.ts
```
Expected: `must be <variant>/<rater>`.

```bash
SUFFICIENCY_MODE=test SUFFICIENCY_CONFIG=P1/us.anthropic.claude-opus-4-5-20251101-v1:0 npx tsx scripts/cases-sufficiency-eval.ts
```
Expected: the role-clash message.

Note: the first three run before any repo access. The grid guard (Step 2) fires inside `main()`
after the repo read, so it is **not** expected to run credential-free — do not treat that as a
failure.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(sufficiency): dev/test modes, pre-registered grid, test-run manifest"
```

---


### Task 7: Whole-branch review

- [ ] **Step 1: Scope**

```bash
git diff --name-only origin/main..HEAD -- src/ | grep -v "^src/lib/cases/sufficiency/" || echo "none — product untouched"
git diff --name-only origin/main..HEAD -- scripts/cases-caseqa-eval.ts
```

Expected: `none — product untouched`; second command empty.

- [ ] **Step 2: Arm L is gone**

```bash
grep -rn "stripTarget\|assertTargetAbsent\|arms\.ts\|armL" src/ scripts/ || echo "none"
```

Expected: `none`.

- [ ] **Step 3: Full verification**

```bash
npx tsc --noEmit && npm run build && npx tsx scripts/test-cases-sufficiency.ts
```

- [ ] **Step 4: Report**

Summarise: which mutations were confirmed to apply and fail, anything that survived a mutation, and any guard that did not fire as specified.

---

## After the plan

1. Operator refreshes credentials (`aws sso login --profile bedrock`).
2. `AWS_PROFILE=bedrock SUFFICIENCY_MODE=dev npm run cases:sufficiency-eval:cloud` — runs the six-configuration grid, prints the chosen configuration and the exact test command.
3. Operator runs that test command **once**.
4. Findings doc, recommending nothing, stating the attempt number.
