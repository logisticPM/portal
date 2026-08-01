# Elision Bucket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `elision` bucket to the drop taxonomy, positioned before `transcription`, so the legitimate-quoting contamination inside *both* `transcription` (634) and `unseen` (51) becomes visible and the fabrication rate can be reported as a measured interval instead of a single number with a prose caveat.

**Architecture:** Two files change. `src/lib/cases/ingest/drop-cause.ts` gains a `classifyElision` helper and a seventh ordered bucket. `scripts/cases-drop-forensics.ts` gains a cross-tabulated diagnostic tally, an overlap histogram, and the fabrication interval. Nothing on the summarize path changes; `verifyClaims` is untouched; every claim that was dropped stays dropped.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes` NOT enabled), `tsx` runner scripts, `node:assert/strict` for offline tests, DynamoDB read via `dynamoCaseRepo`.

**Spec:** `docs/superpowers/specs/2026-07-31-elision-bucket-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/cases/ingest/drop-cause.ts` | Pure classifier. No I/O. | Add `ElisionDiag`, `MIN_FRAGMENT`, `classifyElision`, extend `DropCause`/`DropVerdict`, insert bucket 5. |
| `scripts/test-cases-drop-cause.ts` | Offline assertions against synthetic chunks. | Add elision cases + two ordering regressions. |
| `scripts/cases-drop-forensics.ts` | Read-only runner. Loads chunks, replays cache, tallies. | Add `elision` to ORDER/NOTE, cross-tab diag by final bucket, overlap histogram, fabrication interval. |

`drop-cause.ts` stays pure and I/O-free — that is why its tests run offline with zero credentials, and that property must survive this change.

---

### Task 1: `elision` bucket in the classifier

**Files:**
- Modify: `src/lib/cases/ingest/drop-cause.ts`
- Test: `scripts/test-cases-drop-cause.ts`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-cases-drop-cause.ts`, immediately before the final `console.log`:

```ts
// --- elision: legitimate quoting with the middle omitted ---
{
  const long = [p(1,
    "The appellant argued that the consultation was inadequate in every material respect. " +
    "Counsel devoted considerable time to the history of the negotiations. " +
    "I conclude that the Crown discharged its duty to consult in the circumstances.")];
  const asm = assemble(long);

  // Both fragments live in ONE chunk, in order → elision.
  const q = "The appellant argued that the consultation was inadequate in every material respect. " +
            "... I conclude that the Crown discharged its duty to consult";
  const v = classifyDrop(q, long, asm);
  assert.equal(v.cause, "elision");
  assert.equal(v.elisionDiag, undefined, "the bucket is earned, so there is no failure diagnostic");

  // Every ellipsis spelling reaches the same verdict.
  for (const marker of ["…", ". . .", "[...]", "[…]", "...."]) {
    assert.equal(classifyDrop(q.replace("...", marker), long, asm).cause, "elision",
      `spelling ${JSON.stringify(marker)} must classify the same as "..."`);
  }

  // Reversed → the fragments are all present but not in order.
  const rev = "I conclude that the Crown discharged its duty to consult" +
              " ... The appellant argued that the consultation was inadequate in every material respect.";
  const rv = classifyDrop(rev, long, asm);
  assert.notEqual(rv.cause, "elision");
  assert.equal(rv.elisionDiag, "out_of_order");

  // A fragment under MIN_FRAGMENT matches incidentally, so it does not earn the bucket.
  const short = "The appellant argued that the consultation was inadequate ... duty";
  const sv = classifyDrop(short, long, asm);
  assert.notEqual(sv.cause, "elision");
  assert.equal(sv.elisionDiag, "fragment_too_short");

  // A second fragment present in no chunk at all.
  const bogus = "The appellant argued that the consultation was inadequate in every material respect." +
                " ... The tribunal awarded punitive damages of four million dollars.";
  const bv = classifyDrop(bogus, long, asm);
  assert.notEqual(bv.cause, "elision");
  assert.equal(bv.elisionDiag, "fragment_not_found");
}

// --- cross_chunk_only: legitimate in real writing, but not the strict bucket ---
{
  const two = [
    p(1, "The Crown owed a fiduciary duty to the Nation in these circumstances of dispossession."),
    p(2, "Compensation was assessed at fair market value as of the date of the taking of the land."),
  ];
  const asm = assemble(two);
  const q = "The Crown owed a fiduciary duty to the Nation in these circumstances" +
            " ... Compensation was assessed at fair market value as of the date";
  const v = classifyDrop(q, two, asm);
  assert.notEqual(v.cause, "elision", "fragments in different chunks do not earn the strict bucket");
  assert.equal(v.elisionDiag, "cross_chunk_only");
}

// --- ORDERING REGRESSION: elision must outrank transcription ---
// This is the assertion the whole change exists for. An elided quote whose LONGEST fragment
// exceeds half the quote clears LCS >= 0.5, so if transcription were tested first it would
// absorb the case and the contamination inside that bucket would stay invisible forever.
// The precondition proves both buckets match this input.
{
  const long = [p(1,
    "The duty to consult arises when the Crown has knowledge of a potential Aboriginal claim and " +
    "contemplates conduct that might adversely affect it, a threshold that is not demanding. " +
    "Accordingly the appeal is allowed.")];
  const asm = assemble(long);
  const q = "The duty to consult arises when the Crown has knowledge of a potential Aboriginal claim and " +
            "contemplates conduct that might adversely affect it ... Accordingly the appeal is allowed.";
  const v = classifyDrop(q, long, asm);
  assert.ok(v.bestOverlap >= 0.5,
    `precondition: longest fragment is ${v.bestOverlap.toFixed(2)} of the quote, so transcription also matches`);
  assert.equal(v.cause, "elision", "elision must be tested BEFORE transcription");
}

// --- ORDERING REGRESSION: marker_bleed must outrank elision ---
{
  const long = [p(1,
    "The appellant argued that the consultation was inadequate in every material respect. " +
    "I conclude that the Crown discharged its duty to consult in the circumstances.")];
  const asm = assemble(long);
  const q = "The appellant argued that the consultation was inadequate in every material respect. " +
            "... [para para-1] I conclude that the Crown discharged its duty to consult";
  assert.equal(classifyDrop(q, long, asm).cause, "marker_bleed",
    "a marker problem is a marker problem first, even when the quote is also elided");
}
```

Also extend the import on line 3 so the new export is exercised:

```ts
import { classifyDrop, classifyElision, lcsSpan, widenFold, MIN_FRAGMENT } from "../src/lib/cases/ingest/drop-cause";
```

and add, directly under the existing `widenFold` block (after line 22):

```ts
// --- classifyElision returns null for quotes that are not elided at all ---
assert.equal(classifyElision("no ellipsis anywhere in this sentence", [p(1, "irrelevant")]), null);
assert.equal(MIN_FRAGMENT, 20);
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx tsx scripts/test-cases-drop-cause.ts
```

Expected: FAIL. TypeScript will not resolve `classifyElision` / `MIN_FRAGMENT` from `drop-cause.ts`.

- [ ] **Step 3: Implement**

In `src/lib/cases/ingest/drop-cause.ts`, replace the `DropCause` type and `DropVerdict` interface (lines 8–21) with:

```ts
export type DropCause =
  | "locate_bug"          // present verbatim — locate() should have found it
  | "marker_bleed"        // the quote swept up a "[para N]" prompt marker
  | "assembly_boundary"   // spans a seam that exists only in the assembled prompt
  | "normalization"       // matches after a fold normWs does not perform
  | "elision"             // legitimate quoting with the middle omitted
  | "transcription"       // a real passage, garbled
  | "unseen";             // absent from what the model was shown

// Why a quote that CONTAINED an ellipsis nonetheless failed the strict test. Never set when
// the quote has no ellipsis, and never set when the elision bucket was earned. Without these
// the bucket count is uninterpretable: it cannot separate "the rest are fabrications" from
// "the rest are elisions that fell under MIN_FRAGMENT".
export type ElisionDiag =
  | "cross_chunk_only"     // resolves in document order across chunks, not within one
  | "fragment_too_short"   // a fragment below MIN_FRAGMENT, which matches incidentally
  | "fragment_not_found"   // some fragment appears in no chunk
  | "out_of_order";        // every fragment present, but not in the quoted sequence

export interface DropVerdict {
  cause: DropCause;
  bestOverlap: number;
  bestPara: string | null;
  divergenceAt: number | null; // offset into the quote where the matched run ends
  elisionDiag?: ElisionDiag;
}
```

Then insert, after `widenFold` and before `pairsOf` (i.e. after line 56 of the current file):

```ts
// Below this, a fragment matches incidentally almost anywhere in a paragraph, and admitting
// those would inflate the bucket in exactly the direction that flatters us.
export const MIN_FRAGMENT = 20;

// widenFold has already collapsed "…", ". . ." and "[ ... ]" into ASCII dots, so one pattern
// covers every spelling instead of five.
const ELLIPSIS = /\s*[\[(]?\.{3,4}[\])]?\s*/;

// Leftmost match, no backtracking. If a fragment occurs twice and only the LATER occurrence
// leaves room for the next one, this returns false. With a 20-char floor that is rare, and
// the direction is the safe one: it makes the elision bucket a LOWER bound, which is what a
// number used to bound a fabrication rate should be.
const resolveInOrder = (fragments: string[], text: string): boolean => {
  let cursor = 0;
  for (const f of fragments) {
    const at = text.indexOf(f, cursor);
    if (at < 0) return false;
    cursor = at + f.length;
  }
  return true;
};

// Same scan, but the cursor may advance into later chunks. Each fragment must sit entirely
// within one chunk, so a join cannot manufacture a match that the document does not contain.
const resolveAcrossChunks = (fragments: string[], wide: string[]): boolean => {
  let ci = 0, cursor = 0;
  for (const f of fragments) {
    let placed = false;
    while (ci < wide.length) {
      const at = wide[ci].indexOf(f, cursor);
      if (at >= 0) { cursor = at + f.length; placed = true; break; }
      ci++; cursor = 0;
    }
    if (!placed) return false;
  }
  return true;
};

export interface ElisionResult {
  isElision: boolean;     // strict: every fragment inside ONE chunk, in order, non-overlapping
  diag?: ElisionDiag;
}

// null means "this quote is not elided at all" — distinct from "elided but did not qualify",
// which returns { isElision: false, diag }.
export function classifyElision(rawQuote: string, chunks: CaseChunk[]): ElisionResult | null {
  const fragments = widenFold(rawQuote).split(ELLIPSIS).map((f) => f.trim()).filter(Boolean);
  if (fragments.length < 2) return null;

  if (fragments.some((f) => f.length < MIN_FRAGMENT)) {
    return { isElision: false, diag: "fragment_too_short" };
  }
  const wide = chunks.map((c) => widenFold(c.text));
  if (wide.some((t) => resolveInOrder(fragments, t))) return { isElision: true };
  if (resolveAcrossChunks(fragments, wide)) return { isElision: false, diag: "cross_chunk_only" };
  if (fragments.every((f) => wide.some((t) => t.includes(f)))) {
    return { isElision: false, diag: "out_of_order" };
  }
  return { isElision: false, diag: "fragment_not_found" };
}
```

Finally, in `classifyDrop`, replace the tail of the function — the current step 5 and step 6 — with:

```ts
  // 5. Legitimate quoting with the middle omitted, MISFILED by the six-bucket taxonomy.
  //    Must be tested BEFORE transcription: an elided quote whose longest fragment exceeds
  //    half the quote clears LCS >= 0.5, so transcription would absorb it and the
  //    contamination inside that bucket would stay invisible however often it happened.
  const el = classifyElision(rawQuote, chunks);
  if (el?.isElision) return { cause: "elision", ...base };
  const elisionDiag = el?.diag;

  // 6. A real passage, garbled.
  if (base.bestOverlap >= 0.5) return { cause: "transcription", ...base, elisionDiag };

  // 7. The model was never shown this.
  return { cause: "unseen", ...base, elisionDiag };
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx tsx scripts/test-cases-drop-cause.ts
```

Expected: `✅ test-cases-drop-cause passed`

If the `elision must be tested BEFORE transcription` precondition assertion fails — meaning `bestOverlap < 0.5` for that fixture — do **not** weaken the assertion. Lengthen the first fragment in the fixture until the precondition holds, because a regression test that does not actually trigger both buckets proves nothing about precedence.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. `DropVerdict.elisionDiag` is optional and the repo does not enable `exactOptionalPropertyTypes`, so `{ ...base, elisionDiag }` with an `undefined` value is legal.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/ingest/drop-cause.ts scripts/test-cases-drop-cause.ts
git commit -m "feat(cases): elision bucket, tested before transcription"
```

---

### Task 2: Runner reports the interval, the cross-tab, and the histogram

**Files:**
- Modify: `scripts/cases-drop-forensics.ts`

- [ ] **Step 1: Add the bucket to the ordered lists**

Replace lines 26–34 of `scripts/cases-drop-forensics.ts`:

```ts
const ORDER: DropCause[] = ["locate_bug", "marker_bleed", "assembly_boundary", "normalization", "elision", "transcription", "unseen"];
const NOTE: Record<DropCause, string> = {
  locate_bug: "BUG in locate() — investigate before reading anything else",
  marker_bleed: "recoverable — our prompt marker",
  assembly_boundary: "recoverable — our assembly seam",
  normalization: "recoverable — widen normWs",
  elision: "NOT a defect — legitimate quoting, misfiled by the six-bucket taxonomy",
  transcription: "recoverable only by span alignment",
  unseen: "NOT recoverable — the model was never shown this text",
};
const DIAGS: ElisionDiag[] = ["cross_chunk_only", "fragment_too_short", "fragment_not_found", "out_of_order"];
```

and extend the import on line 13:

```ts
import { classifyDrop, type DropCause, type ElisionDiag } from "../src/lib/cases/ingest/drop-cause";
```

- [ ] **Step 2: Add the accumulators**

Replace line 40 (`let cases = 0, totalDrops = 0, noClaims = 0, mismatches = 0;`) with:

```ts
  let cases = 0, totalDrops = 0, noClaims = 0, mismatches = 0;
  // Cross-tabulated, NOT a flat count: a cross_chunk_only claim can land in either
  // transcription or unseen, and the fabrication floor needs the unseen half specifically.
  const diagTally = Object.fromEntries(
    DIAGS.map((d) => [d, { transcription: 0, unseen: 0 } as Record<string, number>]),
  ) as Record<ElisionDiag, Record<string, number>>;
  const transcriptionOverlaps: number[] = [];
```

- [ ] **Step 3: Record into them**

In the claim loop, immediately after the existing `totalDrops++;` (line 82), insert:

```ts
      if (v.elisionDiag) diagTally[v.elisionDiag][v.cause] = (diagTally[v.elisionDiag][v.cause] ?? 0) + 1;
      if (v.cause === "transcription") transcriptionOverlaps.push(v.bestOverlap);
```

- [ ] **Step 4: Report**

Replace lines 103–105 (the `recoverable` and `fabrication rate` block) with:

```ts
  // elision belongs here: its fragments match exactly, so anchoring them needs no alignment.
  const recoverable = tally.marker_bleed + tally.assembly_boundary + tally.normalization + tally.elision;
  console.log(`\n  recoverable without span alignment: ${recoverable}`);

  console.log(`\n  elision diagnostics (quotes containing an ellipsis that missed the bucket):`);
  for (const d of DIAGS) {
    console.log(`    ${d.padEnd(20)} transcription ${String(diagTally[d].transcription).padStart(4)} · unseen ${String(diagTally[d].unseen).padStart(4)}`);
  }

  const floor = tally.unseen - diagTally.cross_chunk_only.unseen;
  const pc = (n: number) => (totalDrops ? ((n / totalDrops) * 100).toFixed(1) : "0") + "%";
  console.log(`\n  fabrication rate: ${pc(floor)} (floor, cross-chunk elisions in unseen removed)` +
              ` … ${pc(tally.unseen)} (ceiling, all of unseen)`);

  const sorted = [...transcriptionOverlaps].sort((a, b) => a - b);
  const q = (f: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] : 0);
  console.log(`\n  transcription overlap (n=${sorted.length}): ` +
    ["p10", "p25", "p50", "p75", "p90"].map((l, i) => `${l} ${q([0.1, 0.25, 0.5, 0.75, 0.9][i]).toFixed(2)}`).join(" · "));
  // Integer bin indices, NOT `lo += 0.05`: accumulated float error would leave the last
  // bound at 0.9999… and silently drop every claim at exactly 1.00 — the densest bin.
  for (let b = 10; b < 20; b++) {
    const lo = b / 20, hi = (b + 1) / 20;
    const n = sorted.filter((o) => o >= lo && (b === 19 ? o <= hi : o < hi)).length;
    if (n) console.log(`    ${lo.toFixed(2)}–${hi.toFixed(2)}  ${String(n).padStart(4)}  ${"█".repeat(Math.round((n / sorted.length) * 60))}`);
  }
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Verify the runner still refuses to run without data**

The runner needs DynamoDB. Confirm it fails loudly rather than silently producing an empty distribution:

```bash
npx tsx scripts/cases-drop-forensics.ts
```

Expected: a non-zero exit with `❌ cases-drop-forensics failed:` and a credentials/endpoint error. **Do not** interpret an empty or zero-drop table as a pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/cases-drop-forensics.ts
git commit -m "feat(cases): report fabrication interval, elision cross-tab, overlap histogram"
```

---

## After the tasks (controller, not a subagent)

1. Final whole-branch review.
2. **Credentialed run** — `npm run cases:drop-forensics:cloud`, needs AWS read access. Zero Bedrock calls; the 2792-entry cache in this worktree is warm. Do not pipe through `tail` — it masks the exit code.
3. **Revise `docs/research/2026-07-31-claim-drop-forensics.md`**: a Revision section at the top carrying the corrected 7-bucket distribution, the fabrication interval, and the overlap histogram. Leave the original 6-bucket distribution visible below as the record of what that taxonomy measured. State plainly that the earlier framing missed the `transcription` contamination. **Recommend nothing**, including on RM-4.
4. Open the PR. Wait for explicit approval before merging.

## Self-review notes

- **Spec coverage:** seventh bucket (T1), position before `transcription` (T1 ordering regression), strict single-chunk test (T1), `cross_chunk_only` as a counter not a bucket (T1 + T2 cross-tab), `MIN_FRAGMENT` floor (T1), four failure reasons (T1), `DropVerdict.elisionDiag` (T1), cross-tab by final bucket (T2), interval with the correct floor (T2), overlap histogram + percentiles (T2), doc revision (controller step 3), recommend-nothing (controller step 3).
- **Naming consistency:** `classifyElision`, `ElisionResult`, `ElisionDiag`, `MIN_FRAGMENT`, `elisionDiag`, `diagTally`, `transcriptionOverlaps` used identically in both tasks.
- **Not covered by a task, deliberately:** no change to `verifyClaims`, `normWs`, `locate()`, `assembleInput`, or the npm scripts. The spec lists all of these under "Explicitly NOT doing".
