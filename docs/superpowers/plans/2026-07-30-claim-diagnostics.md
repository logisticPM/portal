# Briefing Dependency Fix + Claim-Drop Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop briefings from rendering principles that cite a case with no visible precedent entry, and instrument claim drops so the next summarize run tells us — from our own corpus — whether span alignment is worth building.

**Architecture:** Two independent, purely local changes. (A) `verifyBriefing` filters principle `caseIds` against the precedents that survived verification instead of the retrieved set. (B) `verifyClaims` returns a per-drop diagnostic record including the longest-common-substring overlap against the *cited* paragraph, with **zero change to which claims are accepted**; the batch runner aggregates it into a histogram.

**Tech Stack:** TypeScript, `tsx` tests (async-IIFE + `node:assert/strict`).

**Spec:** `docs/superpowers/specs/2026-07-30-claim-diagnostics-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/cases/briefs/generator.ts` | Part A: `verifyBriefing` dependency filter. |
| `src/lib/cases/ingest/summarizer.ts` | Part B: `ClaimDrop` types, `longestCommonSubstringLen`, `verifyClaims` diagnostics, `SummarizeResult.drops`. |
| `scripts/cases-summarize.ts` | Part B reporting: aggregate + print the histogram. |
| `scripts/test-cases-briefs.ts` | Part A tests. |
| `scripts/test-cases-summarizer.ts` | Part B tests, including the no-behaviour-change regression. |

Context the implementer needs: `verifyClaims` returns `CitationAnchor { text, sourceParagraph, sourceUrl }` — **the quote is deliberately not stored**; it is a verification token. `summarizeCase` returns `{ status, claimsDropped, summary?, … }` and calls `verifyClaims` at one site.

---

## Task 1: Part A — briefing dependency filter

**Files:**
- Modify: `src/lib/cases/briefs/generator.ts`
- Modify: `scripts/test-cases-briefs.ts`

- [ ] **Step 1: Write the failing test**

Append to the async IIFE in `scripts/test-cases-briefs.ts`, before its final `console.log("✅ …")`:
```ts
  // --- verifyBriefing: principles may only cite precedents the reader can SEE ---
  // A precedent dropped for an empty `establishes` must not leave a principle citing it.
  // NB: named depFilterIds, not `retrieved` — this file already declares a `retrieved`
  // at ~line 63 and the whole suite is one async IIFE, so that would be a duplicate
  // const in the same scope and the file would not even parse.
  const depFilterIds = ["a", "b", "c"];
  const droppedEstablishes = verifyBriefing({
    background: "bg",
    precedents: [
      { caseId: "a", establishes: "A holds x", relevance: "matters" },
      { caseId: "b", establishes: "B holds y", relevance: "matters" },
      { caseId: "c", establishes: "   ", relevance: "matters" }, // dropped: empty establishes
    ],
    principles: [
      { text: "principle citing a surviving precedent", caseIds: ["a"] },
      { text: "principle citing the dropped precedent only", caseIds: ["c"] },
      { text: "principle citing both", caseIds: ["a", "c"] },
    ],
    considerations: "cons",
  }, depFilterIds);
  assert.ok(droppedEstablishes, "2 surviving precedents → publishes");
  assert.deepEqual(droppedEstablishes!.body.precedents.map((p) => p.caseId), ["a", "b"]);
  assert.equal(droppedEstablishes!.body.principles.length, 2, "the c-only principle is dropped entirely");
  assert.deepEqual(droppedEstablishes!.body.principles[0].caseIds, ["a"]);
  assert.deepEqual(droppedEstablishes!.body.principles[1].caseIds, ["a"], "c is stripped from the mixed principle");

  // A precedent dropped by the 6-entry cap must also not be citable.
  const sevenIds = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
  const capped = verifyBriefing({
    background: "bg",
    precedents: sevenIds.map((id) => ({ caseId: id, establishes: `${id} holds`, relevance: "matters" })),
    principles: [{ text: "cites the capped-out 7th", caseIds: ["p7"] }],
    considerations: "cons",
  }, sevenIds);
  assert.ok(capped, "publishes");
  assert.equal(capped!.body.precedents.length, 6, "capped at 6");
  assert.equal(capped!.body.principles.length, 0, "a principle citing only the capped-out precedent is dropped");

  // Regression: the <2 surviving precedents rule still refuses.
  assert.equal(verifyBriefing({
    background: "bg",
    precedents: [{ caseId: "a", establishes: "A holds", relevance: "matters" }],
    principles: [{ text: "p", caseIds: ["a"] }],
    considerations: "cons",
  }, ["a"]), null, "<2 precedents → refuse");
```
If `verifyBriefing` is not already imported in this file, add it to the existing import from `../src/lib/cases/briefs/generator`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-cases-briefs.ts`
Expected: FAIL — `the c-only principle is dropped entirely` (currently 3 principles survive, because `c` is in the *retrieved* set).

- [ ] **Step 3: Fix `verifyBriefing`**

In `src/lib/cases/briefs/generator.ts`, replace the `const principles = …` block with:
```ts
  // A principle may only cite precedents the reader can actually SEE. `valid` (the retrieved set)
  // is the wrong gate: a precedent can be dropped for an empty establishes/relevance, as a
  // duplicate, or by the 6-entry cap, and a principle citing it would render as a dangling
  // reference to a case with no entry on the page. Computed AFTER the cap, so cap-trimmed
  // precedents are excluded too. This can only ever tighten output.
  const survivingIds = new Set(precedents.map((p) => p.caseId));
  const principles = body.principles
    .map((pr) => ({ text: pr.text.trim(), caseIds: pr.caseIds.map((id) => id.trim()).filter((id) => survivingIds.has(id)) }))
    .filter((pr) => pr.text && pr.caseIds.length > 0)
    .slice(0, 4);
```
Leave everything else — the `valid` set for precedents, the dedupe, the `dropped` computation, and the `precedents.length < 2 ⇒ null` rule — exactly as it is.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-cases-briefs.ts`
Expected: `✅ …` (whatever the file's existing success line is).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/briefs/generator.ts scripts/test-cases-briefs.ts
git commit -m "fix(briefs): principles may only cite precedents that survived verification"
```

---

## Task 2: Part B — claim-drop diagnostics (zero behaviour change)

**Files:**
- Modify: `src/lib/cases/ingest/summarizer.ts`
- Modify: `scripts/test-cases-summarizer.ts`

- [ ] **Step 1: Write the failing tests**

Append to the async IIFE in `scripts/test-cases-summarizer.ts`, before its final success `console.log`:
```ts
  // --- longestCommonSubstringLen ---
  assert.equal(longestCommonSubstringLen("abcdef", "abcdef"), 6, "identical");
  assert.equal(longestCommonSubstringLen("abc", "xyz"), 0, "disjoint");
  assert.equal(longestCommonSubstringLen("xxhello worldyy", "zzhello worldww"), 11, "shared middle");
  assert.equal(longestCommonSubstringLen("", "abc"), 0, "empty");

  // --- verifyClaims diagnostics: categorise WITHOUT changing what survives ---
  const diagChunks = [
    { paragraph: "para-1", text: "The Crown owed a fiduciary duty to the Nation in these circumstances." },
    { paragraph: "para-2", text: "Compensation was assessed at fair market value as of the date of taking." },
  ];
  const diag = verifyClaims([
    { text: "", quote: "The Crown owed a fiduciary duty to the Nation", paragraph: "para-1" },
    { text: "short quote", quote: "too short", paragraph: "para-1" },
    { text: "near miss", quote: "The Crown owed a fiduciary duty to the People in these circumstances.", paragraph: "para-1" },
    { text: "paraphrase", quote: "The government had to act in the best interests of the community here.", paragraph: "para-2" },
    { text: "bad para id", quote: "Some quote that is long enough to pass the length rule", paragraph: "para-999" },
  ], diagChunks, "https://x/y");

  assert.equal(diag.anchors.length, 0, "none of these verify");
  assert.equal(diag.drops.length, 5, "one diagnostic per dropped claim");
  assert.equal(diag.drops[0].reason, "no_text");
  assert.equal(diag.drops[1].reason, "quote_too_short");

  const nearMiss = diag.drops[2];
  assert.equal(nearMiss.reason, "no_span");
  assert.equal(nearMiss.citedParaFound, true);
  assert.ok(nearMiss.bestOverlap >= 0.6, `near miss has high overlap, got ${nearMiss.bestOverlap.toFixed(2)}`);

  const paraphrase = diag.drops[3];
  assert.equal(paraphrase.reason, "no_span");
  assert.equal(paraphrase.citedParaFound, true);
  assert.ok(paraphrase.bestOverlap < nearMiss.bestOverlap, "a paraphrase overlaps less than a near miss");

  assert.equal(diag.drops[4].citedParaFound, false, "para-999 does not resolve");
  assert.equal(diag.drops[4].bestOverlap, 0, "no cited paragraph → overlap 0");

  // --- REGRESSION: diagnostics must not change accepted claims or the dropped count ---
  const regChunks = [{ paragraph: "para-1", text: "The Nation established Aboriginal title over the claim area." }];
  const regClaims = [
    { text: "title established", quote: "The Nation established Aboriginal title", paragraph: "para-1" },
    { text: "nope", quote: "a quote that simply is not present anywhere", paragraph: "para-1" },
  ];
  const reg = verifyClaims(regClaims, regChunks, "https://x/y");
  assert.equal(reg.anchors.length, 1, "the verifiable claim still survives");
  assert.equal(reg.anchors[0].sourceParagraph, "para-1");
  assert.equal(reg.dropped, 1, "dropped count unchanged");
```
Add `longestCommonSubstringLen` to the existing import from `../src/lib/cases/ingest/summarizer` (`verifyClaims` is already imported).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx scripts/test-cases-summarizer.ts`
Expected: FAIL — `longestCommonSubstringLen` is not exported.

- [ ] **Step 3: Add the LCS helper + diagnostics to `summarizer.ts`**

Add above `verifyClaims`:
```ts
export type ClaimDropReason = "no_text" | "quote_too_short" | "no_span";

// Why a claim was dropped. Diagnostics only — nothing here changes what survives. `bestOverlap`
// is the question this exists to answer: does the model cite the RIGHT paragraph and merely garble
// the transcription (high overlap → span alignment could recover it), or did it genuinely
// paraphrase (low overlap → there is no span to align to and the drop was correct)? We could not
// tell before, because only the dropped COUNT is persisted.
export interface ClaimDrop {
  reason: ClaimDropReason;
  quoteLen: number;
  citedPara: string;
  citedParaFound: boolean;
  bestOverlap: number;
}

// Longest common contiguous substring length. Two-row DP: O(n·m) time, O(min(n,m)) space. Only
// ever runs on the drop path, on a quote of at most a few hundred chars against a ~2KB chunk.
export function longestCommonSubstringLen(a: string, b: string): number {
  if (!a || !b) return 0;
  const [s, t] = a.length <= b.length ? [a, b] : [b, a];
  let prev = new Uint32Array(s.length + 1);
  let cur = new Uint32Array(s.length + 1);
  let best = 0;
  for (let j = 1; j <= t.length; j++) {
    for (let i = 1; i <= s.length; i++) {
      cur[i] = s[i - 1] === t[j - 1] ? prev[i - 1] + 1 : 0;
      if (cur[i] > best) best = cur[i];
    }
    const swap = prev; prev = cur; cur = swap;
    cur.fill(0);
  }
  return best;
}
```

- [ ] **Step 4: Return `drops` from `verifyClaims`**

Change the signature's return type to include `drops`, and record a diagnostic at each `continue` /
non-anchored path. Replace the loop and return with:
```ts
  const anchors: CitationAnchor[] = [];
  const drops: ClaimDrop[] = [];
  const record = (reason: ClaimDropReason, quote: string, citedPara: string) => {
    const cited = norm.find((n) => n.para === citedPara || n.para === `para-${citedPara}`);
    drops.push({
      reason, quoteLen: quote.length, citedPara, citedParaFound: !!cited,
      // Overlap is measured against the CITED paragraph only — that is exactly the hypothesis under
      // test ("right paragraph, wrong span"), and scanning every chunk per drop would be far too
      // slow for a 559-case batch.
      bestOverlap: reason === "no_span" && cited && quote.length
        ? longestCommonSubstringLen(quote, cited.text) / quote.length
        : 0,
    });
  };
  for (const cl of claims) {
    if (anchors.length >= 6) break; // keep the first 6 in model output order
    const quote = normWs(cl.quote ?? "");
    const text = (cl.text ?? "").trim();
    const citedPara = String(cl.paragraph ?? "");
    if (!text) { record("no_text", quote, citedPara); continue; }
    if (quote.length < 15) { record("quote_too_short", quote, citedPara); continue; }
    const para = locate(quote, citedPara);
    if (para !== null) anchors.push({ text, sourceParagraph: para, sourceUrl });
    else record("no_span", quote, citedPara);
  }
  return { anchors, dropped: claims.length - anchors.length, drops };
```
Note the ordering: `!text` is checked before the length rule so an empty-text claim is categorised
`no_text` even when its quote is also short. `dropped` keeps its exact existing formula.

- [ ] **Step 5: Carry `drops` out through `summarizeCase`**

Add `drops?: ClaimDrop[];` to the `SummarizeResult` interface. At the one `verifyClaims` call site,
destructure it and pass it through the two post-verification returns:
```ts
  const { anchors, dropped, drops } = verifyClaims(claims, c.chunks, c.provenance.sourceUrl);
  if (anchors.length < 2) return { status: "failed", claimsDropped: dropped, drops };
```
and add `drops,` to the `status: "generated"` return object. Leave the early-return skip paths
(`skipped_curated`, `skipped_not_core`, `skipped_no_fulltext`, and the `!claims` failure) untouched —
they have no claims to diagnose.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsx scripts/test-cases-summarizer.ts`
Expected: the file's existing success line.

Run: `npx tsx scripts/test-cases-caseqa.ts`
Expected: PASS — the case-QA path also calls `verifyClaims` and must be unaffected by the added field.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean (0 errors).

- [ ] **Step 8: Commit**

```bash
git add src/lib/cases/ingest/summarizer.ts scripts/test-cases-summarizer.ts
git commit -m "feat(cases): claim-drop diagnostics (reason + cited-paragraph overlap)"
```

---

## Task 3: Report the histogram in the summarize runner

**Files:**
- Modify: `scripts/cases-summarize.ts`

- [ ] **Step 1: Accumulate the drops**

Next to the existing `let kept = 0, dropped = 0, done = 0;`, add:
```ts
  const allDrops: import("../src/lib/cases/ingest/summarizer").ClaimDrop[] = [];
```
Then, in the loop, right after the existing `const r = await summarizeCase(target, model);` line, add:
```ts
    if (r.drops) allDrops.push(...r.drops);
```

- [ ] **Step 2: Print the histogram after the existing summary lines**

Immediately after the existing `console.log(\`   claims kept ${kept} · dropped ${dropped}\`);` line, add:
```ts
  if (allDrops.length) {
    const by = (reason: string) => allDrops.filter((d) => d.reason === reason).length;
    const noSpan = allDrops.filter((d) => d.reason === "no_span");
    const bucket = (lo: number, hi: number) => noSpan.filter((d) => d.bestOverlap >= lo && d.bestOverlap < hi).length;
    console.log(`   drop diagnostics: no_span ${by("no_span")} · quote_too_short ${by("quote_too_short")} · no_text ${by("no_text")} · cited-para-not-found ${allDrops.filter((d) => !d.citedParaFound).length}`);
    // The >=0.8 bucket IS the population span alignment could recover. If it is a few percent,
    // that feature is not worth building — and we will have said so with a number from our own
    // corpus rather than from a paper about a different pipeline.
    console.log(`   no_span overlap: >=0.8 → ${noSpan.filter((d) => d.bestOverlap >= 0.8).length} · 0.4–0.8 → ${bucket(0.4, 0.8)} · <0.4 → ${bucket(0, 0.4)}`);
    const near = noSpan.filter((d) => d.bestOverlap >= 0.8).slice(0, 5)
      .map((d) => `${d.citedPara}(${d.bestOverlap.toFixed(2)})`).join(" · ");
    if (near) console.log(`   near-miss samples: ${near}`);
  }
```

- [ ] **Step 3: Typecheck + build + full offline suite**

Run: `npm run typecheck` → expected clean.
Run: `npx tsx scripts/test-cases-summarizer.ts` → PASS
Run: `npx tsx scripts/test-cases-briefs.ts` → PASS
Run: `npx tsx scripts/test-cases-caseqa.ts` → PASS
Run: `npm run build` → expected Next.js build succeeds.

Do NOT run `cases-summarize` itself — it needs DynamoDB and Bedrock credentials.

- [ ] **Step 4: Commit**

```bash
git add scripts/cases-summarize.ts
git commit -m "feat(cases): print the claim-drop histogram after a summarize run"
```

---

## Final verification (before finishing the branch)

- [ ] `npx tsx scripts/test-cases-briefs.ts` → PASS
- [ ] `npx tsx scripts/test-cases-summarizer.ts` → PASS
- [ ] `npx tsx scripts/test-cases-caseqa.ts` → PASS (shares `verifyClaims`)
- [ ] `npm run typecheck` → clean · `npm run build` → succeeds
- [ ] `grep -n "survivingIds" src/lib/cases/briefs/generator.ts` → present, and `valid` is still used for precedents

---

## Self-Review (completed by plan author)

**1. Spec coverage:** Part A dependency filter → T1 ✅ (tests cover empty-`establishes` drop, cap-trim drop, mixed principle, and the `<2` regression) · Part B `ClaimDrop`/`longestCommonSubstringLen`/`verifyClaims` diagnostics → T2 ✅ · overlap measured against the *cited* paragraph only → T2 Step 4 comment + test ✅ · zero behaviour change → T2's explicit regression assertion ✅ · histogram + near-miss samples → T3 ✅ · nothing persisted, run-time log only → T3 ✅ · no span alignment built → nowhere in this plan, by design ✅

**2. Placeholder scan:** No TBD/TODO. Every code step carries complete code. The one place a value is not literal is the existing success-line text in two test files, which the implementer reads from the file rather than inventing.

**3. Type consistency:** `ClaimDropReason` / `ClaimDrop { reason, quoteLen, citedPara, citedParaFound, bestOverlap }` / `longestCommonSubstringLen(a, b)` / `verifyClaims → { anchors, dropped, drops }` / `SummarizeResult.drops?` are used identically in T2 and T3 and in both test files. `survivingIds` (T1) does not collide with the existing `valid` or `seen` sets.
