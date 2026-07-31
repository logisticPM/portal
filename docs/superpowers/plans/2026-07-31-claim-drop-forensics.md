# Claim-Drop Forensics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assign each of the 707 dropped claims exactly one cause, so we learn how much is recoverable and — the number nobody has — how often the model quotes text it was never shown.

**Architecture:** A pure classifier (`drop-cause.ts`) and a read-only runner that replays the on-disk model responses. No LLM calls, no writes, no fix.

**Tech Stack:** TypeScript, `tsx` scripts, `node:assert/strict`, DynamoDB reads via the existing repo.

**Spec:** `docs/superpowers/specs/2026-07-31-claim-drop-forensics-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/cases/ingest/drop-cause.ts` (create) | `DropCause`, `lcsSpan`, `widenFold`, `classifyDrop`. Pure, no I/O. |
| `scripts/test-cases-drop-cause.ts` (create) | Offline tests, including the ordering regression. |
| `scripts/cases-drop-forensics.ts` (create) | Cache replay, tally, worked examples. Read-only. |
| `package.json` (modify) | Two npm scripts. |

Nothing under `src/lib/cases/ingest/summarizer.ts` is touched. That file's `verifyClaims`,
`longestCommonSubstringLen`, `locate`, and `normWs` are shipped, reviewed, and are the thing being
measured — modifying them would invalidate the measurement.

---

### Task 1: The classifier

**Files:**
- Create: `src/lib/cases/ingest/drop-cause.ts`
- Test: `scripts/test-cases-drop-cause.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-drop-cause.ts`:

```ts
import assert from "node:assert/strict";
import type { CaseChunk } from "../src/lib/cases/types";
import { classifyDrop, lcsSpan, widenFold } from "../src/lib/cases/ingest/drop-cause";
import { normWs } from "../src/lib/cases/ingest/summarizer";

const p = (n: number, text: string): CaseChunk => ({ paragraph: `para-${n}`, text });
// Mirrors assembleInput's line format. Passing a NON-CONTIGUOUS join is the point:
// that is what the over-budget path produces.
const assemble = (chunks: CaseChunk[]) => chunks.map((c) => `[para ${c.paragraph}] ${c.text}`).join("\n");

// --- lcsSpan: length AND where the run starts IN THE QUOTE ---
assert.deepEqual(lcsSpan("abcdef", "zzabcdefzz"), { len: 6, quoteStart: 0 });
assert.deepEqual(lcsSpan("XXhello world", "hello world"), { len: 11, quoteStart: 2 },
  "quoteStart is an offset into the FIRST argument");
assert.deepEqual(lcsSpan("abc", "xyz"), { len: 0, quoteStart: 0 });
assert.deepEqual(lcsSpan("", "abc"), { len: 0, quoteStart: 0 });

// --- widenFold ---
assert.equal(widenFold("(emphasis added) ."), widenFold("(emphasis added)."), "space before punctuation");
assert.equal(widenFold("a…b"), widenFold("a...b"), "ellipsis character vs three dots");
assert.equal(widenFold("soft­hyphen"), widenFold("softhyphen"), "soft hyphen is invisible");
assert.equal(widenFold("ﬁre"), widenFold("fire"), "fi ligature from PDF extraction");

const chunks = [
  p(1, "The appellant sought judicial review of the Minister's decision."),
  p(2, "The Crown owed a fiduciary duty to the Nation in these circumstances."),
  p(3, "Compensation was assessed at fair market value as of the date of taking."),
];
const full = assemble(chunks);

// 1. locate_bug — present verbatim, so locate() should have found it.
assert.equal(classifyDrop("The Crown owed a fiduciary duty to the Nation", chunks, full).cause, "locate_bug");
// A quote spanning DOCUMENT-adjacent chunks is also findable, so also not a real drop.
assert.equal(classifyDrop("in these circumstances. Compensation was assessed", chunks, full).cause, "locate_bug");

// 2. marker_bleed — the model swept a paragraph marker in.
assert.equal(classifyDrop("circumstances. [para para-3] Compensation was assessed", chunks, full).cause, "marker_bleed");

// 3. assembly_boundary — adjacent in the PROMPT only. para-1 and para-3 are not
//    document-adjacent, so no window in locate() can span them. Marker stripped, so the
//    seam alone is the cause.
{
  const spliced = assemble([chunks[0], chunks[2]]);    // what the over-budget path emits
  const seamOnly = "Minister's decision. Compensation was assessed";
  assert.equal(classifyDrop(seamOnly, chunks, spliced.replace(/\[para [^\]]+\] /g, "")).cause,
    "assembly_boundary");
}

// 4. normalization — differs only by a fold normWs does not do.
{
  const punct = [p(1, "The order is set aside , and the appeal is allowed .")];
  const asm = assemble(punct);
  assert.equal(classifyDrop("The order is set aside, and the appeal is allowed.", punct, asm).cause,
    "normalization");
}

// 5. transcription — a real passage with one word changed mid-quote.
assert.equal(
  classifyDrop("The Crown owed a fiduciary duty to the People in these circumstances.", chunks, full).cause,
  "transcription");

// 6. unseen — shares nothing substantial with anything the model was given.
{
  const v = classifyDrop("The tribunal awarded punitive damages of four million dollars.", chunks, full);
  assert.equal(v.cause, "unseen");
  assert.ok(v.bestOverlap < 0.5, `unseen must be low overlap, got ${v.bestOverlap.toFixed(2)}`);
}

// --- ORDERING REGRESSION: marker_bleed must outrank assembly_boundary ---
// A marker-bearing quote is DEFINITIONALLY present in the assembled text — that is where
// the markers live. So if assembly_boundary were tested first it would absorb every
// marker case and marker_bleed would read zero however often it happened. The
// precondition assertion below is the point: it proves BOTH buckets match this input, so
// the test really is exercising precedence rather than passing by accident.
{
  const spliced = assemble([chunks[0], chunks[2]]);
  const withMarker = "Minister's decision. [para para-3] Compensation";
  assert.ok(normWs(spliced).includes(normWs(withMarker)),
    "precondition: this quote IS in the assembled text, so assembly_boundary also matches");
  assert.equal(classifyDrop(withMarker, chunks, spliced).cause, "marker_bleed",
    "marker_bleed must be tested BEFORE assembly_boundary");
}

// --- divergence offset is measured from the LCS anchor, not the quote start ---
{
  const v = classifyDrop("ZZZZ The Crown owed a fiduciary duty to the Nation in these XX", chunks, full);
  assert.ok(v.divergenceAt !== null && v.divergenceAt > 5,
    "divergence is reported after the matched run, not at index 0");
}

console.log("✅ test-cases-drop-cause passed");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx scripts/test-cases-drop-cause.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/ingest/drop-cause'`

- [ ] **Step 3: Write `src/lib/cases/ingest/drop-cause.ts`**

```ts
// Forensics for claims that failed verification. MEASUREMENT ONLY — nothing here runs
// in the summarize path and nothing here changes what survives verification.
//
// The buckets are ordered, and the order is load-bearing (see classifyDrop).
import type { CaseChunk } from "../types";
import { normWs } from "./summarizer";

export type DropCause =
  | "locate_bug"          // present verbatim — locate() should have found it
  | "marker_bleed"        // the quote swept up a "[para N]" prompt marker
  | "assembly_boundary"   // spans a seam that exists only in the assembled prompt
  | "normalization"       // matches after a fold normWs does not perform
  | "transcription"       // a real passage, garbled
  | "unseen";             // absent from what the model was shown

export interface DropVerdict {
  cause: DropCause;
  bestOverlap: number;
  bestPara: string | null;
  divergenceAt: number | null; // offset into the quote where the matched run ends
}

// Longest common substring, returning WHERE the run starts in `a`.
//
// Deliberately separate from summarizer.ts's longestCommonSubstringLen, which swaps its
// arguments so the DP row tracks the shorter string. That swap makes the offset
// meaningless, and this module needs the offset. The shipped function is reviewed and
// measured code on the summarize path; duplicating ~12 lines is cheaper than perturbing
// it for a diagnostic. Rows are sized to the quote, which is a few hundred chars.
export function lcsSpan(a: string, b: string): { len: number; quoteStart: number } {
  if (!a || !b) return { len: 0, quoteStart: 0 };
  let prev = new Uint32Array(a.length + 1);
  let cur = new Uint32Array(a.length + 1);
  let bestLen = 0, bestEnd = 0;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      cur[i] = a[i - 1] === b[j - 1] ? prev[i - 1] + 1 : 0;
      if (cur[i] > bestLen) { bestLen = cur[i]; bestEnd = i; }
    }
    const swap = prev; prev = cur; cur = swap;
    cur.fill(0);
  }
  return { len: bestLen, quoteStart: bestEnd - bestLen };
}

// normWs plus the folds it does not do. Each is a real artifact of court-document
// extraction, not a hypothetical. NOTE: JS \s already covers NBSP and friends, so
// normWs handles those; what remains are non-space invisibles and glyph variants.
export const widenFold = (s: string) =>
  normWs(s)
    .replace(/­/g, "")                              // soft hyphen
    .replace(/…/g, "...")                           // ellipsis glyph
    .replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl")   // ligatures
    .replace(/\s+([.,;:!?)\]])/g, "$1")                  // space BEFORE punctuation
    .replace(/([(\[])\s+/g, "$1")                        // space AFTER an opener
    .replace(/\s+/g, " ").trim();

const pairsOf = (texts: string[]) => texts.slice(0, -1).map((t, i) => t + " " + texts[i + 1]);

// `assembled` must be what the model was actually shown — assembleInput's output for
// this case, which over budget is a NON-CONTIGUOUS subset joined with "\n".
export function classifyDrop(rawQuote: string, chunks: CaseChunk[], assembled: string): DropVerdict {
  const q = normWs(rawQuote);
  const norm = chunks.map((c) => ({ para: c.paragraph, text: normWs(c.text) }));

  let bestLen = 0, bestStart = 0, bestPara: string | null = null;
  for (const n of norm) {
    const r = lcsSpan(q, n.text);
    if (r.len > bestLen) { bestLen = r.len; bestStart = r.quoteStart; bestPara = n.para; }
  }
  const base = {
    bestOverlap: q.length ? bestLen / q.length : 0,
    bestPara,
    divergenceAt: bestLen && bestLen < q.length ? bestStart + bestLen : null,
  };

  // 1. locate() searches exactly these two windows. A hit here means the claim was not
  //    actually droppable — in production that is a bug, in the runner it means "kept".
  const texts = norm.map((n) => n.text);
  if (texts.some((t) => t.includes(q)) || pairsOf(texts).some((t) => t.includes(q))) {
    return { cause: "locate_bug", ...base };
  }

  // 2. BEFORE assembly_boundary, and this ordering is not cosmetic: the markers live in
  //    the assembled text, so a marker-bearing quote is definitionally found there and
  //    assembly_boundary would absorb every marker_bleed case.
  if (q.includes("[para ")) return { cause: "marker_bleed", ...base };

  // 3. In the prompt but not the document — our seam, faithfully transcribed.
  if (normWs(assembled).includes(q)) return { cause: "assembly_boundary", ...base };

  // 4. A fold normWs misses.
  const w = widenFold(rawQuote);
  const wide = chunks.map((c) => widenFold(c.text));
  if (wide.some((t) => t.includes(w)) || pairsOf(wide).some((t) => t.includes(w))) {
    return { cause: "normalization", ...base };
  }

  // 5. A real passage, garbled.
  if (base.bestOverlap >= 0.5) return { cause: "transcription", ...base };

  // 6. The model was never shown this.
  return { cause: "unseen", ...base };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-cases-drop-cause.ts`
Expected: `✅ test-cases-drop-cause passed`

- [ ] **Step 5: Confirm the summarize path is untouched**

Run: `npx tsx scripts/test-cases-summarizer.ts && npx tsx scripts/test-cases-caseqa.ts && npm run typecheck`
Expected: all PASS, typecheck clean. This module imports `normWs` and changes nothing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/ingest/drop-cause.ts scripts/test-cases-drop-cause.ts
git commit -m "feat(cases): drop-cause classifier (measurement only)"
```

---

### Task 2: The runner

**Files:**
- Create: `scripts/cases-drop-forensics.ts`
- Modify: `package.json`

- [ ] **Step 1: Write `scripts/cases-drop-forensics.ts`**

No unit test: it is I/O orchestration, and the logic it carries is Task 1's, which is tested.
Correctness here rests on the cache-hit requirement below.

```ts
// Read-only forensics over claims that failed verification. Replays the model responses
// already on disk — ZERO LLM calls — and assigns each dropped claim one cause.
//
// Needs DynamoDB READ access for chunk text. Writes nothing, anywhere.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import {
  assembleInput, buildPrompt, parseClaims, normWs, verifyClaims, RETRY_SUFFIX,
} from "../src/lib/cases/ingest/summarizer";
import { classifyDrop, type DropCause } from "../src/lib/cases/ingest/drop-cause";

const CACHE = path.join(process.cwd(), "scripts", ".cache", "llm");
const MODEL_ID = process.env.SUMMARY_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";

// Must match cachedCall exactly: sha256(modelId + "\n" + prompt), first 32 hex.
const keyFor = (prompt: string) =>
  createHash("sha256").update(MODEL_ID + "\n" + prompt).digest("hex").slice(0, 32);
const readCache = async (prompt: string): Promise<string | null> => {
  try { return await fs.readFile(path.join(CACHE, keyFor(prompt) + ".txt"), "utf8"); }
  catch { return null; }
};

const ORDER: DropCause[] = ["locate_bug", "marker_bleed", "assembly_boundary", "normalization", "transcription", "unseen"];
const NOTE: Record<DropCause, string> = {
  locate_bug: "BUG in locate() — investigate before reading anything else",
  marker_bleed: "recoverable — our prompt marker",
  assembly_boundary: "recoverable — our assembly seam",
  normalization: "recoverable — widen normWs",
  transcription: "recoverable only by span alignment",
  unseen: "NOT recoverable — the model was never shown this text",
};

async function main() {
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  const tally = Object.fromEntries(ORDER.map((c) => [c, 0])) as Record<DropCause, number>;
  const samples = Object.fromEntries(ORDER.map((c) => [c, [] as string[]])) as Record<DropCause, string[]>;
  let cases = 0, totalDrops = 0, noClaims = 0, mismatches = 0;

  for (const prof of profiles) {
    const c = await dynamoCaseRepo.getCase(prof.id);
    if (!c?.chunks?.length) continue;

    const assembled = assembleInput(c.chunks, c.outcome.holding);
    const prompt = buildPrompt(c, assembled);

    // summarizeCase's exact sequence: the base prompt, then one retry whose suffix
    // changes the cache key. Trying them in the other order would re-derive claims the
    // run never used.
    let raw = await readCache(prompt);
    let claims = raw === null ? null : parseClaims(raw);
    if (!claims) {
      const retry = await readCache(prompt + RETRY_SUFFIX);
      if (raw === null && retry === null) {
        // A miss means either the cache is incomplete or this script reconstructs the
        // prompt differently from the run. Both make the distribution meaningless, so
        // stop rather than silently measure a biased subset.
        throw new Error(
          `cache miss for ${c.id}. Either scripts/.cache/llm is incomplete, or the prompt ` +
          `reconstruction has drifted from summarizeCase. Do NOT interpret a partial run.`);
      }
      claims = retry === null ? null : parseClaims(retry);
    }
    if (!claims) { noClaims++; continue; }

    cases++;
    // Authoritative drop count from the shipped verifier…
    const truth = verifyClaims(claims, c.chunks, c.provenance.sourceUrl).dropped;

    // …and our own pass, which additionally tells us WHICH claim dropped.
    let anchors = 0, mine = 0;
    for (const cl of claims) {
      if (anchors >= 6) { mine++; continue; }
      const q = normWs(cl.quote ?? "");
      if (!(cl.text ?? "").trim() || q.length < 15) { mine++; continue; }
      const v = classifyDrop(cl.quote ?? "", c.chunks, assembled);
      if (v.cause === "locate_bug") { anchors++; continue; } // it verified — not a drop
      mine++;
      tally[v.cause]++;
      totalDrops++;
      if (samples[v.cause].length < 3) {
        samples[v.cause].push(
          `${c.id} ${v.bestPara ?? "?"} overlap=${v.bestOverlap.toFixed(2)} divergeAt=${v.divergenceAt ?? "-"}\n` +
          `        quote: ${JSON.stringify(q.slice(0, 150))}`);
      }
    }
    // If our replication and the shipped verifier disagree, the buckets describe a
    // different population than the one the run reported.
    if (mine !== truth) {
      mismatches++;
      console.log(`   ⚠ ${c.id}: replicated ${mine} drops, verifyClaims says ${truth}`);
    }
  }

  console.log(`\n${totalDrops} dropped claims across ${cases} cases · ${noClaims} cases had no parseable claims`);
  if (mismatches) console.log(`⚠ ${mismatches} cases where replication disagreed with verifyClaims — treat the distribution as suspect`);
  console.log("");
  for (const cause of ORDER) {
    console.log(`  ${cause.padEnd(19)} ${String(tally[cause]).padStart(4)}   ${NOTE[cause]}`);
  }
  const recoverable = tally.marker_bleed + tally.assembly_boundary + tally.normalization;
  console.log(`\n  recoverable without span alignment: ${recoverable}`);
  console.log(`  fabrication rate (unseen / total): ${totalDrops ? ((tally.unseen / totalDrops) * 100).toFixed(1) : "0"}%`);
  for (const cause of ORDER) {
    if (!samples[cause].length) continue;
    console.log(`\n### ${cause}`);
    for (const s of samples[cause]) console.log(`  - ${s}`);
  }
}
main().catch((e) => { console.error("❌ cases-drop-forensics failed:", e); process.exit(1); });
```

- [ ] **Step 2: Add npm scripts to `package.json`**

Beside the existing `cases:outcome-review` entries. No `BEDROCK_REGION` — this script makes no
model calls, and omitting it makes that explicit:

```json
"cases:drop-forensics": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-drop-forensics.ts",
"cases:drop-forensics:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx scripts/cases-drop-forensics.ts"
```

- [ ] **Step 3: Full gate**

Run: `npx tsx scripts/test-cases-drop-cause.ts && npx tsx scripts/test-cases-summarizer.ts && npx tsx scripts/test-cases-caseqa.ts && npx tsx scripts/test-cases-briefs.ts && npm run typecheck && npm run build`
Expected: all PASS.

Do NOT run `npm run verify` (it factory-resets the local corpus) and do NOT run the forensics script
itself — it needs credentials.

- [ ] **Step 4: Commit**

```bash
git add scripts/cases-drop-forensics.ts package.json
git commit -m "feat(cases): read-only claim-drop forensics runner"
```

---

## Operational (after merge — needs DynamoDB read credentials)

The 1488 cached responses live in whichever checkout ran the summarize. Copy
`scripts/.cache/llm` into the worktree the forensics runs from, or run it from that checkout —
otherwise every case is a cache miss and the script will (correctly) abort on the first one.

```bash
npm run cases:drop-forensics:cloud > drop-forensics.txt
```

Then write `docs/research/2026-07-31-claim-drop-forensics.md` from the output: the distribution, the
worked examples, and what each bucket implies. **No recommendation in that document** — the remedy is
a separate decision made with the distribution in hand.

Read `locate_bug` first. It should be 0; anything else means the shipped verifier and this classifier
disagree about what `locate()` can find, and nothing below it can be trusted until that is explained.

---

## Self-Review

**Spec coverage.** Six buckets, exclusive and ordered → T1 `classifyDrop`. LCS-anchored divergence
rather than prefix-anchored → T1 `lcsSpan`, with a test asserting the offset is not 0. Ordering
regression → T1 test. All 561 cases, no sampling → T2 iterates `listCases`. Zero LLM calls → T2 reads
the cache only and never constructs a model. Abort on cache miss → T2 throws with the case id and the
two reasons. Read-only → no `UpdateCommand`/`PutCommand` anywhere in T2. Distribution plus three
worked examples per bucket → T2 output. No fix and no recommendation → nothing in either task edits
`summarizer.ts`, and `NOTE` states implications without proposing remedies.

**Placeholder scan.** No TBD. Every code step is complete; every run step names its command and
expected result. The one deviation from the spec's table — `marker_bleed` before `assembly_boundary`
— is called out in both documents with the reason.

**Type consistency.** `DropCause` is declared once in `drop-cause.ts` and imported by the runner.
`DropVerdict.divergenceAt` is `number | null`, and the runner renders `?? "-"`. `bestPara` is
`string | null`, rendered `?? "?"`. `lcsSpan` returns `{ len, quoteStart }` in both the test and the
implementation. The runner imports `verifyClaims` for the cross-check and calls it **without**
`measureOverlap`, since it needs only the count and the overlap scan would be wasted work.
