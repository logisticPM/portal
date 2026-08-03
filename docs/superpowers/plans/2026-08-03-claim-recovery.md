# Claim Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anchor a claim whose quote matches exactly one paragraph near-exactly, so that 352 previously-discarded claims survive and the two core cases that currently produce no summary at all produce one.

**Architecture:** One function changes. `verifyClaims`'s chunk scan — which already runs on every path and today only feeds diagnostics — is extracted into a helper that also returns the runner-up, and `locate()` gains a fourth attempt that uses it. `CitationAnchor` and `SummaryMeta` gain one field each so the recovered share is visible.

**Tech Stack:** TypeScript (strict), `tsx`, `node:assert/strict`, DynamoDB single-table.

**Spec:** `docs/superpowers/specs/2026-08-03-claim-recovery-design.md`

---

## Two facts that shape the work

**The scan is already paid for.** `summarizer.ts:85` says the overlap scan is "Off by default; summarizeCase (batch-only) turns it on". That comment is **stale**: `caseqa/generator.ts:61` (added by #218) and `summarizer.ts:235` both pass `measureOverlap: true`, so every production path already scans every chunk for every drop. Recovery therefore adds **no new cost** — it uses a result that is already computed and currently thrown away. Fix the comment while you are there.

**The `Required<LegalCase>` canary will not catch `matched`.** `scripts/test-cases-table.ts` forces new **top-level** `LegalCase` fields into `itemToCase`, but it does not recurse into nested objects. `CitationAnchor` is nested inside `summary.claims`, so a `matched` field that fails to round-trip through DynamoDB would pass every existing test. Task 3 adds an explicit round-trip assertion; do not skip it.

---

## File Structure

| File | Change |
|---|---|
| `src/lib/cases/ingest/summarizer.ts` | Extract the scan; add the recovery attempt; count recoveries |
| `src/lib/cases/types.ts` | `CitationAnchor.matched?`, `SummaryMeta.claimsRecovered?` |
| `scripts/test-cases-summarizer.ts` | The recovery rules |
| `scripts/test-cases-table.ts` | Round-trip assertion for the nested field |
| `src/app/cases/methodology/page.tsx` | Disclose the corpus-wide recovered rate |

---

### Task 1: The recovery rule

**Files:**
- Modify: `src/lib/cases/ingest/summarizer.ts`, `src/lib/cases/types.ts`
- Test: `scripts/test-cases-summarizer.ts`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-cases-summarizer.ts`, before its final `console.log`:

```ts
// --- near-exact recovery -------------------------------------------------------------
// 25% of all claims are discarded for a quote that does not match verbatim, and the
// forensics showed 352 of them share >=95% of the quote contiguously with real judgment
// text (median 0.98). Two core cases produce NO summary because every claim was dropped at
// 0.97 and 1.00. The quote is a locator that is never published, so recovering one attaches
// an assertion to a paragraph number — mis-attribution is the only risk, and uniqueness is
// the guard.
{
  const body = (n: string) =>
    `The Crown owed a fiduciary duty to the Nation in the circumstances of this case ${n}. ` +
    `Compensation is assessed by reference to the lost opportunity rather than historic value ${n}.`;
  const mk = (paras: string[]) => paras.map((p, i) => ({ paragraph: `para-${i + 1}`, text: p }));
  const claim = (quote: string) => [{ text: "The Crown owed a fiduciary duty.", quote, paragraph: "para-1" }];
  const URL = "https://example.test/j";

  // Exact match: unchanged, and NOT marked as recovered.
  {
    const chunks = mk([body("A")]);
    const r = verifyClaims(claim("The Crown owed a fiduciary duty to the Nation"), chunks, URL, { measureOverlap: true });
    assert.equal(r.anchors.length, 1);
    assert.equal(r.anchors[0].matched, undefined, "the exact path must stay byte-identical to today");
  }

  // One leading character wrong — the real sampled case scored 0.99 with the divergence at
  // character 0. Exactly one chunk matches, so it recovers.
  {
    const chunks = mk([body("A")]);
    const r = verifyClaims(claim("Xhe Crown owed a fiduciary duty to the Nation in the circumstances of this case A"), chunks, URL, { measureOverlap: true });
    assert.equal(r.anchors.length, 1, "a one-character garble must not cost the claim");
    assert.equal(r.anchors[0].matched, "near");
    assert.equal(r.anchors[0].sourceParagraph, "para-1");
    assert.equal(r.dropped, 0);
  }

  // Below the threshold: still dropped. The threshold has to bite.
  {
    const chunks = mk([body("A")]);
    const q = "The Crown owed a XXXXXXXXXX duty to the YYYYYYYY in the ZZZZZZZZZZ of this case A";
    const r = verifyClaims(claim(q), chunks, URL, { measureOverlap: true });
    assert.equal(r.anchors.length, 0, "0.95 is a floor, not a suggestion");
    assert.equal(r.drops[0].reason, "no_span");
  }

  // THE GUARD: two NON-ADJACENT chunks both match near-exactly → ambiguous → dropped.
  // Boilerplate repeated across a judgment is exactly this case. If this assertion ever
  // goes green with an anchor, the design has lost its only protection against
  // mis-attribution.
  {
    const chunks = mk([body("A"), "An unrelated paragraph about procedure and scheduling.", body("A")]);
    const r = verifyClaims(claim("Xhe Crown owed a fiduciary duty to the Nation in the circumstances of this case A"), chunks, URL, { measureOverlap: true });
    assert.equal(r.anchors.length, 0, "two paragraphs matching near-exactly is a coin flip — decline");
    assert.equal(r.drops[0].reason, "no_span");
  }

  // A chunk AND ITS IMMEDIATE NEIGHBOUR are one competitor, not two. locate()'s own
  // adjacent-pair window already treats them as one span, so counting them as rivals would
  // block a straddling quote the exact path would have accepted.
  {
    const chunks = mk([body("A"), body("A")]);
    const r = verifyClaims(claim("Xhe Crown owed a fiduciary duty to the Nation in the circumstances of this case A"), chunks, URL, { measureOverlap: true });
    assert.equal(r.anchors.length, 1, "neighbours are one competitor");
    assert.equal(r.anchors[0].matched, "near");
  }

  // Sharing nothing substantial: unchanged. The fabrication ceiling must not move.
  {
    const chunks = mk([body("A")]);
    const r = verifyClaims(claim("The tribunal awarded punitive damages of four million dollars to the claimant."), chunks, URL, { measureOverlap: true });
    assert.equal(r.anchors.length, 0);
  }

  // Recovery works with measurement OFF too — diagnostics are opt-in, recovery is not.
  {
    const chunks = mk([body("A")]);
    const r = verifyClaims(claim("Xhe Crown owed a fiduciary duty to the Nation in the circumstances of this case A"), chunks, URL);
    assert.equal(r.anchors.length, 1, "recovery must not depend on measureOverlap");
  }
}
```

Add `verifyClaims` to the file's imports from `summarizer` if it is not already there.

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx scripts/test-cases-summarizer.ts
```

Expected: FAIL on the one-character-garble case — it is dropped today.

- [ ] **Step 3: Add the fields**

In `src/lib/cases/types.ts`:

```ts
export interface CitationAnchor {
  text: string;
  sourceParagraph: string;
  sourceUrl: string;
  // "near" when the quote matched exactly one paragraph at >=95% contiguous overlap rather
  // than verbatim. Absent means exact, so every anchor already stored stays valid.
  matched?: "exact" | "near";
}
```

and in `SummaryMeta`, beside `claimsDropped`:

```ts
  claimsRecovered?: number;   // anchored by near-exact match rather than verbatim
```

- [ ] **Step 4: Implement the recovery**

In `summarizer.ts`, first correct the stale comment above `VerifyClaimsOpts`:

```ts
// Scanning every chunk costs ~65ms per drop on a large case. Both production callers now
// pass measureOverlap (summarizeCase and, since #218, the interactive case-QA path), so the
// scan is already paid for on every path — which is why near-exact recovery below adds no
// new cost. The flag now controls only whether the ClaimDrop diagnostics are populated.
export interface VerifyClaimsOpts { measureOverlap?: boolean }
```

Then, inside `verifyClaims`, immediately after the `findCited` definition, add the shared scan:

```ts
  // Recover a claim whose quote matches exactly one paragraph near-exactly.
  //
  // 0.95: a single substituted word splits the quote and leaves the longer fragment at
  // roughly half its length, so 0.5 is the one-garbled-word floor and 0.95 sits far above
  // it. It is also where the mass is — 352 of 631 transcription drops, median 0.98.
  const NEAR = 0.95;

  // One scan, two consumers: the recovery decision and the drop diagnostics. Returns the
  // best chunk and the best NON-ADJACENT rival, because a quote straddling a chunk boundary
  // scores well against both halves and locate()'s adjacent-pair window already treats that
  // pair as one span — counting them as rivals would block a quote the exact path accepts.
  const scan = (quote: string) => {
    let bestOverlap = 0, bestIdx = -1;
    const overlaps = norm.map((n) => longestCommonSubstringLen(quote, n.text) / quote.length);
    overlaps.forEach((o, i) => { if (o > bestOverlap) { bestOverlap = o; bestIdx = i; } });
    let rival = 0;
    overlaps.forEach((o, i) => { if (Math.abs(i - bestIdx) > 1 && o > rival) rival = o; });
    return { bestOverlap, bestPara: bestIdx >= 0 ? norm[bestIdx].para : null, rival };
  };
```

Replace `locate` with a version that takes the scan result:

```ts
  const locate = (quote: string, citedPara: string): { para: string; near: boolean } | null => {
    const cited = findCited(citedPara);
    if (cited && cited.text.includes(quote)) return { para: cited.para, near: false };
    const holder = norm.find((n) => n.text.includes(quote));
    if (holder) return { para: holder.para, near: false };
    for (let i = 0; i + 1 < norm.length; i++) {
      if ((norm[i].text + " " + norm[i + 1].text).includes(quote)) return { para: norm[i].para, near: false };
    }
    // Fourth attempt: exactly one paragraph matches near-exactly. Two matching paragraphs
    // is a coin flip, so decline rather than guess — the quote is never published, so the
    // only harm this design can do is point a reader at the wrong paragraph.
    const s = scan(quote);
    if (s.bestOverlap >= NEAR && s.rival < NEAR && s.bestPara) return { para: s.bestPara, near: true };
    return null;
  };
```

Change `record` to reuse the scan instead of running its own:

```ts
  const record = (reason: ClaimDropReason, quote: string, citedPara: string) => {
    const canMeasure = measure && reason === "no_span" && quote.length > 0;
    const s = canMeasure ? scan(quote) : { bestOverlap: 0, bestPara: null as string | null };
    drops.push({
      reason, quoteLen: quote.length, citedPara, citedParaFound: !!findCited(citedPara),
      overlapMeasured: canMeasure, bestOverlap: s.bestOverlap, bestPara: s.bestPara,
    });
  };
```

Then count recoveries and use the new `locate` shape. Replace the tail of the claim loop:

```ts
    const hit = locate(quote, citedPara);
    if (hit !== null) {
      anchors.push(hit.near
        ? { text, sourceParagraph: hit.para, sourceUrl, matched: "near" }
        : { text, sourceParagraph: hit.para, sourceUrl });
      if (hit.near) recovered++;
    } else record("no_span", quote, citedPara);
```

Declare `recovered` beside `anchors`:

```ts
  let recovered = 0;
```

and return it:

```ts
  return { anchors, dropped: claims.length - anchors.length, drops, recovered };
```

Widen the return type in the signature to include `recovered: number`.

**Note the deliberate asymmetry:** an exact anchor omits `matched` entirely rather than
setting `"exact"`. Every anchor already in DynamoDB was written without the field, so
"absent means exact" keeps them valid with no migration.

- [ ] **Step 5: Thread `recovered` into `summaryMeta`**

In `summarizeCase` (around line 235), the `verifyClaims` result now carries `recovered`.
Add it to the `SummaryMeta` it builds:

```ts
    claimsRecovered: recovered,
```

Find the existing `claimsDropped:` line in that object and put it directly beneath.

- [ ] **Step 6: Run the tests and typecheck**

```bash
npx tsx scripts/test-cases-summarizer.ts && npx tsc --noEmit
```

Expected: pass, clean. Other callers of `verifyClaims` destructure only the fields they use,
so adding `recovered` is non-breaking — report if any does not compile.

**If the two-non-adjacent-chunks assertion fails and produces an anchor, STOP.** That is the
only guard against mis-attribution and it must not be weakened to make a test pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cases/ingest/summarizer.ts src/lib/cases/types.ts scripts/test-cases-summarizer.ts
git commit -m "feat(cases): anchor a quote that matches exactly one paragraph near-exactly"
```

---

### Task 2: Prove the nested field survives DynamoDB

**Files:**
- Modify: `scripts/test-cases-table.ts`

- [ ] **Step 1: Write the failing test**

The `Required<LegalCase>` canary in this file forces new **top-level** fields into
`itemToCase`, but it does **not** recurse into nested objects. `CitationAnchor` lives inside
`summary.claims`, so `matched` could silently fail to round-trip and every existing test
would still pass.

Append, before the file's final `console.log`:

```ts
// --- CitationAnchor.matched survives the round trip -----------------------------------
// The Required<LegalCase> canary above does NOT recurse into nested objects, so a new field
// on CitationAnchor is invisible to it. Without this assertion, `matched` could be dropped
// by caseToItems/itemToCase and the only symptom would be a silently missing disclosure.
{
  const withNear: LegalCase = {
    ...caseFixtures[0],
    summary: { claims: [
      { text: "exact one", sourceParagraph: "para-1", sourceUrl: "https://example.test/j" },
      { text: "near one", sourceParagraph: "para-2", sourceUrl: "https://example.test/j", matched: "near" },
    ] },
  };
  const back = itemToCase(caseToItems(withNear)[0]);
  assert.equal(back.summary?.claims[1].matched, "near", "matched must survive the round trip");
  assert.equal(back.summary?.claims[0].matched, undefined, "absent stays absent — no migration needed");
}
```

Use whatever import names this file already uses for `caseToItems`, `itemToCase`,
`caseFixtures` and the `LegalCase` type; do not add new import styles.

- [ ] **Step 2: Run it**

```bash
npx tsx scripts/test-cases-table.ts
```

If it **passes** immediately, that is the expected outcome — `data: rest` stores the whole
object graph, so nested fields ride along. Say so in your report. The test earns its place by
making that a guarantee rather than an accident.

If it **fails**, `caseToItems`/`itemToCase` is projecting anchors field by field somewhere;
report where before changing anything.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-cases-table.ts
git commit -m "test(dynamo): pin CitationAnchor.matched through the round trip"
```

---

### Task 3: Disclose the recovered share

**Files:**
- Modify: `src/app/cases/methodology/page.tsx`

- [ ] **Step 1: Add the disclosure**

The methodology page already renders `st.core` and the screening funnel. Add a sentence to
the "Sources & provenance" section — find the paragraph that begins "Cases are harvested from
the open A2AJ API" and add immediately after that `</p>`:

```tsx
          <p className="mt-2">
            Each plain-language point is anchored to a paragraph by locating its quotation in
            the judgment. Most match the text verbatim; a small share match exactly one
            paragraph to within a few characters and are anchored to it, which recovers
            points that a strict verbatim test would discard. A quotation matching two
            paragraphs equally well is <strong>not</strong> anchored — an ambiguous citation
            is worse than a missing one. The model&rsquo;s quotation is never published; it
            is used only to find the paragraph.
          </p>
```

- [ ] **Step 2: Typecheck and build**

```bash
npx tsc --noEmit && npm run build 2>&1 | grep -E "✓ Compiled|Failed"
```

- [ ] **Step 3: Commit**

```bash
git add src/app/cases/methodology/page.tsx
git commit -m "docs(cases): methodology states how near-exact anchoring works"
```

---

## After the tasks (controller, not a subagent)

1. Final whole-branch review.
2. **Dry measurement first.** Re-run the forensics (`cases:drop-forensics:cloud`) — it replays
   the warm cache and calls `verifyClaims`, so the drop count should fall from 707 toward
   ~355 with no new LLM spend. If it does not move, the recovery is not firing and nothing
   else should run.
3. **`FORCE=1 cases:summarize:cloud`** over the corpus, or scoped to the affected cases.
   Confirm `2008-scc-41` and `2025-scc-4` now produce summaries.
4. Record the before/after in `docs/research/`. Open the PR.

## Self-review notes

- **Spec coverage:** 0.95 threshold (T1 `NEAR`), uniqueness instead of a margin (T1 `rival`),
  neighbours as one competitor (T1 `Math.abs(i - bestIdx) > 1`), recovery independent of
  `measureOverlap` (T1 test), `matched` on the anchor (T1) and its round trip (T2),
  `claimsRecovered` (T1 step 5), corpus-wide disclosure (T3), bands below 0.95 untouched.
- **Naming:** `NEAR`, `scan`, `rival`, `matched`, `claimsRecovered`, `recovered`.
- **Unchanged:** `drop-cause.ts` stays measurement-only, `longestCommonSubstringLen` is
  reused not rewritten, `MIN_TEXT`, the 6-anchor cap, and every band below 0.95.
