# Anchor Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Size what the uniqueness guard costs, and measure whether the model's own cited paragraph could safely break the ties it declines — without changing what the product does.

**Architecture:** `verifyClaims`'s existing `scan()` already computes the rival overlap; it just does not report it. Widen `ClaimDrop` to carry the rival, its paragraph, and whether the guard declined the claim, so the measurement describes exactly what production does rather than a re-implementation of it. A read-only runner replays the warm LLM cache and aggregates.

**Tech Stack:** TypeScript (strict), `tsx`, `node:assert/strict`, DynamoDB read, zero LLM calls.

**Spec:** `docs/superpowers/specs/2026-07-31-anchor-signals-design.md` — **read the 2026-08-03 amendment at the top**; it supersedes the bottom-175 framing below it.

---

## Why the fields go in `ClaimDrop` and not in the runner

The spec is explicit: *"Reuse `scan()`'s definition rather than reimplementing margin; if the runner and production disagree about what 'rival' means, the measurement describes something the product does not do."*

`scan()` excludes the winner's immediate neighbours from the rival, because a quote straddling a chunk boundary scores well against both halves and `locate()`'s adjacent-pair window already treats that pair as one span. A runner that recomputed "second best" naively would report ambiguity where production sees none, and the whole measurement would be about a rule nobody ships.

`declinedByGuard` is computed **inside** `verifyClaims`, where the `NEAR` constant is in scope, rather than re-derived by the runner from a threshold it would have to import and could drift from.

---

## File Structure

| File | Change |
|---|---|
| `src/lib/cases/ingest/summarizer.ts` | `scan()` returns the rival's paragraph; `ClaimDrop` gains three fields |
| `scripts/test-cases-summarizer.ts` | The new fields, including the declined case |
| `scripts/cases-anchor-signals.ts` | **New.** Read-only runner, banded report |
| `package.json` | One npm script |

---

### Task 1: Report the rival and the guard's verdict

**Files:**
- Modify: `src/lib/cases/ingest/summarizer.ts`
- Test: `scripts/test-cases-summarizer.ts`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-cases-summarizer.ts`, before its final `console.log`:

```ts
// --- the guard's verdict is reported, not just its effect ---------------------------
// 2008-scc-41 has NO summary because its best match scored 0.97 — over the 0.95 threshold —
// and a second non-adjacent paragraph also cleared 0.95, so the uniqueness guard declined
// it. Nobody has measured how often that happens, because a declined claim looks exactly
// like an unmatched one in the drop record.
{
  const body = (n: string) =>
    `The Crown owed a fiduciary duty to the Nation in the circumstances of this case ${n}. ` +
    `Compensation is assessed by reference to the lost opportunity rather than historic value ${n}.`;
  const mk = (paras: string[]) => paras.map((p, i) => ({ paragraph: `para-${i + 1}`, text: p }));
  const claim = (quote: string, cited = "para-1") => [{ text: "A point.", quote, paragraph: cited }];
  const URL = "https://example.test/j";
  const NEARLY = "Xhe Crown owed a fiduciary duty to the Nation in the circumstances of this case A";

  // Declined: two non-adjacent paragraphs both clear the threshold.
  {
    const chunks = mk([body("A"), "An unrelated paragraph about procedure and scheduling.", body("A")]);
    const r = verifyClaims(claim(NEARLY), chunks, URL, { measureOverlap: true });
    assert.equal(r.anchors.length, 0);
    const d = r.drops[0];
    assert.equal(d.declinedByGuard, true, "the guard declined this — that must be visible");
    assert.ok(d.bestOverlap >= 0.95, `best should clear the threshold, got ${d.bestOverlap}`);
    assert.ok(d.rival >= 0.95, `rival should clear it too, got ${d.rival}`);
    assert.equal(d.bestPara, "para-1");
    assert.equal(d.rivalPara, "para-3", "the rival's paragraph is what a tie-breaker would choose between");
  }

  // Genuinely unmatched: not the guard's doing, and must not be counted as such.
  {
    const chunks = mk([body("A")]);
    const r = verifyClaims(claim("The tribunal awarded punitive damages of four million dollars."), chunks, URL, { measureOverlap: true });
    assert.equal(r.drops[0].declinedByGuard, false, "a weak match is not a declined match");
  }

  // Below the threshold with a close rival is ALSO not the guard: recovery never applied.
  {
    const chunks = mk([body("A"), "Unrelated.", body("A")]);
    const q = "The Crown owed a XXXXXXXXXX duty to the YYYYYYYY in the ZZZZZZZZZZ of this case A";
    const r = verifyClaims(claim(q), chunks, URL, { measureOverlap: true });
    assert.equal(r.drops[0].declinedByGuard, false, "declined means the threshold was cleared and ambiguity blocked it");
  }

  // Diagnostics stay opt-in: with measurement off the fields are inert, not wrong.
  {
    const chunks = mk([body("A"), "Unrelated.", body("A")]);
    const r = verifyClaims(claim(NEARLY), chunks, URL);
    assert.equal(r.drops[0].rival, 0);
    assert.equal(r.drops[0].declinedByGuard, false, "unmeasured must not masquerade as not-declined-because-weak");
    assert.equal(r.drops[0].overlapMeasured, false, "…which is why overlapMeasured exists to tell them apart");
  }
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx scripts/test-cases-summarizer.ts
```

Expected: FAIL — `declinedByGuard` and `rivalPara` do not exist.

- [ ] **Step 3: Implement**

In `summarizer.ts`, add the three fields to `ClaimDrop`, after `bestPara`:

```ts
  // The best NON-ADJACENT competitor, and whether the uniqueness guard is what stopped this
  // claim. A declined claim and an unmatched one are both "no_span" and were previously
  // indistinguishable, which is why the guard's cost has never been measured.
  rival: number;
  rivalPara: string | null;
  declinedByGuard: boolean;
```

Make `scanUncached` return the rival's paragraph — replace its body's rival lines and return:

```ts
    let rival = 0, rivalIdx = -1;
    overlaps.forEach((o, i) => { if (Math.abs(i - bestIdx) > 1 && o > rival) { rival = o; rivalIdx = i; } });
    return {
      bestOverlap, bestPara: bestIdx >= 0 ? norm[bestIdx].para : null,
      rival, rivalPara: rivalIdx >= 0 ? norm[rivalIdx].para : null,
    };
```

Update the memo's type annotation to match:

```ts
  const scanned = new Map<string, { bestOverlap: number; bestPara: string | null; rival: number; rivalPara: string | null }>();
```

Replace `record`:

```ts
  const record = (reason: ClaimDropReason, quote: string, citedPara: string) => {
    const canMeasure = measure && reason === "no_span" && quote.length > 0;
    const s = canMeasure
      ? scan(quote)
      : { bestOverlap: 0, bestPara: null as string | null, rival: 0, rivalPara: null as string | null };
    drops.push({
      reason, quoteLen: quote.length, citedPara, citedParaFound: !!findCited(citedPara),
      overlapMeasured: canMeasure, bestOverlap: s.bestOverlap, bestPara: s.bestPara,
      rival: s.rival, rivalPara: s.rivalPara,
      // Only true when the threshold WAS cleared and ambiguity is what blocked it. A weak
      // match is not a declined match, and neither is an unmeasured one.
      declinedByGuard: canMeasure && s.bestOverlap >= NEAR && s.rival >= NEAR,
    });
  };
```

- [ ] **Step 4: Run tests and typecheck**

```bash
npx tsx scripts/test-cases-summarizer.ts && npx tsc --noEmit
```

Expected: pass, clean. `cases-drop-forensics.ts` and any other `ClaimDrop` consumer construct
drops only through `verifyClaims`, so widening the interface is additive — report if anything
fails to compile.

**Recovery behaviour must not change.** The near-exact tests added in #227 are in this same
file; if any of them now fails, stop — this task reports on the guard, it does not adjust it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/ingest/summarizer.ts scripts/test-cases-summarizer.ts
git commit -m "feat(cases): report the rival overlap and whether the guard declined a claim"
```

---

### Task 2: The banded report

**Files:**
- Create: `scripts/cases-anchor-signals.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the runner**

Create `scripts/cases-anchor-signals.ts`:

```ts
// Read-only: how much does the uniqueness guard cost, and could the model's own cited
// paragraph break the ties it declines?
//
// Claim recovery (#227) anchors a claim when exactly one paragraph scores >=0.95. What
// blocks progress now is strong matches that are AMBIGUOUS: 2008-scc-41 has no summary at
// all despite a 0.97 best match, because a second paragraph also cleared 0.95. Lowering the
// threshold would not help — it is already above it.
//
// The candidate tie-breaker is `citedPara`: the model's bookkeeping and our text matching are
// independent, so agreement is real corroboration. But summarizer.ts records that models
// misattribute paragraph ids about half the time. Whether they do so AMONG THE CLAIMS WHERE
// TWO PARAGRAPHS MATCH STRONGLY is what nobody has measured, and it is the only thing that
// decides whether a tie-breaker is safe.
//
// ZERO LLM calls — model responses replay from scripts/.cache/llm. Needs DynamoDB read.
// Writes nothing.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { assembleInput, buildPrompt, parseClaims, verifyClaims, RETRY_SUFFIX } from "../src/lib/cases/ingest/summarizer";
import type { ClaimDrop } from "../src/lib/cases/ingest/summarizer";

const CACHE = path.join(process.cwd(), "scripts", ".cache", "llm");
const MODEL_ID = process.env.SUMMARY_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";
const keyFor = (p: string) => createHash("sha256").update(MODEL_ID + "\n" + p).digest("hex").slice(0, 32);
const readCache = async (p: string) => {
  try { return await fs.readFile(path.join(CACHE, keyFor(p) + ".txt"), "utf8"); } catch { return null; }
};

const BANDS: [string, number, number][] = [
  [">=0.95", 0.95, 1.01],
  ["0.90-0.95", 0.90, 0.95],
  ["0.80-0.90", 0.80, 0.90],
  ["0.50-0.80", 0.50, 0.80],
  ["<0.50", 0, 0.50],
];

type Row = { drops: number; declined: number; citedIsBest: number; citedIsRival: number; citedIsNeither: number; citedMissing: number };
const empty = (): Row => ({ drops: 0, declined: 0, citedIsBest: 0, citedIsRival: 0, citedIsNeither: 0, citedMissing: 0 });

// The cited paragraph is free text from the model; locate() accepts a bare "N" as "para-N",
// so the comparison must too or agreement is undercounted.
const same = (cited: string, para: string | null) =>
  para !== null && (cited === para || `para-${cited}` === para);

async function main() {
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  const rows = new Map(BANDS.map(([n]) => [n, empty()]));
  const declinedSamples: string[] = [];
  let cases = 0, totalDrops = 0, unmeasured = 0;

  for (const prof of profiles) {
    const c = await dynamoCaseRepo.getCase(prof.id);
    if (!c?.chunks?.length) continue;
    const assembled = assembleInput(c.chunks, c.outcome.holding);
    const prompt = buildPrompt(c, assembled);
    let raw = await readCache(prompt);
    let claims = raw === null ? null : parseClaims(raw);
    if (!claims) {
      const retry = await readCache(prompt + RETRY_SUFFIX);
      // A miss means the cache no longer matches the prompts the corpus would produce —
      // exactly what happened after the SCC backfill changed 19 cases' text. Measuring a
      // partial population is the failure mode this whole line of work keeps hitting.
      if (retry === null) {
        throw new Error(`cache miss for ${c.id}. Re-run cases:summarize first, or the ` +
          `distribution describes an unrepresentative subset. Do NOT interpret a partial run.`);
      }
      claims = parseClaims(retry);
    }
    if (!claims) continue;
    cases++;
    const { drops } = verifyClaims(claims, c.chunks, c.provenance.sourceUrl, { measureOverlap: true });
    for (const d of drops as ClaimDrop[]) {
      if (d.reason !== "no_span") continue;
      totalDrops++;
      if (!d.overlapMeasured) { unmeasured++; continue; }
      const band = BANDS.find(([, lo, hi]) => d.bestOverlap >= lo && d.bestOverlap < hi);
      if (!band) continue;
      const r = rows.get(band[0])!;
      r.drops++;
      if (d.declinedByGuard) {
        r.declined++;
        if (same(d.citedPara, d.bestPara)) r.citedIsBest++;
        else if (same(d.citedPara, d.rivalPara)) r.citedIsRival++;
        else if (!d.citedParaFound) r.citedMissing++;
        else r.citedIsNeither++;
        if (declinedSamples.length < 6) {
          declinedSamples.push(`${c.id} best=${d.bestPara}@${d.bestOverlap.toFixed(2)} rival=${d.rivalPara}@${d.rival.toFixed(2)} cited=${d.citedPara}`);
        }
      }
    }
  }

  console.log(`\n${totalDrops} no_span drops across ${cases} cases${unmeasured ? ` · ${unmeasured} unmeasured` : ""}\n`);
  console.log("band        drops  declined   cited=best  cited=rival  cited=neither  cited=absent");
  for (const [name] of BANDS) {
    const r = rows.get(name)!;
    console.log(`${name.padEnd(11)} ${String(r.drops).padStart(5)}  ${String(r.declined).padStart(8)}   ${String(r.citedIsBest).padStart(10)}  ${String(r.citedIsRival).padStart(11)}  ${String(r.citedIsNeither).padStart(13)}  ${String(r.citedMissing).padStart(12)}`);
  }
  const top = rows.get(">=0.95")!;
  console.log(`\nWhat the guard costs at >=0.95: ${top.declined} claims declined for ambiguity.`);
  if (top.declined > 0) {
    const usable = top.citedIsBest + top.citedIsRival;
    console.log(`  citedPara points at one of the two candidates in ${usable}/${top.declined}` +
      ` (${((usable / top.declined) * 100).toFixed(0)}%) — the ceiling for a tie-breaker.`);
    console.log(`  it agrees with the BEST match in ${top.citedIsBest}, with the rival in ${top.citedIsRival}.` +
      ` A tie-breaker is only safe if that split is lopsided.`);
  }
  if (declinedSamples.length) {
    console.log(`\nsample declines:`);
    for (const s of declinedSamples) console.log(`  ${s}`);
  }
}
main().catch((e) => { console.error("❌ cases-anchor-signals failed:", e.message); process.exit(1); });
```

- [ ] **Step 2: Add the npm scripts**

```json
    "cases:anchor-signals": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-anchor-signals.ts",
    "cases:anchor-signals:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-anchor-signals.ts",
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

If `ClaimDrop` is not exported from `summarizer.ts`, export it rather than redeclaring the
shape in the runner — two definitions of the same record is how the runner and production
drift apart.

**Do not run the runner.** It needs AWS credentials; the controller runs it.

- [ ] **Step 4: Commit**

```bash
git add scripts/cases-anchor-signals.ts package.json
git commit -m "feat(cases): read-only anchor-signal report, banded by overlap"
```

---

## After the tasks (controller, not a subagent)

1. Final whole-branch review.
2. **`AWS_PROFILE=bedrock npm run cases:anchor-signals:cloud`.** Zero LLM calls. If it aborts
   on a cache miss, that is correct — re-run `cases:summarize` first rather than loosening
   the guard.
3. Read the `>=0.95` row. It is the only row that decides anything right now: it sizes what
   the guard costs and says whether a `citedPara` tie-breaker has a ceiling worth building
   against. **A lopsided cited=best / cited=rival split is the evidence a tie-breaker needs;
   an even split is evidence against one.**
4. Record in `docs/research/`. **Recommend nothing** — same rule as the two forensics reports.
5. Open the PR.

## Self-review notes

- **Amendment coverage:** rival reported (T1), guard verdict reported (T1), banded by
  overlap (T2), cited-vs-best-vs-rival (T2), every drop not just 0.50–0.80 (T2), reuse
  `scan()` rather than reimplement (T1 — the runner never computes overlap itself), abort on
  cache miss (T2), measurement only (no threshold or gate changes anywhere).
- **Naming:** `rival`, `rivalPara`, `declinedByGuard`, `citedIsBest`, `citedIsRival`.
- **Unchanged:** `NEAR`, the recovery rule, `locate()`'s exact windows, `drop-cause.ts`,
  everything the product does. The only behaviour change is that a drop record now carries
  three more numbers.
