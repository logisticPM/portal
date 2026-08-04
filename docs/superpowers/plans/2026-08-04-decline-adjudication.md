# Decline Adjudication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask a blind judge which of two candidate paragraphs a declined quotation came from, twice per pair with the order swapped, and report whether the answer is stable, whether it abstains, and whether it agrees with what the model cited.

**Architecture:** One additive measurement-only field on `ClaimDrop` (the normalised quote, which no drop record currently carries), three pure modules — the blinded prompt, the tally, and the judge-identity guard — and a read-only runner that replays the warm LLM cache to re-derive the declined population.

**Tech Stack:** TypeScript (strict), `tsx`, `node:assert/strict`, DynamoDB read, Bedrock via the existing `LlmModel` abstraction.

**Spec:** `docs/superpowers/specs/2026-08-04-decline-adjudication-design.md` — read §3 (pre-registered thresholds), §4 (position bias), §5 (blinding), §9 (guards) and §11 (why one production file changes).

---

## Why this exists, and what it can and cannot conclude

`2026-08-03-anchor-signals-results.md` (#228) found the model's own `citedPara` could not distinguish itself from chance on the 15 claims the uniqueness guard declines (*p* = 0.29 / 0.51 / 0.39). The open item was ground truth. **No human will read the judgments** — the adjudication is LLM-only by decision, so this cannot produce ground truth and the findings doc must say so in its first paragraph.

**Read §3 of the spec before writing code.** Its point is that a *positive* result is not establishable at this n: three of the four possible outcomes close the tie-breaker line, and both decision thresholds are pre-registered. Do not add anything that would let a weak positive be presented as support.

## Facts the implementer needs

Verified on this branch; do not re-derive.

- **`npm test` does not exist and CI runs only `typecheck` and `build`.** Run suites yourself with `npx tsx`. A failing test will NOT be caught by CI.
- **Baseline:** `npx tsc --noEmit -p tsconfig.json` exits 0; there is no `scripts/test-cases-adjudicate.ts` yet.
- **`ClaimDrop` does not carry the quote** — only `quoteLen: quote.length`, at `src/lib/cases/ingest/summarizer.ts:196`. `record()` (`:190`) receives `quote` already normalised: the loop does `const quote = normWs(cl.quote ?? "")`.
- **Existing signatures:**
  ```ts
  export function verifyClaims(claims: RawClaim[], chunks: CaseChunk[], sourceUrl: string, opts?: VerifyClaimsOpts):
    { anchors: CitationAnchor[]; dropped: number; drops: ClaimDrop[]; recovered: number }   // summarizer.ts:122
  export interface LlmModel { id: string; call: (prompt: string) => Promise<string>; }       // ingest/llm.ts:19
  export const cachedModel = (m: LlmModel): LlmModel => …                                   // ingest/llm.ts:131
  export function modelFromId(id: string, opts?: CallOpts): LlmModel                        // ingest/llm.ts:36
  export function seededShuffle<T>(xs: readonly T[], seed: number): T[]                      // caseqa-eval/rng.ts
  ```
- **Copy the replay skeleton from `scripts/cases-anchor-signals.ts`** — the cache key (`sha256(modelId + "\n" + prompt).slice(0,32)`), `readCache`, the curated-summary skip (`if (c.summary && c.summaryMeta?.method !== "llm") { curated++; continue; }`), and the cache-miss `throw`. Do not reinvent them; a partial replay measures an unrepresentative population, which is the failure this line of work keeps hitting.
- **The judge model default is `us.anthropic.claude-opus-4-5-20251101-v1:0`** — verified invocable by a real Converse call. Two ids written from memory into an earlier spec were dead and a third was listed `ACTIVE` yet "not available for this account", so do not substitute one.
- **Digit-normalised comparison, for comparability with #228.** That report compared `citedPara` to a paragraph id on the first digit run (`s?.match(/\d+/)?.[0]`). The tally must use the same rule or the two reports cannot be read side by side.
- **`citedPara` names NEITHER candidate in 4 of the 15.** From #228's published rows. Those cannot contribute to an agreement measurement in either direction and must be their own bucket, excluded from the denominator — counting them as disagreements would manufacture a negative.

## File Structure

| file | responsibility |
|---|---|
| `src/lib/cases/ingest/summarizer.ts` | **+1 additive field**: `ClaimDrop.quote` |
| `src/lib/cases/adjudicate/prompt.ts` | blinded prompt builder + pick parser. Pure. |
| `src/lib/cases/adjudicate/tally.ts` | the four metrics, the pre-registered gates, binomial *p*, reconciliation. Pure. |
| `src/lib/cases/adjudicate/guards.ts` | the judge-identity assertion. Pure, so spec §9.1 can have a test. |
| `scripts/cases-adjudicate-declines.ts` | replay, order assignment, judge calls, report. All I/O. |
| `scripts/test-cases-adjudicate.ts` | unit tests over the three pure modules. |
| `package.json` | two npm scripts. |

---

## Task 1: The additive `ClaimDrop.quote` field, and prove production is unchanged

**Files:**
- Modify: `src/lib/cases/ingest/summarizer.ts`

- [ ] **Step 1: Add the field to the interface**

In `src/lib/cases/ingest/summarizer.ts`, in `interface ClaimDrop`, immediately after `quoteLen: number;`:

```ts
  // The NORMALISED quotation (normWs applied), measurement-only — same pattern and same reason
  // as `rival`, `rivalPara` and `declinedByGuard` below. Added because the decline-adjudication
  // instrument must show a blind judge the quotation, and `quoteLen` is a length: the quote is
  // otherwise unrecoverable from a drop record. Matching drops back to parsed claims on
  // (quoteLen, citedPara) was rejected — it is ambiguous when two claims share both, and an
  // in-order walk mis-associates when a claim that ANCHORED shares the key with one that
  // dropped, silently handing the judge the wrong quotation.
  //
  // This does NOT reach the product. `CitationAnchor` still has no quote field; the model's
  // quotation is still a locator that is discarded once it has found a paragraph. `ClaimDrop`
  // is never persisted — cases-summarize.ts writes `summary` and `summaryMeta` only.
  quote: string;
```

- [ ] **Step 2: Populate it**

At `src/lib/cases/ingest/summarizer.ts:196`, change:

```ts
      reason, quoteLen: quote.length, citedPara, citedParaFound: !!findCited(citedPara),
```

to:

```ts
      reason, quoteLen: quote.length, quote, citedPara, citedParaFound: !!findCited(citedPara),
```

`quote` here is already `normWs`-normalised by the loop at `:206`, so the field's documented meaning holds with no further work.

- [ ] **Step 3: Typecheck and run the existing suite**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsx scripts/test-cases-summarizer.ts
```
Expected: `tsc` exits 0, and `✅ test-cases-summarizer passed`. A purely additive field cannot break either; if it does, stop and report.

- [ ] **Step 4: Prove production behaviour is unchanged (spec guard §9.7)**

`git diff` being small is NOT the check. Build a differential against `origin/main`.

Extract main's version **into the same directory** so its relative imports resolve:

```bash
git show origin/main:src/lib/cases/ingest/summarizer.ts > src/lib/cases/ingest/summarizer.main.ts
```

Create `scripts/tmp-differential.ts`:

```ts
// Throwaway. Compares this branch's verifyClaims against origin/main's over randomized
// synthetic corpora. Deleted in step 5 — do NOT commit it.
import { verifyClaims as branchVerify } from "../src/lib/cases/ingest/summarizer";
import { verifyClaims as mainVerify } from "../src/lib/cases/ingest/summarizer.main";

const rnd = (n: number) => Math.floor(Math.random() * n);
const WORDS = "crown duty consult title treaty fiduciary honour reserve licence permit nation".split(" ");
const sentence = (n: number) => Array.from({ length: n }, () => WORDS[rnd(WORDS.length)]).join(" ") + ".";

let cases = 0, mismatches = 0, anchored = 0, dropped = 0, recovered = 0;
for (let iter = 0; iter < 4000; iter++) {
  const nChunks = 1 + rnd(6);
  const chunks = Array.from({ length: nChunks }, (_, i) => ({
    paragraph: `para-${i + 1}`,
    // ~50% duplicated text so the uniqueness guard actually fires.
    text: i > 0 && rnd(2) === 0 ? "" : sentence(12 + rnd(20)),
  }));
  for (let i = 1; i < chunks.length; i++) if (!chunks[i].text) chunks[i].text = chunks[rnd(i)].text;

  const claims = Array.from({ length: 1 + rnd(8) }, () => {
    const src = chunks[rnd(chunks.length)].text;
    let q = src;
    const mode = rnd(5);
    if (mode === 0) q = src.replace(/^./, "X");                    // one-char garble
    else if (mode === 1) q = src.slice(0, Math.max(0, src.length - 1 - rnd(10)));  // truncated
    else if (mode === 2) q = sentence(10);                         // unrelated
    else if (mode === 3) q = "";                                   // empty
    const cited = ["para-1", "1", "[para-2]", "para-999", ""][rnd(5)];
    return { text: rnd(10) === 0 ? "" : sentence(6), quote: q, paragraph: cited };
  });

  for (const measure of [true, false]) {
    const a = branchVerify(claims as never, chunks, "https://x.test", { measureOverlap: measure });
    const b = mainVerify(claims as never, chunks, "https://x.test", { measureOverlap: measure });
    cases++;
    anchored += a.anchors.length; dropped += a.dropped; recovered += a.recovered;
    const pre = (d: Record<string, unknown>) => {
      // Compare every PRE-EXISTING field; `quote` is the new one and is expected to differ
      // (main does not have it), so it is excluded by construction.
      const { quote, ...rest } = d as { quote?: unknown };
      return rest;
    };
    const same =
      JSON.stringify(a.anchors) === JSON.stringify(b.anchors) &&
      a.dropped === b.dropped && a.recovered === b.recovered &&
      JSON.stringify(a.drops.map(pre)) === JSON.stringify(b.drops.map(pre));
    if (!same) {
      mismatches++;
      if (mismatches <= 2) console.log("MISMATCH", JSON.stringify({ chunks, claims, measure }).slice(0, 600));
    }
  }
}
console.log(`${cases} comparisons · ${mismatches} mismatches · anchored ${anchored} dropped ${dropped} recovered ${recovered}`);
if (mismatches) { console.error("❌ production behaviour CHANGED"); process.exit(1); }
console.log("✅ production behaviour unchanged");
```

Run: `npx tsx scripts/tmp-differential.ts`
Expected: `0 mismatches` and `✅ production behaviour unchanged`. **`recovered` and `dropped` must both be non-zero** — if either is 0 the corpora never exercised the near-exact path and the differential proved nothing. Report all four numbers.

- [ ] **Step 5: Delete both throwaways and confirm the tree is clean**

```bash
rm src/lib/cases/ingest/summarizer.main.ts scripts/tmp-differential.ts
git status --porcelain
```
Expected: only `src/lib/cases/ingest/summarizer.ts` modified. If `summarizer.main.ts` or `tmp-differential.ts` still appear, delete them — committing either would ship a duplicate of the module.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/ingest/summarizer.ts
git commit -m "feat(cases): ClaimDrop carries the normalised quote, measurement-only

The decline-adjudication instrument must show a blind judge the quotation, and a drop
record cannot supply it: ClaimDrop stores quoteLen, a length. Matching drops back to
parsed claims on (quoteLen, citedPara) was rejected — ambiguous when two claims share
both, and an in-order walk mis-associates when a claim that anchored shares the key with
one that dropped, silently handing the judge the wrong quotation.

Same pattern as rival/rivalPara/declinedByGuard. CitationAnchor is unchanged, so the
quotation still never reaches the product, and ClaimDrop is not persisted.

Verified by differential against origin/main over randomized synthetic corpora: anchors,
dropped, recovered and every pre-existing ClaimDrop field identical."
```

---

## Task 2: The blinded prompt and the pick parser

**Files:**
- Create: `src/lib/cases/adjudicate/prompt.ts`
- Create: `scripts/test-cases-adjudicate.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-adjudicate.ts`:

```ts
// Offline unit tests for the decline-adjudication instrument. No AWS, no LLM calls.
// Run: npx tsx scripts/test-cases-adjudicate.ts
import assert from "node:assert/strict";

(async () => {
  const { buildAdjudicationPrompt, parsePick } = await import("../src/lib/cases/adjudicate/prompt");

  // --- parsePick: three first-class answers, null on anything else -------------------
  {
    assert.equal(parsePick('{"pick":"A"}'), "A");
    assert.equal(parsePick('{"pick":"B"}'), "B");
    assert.equal(parsePick('{"pick":"unsure"}'), "unsure");
    assert.equal(parsePick('```json\n{"pick": "b"}\n```'), "B", "fences and case must survive");
    assert.equal(parsePick('{"reason":"both match","pick":"unsure"}'), "unsure");
    // Unparseable is NOT an abstention: `unsure` is the judge telling us the pair is
    // undecidable, which spec §2 treats as a result. A response we cannot read is OUR
    // failure and must never be counted as the judge's answer.
    assert.equal(parsePick("I think A"), null, "prose is not a verdict");
    assert.equal(parsePick('{"pick":"C"}'), null);
    assert.equal(parsePick('{"pick":true}'), null);
    assert.equal(parsePick(""), null);
  }

  // --- buildAdjudicationPrompt: BLINDING is the whole design (spec §5) ---------------
  {
    const quote = "the Crown owed a fiduciary duty in these circumstances";
    const p = buildAdjudicationPrompt(quote, "First paragraph text about consultation.", "Second paragraph text about title.");
    assert.ok(p.includes(quote), "the quotation must be present");
    assert.ok(p.includes("First paragraph text about consultation."), "paragraph A must be present");
    assert.ok(p.includes("Second paragraph text about title."), "paragraph B must be present");
    assert.ok(/unsure/.test(p), "abstention must be offered explicitly, not grudgingly");
    // What must NOT leak. Any of these turns an independent read into a confirmation.
    [/\bbest\b/i, /\brival\b/i, /overlap/i, /\bcited\b/i, /0\.9\d/, /para-\d/].forEach((re) =>
      assert.ok(!re.test(p), `the prompt must not leak ${re}`));
  }

  // --- the same quote and paragraphs in swapped order give a DIFFERENT prompt --------
  // Position-bias control (spec §4) only works if the two calls really differ, and only if
  // they differ ONLY in order — otherwise the flip rate measures something else.
  {
    const q = "a quotation";
    const one = buildAdjudicationPrompt(q, "alpha text", "beta text");
    const two = buildAdjudicationPrompt(q, "beta text", "alpha text");
    assert.notEqual(one, two, "swapping the order must change the prompt");
    assert.equal(one.length, two.length, "…and must change nothing else");
  }

  console.log("✅ test-cases-adjudicate passed");
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-adjudicate.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/adjudicate/prompt'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/cases/adjudicate/prompt.ts`:

```ts
// Blinded adjudication of the claims the uniqueness guard declines (spec 2026-08-04).
//
// The judge sees the quotation and two candidate paragraphs labelled A and B, and NOTHING
// else. It does not learn which candidate our overlap scoring preferred, what the model cited,
// the overlap numbers, the case, or the paragraph ids. Every one of those would turn an
// independent read into a confirmation of the thing being tested — which is the whole reason
// this measurement is worth running after #228 found citedPara at chance level.

export type Pick = "A" | "B" | "unsure";

function firstJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

// null means WE could not read the response. It is not an abstention: `unsure` is the judge
// telling us the pair is undecidable from the text, which spec §2 treats as a result in its own
// right, and folding a parse failure into it would inflate that result with our own bugs.
export function parsePick(raw: string): Pick | null {
  const v = firstJson(raw)?.pick;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return s === "a" ? "A" : s === "b" ? "B" : s === "unsure" ? "unsure" : null;
}

export function buildAdjudicationPrompt(quote: string, paraA: string, paraB: string): string {
  return `A sentence was quoted from a court decision, but the quotation was copied imperfectly — a word may be altered or the ending clipped. Two paragraphs from that decision are candidates for where it came from.

QUOTATION:
${quote}

PARAGRAPH A:
${paraA}

PARAGRAPH B:
${paraB}

Which paragraph is the quotation from? Judge only by comparing the wording. If both paragraphs could equally be the source, or you genuinely cannot tell them apart on this evidence, answer "unsure" — that is a real and useful answer here, not a failure, and guessing is worse than abstaining.

Output STRICTLY this JSON, no markdown:
{"pick":"A"|"B"|"unsure"}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-adjudicate.ts`
Expected: `✅ test-cases-adjudicate passed`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit 0

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/adjudicate/prompt.ts scripts/test-cases-adjudicate.ts
git commit -m "feat(adjudicate): blinded prompt and pick parser

The judge sees the quotation and two paragraphs labelled A and B and nothing else — not
which candidate our overlap scoring preferred, not what the model cited, not the overlap
numbers or paragraph ids. Any of those turns an independent read into a confirmation of
the thing under test, which is the only reason this is worth running after #228.

unsure is a first-class answer the prompt invites explicitly, because spec §2's second
question is how often a capable reader cannot tell. Unparseable returns null and is never
folded into it: that would inflate a result with our own bugs.

A test asserts the swapped-order prompt differs from the original and has the same length —
the position-bias control only means something if the two calls differ ONLY in order."
```

---

## Task 3: The tally, the pre-registered gates, and the judge-identity guard

**Files:**
- Create: `src/lib/cases/adjudicate/tally.ts`
- Create: `src/lib/cases/adjudicate/guards.ts`
- Modify: `scripts/test-cases-adjudicate.ts`

- [ ] **Step 1: Write the failing test**

Insert into `scripts/test-cases-adjudicate.ts`, before the final `console.log`:

```ts
  const { tally, FLIP_GATE, ABSTENTION_GATE } = await import("../src/lib/cases/adjudicate/tally");
  type Row = Parameters<typeof tally>[0][number];
  const row = (o: Partial<Row>): Row => ({
    caseId: "c", quote: "q", bestPara: "para-1", rivalPara: "para-2", citedPara: "para-1",
    first: "best", second: "best", ...o,
  });

  // --- the chain of narrowing denominators, each with its own exclusion --------------
  {
    const t = tally([
      // consistent, decided, cited names the BEST candidate -> agreement
      row({}),
      // consistent, decided, cited names the RIVAL -> disagreement
      row({ citedPara: "para-2" }),
      // consistent abstention -> excluded from agreement, counted as abstained
      row({ first: "unsure", second: "unsure" }),
      // FLIPPED -> excluded from abstention and agreement both: no stable answer to compare
      row({ first: "best", second: "rival" }),
      // unparseable in one ordering -> its own bucket, never an abstention
      row({ first: "best", second: null }),
      // consistent + decided, but cited names NEITHER candidate. Cannot agree or disagree;
      // counting it as a disagreement would manufacture a negative. #228 found 4 of 15 here.
      row({ citedPara: "para-77" }),
    ]);

    assert.equal(t.pairs, 6);
    assert.equal(t.unparseable, 1);
    assert.equal(t.flipped, 1);
    assert.equal(t.consistent, 4, "6 pairs - 1 flipped - 1 unparseable");
    assert.equal(t.abstained, 1);
    assert.equal(t.decided, 3, "consistent, non-abstained");
    assert.equal(t.citedNamesNeither, 1);
    assert.equal(t.comparable, 2, "decided minus cited-names-neither");
    assert.equal(t.agreed, 1);
    assert.ok(Math.abs(t.agreementRate - 0.5) < 1e-9, "1 of 2 comparable");

    // Reconciliation must hold and be asserted, not assumed.
    assert.equal(t.consistent + t.flipped + t.unparseable, t.pairs);
  }

  // --- the pre-registered gates (spec §3), and the flip gate SUPPRESSES agreement ----
  {
    // 2 of 5 flipped = 0.4 >= FLIP_GATE. The agreement metric must not be computed at all —
    // spec §3 says a judge that disagrees with itself on a third of rows cannot support an
    // inference on a denominator this small.
    const flippy = tally([
      row({ first: "best", second: "rival" }), row({ first: "rival", second: "best" }),
      row({}), row({}), row({}),
    ]);
    assert.ok(flippy.flipRate >= FLIP_GATE);
    assert.equal(flippy.flipGateTripped, true);
    assert.equal(flippy.agreementRate, null, "agreement must be withheld, not merely flagged");
    assert.equal(flippy.p, null);

    // Abstention gate: half or more of consistent pairs abstained.
    const unsurey = tally([
      row({ first: "unsure", second: "unsure" }), row({ first: "unsure", second: "unsure" }),
      row({}), row({}),
    ]);
    assert.ok(unsurey.abstentionRate >= ABSTENTION_GATE);
    assert.equal(unsurey.abstentionGateTripped, true);
    assert.equal(unsurey.flipGateTripped, false, "the two gates are independent");
    assert.notEqual(unsurey.agreementRate, null, "the abstention gate does not suppress agreement");
  }

  // --- digit-normalised comparison, matching #228 so the two reports are comparable --
  {
    const t = tally([row({ citedPara: "[para-1]", bestPara: "para-1", rivalPara: "para-2" })]);
    assert.equal(t.agreed, 1, "a bracket-wrapped cited value must still match on the digit run");
    const u = tally([row({ citedPara: "1", bestPara: "para-1", rivalPara: "para-2" })]);
    assert.equal(u.agreed, 1, "a bare digit must match too");
  }

  // --- binomial p, and the empty population -----------------------------------------
  {
    // 5:0 on n=5 -> two-sided p = 2 * (1/32) = 0.0625
    const t = tally([row({}), row({}), row({}), row({}), row({})]);
    assert.ok(t.p !== null && Math.abs(t.p - 0.0625) < 1e-9, `expected 0.0625, got ${t.p}`);
    assert.throws(() => tally([]), /no pairs/i,
      "an empty population is an error, not a scorecard of zeros");
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-cases-adjudicate.ts`
Expected: FAIL — `Cannot find module '../src/lib/cases/adjudicate/tally'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/cases/adjudicate/tally.ts`:

```ts
// Pure scoring for the decline adjudication (spec 2026-08-04 §3, §8).
//
// Every denominator narrows, and each narrowing has a reason stated beside it. The final one
// may be very small — #228 found citedPara naming a candidate in only 9 of 15 — so each is
// printed with its numerator by the runner rather than as a bare percentage.

// Pre-registered in spec §3 BEFORE any data was seen. A threshold chosen afterwards is not a
// threshold; this is the discipline that made the CanLegalRAGBench negative clean.
export const FLIP_GATE = 1 / 3;
export const ABSTENTION_GATE = 1 / 2;

// Which candidate the judge's pick resolved to, once the A/B labelling is undone.
export type Side = "best" | "rival";
export type Answer = Side | "unsure" | null; // null = we could not parse the response

export interface PairRow {
  caseId: string;
  quote: string;
  bestPara: string;
  rivalPara: string;
  citedPara: string;
  first: Answer;   // the ordering presented first
  second: Answer;  // the same pair with the candidates swapped
}

export interface Tally {
  pairs: number;
  unparseable: number;
  flipped: number;
  consistent: number;
  abstained: number;
  decided: number;           // consistent and not an abstention
  citedNamesNeither: number; // of `decided`: citedPara matches neither candidate
  comparable: number;        // decided - citedNamesNeither
  agreed: number;            // of `comparable`: judge's side is the one citedPara names
  flipRate: number;
  abstentionRate: number;
  flipGateTripped: boolean;
  abstentionGateTripped: boolean;
  // null when the flip gate trips. Withheld rather than flagged, so a caller cannot print a
  // number the spec says is not interpretable.
  agreementRate: number | null;
  p: number | null;
}

// Digit-run comparison, deliberately identical to the rule
// `2026-08-03-anchor-signals-results.md` used, so the two reports can be read side by side.
// It is looser than production's findCited — that report explains why a ceiling wants the
// generous reading.
const digits = (s: string) => s.match(/\d+/)?.[0] ?? null;
const same = (a: string, b: string) => {
  const x = digits(a), y = digits(b);
  return x !== null && x === y;
};

// Exact for every n in play here; checked against BigInt for n <= 15 in the anchor-signals work.
const choose = (n: number, k: number) => { let v = 1; for (let i = 0; i < k; i++) v = (v * (n - i)) / (i + 1); return v; };
// Two-sided binomial against p=0.5, exact by doubling because Binomial(n, 0.5) is symmetric.
const pValue = (a: number, b: number) => {
  const n = a + b, k = Math.max(a, b);
  if (n === 0) return null;
  let tail = 0;
  for (let i = k; i <= n; i++) tail += choose(n, i);
  return Math.min(1, (2 * tail) / Math.pow(2, n));
};

export function tally(rows: readonly PairRow[]): Tally {
  if (!rows.length) throw new Error("no pairs — this run measured nothing, refusing to print a scorecard");

  let unparseable = 0, flipped = 0, consistent = 0, abstained = 0, decided = 0,
      citedNamesNeither = 0, agreed = 0;

  for (const r of rows) {
    // Checked FIRST: an unreadable response is our failure, and asking whether it "flipped"
    // would treat a missing answer as a disagreement.
    if (r.first === null || r.second === null) { unparseable++; continue; }
    if (r.first !== r.second) { flipped++; continue; }
    consistent++;
    if (r.first === "unsure") { abstained++; continue; }
    decided++;
    const namesBest = same(r.citedPara, r.bestPara), namesRival = same(r.citedPara, r.rivalPara);
    // citedPara pointing somewhere else entirely cannot agree OR disagree with the judge.
    // #228 found 4 of 15 rows here; scoring them as disagreements would manufacture a negative.
    if (!namesBest && !namesRival) { citedNamesNeither++; continue; }
    if ((r.first === "best" && namesBest) || (r.first === "rival" && namesRival)) agreed++;
  }

  if (consistent + flipped + unparseable !== rows.length) {
    throw new Error(`${rows.length} pairs but ${consistent}+${flipped}+${unparseable} accounted for — a row reached no bucket`);
  }

  const comparable = decided - citedNamesNeither;
  const flipRate = flipped / rows.length;
  const flipGateTripped = flipRate >= FLIP_GATE;
  const abstentionRate = consistent ? abstained / consistent : 0;

  return {
    pairs: rows.length, unparseable, flipped, consistent, abstained, decided,
    citedNamesNeither, comparable, agreed,
    flipRate, abstentionRate,
    flipGateTripped, abstentionGateTripped: abstentionRate >= ABSTENTION_GATE,
    // Withheld entirely when the flip gate trips: spec §3 says the agreement metric is not
    // computed in that case, and returning a number a caller might print anyway would defeat
    // the pre-registration.
    agreementRate: flipGateTripped || !comparable ? null : agreed / comparable,
    p: flipGateTripped ? null : pValue(agreed, comparable - agreed),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-cases-adjudicate.ts`
Expected: `✅ test-cases-adjudicate passed`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit 0

- [ ] **Step 6: Add the judge-identity guard, with a test**

Spec §9.1 requires this guard to have a test that fails when it is removed. A guard written inline
in the runner cannot have one — the test file never imports the runner. That is exactly why
`caseqa-eval/guards.ts` exists on a sibling branch, so follow the same pattern here.

Append to `scripts/test-cases-adjudicate.ts`, before the final `console.log`:

```ts
  const { assertJudgeIsNotSummarizer } = await import("../src/lib/cases/adjudicate/guards");

  // --- guard §9.1: the model under test cannot be its own adjudicator ---------------
  {
    assert.doesNotThrow(() => assertJudgeIsNotSummarizer("judge-x", "summarizer-y"));
    assert.throws(() => assertJudgeIsNotSummarizer("same-model", "same-model"), /summarizer/i,
      "the summarizer must not be allowed to adjudicate its own citedPara");
    // The error must name the model, or a failed run sends the reader back to the env vars.
    assert.throws(() => assertJudgeIsNotSummarizer("m-1", "m-1"), /m-1/);
  }
```

Create `src/lib/cases/adjudicate/guards.ts`:

```ts
// Spec §9.1 as a pure function, so it can have a test that fails when it is removed. A guard
// buried in an I/O runner cannot have one, and on a sibling branch that gap let a counter ship
// that could never fire.

// The whole measurement is "does an INDEPENDENT reader agree with the summarizer's citedPara".
// If the summarizer adjudicates, the answer is self-consistency and the report would present it
// as corroboration — the failure mode #228 was written to avoid, reintroduced one layer up.
export function assertJudgeIsNotSummarizer(judge: string, summarizer: string): void {
  if (judge === summarizer) {
    throw new Error(`the judge must not be the summarizer (${summarizer}) — it would be grading ` +
      `its own bookkeeping, and the result would be self-consistency presented as corroboration`);
  }
}
```

Run: `npx tsx scripts/test-cases-adjudicate.ts` → `✅ test-cases-adjudicate passed`, then
`npx tsc --noEmit -p tsconfig.json` → exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cases/adjudicate/tally.ts src/lib/cases/adjudicate/guards.ts scripts/test-cases-adjudicate.ts
git commit -m "feat(adjudicate): tally with pre-registered gates and narrowing denominators

Four denominators, each narrowing, each with its exclusion stated. Two matter most:
a FLIPPED pair is excluded from abstention and agreement because it has no stable answer
to compare, and resolving it by taking one ordering would be picking the answer; and a row
where citedPara names NEITHER candidate is its own bucket, because it can neither agree nor
disagree and scoring it as a disagreement would manufacture a negative — #228 found 4 of 15
rows there.

The flip gate WITHHOLDS agreementRate and p as null rather than flagging them, so a caller
cannot print a number spec §3 says is not interpretable. Both gate values are the ones
pre-registered in the spec before any data was seen.

Digit-run comparison is deliberately identical to the anchor-signals rule so the two
reports can be read side by side."
```

---

## Task 4: The runner and npm scripts

**Files:**
- Create: `scripts/cases-adjudicate-declines.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the runner**

Create `scripts/cases-adjudicate-declines.ts`:

```ts
// Blind adjudication of the claims the uniqueness guard declines (spec 2026-08-04).
//
// NOT GROUND TRUTH. No human reads anything here — the adjudication is LLM-only by decision,
// so whatever the judge picks we do not learn which paragraph a quotation came from. What this
// CAN establish, per spec §3, is a negative or a methodological result: whether the judge's
// answer survives swapping the presentation order, and how often it abstains. Three of the four
// possible outcomes close the tie-breaker line.
//
// Model responses for the REPLAY come from scripts/.cache/llm (zero LLM calls to re-derive the
// population). The judge calls are new but cached. Writes nothing to the table.
import "./fetch-polyfill";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { assembleInput, buildPrompt, parseClaims, verifyClaims, RETRY_SUFFIX } from "../src/lib/cases/ingest/summarizer";
import { modelFromId, cachedModel } from "../src/lib/cases/ingest/llm";
import { seededShuffle } from "../src/lib/cases/caseqa-eval/rng";
import { buildAdjudicationPrompt, parsePick } from "../src/lib/cases/adjudicate/prompt";
import { tally, FLIP_GATE, ABSTENTION_GATE, type PairRow, type Answer } from "../src/lib/cases/adjudicate/tally";
import { assertJudgeIsNotSummarizer } from "../src/lib/cases/adjudicate/guards";

const CACHE = path.join(process.cwd(), "scripts", ".cache", "llm");
const SUMMARY_MODEL = process.env.SUMMARY_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";
const JUDGE = process.env.ADJ_JUDGE_MODEL ?? "us.anthropic.claude-opus-4-5-20251101-v1:0";
const SEED = Number(process.env.ADJ_SEED ?? 1);
const JUDGE_MAX_TOKENS = 256;

const keyFor = (p: string) => createHash("sha256").update(SUMMARY_MODEL + "\n" + p).digest("hex").slice(0, 32);
const readCache = async (p: string) => {
  try { return await fs.readFile(path.join(CACHE, keyFor(p) + ".txt"), "utf8"); } catch { return null; }
};

async function main() {
  // Spec §7/§9.1, in guards.ts so it has a test.
  assertJudgeIsNotSummarizer(JUDGE, SUMMARY_MODEL);
  const judge = cachedModel(modelFromId(JUDGE, { maxTokens: JUDGE_MAX_TOKENS }));

  // --- re-derive the declined population by replaying the warm cache (spec §6) -------
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  // Paragraph TEXT is captured here, during the replay, rather than re-fetched later: the loop
  // already holds every case, and a second getCase pass per decline would re-read cases we have.
  const declines: {
    caseId: string; quote: string;
    bestPara: string; rivalPara: string; citedPara: string;
    bestText: string; rivalText: string;
  }[] = [];
  let cases = 0, curated = 0, noClaims = 0;
  for (const prof of profiles) {
    const c = await dynamoCaseRepo.getCase(prof.id);
    if (!c?.chunks?.length) continue;
    // A hand-curated summary was never produced by a model, so there is no cached response to
    // replay — outside the population, not a gap in the cache.
    if (c.summary && c.summaryMeta?.method !== "llm") { curated++; continue; }
    const prompt = buildPrompt(c, assembleInput(c.chunks, c.outcome.holding));
    const raw = await readCache(prompt);
    let claims = raw === null ? null : parseClaims(raw);
    if (!claims) {
      const retry = await readCache(prompt + RETRY_SUFFIX);
      // A miss means the cache no longer matches the prompts the corpus would produce.
      // Measuring a partial population is the failure this line of work keeps hitting.
      if (retry === null) {
        throw new Error(`cache miss for ${c.id}. Re-run cases:summarize first, or the population ` +
          `describes an unrepresentative subset. Do NOT interpret a partial run.`);
      }
      claims = parseClaims(retry);
    }
    if (!claims) { noClaims++; continue; }
    cases++;
    const text = new Map(c.chunks.map((ch) => [ch.paragraph, ch.text]));
    for (const d of verifyClaims(claims, c.chunks, c.provenance.sourceUrl, { measureOverlap: true }).drops) {
      if (!d.declinedByGuard || !d.bestPara || !d.rivalPara) continue;
      const bestText = text.get(d.bestPara), rivalText = text.get(d.rivalPara);
      // Both paragraphs are by construction chunks of THIS case — verifyClaims derives bestPara
      // and rivalPara from the same array. If either is missing the association is broken and a
      // blank paragraph would be handed to the judge as if it were evidence.
      if (!bestText || !rivalText) {
        throw new Error(`${c.id}: declined claim cites ${d.bestPara}/${d.rivalPara}, absent from chunks`);
      }
      declines.push({
        caseId: c.id, quote: d.quote, citedPara: d.citedPara,
        bestPara: d.bestPara, rivalPara: d.rivalPara, bestText, rivalText,
      });
    }
  }
  if (!declines.length) throw new Error("the guard declines nothing in this corpus — nothing to adjudicate");

  // --- judge each pair TWICE, order swapped (spec §4) --------------------------------
  const rows: PairRow[] = [];
  // Seeded so the assignment is reproducible; which candidate goes first is decided per pair
  // rather than always best-first, so a position-preferring judge cannot score well by default.
  const bestFirst = seededShuffle(declines.map((_, i) => i % 2 === 0), SEED);
  for (const [i, d] of declines.entries()) {
    const [p1, p2] = bestFirst[i] ? [d.bestText, d.rivalText] : [d.rivalText, d.bestText];
    // The two calls differ ONLY in the order the paragraphs appear.
    const one = parsePick(await judge.call(buildAdjudicationPrompt(d.quote, p1, p2)));
    const two = parsePick(await judge.call(buildAdjudicationPrompt(d.quote, p2, p1)));
    // Undo the A/B labelling. In ordering 1, "A" is the best match iff bestFirst[i]; ordering 2
    // is the inverse. Getting this backwards would silently invert every agreement result.
    const side = (pick: ReturnType<typeof parsePick>, bestIsA: boolean): Answer =>
      pick === null || pick === "unsure" ? pick : (pick === "A") === bestIsA ? "best" : "rival";
    rows.push({
      caseId: d.caseId, quote: d.quote, bestPara: d.bestPara, rivalPara: d.rivalPara,
      citedPara: d.citedPara, first: side(one, bestFirst[i]), second: side(two, !bestFirst[i]),
    });
  }

  const t = tally(rows);

  console.log(`\njudge      ${JUDGE}`);
  console.log(`summarizer ${SUMMARY_MODEL} (under test — cannot be the judge)`);
  console.log(`seed ${SEED} · replayed ${cases} cases · ${curated} curated outside the population` +
    `${noClaims ? ` · ${noClaims} with no parseable claims` : ""}`);
  console.log(`declines re-derived from the corpus: ${t.pairs} (not hardcoded — #228 published 15)`);

  console.log(`\n--- all ${rows.length} pairs ---`);
  for (const r of rows) {
    const flag = r.first === null || r.second === null ? "UNPARSEABLE"
      : r.first !== r.second ? "FLIPPED"
      : r.first === "unsure" ? "unsure" : `picked ${r.first}`;
    console.log(`  ${r.caseId.padEnd(14)} best=${r.bestPara.padEnd(9)} rival=${r.rivalPara.padEnd(9)} cited=${r.citedPara.padEnd(11)} ${flag}`);
    console.log(`        quote: ${JSON.stringify(r.quote.slice(0, 130))}`);
  }

  console.log(`\n--- results (NOT ground truth: no human read any of this) ---`);
  console.log(`  flip rate        ${(t.flipRate * 100).toFixed(1)}%  (${t.flipped}/${t.pairs})  gate ${(FLIP_GATE * 100).toFixed(0)}%${t.flipGateTripped ? "  ** TRIPPED **" : ""}`);
  console.log(`  unparseable      ${t.unparseable}/${t.pairs}  (our failure, never counted as an abstention)`);
  console.log(`  abstention rate  ${(t.abstentionRate * 100).toFixed(1)}%  (${t.abstained}/${t.consistent} order-consistent)  gate ${(ABSTENTION_GATE * 100).toFixed(0)}%${t.abstentionGateTripped ? "  ** TRIPPED **" : ""}`);
  console.log(`  decided          ${t.decided}  · of those, citedPara names neither candidate in ${t.citedNamesNeither}`);
  if (t.agreementRate === null) {
    console.log(`  agreement        WITHHELD — the flip gate tripped, so spec §3 does not permit computing it`);
  } else {
    console.log(`  agreement        ${(t.agreementRate * 100).toFixed(1)}%  (${t.agreed}/${t.comparable} comparable)  two-sided p=${t.p?.toFixed(2)}`);
  }
  console.log(`\n  Per spec §3, a positive here would be a reason to seek ground truth — never a reason to build.`);
}
main().catch((e) => { console.error("❌ cases-adjudicate-declines failed:", e instanceof Error ? e.message : String(e)); process.exit(1); });
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output, exit 0

- [ ] **Step 3: Add the npm scripts**

In `package.json`, immediately after the `"cases:anchor-signals:cloud"` entry:

```json
    "cases:adjudicate": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-adjudicate-declines.ts",
    "cases:adjudicate:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-adjudicate-declines.ts",
```

- [ ] **Step 4: Verify the judge≠summarizer guard aborts before any network call**

Run: `npx cross-env ADJ_JUDGE_MODEL=us.meta.llama3-3-70b-instruct-v1:0 CASES_TABLE=LegalCases REPO_IMPL=dynamo AWS_REGION=us-east-1 tsx scripts/cases-adjudicate-declines.ts`
Expected: exit 1 with `❌ cases-adjudicate-declines failed: the judge must not be the summarizer (us.meta.llama3-3-70b-instruct-v1:0) — it would be grading its own bookkeeping, and the result would be self-consistency presented as corroboration`. Nothing should reach AWS, which is what makes this verification free.

- [ ] **Step 5: Confirm package.json is valid and both suites pass**

```bash
node -e "console.log(Object.keys(require('./package.json').scripts).filter(k=>k.startsWith('cases:adjudicate')))"
npx tsx scripts/test-cases-adjudicate.ts && npx tsx scripts/test-cases-summarizer.ts
```
Expected: `[ 'cases:adjudicate', 'cases:adjudicate:cloud' ]`, then both `✅ … passed` lines.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: exit 0. Included because CI runs `typecheck` and `build` and nothing else.

- [ ] **Step 7: Commit**

```bash
git add scripts/cases-adjudicate-declines.ts package.json
git commit -m "feat(adjudicate): runner — re-derived population, order-swapped judging

The population is re-derived by replaying the warm cache rather than hardcoding #228's
fifteen, which would go stale the next time the corpus changes — and it changed twice in
the week this line of work ran. Same cache-miss abort as the other replay runners.

Each pair is judged twice with the presentation order swapped, and which candidate goes
first is seeded per pair rather than always best-first, so a judge that prefers position 1
cannot score well by default. The A/B labelling is undone before tallying.

Prints all rows and labels the result NOT GROUND TRUTH, because no human read any of it."
```

---

## Not in this plan

- **Running the measurement.** 30 judge calls plus a read-only replay; an ops step after merge. Its output becomes `docs/research/2026-08-04-decline-adjudication-results.md`, which per spec §13 must state in its first paragraph that this is not ground truth, record which of §3's four outcomes the data landed in, and **recommend nothing**.
- **Any change to `CitationAnchor` or the product's Q&A path.** The quotation still never reaches the reader.
- **RM-3 sub-project A** (expanding the retrieval eval from 18 queries) — separate spec.
