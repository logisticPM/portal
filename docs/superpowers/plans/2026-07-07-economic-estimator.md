# Recorded Economic Figures (client idea #3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the real, citation-anchored monetary figures that appear in core judgments (extracted + mechanically verified verbatim, never fabricated) and present them honestly on the case pages and activation dashboard (coverage denominator + per-kind ranges, never a cross-case total).

**Architecture:** Mirror the AI-summaries pipeline — an LLM extracts candidate figures with a verbatim quote + anchor + kind/role; a mechanical verifier keeps a figure only if its amount parses and its quote appears verbatim in the judgment text (re-anchored). Figures live in a new `extractedFigures[]` layer on the PROFILE (separate from the authoritative curated `economic`). Aggregation computes per-kind ranges over court-awarded/ordered amounts with a coverage denominator; no sums.

**Tech Stack:** TypeScript, `tsx`, AWS SDK v3 (`@aws-sdk/lib-dynamodb`), DynamoDB single-table, Next.js 14 RSC, `node:assert/strict` tests via `npx tsx`.

Each task leaves a green `tsc`. Run every command from the worktree root; do NOT run `npm run verify`.

---

### Task 1: Types + round-trip mapping

**Files:**
- Modify: `src/lib/cases/types.ts`
- Modify: `src/lib/dynamo/cases-table.ts` (`itemToCase`)
- Test: `scripts/test-cases-table.ts` (extend the kitchen-sink fixture)

- [ ] **Step 1: Add the new types**

In `src/lib/cases/types.ts`, add after the `EconomicDimension` interface:

```ts
export type FigureKind = "settlement" | "compensation" | "damages" | "resource_revenue" | "equity" | "other";
export type FigureRole = "awarded" | "ordered" | "claimed" | "valuation" | "contextual";

export interface ExtractedFigure {
  raw: string;              // verbatim as it appears, e.g. "$30 million", "51%"
  amount: number;           // deterministically parsed from raw
  currency: string;         // "CAD" default; "USD" if the judgment says so
  unit?: "percent";         // set for equity stakes expressed as a percentage
  kind: FigureKind;
  role: FigureRole;
  quote: string;            // clause containing raw, verbatim and verified in the text
  sourceParagraph: string;
  sourceUrl: string;
}

export interface FiguresMeta { method: "llm"; model: string; generatedAt: string; dropped: number; }

export interface FigureRange { countCases: number; min: number; median: number; max: number; unit: string; }
export interface EconomicFigures {
  totalCases: number;
  casesWithFigures: number;
  byKind: Partial<Record<FigureKind, FigureRange>>;
}
```

Then add two optional fields to the `LegalCase` interface, immediately after the `summaryMeta?: SummaryMeta;` line:

```ts
  extractedFigures?: ExtractedFigure[];
  figuresMeta?: FiguresMeta;
```

(Do NOT change `ActivationSummary` in this task — that happens in Task 4.)

- [ ] **Step 2: Run the round-trip test to verify it FAILS to compile**

Run: `npx tsc --noEmit`
Expected: FAIL — `scripts/test-cases-table.ts` `kitchenSink: Required<LegalCase>` is missing `extractedFigures` and `figuresMeta`.

- [ ] **Step 3: Map the fields in `itemToCase`**

In `src/lib/dynamo/cases-table.ts`, inside `itemToCase`, add immediately after the `summaryMeta` mapping line (`...(d.summaryMeta !== undefined ? { summaryMeta: d.summaryMeta } : {}),`):

```ts
    ...(d.extractedFigures !== undefined ? {
      extractedFigures: d.extractedFigures.map((fig: any) => ({
        raw: fig.raw, amount: fig.amount, currency: fig.currency,
        ...(fig.unit !== undefined ? { unit: fig.unit } : {}),
        kind: fig.kind, role: fig.role, quote: fig.quote,
        sourceParagraph: fig.sourceParagraph, sourceUrl: fig.sourceUrl,
      })),
    } : {}),
    ...(d.figuresMeta !== undefined ? { figuresMeta: d.figuresMeta } : {}),
```

- [ ] **Step 4: Extend the kitchen-sink fixture**

In `scripts/test-cases-table.ts`, inside the `kitchenSink: Required<LegalCase>` object, add after the `summaryMeta: { … },` line:

```ts
  extractedFigures: [
    { raw: "$1,000,000", amount: 1_000_000, currency: "CAD", kind: "settlement", role: "awarded",
      quote: "ordered to pay $1,000,000 in damages", sourceParagraph: "para-2", sourceUrl: "https://example.org/kitchen-sink" },
    { raw: "51%", amount: 51, currency: "CAD", unit: "percent", kind: "equity", role: "ordered",
      quote: "a 51% equity stake in the project", sourceParagraph: "para-2", sourceUrl: "https://example.org/kitchen-sink" },
  ],
  figuresMeta: { method: "llm", model: "us.meta.llama3-3-70b-instruct-v1:0", generatedAt: "2026-07-07T00:00:00.000Z", dropped: 1 },
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx tsx scripts/test-cases-table.ts && npx tsc --noEmit`
Expected: `✅ cases-table tests passed`; tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/types.ts src/lib/dynamo/cases-table.ts scripts/test-cases-table.ts
git commit -m "feat(cases): ExtractedFigure/FiguresMeta types + round-trip mapping"
```

---

### Task 2: Figure extraction + verification (`ingest/figures.ts`)

**Files:**
- Create: `src/lib/cases/ingest/figures.ts`
- Test: `scripts/test-cases-figures.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-figures.ts`:

```ts
// Recorded economic figures (spec 2026-07-07): parse + mechanical verify + extract.
// Wrapped in an async IIFE: this repo is NOT ESM, so top-level await is illegal.
import assert from "node:assert/strict";
import { parseAmount, verifyFigures, extractFigures, type RawFigure } from "../src/lib/cases/ingest/figures";
import type { CaseChunk, LegalCase } from "../src/lib/cases/types";
import type { LlmModel } from "../src/lib/cases/ingest/llm";

(async () => {
// --- parseAmount ---
assert.deepEqual(parseAmount("$1,234,567"), { amount: 1234567 });
assert.deepEqual(parseAmount("$30 million"), { amount: 30_000_000 });
assert.deepEqual(parseAmount("CAD 5,000"), { amount: 5000 });
assert.deepEqual(parseAmount("51%"), { amount: 51, unit: "percent" });
assert.equal(parseAmount("the 1990s"), null, "bare number without currency marker → null");
assert.equal(parseAmount("section 35"), null, "no currency, no percent → null");

// --- verifyFigures ---
const chunks: CaseChunk[] = [
  { paragraph: "para-1", text: "The background of the dispute is set out here." },
  { paragraph: "para-2", text: "The Crown was ordered to pay $30 million in equitable compensation." },
  { paragraph: "para-3", text: "The band also received a 51% equity stake in the venture." },
];
const raws: RawFigure[] = [
  { raw: "$30 million", quote: "ordered to pay $30 million in equitable compensation", paragraph: "para-2", kind: "compensation", role: "awarded" },
  { raw: "51%", quote: "received a 51% equity stake", paragraph: "para-3", kind: "equity", role: "ordered" },
  { raw: "$999 billion", quote: "the sum of $999 billion was awarded", paragraph: "para-2", kind: "damages", role: "awarded" }, // fabricated — not in text
  { raw: "$30 million", quote: "totally different clause not present", paragraph: "para-2", kind: "compensation", role: "awarded" }, // quote not in text
];
const { figures, dropped } = verifyFigures(raws, chunks, "https://ex.org/x");
assert.equal(figures.length, 2, "only the two real, in-text figures survive");
assert.equal(dropped, 2, "fabricated + quote-not-in-text dropped");
assert.equal(figures[0].amount, 30_000_000);
assert.equal(figures[0].sourceParagraph, "para-2");
assert.equal(figures[1].unit, "percent");
assert.equal(figures[1].amount, 51);

// re-anchor: quote spanning an adjacent chunk pair verifies (anchor = first chunk)
const split: CaseChunk[] = [
  { paragraph: "para-1", text: "The Crown was ordered to pay" },
  { paragraph: "para-2", text: "$40,000 in costs to the applicant." },
];
const spanned = verifyFigures(
  [{ raw: "$40,000", quote: "ordered to pay $40,000 in costs", paragraph: "para-1", kind: "compensation", role: "ordered" }],
  split, "https://ex.org/y");
assert.equal(spanned.figures.length, 1, "quote spanning adjacent chunks verifies");
assert.equal(spanned.figures[0].sourceParagraph, "para-1");

// --- extractFigures (fake model) ---
const fakeModel: LlmModel = {
  id: "fake",
  call: async () => JSON.stringify({ figures: [
    { raw: "$30 million", quote: "ordered to pay $30 million in equitable compensation", paragraph: "para-2", kind: "compensation", role: "awarded" },
  ] }),
};
const baseCase = (over: Partial<LegalCase>): LegalCase => ({
  id: "c1", citation: "2020 SCC 1", styleOfCause: "Test", court: "SCC", level: "scc", year: 2020,
  jurisdiction: "CA", nations: [], themes: [],
  outcome: { outcomeType: "precedent", winType: "party_win", whoWon: "", holding: "compensation" },
  casesCited: [], casesCiting: [], citingCount: 0, enrichmentLevel: "index", corpusTier: "core",
  fullTextAvailable: true, chunks,
  provenance: { source: "a2aj", sourceUrl: "https://ex.org/x", upstreamLicense: "open", ingestedAt: "2026", unofficial: true },
  ...over,
});
const okRes = await extractFigures(baseCase({}), fakeModel);
assert.equal(okRes.status, "generated");
assert.equal(okRes.figures?.length, 1);
assert.equal((await extractFigures(baseCase({ corpusTier: "substrate" }), fakeModel)).status, "skipped_not_core");
assert.equal((await extractFigures(baseCase({ chunks: [] }), fakeModel)).status, "skipped_no_fulltext");

console.log("✅ test-cases-figures passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `npx tsx scripts/test-cases-figures.ts`
Expected: FAIL — cannot resolve `../src/lib/cases/ingest/figures`.

- [ ] **Step 3: Create `src/lib/cases/ingest/figures.ts`**

```ts
// Recorded economic figures (spec 2026-07-07). Same discipline as summarizer.ts:
// the model proposes figures with a verbatim quote + anchor; a mechanical verifier
// keeps a figure only if its amount parses deterministically AND its quote appears
// verbatim (whitespace/typography-normalized, re-anchored) in the judgment text.
// The model can never introduce a number that isn't in the judgment.
import type { CaseChunk, ExtractedFigure, FigureKind, FigureRole, FiguresMeta, LegalCase } from "../types";
import type { LlmModel } from "./llm";
import { assembleInput, normWs } from "./summarizer";

export interface RawFigure { raw: string; quote: string; paragraph: string; kind: string; role: string }
export type ExtractStatus = "generated" | "skipped_not_core" | "skipped_no_fulltext" | "failed";
export interface ExtractResult { status: ExtractStatus; figures?: ExtractedFigure[]; meta?: FiguresMeta; dropped: number }

const KINDS: FigureKind[] = ["settlement", "compensation", "damages", "resource_revenue", "equity", "other"];
const ROLES: FigureRole[] = ["awarded", "ordered", "claimed", "valuation", "contextual"];
const MAX_FIGURES = 12;

// Deterministic amount parser. Percent (equity) → { amount, unit:"percent" }.
// Monetary REQUIRES an explicit currency marker so bare numbers (years, section
// numbers, counts) are never treated as money. Unparseable → null (dropped).
export function parseAmount(raw: string): { amount: number; unit?: "percent" } | null {
  const s = raw.trim();
  const pct = s.match(/(\d[\d,]*(?:\.\d+)?)\s*%/);
  if (pct) { const n = Number(pct[1].replace(/,/g, "")); return Number.isFinite(n) ? { amount: n, unit: "percent" } : null; }
  if (!/\$|\bCAD\b|\bUSD\b|C\$|dollar/i.test(s)) return null;
  const m = s.match(/(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|m|k)?/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const scale = (m[2] ?? "").toLowerCase();
  if (scale === "billion" || scale === "bn") n *= 1e9;
  else if (scale === "million" || scale === "m") n *= 1e6;
  else if (scale === "thousand" || scale === "k") n *= 1e3;
  return { amount: n };
}

// Parse the model's response: first "{" to last "}", strict shape check.
export function parseFigures(raw: string): RawFigure[] | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const arr = (JSON.parse(raw.slice(start, end + 1)) as { figures?: unknown })?.figures;
    if (!Array.isArray(arr)) return null;
    return arr.map((f) => {
      const r = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      return { raw: String(r.raw ?? ""), quote: String(r.quote ?? ""), paragraph: String(r.paragraph ?? ""),
        kind: String(r.kind ?? ""), role: String(r.role ?? "") };
    });
  } catch { return null; }
}

// Mechanical verification, mirroring summarizer.verifyClaims re-anchoring: the quote
// must appear verbatim (normWs) in the cited chunk, else any chunk, else an adjacent
// chunk pair (anchor = first of the pair). Amount must parse; quote must contain raw.
export function verifyFigures(
  raws: RawFigure[], chunks: CaseChunk[], sourceUrl: string,
): { figures: ExtractedFigure[]; dropped: number } {
  const norm = chunks.map((ch) => ({ para: String(ch.paragraph), text: normWs(ch.text) }));
  const locate = (quote: string, cited: string): string | null => {
    const c = norm.find((n) => n.para === cited || n.para === `para-${cited}`);
    if (c && c.text.includes(quote)) return c.para;
    const h = norm.find((n) => n.text.includes(quote));
    if (h) return h.para;
    for (let i = 0; i + 1 < norm.length; i++)
      if ((norm[i].text + " " + norm[i + 1].text).includes(quote)) return norm[i].para;
    return null;
  };
  const figures: ExtractedFigure[] = [];
  for (const rf of raws) {
    if (figures.length >= MAX_FIGURES) break;
    const parsed = parseAmount(rf.raw);
    if (!parsed) continue;
    const quote = normWs(rf.quote ?? "");
    if (!quote.includes(normWs(rf.raw))) continue;   // quote must actually contain the figure
    const para = locate(quote, String(rf.paragraph ?? ""));
    if (para === null) continue;                     // quote not found in judgment → drop
    const kind = (KINDS as string[]).includes(rf.kind) ? (rf.kind as FigureKind) : "other";
    const role = (ROLES as string[]).includes(rf.role) ? (rf.role as FigureRole) : "contextual";
    figures.push({
      raw: rf.raw, amount: parsed.amount,
      currency: /USD|US\$/i.test(rf.raw) ? "USD" : "CAD",
      ...(parsed.unit ? { unit: parsed.unit } : {}),
      kind, role, quote: rf.quote, sourceParagraph: para, sourceUrl,
    });
  }
  return { figures, dropped: raws.length - figures.length };
}

export function buildFigurePrompt(c: LegalCase, body: string): string {
  return `You extract monetary figures from a Canadian court decision. List EVERY monetary figure that literally appears in the text — settlement/compensation/damages amounts, resource revenue or royalties, and equity percentages.

Case: ${c.styleOfCause}, ${c.citation} (${c.court}, ${c.year})

Produce STRICTLY this JSON (no markdown, no commentary):
{"figures":[{"raw":"...","quote":"...","paragraph":"...","kind":"...","role":"..."}]}

Rules:
- "raw": the figure EXACTLY as written, copied character-for-character (e.g. "$30 million", "51%").
- "quote": a VERBATIM excerpt from one paragraph below that CONTAINS "raw".
- "paragraph": the id from that paragraph's [para <id>] tag.
- "kind": one of settlement | compensation | damages | resource_revenue | equity | other.
- "role": one of awarded | ordered (the court granted it) | claimed (a party sought it) | valuation (an appraisal) | contextual (merely mentioned).
- Do NOT infer, convert, sum, adjust, or invent any number. Copy only figures present in the text. If none, return {"figures":[]}.

JUDGMENT TEXT:
${body}`;
}

export const FIGURE_RETRY_SUFFIX = "\n\nYour previous output was not valid JSON. Output ONLY the JSON object.";

export async function extractFigures(c: LegalCase, model: LlmModel): Promise<ExtractResult> {
  if (c.corpusTier !== "core") return { status: "skipped_not_core", dropped: 0 };
  if (!c.chunks || c.chunks.length === 0) return { status: "skipped_no_fulltext", dropped: 0 };
  const prompt = buildFigurePrompt(c, assembleInput(c.chunks, c.outcome.holding));
  let raws = parseFigures(await model.call(prompt));
  if (!raws) raws = parseFigures(await model.call(prompt + FIGURE_RETRY_SUFFIX));
  if (!raws) return { status: "failed", dropped: 0 };
  const { figures, dropped } = verifyFigures(raws, c.chunks, c.provenance.sourceUrl);
  return {
    status: "generated", figures,
    meta: { method: "llm", model: model.id, generatedAt: new Date().toISOString(), dropped },
    dropped,
  };
}
```

- [ ] **Step 4: Run it, verify it PASSES**

Run: `npx tsx scripts/test-cases-figures.ts && npx tsc --noEmit`
Expected: `✅ test-cases-figures passed`; tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/ingest/figures.ts scripts/test-cases-figures.ts
git commit -m "feat(cases): citation-anchored figure extraction + mechanical verification"
```

---

### Task 3: Batch runner + npm scripts

**Files:**
- Create: `scripts/cases-extract-figures.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the batch runner**

Create `scripts/cases-extract-figures.ts` (mirrors `cases-summarize.ts`):

```ts
// Batch figure extraction over core cases (spec 2026-07-07). Idempotent: responses
// are disk-cached (scripts/.cache/llm), so re-runs and the cloud replay are free.
// Writes extractedFigures + figuresMeta onto the PROFILE item ONLY — never rewrites
// CHUNK items (that would wipe embedded vectors; the promote lesson).
import "./fetch-polyfill";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseKeys } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { cachedModel, modelFromId } from "../src/lib/cases/ingest/llm";
import { extractFigures } from "../src/lib/cases/ingest/figures";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
const MODEL_ID = process.env.FIGURES_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";
const FORCE = process.env.FIGURES_FORCE === "1";

async function main() {
  const model = cachedModel(modelFromId(MODEL_ID, { maxTokens: 1024 }));
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  console.log(`extracting figures from ${profiles.length} core cases with ${MODEL_ID}${FORCE ? " (FORCE)" : ""}`);

  const stats = { generated: 0, skipped_already: 0, skipped_no_fulltext: 0, skipped_not_core: 0, failed: 0 };
  let casesWithFigures = 0, kept = 0, dropped = 0, done = 0;

  for (const p of profiles) {
    if (p.figuresMeta?.method === "llm" && !FORCE) { stats.skipped_already++; continue; }
    const c = await dynamoCaseRepo.getCase(p.id);
    if (!c) continue;
    const r = await extractFigures(c, model);
    if (r.status === "generated" && r.figures && r.meta) {
      await ddbDoc.send(new UpdateCommand({
        TableName: TABLE,
        Key: caseKeys.profile(c.id),
        UpdateExpression: "SET #d.#f = :f, #d.#m = :m",
        ExpressionAttributeNames: { "#d": "data", "#f": "extractedFigures", "#m": "figuresMeta" },
        ExpressionAttributeValues: { ":f": r.figures, ":m": r.meta },
      }));
      stats.generated++; kept += r.figures.length; dropped += r.dropped;
      if (r.figures.length > 0) casesWithFigures++;
    } else if (r.status === "failed") stats.failed++;
    else if (r.status === "skipped_no_fulltext") stats.skipped_no_fulltext++;
    else if (r.status === "skipped_not_core") stats.skipped_not_core++;
    if (++done % 25 === 0) console.log(`… ${done}/${profiles.length} · generated ${stats.generated} · cases-with-figures ${casesWithFigures}`);
  }

  console.log(`✅ extract-figures: generated ${stats.generated} · already ${stats.skipped_already} · no-fulltext ${stats.skipped_no_fulltext} · failed ${stats.failed}`);
  console.log(`   cases with ≥1 figure ${casesWithFigures} · figures kept ${kept} · dropped ${dropped}`);
}
main().catch((e) => { console.error("❌ cases-extract-figures failed:", e); process.exit(1); });
```

- [ ] **Step 2: Add npm scripts**

In `package.json`, add after the `"cases:summarize:cloud"` line:

```json
    "cases:extract-figures": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-extract-figures.ts",
    "cases:extract-figures:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-extract-figures.ts",
```

- [ ] **Step 3: Verify types + JSON validity**

Run: `npx tsc --noEmit && node -e "require('./package.json')"`
Expected: tsc exit 0; node prints nothing (valid JSON).

- [ ] **Step 4: Commit**

```bash
git add scripts/cases-extract-figures.ts package.json
git commit -m "feat(cases): batch figure-extraction runner + npm scripts"
```

---

### Task 4: Honest aggregation (`buildActivation` + type swap + consumers)

**Files:**
- Modify: `src/lib/cases/types.ts` (`ActivationSummary`)
- Modify: `src/lib/cases/query.ts` (`buildActivation`)
- Modify: `src/app/cases/activation/page.tsx`
- Test: `scripts/test-cases-query.ts` (extend)

- [ ] **Step 1: Write the failing test**

In `scripts/test-cases-query.ts`, add immediately after the existing activation block (after `assert.ok(a.landmarkCases.length > 0, "has landmark cases");`):

```ts
// economicFigures: per-kind ranges from awarded/ordered figures, one amount per case, no sums
const ef = buildActivation([
  { ...caseFixtures[0], id: "f1", extractedFigures: [
    { raw: "$10", amount: 10, currency: "CAD", kind: "settlement", role: "awarded", quote: "$10", sourceParagraph: "para-1", sourceUrl: "u" },
    { raw: "$40", amount: 40, currency: "CAD", kind: "settlement", role: "awarded", quote: "$40", sourceParagraph: "para-1", sourceUrl: "u" },
    { raw: "$999", amount: 999, currency: "CAD", kind: "settlement", role: "claimed", quote: "$999", sourceParagraph: "para-1", sourceUrl: "u" },
  ] },
  { ...caseFixtures[1], id: "f2", extractedFigures: [
    { raw: "$20", amount: 20, currency: "CAD", kind: "settlement", role: "ordered", quote: "$20", sourceParagraph: "para-1", sourceUrl: "u" },
  ] },
]).economicFigures;
assert.equal(ef.totalCases, 2, "denominator = cases passed");
assert.equal(ef.casesWithFigures, 2, "both cases have an awarded/ordered figure");
assert.equal(ef.byKind.settlement?.countCases, 2, "one amount per case");
assert.equal(ef.byKind.settlement?.max, 40, "case f1 keeps its largest awarded (40, not the claimed 999)");
assert.equal(ef.byKind.settlement?.min, 20);
assert.equal(ef.byKind.settlement?.median, 30, "median of [20,40]");
assert.equal(ef.byKind.settlement?.unit, "CAD");
assert.equal((ef as any).settlement, undefined, "no flat cross-case total field");
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `npx tsx scripts/test-cases-query.ts`
Expected: FAIL — `a`/`ef` has no `economicFigures` (still `economicValue`), or a compile error.

- [ ] **Step 3: Swap the `ActivationSummary` field**

In `src/lib/cases/types.ts`, in the `ActivationSummary` interface, replace the line
`economicValue: { settlement: number; resourceRevenue: number; equity: number };`
with:

```ts
  economicFigures: EconomicFigures;
```

- [ ] **Step 4: Rewrite the economic aggregation in `buildActivation`**

In `src/lib/cases/query.ts`, replace the three `economicValue` lines and its object usage. Replace the `const economicValue = { settlement: 0, resourceRevenue: 0, equity: 0 };` declaration and the three `economicValue.* += …` lines inside the loop, and the `economicValue,` in the return, as follows.

Add this import at the top if not present (extend the existing `types` import):

```ts
import type { FigureKind, EconomicFigures, FigureRange } from "./types";
```

Replace the declaration `const economicValue = { settlement: 0, resourceRevenue: 0, equity: 0 };` with:

```ts
  // One amount per case per kind (largest court-awarded/ordered figure, or curated
  // amount). Ranges only — never a cross-case or cross-kind sum (spec §3, Gallagher).
  const perKind = new Map<FigureKind, Map<string, number>>();
  const kindUnit = new Map<FigureKind, string>();
  const addAmount = (kind: FigureKind, caseId: string, amount: number, unit: string) => {
    let m = perKind.get(kind); if (!m) { m = new Map(); perKind.set(kind, m); }
    const cur = m.get(caseId);
    if (cur === undefined || amount > cur) m.set(caseId, amount);
    kindUnit.set(kind, unit);
  };
```

Replace the three `economicValue.* += …` lines (inside the `for (const c of cases)` loop) with:

```ts
    for (const fig of c.extractedFigures ?? []) {
      if (fig.role !== "awarded" && fig.role !== "ordered") continue;
      addAmount(fig.kind, c.id, fig.amount, fig.unit === "percent" ? "%" : fig.currency);
    }
    if (c.economic?.settlementAmount != null) addAmount("settlement", c.id, c.economic.settlementAmount, "CAD");
    if (c.economic?.resourceRevenue != null) addAmount("resource_revenue", c.id, c.economic.resourceRevenue, "CAD");
    if (c.economic?.equityStake != null) addAmount("equity", c.id, c.economic.equityStake, "%");
```

Before the `return`, build `economicFigures`:

```ts
  const byKind: Partial<Record<FigureKind, FigureRange>> = {};
  const casesWith = new Set<string>();
  for (const [kind, m] of perKind) {
    const amounts = [...m.values()].sort((a, b) => a - b);
    for (const id of m.keys()) casesWith.add(id);
    const mid = Math.floor(amounts.length / 2);
    const median = amounts.length % 2 ? amounts[mid] : (amounts[mid - 1] + amounts[mid]) / 2;
    byKind[kind] = { countCases: m.size, min: amounts[0], max: amounts[amounts.length - 1], median, unit: kindUnit.get(kind) ?? "CAD" };
  }
  const economicFigures: EconomicFigures = { totalCases: cases.length, casesWithFigures: casesWith.size, byKind };
```

In the returned object, replace `economicValue,` with `economicFigures,`.

- [ ] **Step 5: Update the activation page**

In `src/app/cases/activation/page.tsx`, replace `const ev = s.economicValue;` with `const ef = s.economicFigures;`, and replace the entire "Economic value" `<section>` (the one with the three `StatCard`s for settlements/resource revenue/equity) with:

```tsx
      <section className="mt-6">
        <h2 className="font-serif text-lg">Recorded economic figures <span className="text-xs font-sans font-normal text-ink3">(as recorded in the judgments)</span></h2>
        <p className="mt-1 text-sm text-ink3">Figures recorded in {ef.casesWithFigures} of {ef.totalCases} core cases.</p>
        <div className="mt-2 space-y-1 text-sm">
          {Object.entries(ef.byKind).map(([kind, r]) => (
            <div key={kind} className="flex justify-between rounded border border-line bg-panel px-3 py-2">
              <span className="capitalize">{kind.replace(/_/g, " ")} <span className="text-ink3">· {r.countCases} case{r.countCases === 1 ? "" : "s"}</span></span>
              <span className="text-ink2">
                {r.unit === "%" ? `${r.min}–${r.max}% (median ${r.median}%)` : `${cad(r.min)}–${cad(r.max)} (median ${cad(r.median)})`}
              </span>
            </div>
          ))}
          {Object.keys(ef.byKind).length === 0 && <p className="text-ink3">No court-awarded figures recorded yet.</p>}
        </div>
        <p className="mt-2 text-xs text-ink3">The courts&rsquo; own numbers, extracted and citation-anchored — not estimates, projections, or a corpus total; nominal amounts across different years, not inflation-adjusted.</p>
      </section>
```

- [ ] **Step 6: Run tests + typecheck + build**

Run: `npx tsx scripts/test-cases-query.ts && npx tsc --noEmit`
Expected: test passes (no crash, all asserts hold); tsc exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cases/types.ts src/lib/cases/query.ts src/app/cases/activation/page.tsx scripts/test-cases-query.ts
git commit -m "feat(cases): honest economic-figures aggregation (coverage + per-kind ranges, no totals)"
```

---

### Task 5: Case-page figures block

**Files:**
- Modify: `src/app/cases/[id]/page.tsx`

- [ ] **Step 1: Add the figures block**

In `src/app/cases/[id]/page.tsx`, immediately AFTER the `{c.summary && ( … )}` section block closes (the `)}` that ends the Summary section) and before the next section, insert:

```tsx
      {c.extractedFigures && c.extractedFigures.length > 0 && (
        <section className="mt-4">
          <h2 className="font-serif text-lg">
            Recorded economic figures <span className="text-xs font-sans font-normal text-ink3">(citation-anchored)</span>
            {c.figuresMeta?.method === "llm" && (
              <span className="ml-2 rounded bg-amber/15 px-2 py-0.5 text-xs font-sans font-normal text-amber">AI-extracted · verify against source</span>
            )}
          </h2>
          <ul className="mt-1 space-y-2 text-sm text-ink2">
            {c.extractedFigures.map((f, i) => (
              <li key={i} className="rounded border border-line bg-panel px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-serif">{f.raw}</span>
                  <span className="rounded border border-line bg-ink/5 px-2 py-0.5 text-xs">{f.kind.replace(/_/g, " ")} · {f.role}</span>
                </div>
                <p className="mt-1 text-xs text-ink3">&ldquo;{f.quote}&rdquo; <span className="text-ink3">({f.sourceParagraph})</span></p>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink3">Figures as recorded in the judgment — the court&rsquo;s own numbers, not estimates. Verify against the source text.</p>
        </section>
      )}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc exit 0; `next build` completes (compiles, generates static pages, exit 0).

- [ ] **Step 3: Commit**

```bash
git add src/app/cases/[id]/page.tsx
git commit -m "feat(cases): case-page recorded-figures block with anchors + AI-extracted badge"
```

---

### Task 6: Methodology note + final offline gate

**Files:**
- Modify: `docs/research/2026-06-28-legal-corpus-construction-methodology.md`

- [ ] **Step 1: Append the methodology note**

APPEND to the END of `docs/research/2026-06-28-legal-corpus-construction-methodology.md` (leading blank line):

```markdown

## Recorded economic figures (2026-07-07) — extracted, citation-anchored, non-authoritative

Client idea #3 ("economic impact estimator") is implemented as **recorded economic
figures**, deliberately NOT an estimate or projection. An LLM extracts monetary
figures from core judgments; a mechanical verifier keeps a figure only if its
amount parses deterministically AND its quote appears verbatim in the judgment
text (re-anchored, same discipline as the AI summaries). Every displayed figure is
the court's own number, citation-anchored to a paragraph.

- **Storage:** a non-authoritative `extractedFigures[]` layer on each case,
  separate from the curated (Kay-authoritative) `economic` field.
- **Aggregation:** per-kind ranges (min/median/max) over court-`awarded`/`ordered`
  figures, one amount per case per kind, with a coverage denominator (`N / core`).
  **No cross-case or cross-kind totals** — a summed "economic value of Indigenous
  wins" would be the Gallagher credibility trap (non-representative, non-commensurable).
- **Caveats surfaced in the UI:** nominal amounts across different years (not
  inflation-adjusted); figures are AI-extracted and should be verified against the
  source; the curated `economic` field remains the authoritative record.
```

- [ ] **Step 2: Run the full offline gate**

Run: `npx tsx scripts/test-cases-figures.ts && npx tsx scripts/test-cases-table.ts && npx tsx scripts/test-cases-query.ts && npx tsc --noEmit && npm run build`
Expected: all three tests print their `✅` line; tsc exit 0; `next build` completes.

> Do NOT run `npm run verify` (it factory-resets the local corpus).

- [ ] **Step 3: Commit**

```bash
git add docs/research/2026-06-28-legal-corpus-construction-methodology.md
git commit -m "docs(cases): record economic-figures extraction methodology (non-authoritative, no totals)"
```

---

## Post-merge operational run (credentialed — NOT part of code tasks)

Against the cloud table with temporary SSO creds (`AWS_REGION=us-east-1 CASES_TABLE=LegalCases`), from the repo root:

1. `npm run cases:extract-figures:cloud` — extract over the 452 core cases (reports cases-with-figures / kept / dropped). **No search-artifact rebuild** (figures aren't indexed).
2. Fidelity spot-check: sample ~10 cases; confirm each displayed figure appears verbatim at its cited paragraph and the role label is correct.
3. Record in a Result section of the spec: `casesWithFigures / 452`, per-kind counts and ranges, figures kept vs dropped, and confirmation that no figure is fabricated and no cross-case total appears anywhere.
