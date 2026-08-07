# RAP Extraction Engine Comparison — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `scripts/engine-eval/` — a reproducible harness that runs three RAP extraction engines (BDA, Bedrock+Textract-LAYOUT, Bedrock+text-layer) over 8 real RAP PDFs and emits a scorecard + a capped human-adjudication worklist, to recommend the best engine for the client's unrestricted account.

**Architecture:** Upload the 8 local PDFs to S3 once (a manifest). One parameterized runner drives the existing `runExtraction({fileName, sourceS3Key})` seam three times (engine selected by env), writing `results/<doc>/<engine>.json`. A scoring phase computes gold precision/recall/F1 (Bank of Canada), cross-engine relative recall, grounding fidelity, operational metrics, and dual-LLM-judge verdicts (Nova Pro + Kimi K2.5) with a capped human worklist — emitting `docs/rap-engine-comparison.md`.

**Tech Stack:** TypeScript run via `tsx`; AWS SDK v3 (S3, Bedrock, Textract, BDA runtime); existing `src/lib/rap/*` extractors/loaders/validators; existing `src/lib/cases/ingest/llm.ts` Bedrock Converse client; new minimal OpenRouter client. No test runner — standalone `test-*.ts` scripts using the repo's `check()` pattern.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-06-rap-engine-comparison-design.md` — this plan implements it.
- **Path alias:** `@/*` → `./src/*` (works in `tsx` scripts). Import repo code via `@/lib/...`; import sibling harness files via relative `./`.
- **No test runner.** Unit tests are standalone `tsx` scripts using: `let fail = 0; function check(name, ok){ console.log(`${ok?"✅":"❌"} ${name}`); if(!ok) fail++; } … process.exit(fail?1:0);`
- **Corpus n=8** (all real, distinct RAPs; text-based): BankOfCanada (gold), BCLeg, Populous, HydroQuebec, OPG, RBC Pathways, Deloitte, ATB. Local PDFs live OUTSIDE the repo — read dir from `RAP_SAMPLES_DIR` (default `../../CS7980/Week 7/rap_samples` relative to repo root — an absolute path is safest).
- **Engines run under `AWS_PROFILE=isb`** (SSO; the org SCP allows Textract for human principals, not Lambda roles). BDA phase uses `BEDROCK_REGION=us-east-1`; the two Bedrock phases use `BEDROCK_REGION=ca-central-1`.
- **Judges must be non-Claude families:** Amazon **Nova Pro** (Bedrock Converse) and **Kimi K2.5** (OpenRouter). No engine judges itself.
- **Validity guardrails (bake in):** absolute counts, never agreement ratios; BDA page numbers are NEVER used as a reference (they are inferred); recall on non-gold docs is "relative to union" and every report line saying so must carry the shared-blind-spot caveat.
- **No third-party prose committed:** `scripts/engine-eval/results/` is git-ignored; only the aggregate `docs/rap-engine-comparison.md` (numbers, no source prose) is committed.
- **Reused signatures (verified against current code):**
  - `runExtraction(input:{fileName:string; sourceS3Key:string}): Promise<ExtractionResult>` — `@/lib/rap/pipeline`. Selects engine by `process.env.EXTRACTION_IMPL` (`bda`|`bedrock`|else mock); Bedrock loader by `process.env.DOC_LOADER` (`textract`|`textlayer`). Both read at call time.
  - Types — `@/lib/rap/types`: `Grounded<T>={value:T|null; quote:string|null; page:number|null; confidence:number; flagged:boolean}`; `ExtractedCommitment={pillarRaw,action,deliverable,timeline,owner,metric,commitmentType:Grounded<...>; pillarNormalized:Pillar|null}`; `ExtractedRap={…header Grounded fields…; commitments:ExtractedCommitment[]; …}`; `ExtractionResult={engine:"bda"|"claude"|"textract+claude"; schemaVersion:string; classification; extracted:ExtractedRap; validationIssues:ValidationIssue[]; verdicts:FieldVerdict[]}`.
  - `normalizeForQuoteMatch(s:string):string` and `quoteOccursIn(quote:string, sourceText:string):boolean` — `@/lib/rap/validate`.
  - `extractPagesFromPdf(bytes:Uint8Array):Promise<string[][]>` and `buildTextFromPages(pages:string[][]):string` — `@/lib/rap/doc-loader/textlayer`.
  - `modelFromId(id:string, opts?:{maxTokens?:number}):{id:string; call:(prompt:string)=>Promise<string>}` — `@/lib/cases/ingest/llm` (Bedrock Converse; use for Nova Pro).
  - Gold fixture: `scripts/fixtures/gold-commitments-bankofcanada.json` = `{page:number; action:string}[]`.

---

### Task 1: Scaffold — types, corpus manifest, gitignore

**Files:**
- Create: `scripts/engine-eval/types.ts`
- Create: `scripts/engine-eval/corpus.ts`
- Create: `scripts/engine-eval/test-corpus.ts`
- Modify: `.gitignore` (append `scripts/engine-eval/results/`)

**Interfaces:**
- Produces: `type EngineKey = "bda" | "textract" | "textlayer"`; `interface CorpusDoc { key: string; fileName: string; pages: number; isGold: boolean }`; `const CORPUS: CorpusDoc[]`; `interface RunResult { engine: EngineKey; docKey: string; fileName: string; sourceS3Key: string; timingMs: number; extracted: ExtractedRap | null; validationIssues: ValidationIssue[]; engineLabel: string; error: string | null }`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/engine-eval/test-corpus.ts
import { CORPUS } from "./corpus";
let fail = 0;
function check(name: string, ok: boolean) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; }

check("corpus has 8 docs", CORPUS.length === 8);
check("exactly one gold doc", CORPUS.filter((d) => d.isGold).length === 1);
check("gold doc is BankOfCanada", CORPUS.find((d) => d.isGold)?.key === "bankofcanada");
check("all keys unique", new Set(CORPUS.map((d) => d.key)).size === 8);
check("all fileNames end in .pdf", CORPUS.every((d) => d.fileName.endsWith(".pdf")));
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/engine-eval/test-corpus.ts`
Expected: FAIL — `Cannot find module './corpus'`.

- [ ] **Step 3: Write `types.ts`**

```ts
// scripts/engine-eval/types.ts
import type { ExtractedRap, ValidationIssue } from "@/lib/rap/types";

export type EngineKey = "bda" | "textract" | "textlayer";

export interface CorpusDoc {
  key: string;       // stable slug, e.g. "bankofcanada"
  fileName: string;  // exact PDF filename in RAP_SAMPLES_DIR
  pages: number;     // for cost/operational reporting
  isGold: boolean;   // has a human gold set
}

export interface RunResult {
  engine: EngineKey;
  docKey: string;
  fileName: string;
  sourceS3Key: string;
  timingMs: number;
  extracted: ExtractedRap | null;   // null on error
  validationIssues: ValidationIssue[];
  engineLabel: string;              // ExtractionResult.engine ("bda"|"claude"|"textract+claude")
  error: string | null;
}
```

- [ ] **Step 4: Write `corpus.ts`**

```ts
// scripts/engine-eval/corpus.ts
import type { CorpusDoc } from "./types";

// The 8 clean, distinct RAPs in RAP_SAMPLES_DIR (spec §3). Page counts from pdfinfo.
export const CORPUS: CorpusDoc[] = [
  { key: "bankofcanada", fileName: "BankOfCanada_RAP.pdf", pages: 17, isGold: true },
  { key: "bcleg", fileName: "BCLeg_RAP_2024_2028.pdf", pages: 12, isGold: false },
  { key: "populous", fileName: "Populous_Reflect_RAP_2024.pdf", pages: 12, isGold: false },
  { key: "hydroquebec", fileName: "HydroQuebec_Reconciliation_Strategy.pdf", pages: 13, isGold: false },
  { key: "opg", fileName: "OPG_Reconciliation_Action_Plan_2021.pdf", pages: 33, isGold: false },
  { key: "rbc", fileName: "RBC_Pathways_to_Economic_Prosperity_RAP.pdf", pages: 35, isGold: false },
  { key: "deloitte", fileName: "Deloitte_Expanding_Horizons_RAP.pdf", pages: 41, isGold: false },
  { key: "atb", fileName: "ATB_TRAP_2025.pdf", pages: 76, isGold: false },
];
```

- [ ] **Step 5: Append to `.gitignore`**

Add this line to `.gitignore`:

```
scripts/engine-eval/results/
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx scripts/engine-eval/test-corpus.ts`
Expected: PASS — all ✅, exit 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/engine-eval/types.ts scripts/engine-eval/corpus.ts scripts/engine-eval/test-corpus.ts .gitignore
git commit -m "feat(engine-eval): scaffold corpus manifest and result types"
```

---

### Task 2: Gold precision/recall/F1 scorer (pure)

**Files:**
- Create: `scripts/engine-eval/gold-score.ts`
- Create: `scripts/engine-eval/test-gold-score.ts`

**Interfaces:**
- Consumes: `normalizeForQuoteMatch` (`@/lib/rap/validate`); `ExtractedCommitment` (`@/lib/rap/types`).
- Produces: `interface GoldEntry { page: number; action: string }`; `interface GoldScore { precision: number; recall: number; f1: number; actionMatches: number; pageMatches: number; extractedCount: number; goldCount: number; misses: string[] }`; `function scoreAgainstGold(commitments: {action:{value:string|null}; page:number|null}[], gold: GoldEntry[]): GoldScore`.

Matching rule (reuse the existing gold script's rule so results are comparable): an extracted commitment matches a gold entry when `normalizeForQuoteMatch(extracted.action.value)` contains the first 40 chars of `normalizeForQuoteMatch(gold.action)`. Page match = the matched extracted commitment's `page === gold.page`. **Absolute counts** drive the numbers. Precision = matched extracted / extracted count; recall = matched gold / gold count; F1 = harmonic mean (0 when either is 0).

- [ ] **Step 1: Write the failing test**

```ts
// scripts/engine-eval/test-gold-score.ts
import { scoreAgainstGold } from "./gold-score";
let fail = 0;
function check(name: string, ok: boolean) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; }

const gold = [
  { page: 13, action: "Invest in the CBNII to share work and learn best practices" },
  { page: 15, action: "Develop a framework to support Indigenous participation" },
];
// one exact-ish hit on the right page, one miss
const extracted = [
  { action: { value: "Invest in the CBNII to share work and learn best practices in economic Reconciliation" }, page: 13 },
  { action: { value: "Something entirely unrelated about catering" }, page: 4 },
];
const s = scoreAgainstGold(extracted, gold);
check("1 action match", s.actionMatches === 1);
check("1 page match", s.pageMatches === 1);
check("recall = 0.5", Math.abs(s.recall - 0.5) < 1e-9);
check("precision = 0.5", Math.abs(s.precision - 0.5) < 1e-9);
check("f1 = 0.5", Math.abs(s.f1 - 0.5) < 1e-9);
check("misses lists the framework gold", s.misses.some((m) => m.includes("framework")));

const empty = scoreAgainstGold([], gold);
check("empty extraction → recall 0, f1 0 (no crash)", empty.recall === 0 && empty.f1 === 0 && empty.precision === 0);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/engine-eval/test-gold-score.ts`
Expected: FAIL — `Cannot find module './gold-score'`.

- [ ] **Step 3: Write `gold-score.ts`**

```ts
// scripts/engine-eval/gold-score.ts
import { normalizeForQuoteMatch } from "@/lib/rap/validate";

export interface GoldEntry { page: number; action: string }
export interface GoldScore {
  precision: number; recall: number; f1: number;
  actionMatches: number; pageMatches: number;
  extractedCount: number; goldCount: number; misses: string[];
}

type ExtractedLike = { action: { value: string | null }; page: number | null };

export function scoreAgainstGold(commitments: ExtractedLike[], gold: GoldEntry[]): GoldScore {
  const usedExtracted = new Set<number>();
  let actionMatches = 0;
  let pageMatches = 0;
  const misses: string[] = [];

  for (const g of gold) {
    const goldNorm = normalizeForQuoteMatch(g.action);
    const needle = goldNorm.slice(0, 40);
    let matched = -1;
    for (let i = 0; i < commitments.length; i++) {
      if (usedExtracted.has(i)) continue;
      const v = commitments[i].action.value;
      if (v && normalizeForQuoteMatch(v).includes(needle)) { matched = i; break; }
    }
    if (matched === -1) { misses.push(g.action); continue; }
    usedExtracted.add(matched);
    actionMatches++;
    if (commitments[matched].page === g.page) pageMatches++;
  }

  const extractedCount = commitments.length;
  const goldCount = gold.length;
  const precision = extractedCount ? actionMatches / extractedCount : 0;
  const recall = goldCount ? actionMatches / goldCount : 0;
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, actionMatches, pageMatches, extractedCount, goldCount, misses };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/engine-eval/test-gold-score.ts`
Expected: PASS — all ✅.

- [ ] **Step 5: Commit**

```bash
git add scripts/engine-eval/gold-score.ts scripts/engine-eval/test-gold-score.ts
git commit -m "feat(engine-eval): gold precision/recall/F1 scorer"
```

---

### Task 3: Cross-engine agreement + relative recall (pure)

**Files:**
- Create: `scripts/engine-eval/util.ts`
- Create: `scripts/engine-eval/agreement.ts`
- Create: `scripts/engine-eval/test-agreement.ts`

**Interfaces:**
- Consumes: `normalizeForQuoteMatch` (`@/lib/rap/validate`).
- Produces (util.ts): `function tokenSet(s: string): Set<string>`; `function jaccard(a: Set<string>, b: Set<string>): number`.
- Produces (agreement.ts): `interface EngineCommitments { engine: string; actions: string[] }`; `interface AgreementReport { unionSize: number; perEngine: { engine: string; found: number; corroborated: number }[] }`; `function computeAgreement(engines: EngineCommitments[], simThreshold?: number): AgreementReport`. Two actions are "the same commitment" when Jaccard token overlap ≥ `simThreshold` (default 0.6). `unionSize` = count of distinct commitment clusters across all engines. `corroborated` (per engine) = how many of that engine's commitments appear in a cluster reached by ≥2 engines. All **absolute counts** (no ratios stored).

- [ ] **Step 1: Write the failing test**

```ts
// scripts/engine-eval/test-agreement.ts
import { tokenSet, jaccard } from "./util";
import { computeAgreement } from "./agreement";
let fail = 0;
function check(name: string, ok: boolean) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; }

check("jaccard identical = 1", jaccard(tokenSet("hire indigenous staff"), tokenSet("hire indigenous staff")) === 1);
check("jaccard disjoint = 0", jaccard(tokenSet("alpha beta"), tokenSet("gamma delta")) === 0);

const report = computeAgreement([
  { engine: "a", actions: ["Hire more Indigenous staff by 2025", "Build a new supplier program"] },
  { engine: "b", actions: ["hire more indigenous staff by 2025"] },  // matches a's first
  { engine: "c", actions: ["Totally different climate pledge"] },
]);
check("union has 3 clusters", report.unionSize === 3);
const a = report.perEngine.find((e) => e.engine === "a")!;
check("engine a found 2", a.found === 2);
check("engine a corroborated 1 (staff cluster, ≥2 engines)", a.corroborated === 1);
const c = report.perEngine.find((e) => e.engine === "c")!;
check("engine c corroborated 0 (solo)", c.corroborated === 0);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/engine-eval/test-agreement.ts`
Expected: FAIL — `Cannot find module './util'`.

- [ ] **Step 3: Write `util.ts`**

```ts
// scripts/engine-eval/util.ts
import { normalizeForQuoteMatch } from "@/lib/rap/validate";

export function tokenSet(s: string): Set<string> {
  return new Set(normalizeForQuoteMatch(s).split(" ").filter((t) => t.length > 2));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
```

- [ ] **Step 4: Write `agreement.ts`**

```ts
// scripts/engine-eval/agreement.ts
import { tokenSet, jaccard } from "./util";

export interface EngineCommitments { engine: string; actions: string[] }
export interface AgreementReport {
  unionSize: number;
  perEngine: { engine: string; found: number; corroborated: number }[];
}

interface Cluster { engines: Set<string>; sig: Set<string>; members: { engine: string; idx: number }[] }

export function computeAgreement(engines: EngineCommitments[], simThreshold = 0.6): AgreementReport {
  const clusters: Cluster[] = [];
  for (const e of engines) {
    e.actions.forEach((action, idx) => {
      const sig = tokenSet(action);
      let hit = clusters.find((c) => jaccard(c.sig, sig) >= simThreshold);
      if (!hit) { hit = { engines: new Set(), sig, members: [] }; clusters.push(hit); }
      hit.engines.add(e.engine);
      hit.members.push({ engine: e.engine, idx });
    });
  }
  const perEngine = engines.map((e) => {
    const found = e.actions.length;
    const corroborated = clusters.filter((c) => c.engines.size >= 2 && c.engines.has(e.engine)).length;
    return { engine: e.engine, found, corroborated };
  });
  return { unionSize: clusters.length, perEngine };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/engine-eval/test-agreement.ts`
Expected: PASS — all ✅.

- [ ] **Step 6: Commit**

```bash
git add scripts/engine-eval/util.ts scripts/engine-eval/agreement.ts scripts/engine-eval/test-agreement.ts
git commit -m "feat(engine-eval): cross-engine agreement + relative recall"
```

---

### Task 4: Grounding fidelity (pure) + local doc-text loader

**Files:**
- Modify: `scripts/engine-eval/util.ts` (add `loadLocalDocText`, `pageText`)
- Create: `scripts/engine-eval/grounding.ts`
- Create: `scripts/engine-eval/test-grounding.ts`

**Interfaces:**
- Consumes: `quoteOccursIn` (`@/lib/rap/validate`); `extractPagesFromPdf`, `buildTextFromPages` (`@/lib/rap/doc-loader/textlayer`).
- Produces (util.ts additions): `async function loadLocalDocText(pdfPath: string): Promise<{ pages: string[][]; text: string }>`; `function pageText(pages: string[][], page: number | null): string` (returns that 1-indexed page's joined paragraphs, or "" if out of range/null).
- Produces (grounding.ts): `interface GroundingInput { quote: string | null; page: number | null }`; `interface GroundingScore { total: number; quotePresent: number; pagePresent: number }`; `function scoreGrounding(fields: GroundingInput[], pages: string[][]): GroundingScore`. A field's quote is "present" if `quoteOccursIn(quote, fullText)`; its page is "present" if the quote occurs within `pageText(pages, page)`. **BDA callers pass this too, but the score.ts caller marks BDA's page column as N/A (inferred) — grounding.ts stays engine-agnostic; the guardrail lives at the report layer.**

- [ ] **Step 1: Write the failing test**

```ts
// scripts/engine-eval/test-grounding.ts
import { scoreGrounding } from "./grounding";
import { pageText } from "./util";
let fail = 0;
function check(name: string, ok: boolean) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; }

const pages = [
  ["We will hire Indigenous staff.", "First page filler."],   // page 1
  ["We commit to spend $5M with Indigenous suppliers."],       // page 2
];
check("pageText page 2", pageText(pages, 2).includes("$5M"));
check("pageText out-of-range → empty", pageText(pages, 9) === "");

const score = scoreGrounding([
  { quote: "We will hire Indigenous staff.", page: 1 },     // present, right page
  { quote: "We commit to spend $5M with Indigenous suppliers.", page: 1 }, // present text, WRONG page
  { quote: "This sentence appears nowhere in the doc.", page: 1 },          // absent
], pages);
check("3 fields total", score.total === 3);
check("2 quotes present", score.quotePresent === 2);
check("1 page-correct", score.pagePresent === 1);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/engine-eval/test-grounding.ts`
Expected: FAIL — `Cannot find module './grounding'`.

- [ ] **Step 3: Add `loadLocalDocText` + `pageText` to `util.ts`**

```ts
// append to scripts/engine-eval/util.ts
import { readFile } from "node:fs/promises";
import { extractPagesFromPdf, buildTextFromPages } from "@/lib/rap/doc-loader/textlayer";

export async function loadLocalDocText(pdfPath: string): Promise<{ pages: string[][]; text: string }> {
  const bytes = new Uint8Array(await readFile(pdfPath));
  const pages = await extractPagesFromPdf(bytes);
  return { pages, text: buildTextFromPages(pages) };
}

export function pageText(pages: string[][], page: number | null): string {
  if (page == null || page < 1 || page > pages.length) return "";
  return pages[page - 1].join("\n");
}
```

- [ ] **Step 4: Write `grounding.ts`**

```ts
// scripts/engine-eval/grounding.ts
import { quoteOccursIn } from "@/lib/rap/validate";
import { buildTextFromPages } from "@/lib/rap/doc-loader/textlayer";
import { pageText } from "./util";

export interface GroundingInput { quote: string | null; page: number | null }
export interface GroundingScore { total: number; quotePresent: number; pagePresent: number }

export function scoreGrounding(fields: GroundingInput[], pages: string[][]): GroundingScore {
  const fullText = buildTextFromPages(pages);
  let quotePresent = 0;
  let pagePresent = 0;
  for (const f of fields) {
    if (!f.quote) continue;
    if (quoteOccursIn(f.quote, fullText)) {
      quotePresent++;
      if (quoteOccursIn(f.quote, pageText(pages, f.page))) pagePresent++;
    }
  }
  return { total: fields.length, quotePresent, pagePresent };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/engine-eval/test-grounding.ts`
Expected: PASS — all ✅.

- [ ] **Step 6: Commit**

```bash
git add scripts/engine-eval/util.ts scripts/engine-eval/grounding.ts scripts/engine-eval/test-grounding.ts
git commit -m "feat(engine-eval): grounding fidelity + local doc-text loader"
```

---

### Task 5: OpenRouter client for Kimi K2.5

**Files:**
- Create: `scripts/engine-eval/openrouter.ts`
- Create: `scripts/engine-eval/test-openrouter.ts`

**Interfaces:**
- Produces: `interface JudgeModel { id: string; call: (prompt: string) => Promise<string> }`; `function openRouterModel(id: string, opts?: { maxTokens?: number }): JudgeModel`. Reads `process.env.OPENROUTER_API_KEY`. If the key is absent AND `process.env.EVAL_STUB_LLM === "1"`, `call` returns the fixed string `"STUB"` (offline test path, mirroring the `stub:` convention in `cases/ingest/llm.ts`). Model id for Kimi: `"moonshotai/kimi-k2.5"` (the caller supplies it; verify the exact slug on OpenRouter at run time).

- [ ] **Step 1: Write the failing test (offline stub path)**

```ts
// scripts/engine-eval/test-openrouter.ts
import { openRouterModel } from "./openrouter";
let fail = 0;
function check(name: string, ok: boolean) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; }

process.env.EVAL_STUB_LLM = "1";
delete process.env.OPENROUTER_API_KEY;

(async () => {
  const m = openRouterModel("moonshotai/kimi-k2.5");
  check("id set", m.id === "moonshotai/kimi-k2.5");
  const out = await m.call("anything");
  check("stub returns STUB offline", out === "STUB");
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/engine-eval/test-openrouter.ts`
Expected: FAIL — `Cannot find module './openrouter'`.

- [ ] **Step 3: Write `openrouter.ts`**

```ts
// scripts/engine-eval/openrouter.ts
export interface JudgeModel { id: string; call: (prompt: string) => Promise<string> }

export function openRouterModel(id: string, opts?: { maxTokens?: number }): JudgeModel {
  const maxTokens = opts?.maxTokens ?? 512;
  return {
    id,
    async call(prompt: string): Promise<string> {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) {
        if (process.env.EVAL_STUB_LLM === "1") return "STUB";
        throw new Error("OPENROUTER_API_KEY not set (or set EVAL_STUB_LLM=1 for offline runs)");
      }
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: id,
          temperature: 0,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return json.choices?.[0]?.message?.content ?? "";
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/engine-eval/test-openrouter.ts`
Expected: PASS — all ✅.

- [ ] **Step 5: Commit**

```bash
git add scripts/engine-eval/openrouter.ts scripts/engine-eval/test-openrouter.ts
git commit -m "feat(engine-eval): minimal OpenRouter client for Kimi judge"
```

---

### Task 6: Dual-judge scoring, κ, and worklist (pure core + injectable models)

**Files:**
- Create: `scripts/engine-eval/judge.ts`
- Create: `scripts/engine-eval/test-judge.ts`

**Interfaces:**
- Consumes: `JudgeModel` (`./openrouter`); `modelFromId` (`@/lib/cases/ingest/llm`) is wired in Task 8, not here.
- Produces:
  - `interface JudgeVerdict { real: boolean }`
  - `function parseVerdict(raw: string): JudgeVerdict` — expects the model to answer with a JSON object `{"real": true|false}`; tolerant: searches for `"real"` truthiness, defaults `real:false` if unparseable (conservative).
  - `interface Finding { docKey: string; engine: string; action: string; quote: string | null; page: number | null }`
  - `interface JudgedFinding extends Finding { verdictA: boolean; verdictB: boolean; agree: boolean }`
  - `async function judgeFindings(findings: Finding[], judgeA: JudgeModel, judgeB: JudgeModel, pageTextFor: (f: Finding) => string): Promise<JudgedFinding[]>` — builds the prompt, calls both judges per finding, parses verdicts.
  - `function cohenKappa(a: boolean[], b: boolean[]): number` — inter-judge agreement beyond chance.
  - `function buildWorklist(judged: JudgedFinding[], cap: number): JudgedFinding[]` — the disagreements (`!agree`), capped at `cap` (spec: ~25).
  - `function judgePrompt(f: Finding, sourceWindow: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/engine-eval/test-judge.ts
import { parseVerdict, cohenKappa, buildWorklist, judgeFindings } from "./judge";
import type { JudgeModel } from "./openrouter";
let fail = 0;
function check(name: string, ok: boolean) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; }

check("parse real true", parseVerdict('{"real": true}').real === true);
check("parse real false", parseVerdict('{"real": false}').real === false);
check("parse garbage → false", parseVerdict("who knows").real === false);

// perfect agreement → kappa 1
check("kappa perfect = 1", Math.abs(cohenKappa([true, false, true], [true, false, true]) - 1) < 1e-9);
// total disagreement on balanced labels → kappa negative/zero
check("kappa opposite ≤ 0", cohenKappa([true, false], [false, true]) <= 0);

const findings = [
  { docKey: "d", engine: "e", action: "real one", quote: "q", page: 1 },
  { docKey: "d", engine: "e", action: "fake one", quote: null, page: null },
];
const yes: JudgeModel = { id: "yes", call: async () => '{"real": true}' };
const no: JudgeModel = { id: "no", call: async () => '{"real": false}' };

(async () => {
  const judged = await judgeFindings(findings, yes, no, () => "window");
  check("both findings judged", judged.length === 2);
  check("all disagree (yes vs no)", judged.every((j) => j.agree === false));
  const worklist = buildWorklist(judged, 25);
  check("worklist has both disagreements", worklist.length === 2);
  check("cap respected", buildWorklist(judged, 1).length === 1);
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/engine-eval/test-judge.ts`
Expected: FAIL — `Cannot find module './judge'`.

- [ ] **Step 3: Write `judge.ts`**

```ts
// scripts/engine-eval/judge.ts
import type { JudgeModel } from "./openrouter";

export interface JudgeVerdict { real: boolean }
export interface Finding { docKey: string; engine: string; action: string; quote: string | null; page: number | null }
export interface JudgedFinding extends Finding { verdictA: boolean; verdictB: boolean; agree: boolean }

export function parseVerdict(raw: string): JudgeVerdict {
  const m = raw.match(/"real"\s*:\s*(true|false)/i);
  if (m) return { real: m[1].toLowerCase() === "true" };
  return { real: false }; // conservative default
}

export function judgePrompt(f: Finding, sourceWindow: string): string {
  return [
    "You are auditing an AI's extraction of a commitment from a corporate Reconciliation Action Plan.",
    "Decide whether the EXTRACTED COMMITMENT is a genuine, specific commitment that the SOURCE TEXT supports.",
    "",
    `EXTRACTED COMMITMENT: ${f.action}`,
    `CITED QUOTE: ${f.quote ?? "(none provided)"}`,
    "",
    "SOURCE TEXT (from the cited page and nearby):",
    sourceWindow || "(no source text available for this page)",
    "",
    'Answer with ONLY a JSON object: {"real": true} or {"real": false}.',
  ].join("\n");
}

export async function judgeFindings(
  findings: Finding[],
  judgeA: JudgeModel,
  judgeB: JudgeModel,
  pageTextFor: (f: Finding) => string,
): Promise<JudgedFinding[]> {
  const out: JudgedFinding[] = [];
  for (const f of findings) {
    const prompt = judgePrompt(f, pageTextFor(f));
    const [ra, rb] = await Promise.all([judgeA.call(prompt), judgeB.call(prompt)]);
    const va = parseVerdict(ra).real;
    const vb = parseVerdict(rb).real;
    out.push({ ...f, verdictA: va, verdictB: vb, agree: va === vb });
  }
  return out;
}

export function cohenKappa(a: boolean[], b: boolean[]): number {
  const n = a.length;
  if (n === 0 || n !== b.length) return 0;
  let observed = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) observed++;
  const po = observed / n;
  const aTrue = a.filter(Boolean).length / n;
  const bTrue = b.filter(Boolean).length / n;
  const pe = aTrue * bTrue + (1 - aTrue) * (1 - bTrue);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

export function buildWorklist(judged: JudgedFinding[], cap: number): JudgedFinding[] {
  return judged.filter((j) => !j.agree).slice(0, cap);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/engine-eval/test-judge.ts`
Expected: PASS — all ✅.

- [ ] **Step 5: Commit**

```bash
git add scripts/engine-eval/judge.ts scripts/engine-eval/test-judge.ts
git commit -m "feat(engine-eval): dual-judge scoring, Cohen's kappa, capped worklist"
```

---

### Task 7: Upload corpus to S3 → manifest

**Files:**
- Create: `scripts/engine-eval/upload-corpus.ts`

**Interfaces:**
- Consumes: `CORPUS` (`./corpus`).
- Produces: writes `scripts/engine-eval/results/manifest.json` = `{ uploadedAt: string; bucket: string; docs: { key: string; fileName: string; sourceS3Key: string }[] }`. Uploads each local PDF to `s3://$RAP_UPLOAD_BUCKET/engine-eval/<fileName>`.

This task performs real S3 writes; its deliverable is verified by a real run (no unit test — the logic is a thin SDK wrapper).

- [ ] **Step 1: Write `upload-corpus.ts`**

```ts
// scripts/engine-eval/upload-corpus.ts
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { CORPUS } from "./corpus";

const bucket = process.env.RAP_UPLOAD_BUCKET;
if (!bucket) throw new Error("RAP_UPLOAD_BUCKET not set");
const samplesDir = resolve(process.env.RAP_SAMPLES_DIR ?? "../CS7980/Week 7/rap_samples");
const region = process.env.AWS_REGION ?? process.env.BEDROCK_REGION ?? "ca-central-1";
const outDir = resolve(__dirname, "results");

async function main() {
  const s3 = new S3Client({ region });
  const docs: { key: string; fileName: string; sourceS3Key: string }[] = [];
  for (const doc of CORPUS) {
    const body = await readFile(join(samplesDir, doc.fileName));
    const sourceS3Key = `engine-eval/${doc.fileName}`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: sourceS3Key, Body: body, ContentType: "application/pdf" }));
    console.log(`uploaded ${doc.key} → s3://${bucket}/${sourceS3Key}`);
    docs.push({ key: doc.key, fileName: doc.fileName, sourceS3Key });
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "manifest.json"), JSON.stringify({ uploadedAt: new Date().toISOString(), bucket, docs }, null, 2));
  console.log(`\nmanifest → ${join(outDir, "manifest.json")}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Real run (uploads the 8 PDFs)**

Run (adjust the samples dir + bucket to the real values; `isb` SSO must be active):
```bash
AWS_PROFILE=isb AWS_REGION=ca-central-1 \
  RAP_UPLOAD_BUCKET="<the ca stage RapUploads bucket>" \
  RAP_SAMPLES_DIR="/Users/eps/Desktop/Work/NEU/Summer 2026/CS7980/Week 7/rap_samples" \
  npx tsx scripts/engine-eval/upload-corpus.ts
```
Expected: 8 "uploaded …" lines and a written `results/manifest.json` with 8 docs. (Find the bucket name with `AWS_PROFILE=isb aws s3 ls | grep -i rapupload`, or from `sst.config.ts`.)

- [ ] **Step 4: Commit (code only — results/ is git-ignored)**

```bash
git add scripts/engine-eval/upload-corpus.ts
git commit -m "feat(engine-eval): upload corpus PDFs to S3 and write manifest"
```

---

### Task 8: Parameterized engine runner

**Files:**
- Create: `scripts/engine-eval/run-engine.ts`

**Interfaces:**
- Consumes: `runExtraction` (`@/lib/rap/pipeline`); manifest from Task 7; `RunResult`, `EngineKey` (`./types`).
- Produces: writes `scripts/engine-eval/results/<docKey>/<engine>.json` = a `RunResult`. Reads the engine to run from `argv[2]` (`bda|textract|textlayer`) and asserts the required env is set (fails fast otherwise).

Env each engine needs (set via `package.json` in Task 10; this script only validates + calls):
- `textlayer`: `EXTRACTION_IMPL=bedrock DOC_LOADER=textlayer BEDROCK_REGION=ca-central-1`
- `textract`: `EXTRACTION_IMPL=bedrock DOC_LOADER=textract BEDROCK_REGION=ca-central-1`
- `bda`: `EXTRACTION_IMPL=bda BEDROCK_REGION=us-east-1` + `BDA_PROJECT_ARN`, `BDA_PROFILE_ARN`, `BDA_OUTPUT_BUCKET`
- all: `RAP_UPLOAD_BUCKET`, `AWS_PROFILE=isb`

- [ ] **Step 1: Write `run-engine.ts`**

```ts
// scripts/engine-eval/run-engine.ts
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runExtraction } from "@/lib/rap/pipeline";
import type { EngineKey, RunResult } from "./types";

const engine = process.argv[2] as EngineKey;
if (!["bda", "textract", "textlayer"].includes(engine)) {
  throw new Error(`usage: run-engine.ts <bda|textract|textlayer> — got "${engine}"`);
}
// Fail fast on missing env for the chosen engine.
const need = engine === "bda"
  ? ["EXTRACTION_IMPL", "BEDROCK_REGION", "RAP_UPLOAD_BUCKET", "BDA_PROJECT_ARN", "BDA_PROFILE_ARN"]
  : ["EXTRACTION_IMPL", "DOC_LOADER", "BEDROCK_REGION", "RAP_UPLOAD_BUCKET"];
for (const k of need) if (!process.env[k]) throw new Error(`missing env ${k} for engine ${engine}`);

const resultsDir = resolve(__dirname, "results");

async function main() {
  const manifest = JSON.parse(await readFile(join(resultsDir, "manifest.json"), "utf8")) as {
    docs: { key: string; fileName: string; sourceS3Key: string }[];
  };
  for (const doc of manifest.docs) {
    const started = Date.now();
    let result: RunResult;
    try {
      const r = await runExtraction({ fileName: doc.fileName, sourceS3Key: doc.sourceS3Key });
      result = {
        engine, docKey: doc.key, fileName: doc.fileName, sourceS3Key: doc.sourceS3Key,
        timingMs: Date.now() - started, extracted: r.extracted, validationIssues: r.validationIssues,
        engineLabel: r.engine, error: null,
      };
      console.log(`✅ ${engine}/${doc.key}: ${r.extracted.commitments.length} commitments in ${result.timingMs}ms`);
    } catch (e) {
      result = {
        engine, docKey: doc.key, fileName: doc.fileName, sourceS3Key: doc.sourceS3Key,
        timingMs: Date.now() - started, extracted: null, validationIssues: [], engineLabel: engine,
        error: e instanceof Error ? e.message : String(e),
      };
      console.error(`❌ ${engine}/${doc.key}: ${result.error}`);
    }
    const dir = join(resultsDir, doc.key);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${engine}.json`), JSON.stringify(result, null, 2));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke run one engine on the real corpus (text-layer — cheapest, in-country)**

Run (after Task 7's manifest exists):
```bash
AWS_PROFILE=isb EXTRACTION_IMPL=bedrock DOC_LOADER=textlayer BEDROCK_REGION=ca-central-1 \
  RAP_UPLOAD_BUCKET="<ca RapUploads bucket>" \
  npx tsx scripts/engine-eval/run-engine.ts textlayer
```
Expected: 8 ✅ lines; `results/<docKey>/textlayer.json` written for each. Spot-check one file has non-empty `extracted.commitments`.

- [ ] **Step 4: Commit**

```bash
git add scripts/engine-eval/run-engine.ts
git commit -m "feat(engine-eval): parameterized runner over the corpus manifest"
```

---

### Task 9: Scoring + report generation

**Files:**
- Create: `scripts/engine-eval/score.ts`
- Create: `scripts/engine-eval/cost.ts`
- Create: `scripts/engine-eval/test-cost.ts`

**Interfaces:**
- Consumes: `scoreAgainstGold` (`./gold-score`); `computeAgreement` (`./agreement`); `scoreGrounding`, and `loadLocalDocText`/`pageText` (`./util`); `judgeFindings`, `cohenKappa`, `buildWorklist`, `Finding` (`./judge`); `openRouterModel` (`./openrouter`); `modelFromId` (`@/lib/cases/ingest/llm`); `RunResult` (`./types`); `CORPUS` (`./corpus`).
- Produces (cost.ts): `function estimateCost(engine: EngineKey, pages: number, inTokens: number, outTokens: number): number` — Sonnet 4.6 $3/$15 per M for textract/textlayer LLM; Textract LAYOUT $0.004/page (textract only); BDA $0.040/page (custom blueprint). Returns USD.
- Produces (score.ts): writes `docs/rap-engine-comparison.md` (committed) and `scripts/engine-eval/results/worklist.html` (git-ignored). Reads every `results/<docKey>/<engine>.json`.

- [ ] **Step 1: Write the failing cost test**

```ts
// scripts/engine-eval/test-cost.ts
import { estimateCost } from "./cost";
let fail = 0;
function check(name: string, ok: boolean) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; }

// textlayer: LLM only. 1M in @ $3 + 1M out @ $15 = $18
check("textlayer LLM cost", Math.abs(estimateCost("textlayer", 10, 1_000_000, 1_000_000) - 18) < 1e-6);
// textract adds $0.004/page: 100 pages → +$0.40
check("textract adds Textract per-page", Math.abs(estimateCost("textract", 100, 0, 0) - 0.4) < 1e-6);
// bda: $0.040/page only, no LLM token cost: 100 pages → $4
check("bda per-page only", Math.abs(estimateCost("bda", 100, 0, 0) - 4) < 1e-6);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/engine-eval/test-cost.ts`
Expected: FAIL — `Cannot find module './cost'`.

- [ ] **Step 3: Write `cost.ts`**

```ts
// scripts/engine-eval/cost.ts
import type { EngineKey } from "./types";

const SONNET_IN = 3 / 1_000_000;    // $/token
const SONNET_OUT = 15 / 1_000_000;
const TEXTRACT_PER_PAGE = 0.004;
const BDA_PER_PAGE = 0.040;         // custom blueprint (spec §8.1)

export function estimateCost(engine: EngineKey, pages: number, inTokens: number, outTokens: number): number {
  if (engine === "bda") return pages * BDA_PER_PAGE;
  const llm = inTokens * SONNET_IN + outTokens * SONNET_OUT;
  const textract = engine === "textract" ? pages * TEXTRACT_PER_PAGE : 0;
  return llm + textract;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx scripts/engine-eval/test-cost.ts`
Expected: PASS.

- [ ] **Step 5: Write `score.ts`**

```ts
// scripts/engine-eval/score.ts
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CORPUS } from "./corpus";
import type { EngineKey, RunResult } from "./types";
import { scoreAgainstGold, type GoldEntry } from "./gold-score";
import { computeAgreement } from "./agreement";
import { scoreGrounding } from "./grounding";
import { loadLocalDocText, pageText } from "./util";
import { estimateCost } from "./cost";
import { judgeFindings, cohenKappa, buildWorklist, type Finding } from "./judge";
import { openRouterModel } from "./openrouter";
import { modelFromId } from "@/lib/cases/ingest/llm";

const ENGINES: EngineKey[] = ["bda", "textract", "textlayer"];
const resultsDir = resolve(__dirname, "results");
const samplesDir = resolve(process.env.RAP_SAMPLES_DIR ?? "../CS7980/Week 7/rap_samples");
const WORKLIST_CAP = 25;

const estTokens = (chars: number) => Math.ceil(chars / 4);

async function loadRun(docKey: string, engine: EngineKey): Promise<RunResult | null> {
  try { return JSON.parse(await readFile(join(resultsDir, docKey, `${engine}.json`), "utf8")); }
  catch { return null; }
}

async function main() {
  const gold = JSON.parse(await readFile(join(__dirname, "..", "fixtures", "gold-commitments-bankofcanada.json"), "utf8")) as GoldEntry[];
  const rows: string[] = [];
  const allFindings: Finding[] = [];
  const pageTextByDoc = new Map<string, string[][]>();

  // Preload doc text (for grounding + judge windows) once per doc.
  for (const doc of CORPUS) {
    const { pages } = await loadLocalDocText(join(samplesDir, doc.fileName));
    pageTextByDoc.set(doc.key, pages);
  }

  // Per engine × doc: gold (BoC only), grounding, cost, timing; collect findings for judges + agreement.
  const perEngine: Record<EngineKey, { grounding: { q: number; p: number; total: number }; costUSD: number; timeMs: number; commits: number; goldF1: number | null; goldRecall: number | null; goldPrec: number | null }> =
    Object.fromEntries(ENGINES.map((e) => [e, { grounding: { q: 0, p: 0, total: 0 }, costUSD: 0, timeMs: 0, commits: 0, goldF1: null, goldRecall: null, goldPrec: null }])) as never;

  const agreementByDoc: { doc: string; engines: { engine: string; actions: string[] }[] }[] = [];

  for (const doc of CORPUS) {
    const pages = pageTextByDoc.get(doc.key)!;
    const perDocEngines: { engine: string; actions: string[] }[] = [];
    for (const engine of ENGINES) {
      const run = await loadRun(doc.key, engine);
      if (!run || !run.extracted) continue;
      const commits = run.extracted.commitments;
      perEngine[engine].commits += commits.length;
      perEngine[engine].timeMs += run.timingMs;

      // grounding (guardrail: BDA page column marked N/A at report layer)
      const g = scoreGrounding(commits.map((c) => ({ quote: c.action.quote, page: c.action.page })), pages);
      perEngine[engine].grounding.q += g.quotePresent;
      perEngine[engine].grounding.p += g.pagePresent;
      perEngine[engine].grounding.total += g.total;

      // cost estimate (input ≈ doc text ×2 read; output ≈ extracted JSON)
      const inTokens = estTokens(pages.flat().join(" ").length) * 2;
      const outTokens = estTokens(JSON.stringify(commits).length);
      perEngine[engine].costUSD += estimateCost(engine, doc.pages, inTokens, outTokens);

      // gold (BoC only)
      if (doc.isGold) {
        const s = scoreAgainstGold(commits.map((c) => ({ action: { value: c.action.value }, page: c.action.page })), gold);
        perEngine[engine].goldF1 = s.f1; perEngine[engine].goldRecall = s.recall; perEngine[engine].goldPrec = s.precision;
      }

      // findings for judges (non-gold docs only — gold uses the oracle) + agreement (all docs)
      perDocEngines.push({ engine, actions: commits.map((c) => c.action.value ?? "").filter(Boolean) });
      if (!doc.isGold) {
        for (const c of commits) {
          if (!c.action.value) continue;
          allFindings.push({ docKey: doc.key, engine, action: c.action.value, quote: c.action.quote, page: c.action.page });
        }
      }
    }
    agreementByDoc.push({ doc: doc.key, engines: perDocEngines });
  }

  // Dual-judge the non-gold findings (Nova Pro + Kimi K2.5).
  const judgeA = modelFromId(process.env.JUDGE_A_MODEL ?? "us.amazon.nova-pro-v1:0", { maxTokens: 256 });
  const judgeB = openRouterModel(process.env.JUDGE_B_MODEL ?? "moonshotai/kimi-k2.5", { maxTokens: 256 });
  const judged = await judgeFindings(
    allFindings, { id: judgeA.id, call: judgeA.call }, judgeB,
    (f) => pageText(pageTextByDoc.get(f.docKey)!, f.page),
  );
  const kappa = cohenKappa(judged.map((j) => j.verdictA), judged.map((j) => j.verdictB));
  const worklist = buildWorklist(judged, WORKLIST_CAP);

  // Cross-engine relative recall (union), per engine, per doc — absolute counts.
  const agg: Record<string, { found: number; corroborated: number }> = {};
  for (const d of agreementByDoc) {
    const rep = computeAgreement(d.engines);
    for (const pe of rep.perEngine) {
      agg[pe.engine] ??= { found: 0, corroborated: 0 };
      agg[pe.engine].found += pe.found;
      agg[pe.engine].corroborated += pe.corroborated;
    }
  }

  // ---- Emit scorecard.md ----
  rows.push("# RAP Extraction Engine Comparison — Results\n");
  rows.push(`Generated ${new Date().toISOString()} · n=8 (BankOfCanada gold + 7). Dual judges: ${judgeA.id} + ${judgeB.id}. Inter-judge κ = **${kappa.toFixed(3)}**.\n`);
  rows.push("## Scorecard\n");
  rows.push("| Engine | Gold P / R / F1 (BoC) | Grounding: quote-present | Grounding: page-correct | Commitments found | Corroborated (≥2 engines) | Est. cost | Total time |");
  rows.push("|---|---|---|---|---|---|---|---|");
  for (const e of ENGINES) {
    const p = perEngine[e];
    const goldCell = p.goldF1 == null ? "—" : `${(p.goldPrec! * 100).toFixed(0)}% / ${(p.goldRecall! * 100).toFixed(0)}% / ${p.goldF1!.toFixed(2)}`;
    const pageCell = e === "bda" ? "N/A (inferred)" : `${p.grounding.p}/${p.grounding.total}`;
    rows.push(`| ${e} | ${goldCell} | ${p.grounding.q}/${p.grounding.total} | ${pageCell} | ${agg[e]?.found ?? 0} | ${agg[e]?.corroborated ?? 0} | $${p.costUSD.toFixed(2)} | ${(p.timeMs / 1000).toFixed(0)}s |`);
  }
  rows.push("\n> Recall on the 7 non-gold docs is **relative to the union of all engines' finds** — a defect all three miss is invisible here. BDA page numbers are inferred and are never used as a page reference. All figures are absolute counts, not agreement ratios.\n");
  rows.push(`## Judge adjudication\n\n${judged.length} findings judged; ${judged.filter((j) => !j.agree).length} disagreements → worklist (capped ${WORKLIST_CAP}). Open \`results/worklist.html\` to resolve.\n`);

  await writeFile(resolve(__dirname, "..", "..", "docs", "rap-engine-comparison.md"), rows.join("\n"));

  // ---- Emit worklist.html ----
  const items = worklist.map((w) => `<li><b>${w.docKey} / ${w.engine}</b>: ${w.action}<br><i>quote:</i> ${w.quote ?? "(none)"} · p.${w.page ?? "?"} — judgeA=${w.verdictA} judgeB=${w.verdictB} <label><input type="checkbox"> real</label></li>`).join("\n");
  await writeFile(join(resultsDir, "worklist.html"), `<!doctype html><meta charset=utf-8><title>Adjudication worklist</title><h1>Adjudication worklist (${worklist.length})</h1><ol>${items}</ol>`);

  console.log(`scorecard → docs/rap-engine-comparison.md · worklist → results/worklist.html (κ=${kappa.toFixed(3)})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Offline dry-run of scoring wiring (stub judges)**

Run (after at least one engine's results exist; stub avoids live judge calls):
```bash
EVAL_STUB_LLM=1 JUDGE_A_MODEL="stub:nova" \
  RAP_SAMPLES_DIR="/Users/eps/Desktop/Work/NEU/Summer 2026/CS7980/Week 7/rap_samples" \
  npx tsx scripts/engine-eval/score.ts
```
Expected: writes `docs/rap-engine-comparison.md` and `results/worklist.html` without throwing. (`stub:` prefix routes `modelFromId` to its offline path per `cases/ingest/llm.ts`; `EVAL_STUB_LLM=1` routes the OpenRouter judge to "STUB".) The scorecard's numbers will be partial until all three engines have run — that's expected for the dry run.

- [ ] **Step 8: Commit (code + the generated scorecard once real)**

```bash
git add scripts/engine-eval/score.ts scripts/engine-eval/cost.ts scripts/engine-eval/test-cost.ts
git commit -m "feat(engine-eval): scoring + scorecard/worklist generation"
```

---

### Task 10: package.json scripts + README

**Files:**
- Modify: `package.json` (add `eval:*` script entries)
- Create: `scripts/engine-eval/README.md`

**Interfaces:** none (wiring + docs).

- [ ] **Step 1: Add script entries to `package.json`**

Add under `"scripts"` (fill `<ca-bucket>` / `<us-bucket>` / BDA ARNs from `sst.config.ts` or the deployed stacks; keep secrets out of git — prefer exporting them in the shell and referencing `$VAR`):

```json
"eval:upload": "cross-env AWS_PROFILE=isb AWS_REGION=ca-central-1 tsx scripts/engine-eval/upload-corpus.ts",
"eval:run:textlayer": "cross-env AWS_PROFILE=isb EXTRACTION_IMPL=bedrock DOC_LOADER=textlayer BEDROCK_REGION=ca-central-1 tsx scripts/engine-eval/run-engine.ts textlayer",
"eval:run:textract": "cross-env AWS_PROFILE=isb EXTRACTION_IMPL=bedrock DOC_LOADER=textract BEDROCK_REGION=ca-central-1 tsx scripts/engine-eval/run-engine.ts textract",
"eval:run:bda": "cross-env AWS_PROFILE=isb EXTRACTION_IMPL=bda BEDROCK_REGION=us-east-1 tsx scripts/engine-eval/run-engine.ts bda",
"eval:score": "tsx scripts/engine-eval/score.ts",
"eval:test": "tsx scripts/engine-eval/test-corpus.ts && tsx scripts/engine-eval/test-gold-score.ts && tsx scripts/engine-eval/test-agreement.ts && tsx scripts/engine-eval/test-grounding.ts && tsx scripts/engine-eval/test-openrouter.ts && tsx scripts/engine-eval/test-judge.ts && tsx scripts/engine-eval/test-cost.ts"
```

(`RAP_UPLOAD_BUCKET`, `BDA_PROJECT_ARN`, `BDA_PROFILE_ARN`, `BDA_OUTPUT_BUCKET`, `OPENROUTER_API_KEY`, `RAP_SAMPLES_DIR` must be exported in the shell before running — document them in the README.)

- [ ] **Step 2: Write `scripts/engine-eval/README.md`**

Write a README covering: purpose (link the spec), the run order (`eval:test` → `eval:upload` → `eval:run:textlayer` / `:textract` / `:bda` → `eval:score`), the required env vars per phase (with a note that `textract` needs an active `isb` SSO session because the org SCP blocks Textract for Lambda but not for human principals), where outputs land (`results/` git-ignored; `docs/rap-engine-comparison.md` committed), and the validity caveats (BDA pages inferred; recall relative-to-union; ~25-item human worklist).

- [ ] **Step 3: Run the full offline test suite**

Run: `npm run eval:test`
Expected: every test script prints ✅ and exits 0.

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/engine-eval/README.md
git commit -m "chore(engine-eval): npm scripts + README"
```

---

## Execution order (live run, after the plan is built)

1. `npm run eval:test` — all pure-logic tests green.
2. Export env: `RAP_UPLOAD_BUCKET`, `RAP_SAMPLES_DIR`, `BDA_PROJECT_ARN`/`BDA_PROFILE_ARN`/`BDA_OUTPUT_BUCKET`, `OPENROUTER_API_KEY`; `aws sso login --profile isb`.
3. `npm run eval:upload` → manifest.
4. `npm run eval:run:textlayer` · `npm run eval:run:textract` · `npm run eval:run:bda` (BDA phase runs in us-east-1).
5. `npm run eval:score` → `docs/rap-engine-comparison.md` + `results/worklist.html`.
6. Open `worklist.html`, resolve the ≤25 disagreements (~30–45 min), then finalize the recommendation narrative in the scorecard.

## Self-Review notes

- **Spec coverage:** three engines (Tasks 7–8 via env), n=8 corpus (Task 1), gold P/R/F1 (Task 2), dual-judge + κ + capped worklist (Tasks 5–6, 9), cross-engine relative recall (Task 3), grounding fidelity (Task 4), cost estimate (Task 9/cost.ts), scorecard + worklist deliverables (Task 9), validity guardrails (BDA page N/A + relative-recall caveat in score.ts; absolute counts throughout).
- **Deviation from spec file layout:** the spec listed `run-bda.ts`/`run-textract.ts`/`run-textlayer.ts`; this plan uses one parameterized `run-engine.ts` + three `package.json` entries (DRY — the three differ only in env). Same behavior, less duplication.
- **Not automated (by design):** the final recommendation narrative and the ~25-item human adjudication are manual (spec §5).
- **Open runtime unknowns to resolve at execution:** exact `RAP_UPLOAD_BUCKET` name, BDA ARNs, the Nova Pro inference-profile id, and the Kimi K2.5 OpenRouter slug — all injected via env, none hard-coded.
</content>
