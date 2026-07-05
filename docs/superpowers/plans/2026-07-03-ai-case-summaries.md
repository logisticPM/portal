# AI Plain-Language Case Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Batch-generate citation-anchored plain-language summaries for core-tier legal cases (client idea #2), mechanically verified, badged "AI-generated" in the UI.

**Architecture:** A pure, injectable `summarizeCase(case, model)` in `src/lib/cases/ingest/summarizer.ts` (skip rules → deterministic input assembly → strict-JSON prompt → parse with one cache-safe retry → mechanical quote verification), a thin batch runner `scripts/cases-summarize.ts` that patches ONLY the PROFILE item, and a minimal frontend badge. Reuses the labeler's `LlmModel` interface and disk cache from `src/lib/cases/ingest/llm.ts`.

**Tech Stack:** TypeScript, Next.js 14 RSC, DynamoDB (single-table, model B vertical partitioning), AWS Bedrock Converse API, tsx + node:assert/strict tests.

**Spec:** `docs/specs/2026-07-03-ai-case-summaries-design.md` — read it before starting.

---

## Context you must know (read once)

- **Repo root:** `C:\Users\chntw\Documents\7980\demo`. All commands run from there.
- **Branch:** work on `feat/legal-ai-summaries` (Task 1 creates it from `main`).
- **Test convention:** standalone scripts `scripts/test-cases-*.ts`, `node:assert/strict`, top-level `async` IIFE (repo is not ESM — top-level await breaks). Run with `npx tsx scripts/<file>.ts`. Every task that touches a `.ts` file must also run `npm run typecheck` (tsx strips types; passing tests do NOT imply type-correctness).
- **DO NOT run `npm run verify`** in this plan: its freshSeed resets the local LegalCases table (wipes the real corpus + embedded vectors, forcing an expensive re-embed). This change is additive (no repo method logic changes), so the `dynamo≡mock` gold standard is unaffected; Task 6 justifies this in the commit message.
- **Storage shape (critical):** a case is a PROFILE item (`PK=CASE#<id>`, `SK=PROFILE`) whose case fields live under the **`data` attribute** (`data: LegalCase-minus-chunks`), plus one item per chunk (`SK=CHUNK#nnnn`). `DATA` is a DynamoDB reserved word → updates must alias BOTH path segments (`#d.#s`). **Never rewrite CHUNK items** — that wipes embedded vectors.
- Commit messages: plain `feat:`/`test:` style, no Co-Authored-By trailer.

---

### Task 1: `llm.ts` — `modelFromId`, `cachedModel`, `maxTokens` option

**Files:**
- Modify: `src/lib/cases/ingest/llm.ts`
- Create: `scripts/test-cases-summarizer.ts` (first block; later tasks extend it)

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/legal-ai-summaries
git add docs/specs/2026-07-03-ai-case-summaries-design.md docs/superpowers/plans/2026-07-03-ai-case-summaries.md
git commit -m "docs: spec + plan for AI plain-language case summaries"
```

- [ ] **Step 2: Write the failing test**

Create `scripts/test-cases-summarizer.ts`:

```ts
// Tests for the AI summary pipeline (spec 2026-07-03). Offline: fake LlmModels
// with canned JSON — no network, no cache interference (fakes bypass cachedCall).
import assert from "node:assert/strict";

(async () => {
  const { modelFromId, cachedModel } = await import("../src/lib/cases/ingest/llm");

  // modelFromId: stub path stays deterministic and carries the id.
  const m = modelFromId("stub:sum-a");
  assert.equal(m.id, "stub:sum-a");
  const out1 = await m.call("same prompt");
  const out2 = await m.call("same prompt");
  assert.equal(out1, out2, "stub output must be deterministic");
  assert.ok(Array.isArray(JSON.parse(out1)), "stub output is a JSON array");

  // cachedModel: preserves the id, wraps the call.
  const cm = cachedModel(m);
  assert.equal(cm.id, "stub:sum-a");
  assert.equal(await cm.call("same prompt"), out1);

  console.log("✅ test-cases-summarizer (task 1: modelFromId/cachedModel) passed");
})();
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx tsx scripts/test-cases-summarizer.ts`
Expected: FAIL — `modelFromId` / `cachedModel` are not exported.

- [ ] **Step 4: Implement in `src/lib/cases/ingest/llm.ts`**

Replace `configuredModels`, `callProvider`, `bedrockConverse`, `converse`, and `cachedCall` with (stub + cache internals unchanged):

```ts
export interface CallOpts { maxTokens?: number }

export function configuredModels(): LlmModel[] {
  const ids = (process.env.LABEL_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length < 2) throw new Error("Set LABEL_MODELS to two comma-separated model ids (different families).");
  return ids.map((id) => modelFromId(id));
}

// Build a single LlmModel from a model id, baking call options into the closure
// so LlmModel.call keeps its (prompt) => Promise<string> shape.
export function modelFromId(id: string, opts?: CallOpts): LlmModel {
  return { id, call: (p) => callProvider(id, p, opts) };
}

async function callProvider(modelId: string, prompt: string, opts?: CallOpts): Promise<string> {
  if (modelId.startsWith("stub:")) return stubLabelResponse(modelId, prompt);
  return converse(modelId, prompt, opts);
}
```

In `bedrockConverse`, change the memoized shape and send signature:

```ts
let bedrockP: Promise<{ send: (modelId: string, prompt: string, opts?: CallOpts) => Promise<string> }> | null = null;
function bedrockConverse() {
  if (!bedrockP) {
    bedrockP = import("@aws-sdk/client-bedrock-runtime").then((m) => {
      const region = (process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-east-1").trim();
      const client = new m.BedrockRuntimeClient({ region });
      return {
        send: async (modelId: string, prompt: string, opts?: CallOpts) => {
          const res = await client.send(new m.ConverseCommand({
            modelId,
            messages: [{ role: "user", content: [{ text: prompt }] }],
            inferenceConfig: { temperature: 0, maxTokens: opts?.maxTokens ?? 256 },
          }));
          const parts = res.output?.message?.content ?? [];
          return parts.map((p) => ("text" in p && p.text ? p.text : "")).join("");
        },
      };
    });
  }
  return bedrockP;
}

async function converse(modelId: string, prompt: string, opts?: CallOpts): Promise<string> {
  return (await bedrockConverse()).send(modelId, prompt, opts);
}
```

Export the cache layer (body unchanged, add `export`), plus a model wrapper:

```ts
export async function cachedCall(m: LlmModel, prompt: string): Promise<string> { /* unchanged body */ }

// Wrap a model so calls go through the disk cache (batch runners use this;
// summarizeCase itself calls the model directly so tests stay cache-free).
export const cachedModel = (m: LlmModel): LlmModel => ({ id: m.id, call: (p) => cachedCall(m, p) });
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx tsx scripts/test-cases-summarizer.ts` → PASS.
Run: `npx tsx scripts/test-cases-label-llm.ts` → still PASS (configuredModels now delegates to modelFromId; behavior identical).
Run: `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/ingest/llm.ts scripts/test-cases-summarizer.ts
git commit -m "feat(cases): modelFromId + cachedModel + maxTokens option in llm client"
```

---

### Task 2: types + parser + mechanical verifier (pure functions)

**Files:**
- Modify: `src/lib/cases/types.ts` (additive only)
- Create: `src/lib/cases/ingest/summarizer.ts`
- Modify: `scripts/test-cases-summarizer.ts` (append)

- [ ] **Step 1: Add types to `src/lib/cases/types.ts`**

After the `ThemeLabelMeta` interface, add:

```ts
export interface SummaryMeta {
  method: "curated" | "llm";
  model?: string;        // e.g. "us.meta.llama3-3-70b-instruct-v1:0"
  generatedAt?: string;  // ISO timestamp
  claimsDropped?: number;
}
```

In `LegalCase`, directly after `summary?: CitationAnchored;` add:

```ts
  summaryMeta?: SummaryMeta;
```

(Optional field ⇒ mock fixtures and `dynamo≡mock` untouched. Curated cases carry no `summaryMeta`; the UI treats absence as curated.)

- [ ] **Step 2: Write the failing tests (append to `scripts/test-cases-summarizer.ts`, inside the IIFE before the final console.log; change the final log message to "✅ test-cases-summarizer passed")**

```ts
  const { parseClaims, verifyClaims, normWs } = await import("../src/lib/cases/ingest/summarizer");

  // --- parser ---
  const good = `Here is the summary:\n{"claims":[{"text":"T","quote":"Q","paragraph":12}]}\nDone.`;
  const parsed = parseClaims(good);
  assert.ok(parsed && parsed.length === 1);
  assert.deepEqual(parsed![0], { text: "T", quote: "Q", paragraph: "12" }); // numeric para coerced to string
  assert.equal(parseClaims("no json here"), null);
  assert.equal(parseClaims(`{"claims": "not-an-array"}`), null);
  assert.equal(parseClaims(`{"claims":[{"text":"T"`), null); // truncated JSON

  // --- verifier ---
  const chunks = [
    { paragraph: "12", text: "The Crown owed a duty to consult the Haida Nation before transferring the licence." },
    { paragraph: "48", text: "Compensation of $10 million was awarded for the breach of treaty obligations." },
  ];
  const URL = "https://example.org/case";
  const mk = (text: string, quote: string, paragraph: string) => ({ text, quote, paragraph });

  // valid quote passes and is anchored
  let v = verifyClaims([mk("Plain claim.", "duty to consult the Haida Nation", "12")], chunks, URL);
  assert.equal(v.anchors.length, 1);
  assert.deepEqual(v.anchors[0], { text: "Plain claim.", sourceParagraph: "12", sourceUrl: URL });
  assert.equal(v.dropped, 0);

  // whitespace differences still match (normalization)
  v = verifyClaims([mk("C.", "Compensation of   $10 million\n was awarded", "48")], chunks, URL);
  assert.equal(v.anchors.length, 1);

  // fabricated quote dropped
  v = verifyClaims([mk("C.", "the court awarded punitive damages", "48")], chunks, URL);
  assert.equal(v.anchors.length, 0); assert.equal(v.dropped, 1);

  // right quote, wrong paragraph id → dropped
  v = verifyClaims([mk("C.", "duty to consult the Haida Nation", "48")], chunks, URL);
  assert.equal(v.anchors.length, 0);

  // unknown paragraph id → dropped
  v = verifyClaims([mk("C.", "duty to consult the Haida Nation", "99")], chunks, URL);
  assert.equal(v.anchors.length, 0);

  // short quote (<15 chars normalized) → dropped
  v = verifyClaims([mk("C.", "duty to", "12")], chunks, URL);
  assert.equal(v.anchors.length, 0);

  // empty text → dropped
  v = verifyClaims([mk("  ", "duty to consult the Haida Nation", "12")], chunks, URL);
  assert.equal(v.anchors.length, 0);

  // more than 6 survivors → first 6 kept, rest counted dropped
  const many = Array.from({ length: 8 }, (_, i) => mk(`claim ${i}`, "duty to consult the Haida Nation", "12"));
  v = verifyClaims(many, chunks, URL);
  assert.equal(v.anchors.length, 6); assert.equal(v.dropped, 2);

  assert.equal(normWs("  a\n\t b  "), "a b");
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx tsx scripts/test-cases-summarizer.ts`
Expected: FAIL — cannot find module `../src/lib/cases/ingest/summarizer`.

- [ ] **Step 4: Create `src/lib/cases/ingest/summarizer.ts`**

```ts
// AI plain-language case summaries (spec 2026-07-03). Pure + injectable: the
// model is passed in (tests use fakes; the batch runner wraps in the disk cache).
// Governance: every displayed claim is anchored to a verbatim quote that is
// mechanically verified against the judgment text; unverifiable claims are
// dropped; <2 surviving claims → no summary at all (宁缺毋滥).
import type { CaseChunk, CitationAnchor, CitationAnchored, LegalCase, SummaryMeta } from "../types";
import type { LlmModel } from "./llm";

export interface RawClaim { text: string; quote: string; paragraph: string }
export type SummarizeStatus =
  | "generated" | "skipped_curated" | "skipped_not_core" | "skipped_no_fulltext" | "failed";
export interface SummarizeResult {
  status: SummarizeStatus;
  summary?: CitationAnchored;
  meta?: SummaryMeta;
  claimsDropped: number; // claims returned by the model but not kept (failed verification or past the 6 cap)
}

export const normWs = (s: string) => s.replace(/\s+/g, " ").trim();

// Parse the model's response: first "{" to last "}", strict shape check.
// Returns null on any malformation (caller retries once with a corrective suffix).
export function parseClaims(raw: string): RawClaim[] | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    const arr = (obj as { claims?: unknown })?.claims;
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c) => ({ text: String(c.text ?? ""), quote: String(c.quote ?? ""), paragraph: String(c.paragraph ?? "") }));
  } catch { return null; }
}

// Mechanical verification: the quote must appear verbatim (whitespace-normalized)
// in the chunk whose paragraph id the claim cites. Quotes are guaranteed real;
// paraphrase fidelity is human-spot-checked (spec Q3).
export function verifyClaims(
  claims: RawClaim[], chunks: CaseChunk[], sourceUrl: string,
): { anchors: CitationAnchor[]; dropped: number } {
  const byPara = new Map(chunks.map((ch) => [String(ch.paragraph), normWs(ch.text)]));
  const anchors: CitationAnchor[] = [];
  for (const cl of claims) {
    if (anchors.length >= 6) break; // keep the first 6 in model output order
    const para = String(cl.paragraph ?? "");
    const body = byPara.get(para);
    const quote = normWs(cl.quote ?? "");
    const text = (cl.text ?? "").trim();
    if (body && text && quote.length >= 15 && body.includes(quote)) {
      anchors.push({ text, sourceParagraph: para, sourceUrl });
    }
  }
  return { anchors, dropped: claims.length - anchors.length };
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx tsx scripts/test-cases-summarizer.ts` → PASS.
Run: `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/types.ts src/lib/cases/ingest/summarizer.ts scripts/test-cases-summarizer.ts
git commit -m "feat(cases): SummaryMeta type + summary claim parser and mechanical verifier"
```

---

### Task 3: input assembly, prompt, `summarizeCase` orchestration

**Files:**
- Modify: `src/lib/cases/ingest/summarizer.ts` (append)
- Modify: `scripts/test-cases-summarizer.ts` (append)

- [ ] **Step 1: Write the failing tests (append inside the IIFE)**

```ts
  const { assembleInput, buildPrompt, summarizeCase, RETRY_SUFFIX } =
    await import("../src/lib/cases/ingest/summarizer");
  type LM = import("../src/lib/cases/ingest/llm").LlmModel;
  type LC = import("../src/lib/cases/types").LegalCase;

  const mkCase = (over: Partial<LC> = {}): LC => ({
    id: "2004-scc-73", citation: "2004 SCC 73", styleOfCause: "Haida Nation v. British Columbia",
    court: "Supreme Court of Canada", level: "scc", year: 2004, jurisdiction: "CA",
    nations: ["Haida"], themes: ["duty_to_consult"],
    outcome: { outcomeType: "precedent", winType: "doctrine_win", whoWon: "Haida Nation",
      holding: "The Crown owed a duty to consult before transferring the licence." },
    casesCited: [], casesCiting: [], citingCount: 0,
    enrichmentLevel: "index", corpusTier: "core",
    fullTextAvailable: true,
    chunks: [
      { paragraph: "12", text: "The Crown owed a duty to consult the Haida Nation before transferring the licence." },
      { paragraph: "48", text: "Compensation of $10 million was awarded for the breach of treaty obligations." },
    ],
    provenance: { source: "a2aj", sourceUrl: "https://example.org/case", upstreamLicense: "open", ingestedAt: "2026-06-28", unofficial: true },
    ...over,
  });

  // --- assembleInput: under budget → all chunks, tagged, document order ---
  const asm = assembleInput(mkCase().chunks!, "duty to consult");
  assert.ok(asm.startsWith("[para 12] The Crown"));
  assert.ok(asm.includes("\n[para 48] Compensation"));

  // --- assembleInput: over budget → first-10 + holding-token + economic chunks, doc order, within budget ---
  const bigChunks = Array.from({ length: 60 }, (_, i) => ({
    paragraph: String(i + 1),
    text: i === 40 ? "The consultation duty framework applies here. ".repeat(20)
      : i === 50 ? "A settlement of $2 million in compensation. ".repeat(20)
      : `Filler paragraph number ${i + 1}. `.repeat(20),
  }));
  const budget = 12_000;
  const out = assembleInput(bigChunks, "consultation duty framework", budget);
  assert.ok(out.length <= budget, "stays within budget");
  assert.ok(out.includes("[para 1]"), "keeps head chunks");
  assert.ok(out.includes("[para 41]"), "keeps holding-token chunk");
  assert.ok(out.includes("[para 51]"), "keeps economic chunk");
  const idx41 = out.indexOf("[para 41]"); const idx51 = out.indexOf("[para 51]");
  assert.ok(idx41 < idx51, "document order preserved");
  assert.equal(assembleInput(bigChunks, "consultation duty framework", budget), out, "deterministic");

  // --- buildPrompt carries case identity + rules + body ---
  const prompt = buildPrompt(mkCase(), "BODY-SENTINEL");
  assert.ok(prompt.includes("Haida Nation v. British Columbia"));
  assert.ok(prompt.includes("2004 SCC 73"));
  assert.ok(prompt.includes("BODY-SENTINEL"));
  assert.ok(prompt.includes('"claims"'));

  // --- summarizeCase: happy path ---
  const goodJson = JSON.stringify({ claims: [
    { text: "The court said the Crown must consult first.", quote: "duty to consult the Haida Nation", paragraph: "12" },
    { text: "Ten million dollars was awarded.", quote: "Compensation of $10 million was awarded", paragraph: "48" },
  ]});
  const fake = (responses: string[]): LM & { calls: string[] } => {
    const calls: string[] = [];
    return { id: "fake:test", calls, call: async (p: string) => { calls.push(p); return responses[Math.min(calls.length - 1, responses.length - 1)]; } };
  };

  let f = fake([goodJson]);
  let r = await summarizeCase(mkCase(), f);
  assert.equal(r.status, "generated");
  assert.equal(r.summary!.claims.length, 2);
  assert.equal(r.summary!.claims[0].sourceUrl, "https://example.org/case");
  assert.equal(r.meta!.method, "llm");
  assert.equal(r.meta!.model, "fake:test");
  assert.equal(r.claimsDropped, 0);
  assert.equal(f.calls.length, 1);

  // --- retry on malformed JSON, corrective suffix changes the prompt ---
  f = fake(["NOT JSON", goodJson]);
  r = await summarizeCase(mkCase(), f);
  assert.equal(r.status, "generated");
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[1].endsWith(RETRY_SUFFIX), "retry appends corrective suffix (new cache key)");

  // --- two malformed responses → failed ---
  f = fake(["NOT JSON", "STILL NOT JSON"]);
  r = await summarizeCase(mkCase(), f);
  assert.equal(r.status, "failed");

  // --- <2 verified claims → failed, nothing written ---
  const oneGood = JSON.stringify({ claims: [
    { text: "ok", quote: "duty to consult the Haida Nation", paragraph: "12" },
    { text: "fabricated", quote: "the moon is made of cheese and treaties", paragraph: "48" },
  ]});
  f = fake([oneGood]);
  r = await summarizeCase(mkCase(), f);
  assert.equal(r.status, "failed");
  assert.equal(r.claimsDropped, 1);
  assert.equal(r.summary, undefined);

  // --- skip rules: no model call happens ---
  const throwing: LM = { id: "fake:never", call: async () => { throw new Error("must not be called"); } };
  r = await summarizeCase(mkCase({ summary: { claims: [{ text: "curated", sourceParagraph: "1", sourceUrl: "u" }] } }), throwing);
  assert.equal(r.status, "skipped_curated");
  r = await summarizeCase(mkCase({ corpusTier: "substrate" }), throwing);
  assert.equal(r.status, "skipped_not_core");
  r = await summarizeCase(mkCase({ chunks: [] }), throwing);
  assert.equal(r.status, "skipped_no_fulltext");
  r = await summarizeCase(mkCase({ chunks: undefined }), throwing);
  assert.equal(r.status, "skipped_no_fulltext");
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-cases-summarizer.ts`
Expected: FAIL — `assembleInput` not exported.

- [ ] **Step 3: Append to `src/lib/cases/ingest/summarizer.ts`**

```ts
const ECON_RE = /compensation|damages|royalt|revenue|settlement|\$/i;

// Deterministic input assembly. Under budget: the whole judgment in document
// order. Over budget: keep (a) the first 10 chunks (facts/background), (b)
// chunks sharing tokens with the holding, (c) economic-keyword chunks, then
// fill remaining budget in document order; emit selected chunks in document order.
export function assembleInput(chunks: CaseChunk[], holding: string, budget = 240_000): string {
  const lines = chunks.map((ch) => `[para ${ch.paragraph}] ${ch.text}`);
  const total = lines.reduce((n, l) => n + l.length + 1, 0);
  if (total <= budget) return lines.join("\n");

  const holdTokens = (holding.toLowerCase().match(/[a-z]{4,}/g) ?? []).slice(0, 12);
  const picked = new Set<number>();
  chunks.forEach((ch, i) => {
    if (i < 10) { picked.add(i); return; }
    const low = ch.text.toLowerCase();
    if (holdTokens.some((t) => low.includes(t)) || ECON_RE.test(ch.text)) picked.add(i);
  });

  const chosen: number[] = [];
  let used = 0;
  const tryAdd = (i: number) => {
    const cost = lines[i].length + 1;
    if (used + cost > budget) return;
    chosen.push(i); used += cost;
  };
  for (let i = 0; i < chunks.length; i++) if (picked.has(i)) tryAdd(i);
  for (let i = 0; i < chunks.length; i++) if (!picked.has(i)) tryAdd(i);
  chosen.sort((a, b) => a - b);
  return chosen.map((i) => lines[i]).join("\n");
}

export function buildPrompt(c: LegalCase, body: string): string {
  return `You are writing a plain-language summary of a Canadian court decision for readers WITHOUT legal training (Indigenous community members, business advisors, policy staff).

Case: ${c.styleOfCause}, ${c.citation} (${c.court}, ${c.year})

Below is the judgment text as paragraphs, each tagged [para <id>].

Produce STRICTLY this JSON (no markdown, no commentary):
{"claims":[{"text":"...","quote":"...","paragraph":"..."}]}

Rules:
- 3 to 6 claims.
- Each "text": 1-2 plain-language sentences a non-lawyer understands. No legalese.
- Each "quote": a VERBATIM excerpt copied character-for-character from one paragraph below (at least 15 characters).
- Each "paragraph": the id from that paragraph's [para <id>] tag.
- Together the claims must cover: (1) what the dispute was about, (2) what the court decided, (3) the economic significance or consequences.
- Do not invent facts. Every claim must be supported by its quote.

JUDGMENT TEXT:
${body}`;
}

export const RETRY_SUFFIX = "\n\nYour previous output was not valid JSON. Output ONLY the JSON object.";

export async function summarizeCase(c: LegalCase, model: LlmModel): Promise<SummarizeResult> {
  if (c.summary) return { status: "skipped_curated", claimsDropped: 0 };
  if (c.corpusTier !== "core") return { status: "skipped_not_core", claimsDropped: 0 };
  if (!c.chunks || c.chunks.length === 0) return { status: "skipped_no_fulltext", claimsDropped: 0 };

  const prompt = buildPrompt(c, assembleInput(c.chunks, c.outcome.holding));
  let claims = parseClaims(await model.call(prompt));
  // Retry once with a corrective suffix — the suffix changes the disk-cache key,
  // so a cached malformed response can never be replayed as the "retry".
  if (!claims) claims = parseClaims(await model.call(prompt + RETRY_SUFFIX));
  if (!claims) return { status: "failed", claimsDropped: 0 };

  const { anchors, dropped } = verifyClaims(claims, c.chunks, c.provenance.sourceUrl);
  if (anchors.length < 2) return { status: "failed", claimsDropped: dropped };
  return {
    status: "generated",
    summary: { claims: anchors },
    meta: { method: "llm", model: model.id, generatedAt: new Date().toISOString(), claimsDropped: dropped },
    claimsDropped: dropped,
  };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx tsx scripts/test-cases-summarizer.ts` → PASS.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/ingest/summarizer.ts scripts/test-cases-summarizer.ts
git commit -m "feat(cases): summarizeCase — input assembly, prompt, cache-safe retry, anchoring"
```

---

### Task 4: batch runner `scripts/cases-summarize.ts` + npm scripts

**Files:**
- Create: `scripts/cases-summarize.ts`
- Modify: `package.json` (two scripts, next to `cases:promote` at ~line 36)

- [ ] **Step 1: Create `scripts/cases-summarize.ts`**

```ts
// Batch AI plain-language summaries over core cases (spec 2026-07-03).
// Idempotent: responses are disk-cached (scripts/.cache/llm), so re-runs and the
// cloud replay are free. Writes summary + summaryMeta onto the PROFILE item ONLY —
// never rewrites CHUNK items (that would wipe embedded vectors; the promote lesson).
import "./fetch-polyfill";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseKeys } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { cachedModel, modelFromId } from "../src/lib/cases/ingest/llm";
import { summarizeCase } from "../src/lib/cases/ingest/summarizer";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
const MODEL_ID = process.env.SUMMARY_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";

async function main() {
  const model = cachedModel(modelFromId(MODEL_ID, { maxTokens: 1024 }));
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  console.log(`summarizing ${profiles.length} core cases with ${MODEL_ID}`);

  const stats = { generated: 0, skipped_curated: 0, skipped_not_core: 0, skipped_no_fulltext: 0 };
  const failed: string[] = [];
  let kept = 0, dropped = 0, done = 0;

  for (const p of profiles) {
    // Curated cases short-circuit on the PROFILE alone; others need chunks reassembled.
    const c = p.summary ? p : await dynamoCaseRepo.getCase(p.id);
    if (!c) continue;
    const r = await summarizeCase(c, model);
    if (r.status === "generated" && r.summary && r.meta) {
      await ddbDoc.send(new UpdateCommand({
        TableName: TABLE,
        Key: caseKeys.profile(c.id),
        // Case fields live under the PROFILE's `data` attribute, and DATA is a
        // DynamoDB reserved word — alias both path segments.
        UpdateExpression: "SET #d.#s = :s, #d.#m = :m",
        ExpressionAttributeNames: { "#d": "data", "#s": "summary", "#m": "summaryMeta" },
        ExpressionAttributeValues: { ":s": r.summary, ":m": r.meta },
      }));
      stats.generated++; kept += r.summary.claims.length; dropped += r.claimsDropped;
    } else if (r.status === "failed") { failed.push(c.id); dropped += r.claimsDropped; }
    else stats[r.status]++;
    if (++done % 25 === 0) console.log(`… ${done}/${profiles.length} · generated ${stats.generated} · failed ${failed.length}`);
  }

  console.log(`✅ summarize: generated ${stats.generated} · curated ${stats.skipped_curated} · no-fulltext ${stats.skipped_no_fulltext} · failed ${failed.length} of ${profiles.length}`);
  console.log(`   claims kept ${kept} · dropped ${dropped}`);
  if (failed.length) console.log("   failed ids:", failed.join(", "));
}
main().catch((e) => { console.error("❌ cases-summarize failed:", e); process.exit(1); });
```

- [ ] **Step 2: Add npm scripts to `package.json`** (immediately after `"cases:promote"`)

```json
    "cases:summarize": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-summarize.ts",
    "cases:summarize:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-summarize.ts",
```

(`BEDROCK_REGION=us-east-1` is explicit so nothing inherits ca-central-1; the labeled models live in us-east-1.)

- [ ] **Step 3: Typecheck + dry sanity**

Run: `npm run typecheck` → clean (covers `scripts/`; the real run needs DynamoDB + credentials and happens post-merge per spec "Operational run").

- [ ] **Step 4: Commit**

```bash
git add scripts/cases-summarize.ts package.json
git commit -m "feat(cases): cases:summarize batch runner — PROFILE-only patch, disk-cached"
```

---

### Task 5: frontend badge + methodology, and fix the "nothing is generated" claim

**Files:**
- Modify: `src/app/cases/[id]/page.tsx` (summary block, ~lines 51–60)
- Modify: `src/app/cases/methodology/page.tsx` (~lines 38–49)

- [ ] **Step 1: Update the summary block in `src/app/cases/[id]/page.tsx`**

Replace the existing `{c.summary && (...)}` section with:

```tsx
      {c.summary && (
        <section className="mt-4">
          <h2 className="font-serif text-lg">
            Summary <span className="text-xs font-sans font-normal text-ink3">(citation-anchored)</span>
            {c.summaryMeta?.method === "llm" && (
              <span className="ml-2 rounded bg-amber/15 px-2 py-0.5 text-xs font-sans font-normal text-amber">AI-generated · plain language</span>
            )}
          </h2>
          <ul className="mt-1 space-y-1 text-sm text-ink2">
            {c.summary.claims.map((cl, i) => (
              <li key={i}>{cl.text} <a href={cl.sourceUrl} className="text-xs text-amber hover:underline" target="_blank" rel="noreferrer">[{cl.sourceParagraph}]</a></li>
            ))}
          </ul>
          {c.summaryMeta?.method === "llm" && (
            <p className="mt-1 text-xs text-ink3">AI paraphrase — unofficial; verify each claim against its anchored paragraph.</p>
          )}
        </section>
      )}
```

- [ ] **Step 2: Update `src/app/cases/methodology/page.tsx`**

(a) The "Sources &amp; provenance" paragraph currently ends with "; nothing is generated." — that claim becomes false once AI summaries ship. Replace that sentence ending so the paragraph reads:

```tsx
          <p>Cases are harvested from the open A2AJ API (metadata + citation graph) and matched to official court decisions for full text. All displayed judgment text is an <strong>unofficial reproduction</strong> of a public decision, linked to its official source; judgment text is never generated. AI-generated content (plain-language summaries) is always labeled as such and citation-anchored.</p>
```

(b) After the "Labeling" `<div>`, insert:

```tsx
        <div>
          <h2 className="font-serif text-lg">AI plain-language summaries</h2>
          <p>Core cases carry an AI-generated plain-language summary, badged as such. Every claim is anchored to a verbatim quote that is <strong>mechanically verified</strong> against the judgment text before display — claims whose quotes cannot be found verbatim are discarded, and a case with fewer than two verified claims gets no summary at all. Verification guarantees the quotes are real; paraphrase fidelity is validated by human spot-check. Flagship summaries are human-curated and never overwritten.</p>
        </div>
```

- [ ] **Step 3: Build**

Run: `npm run typecheck` → clean.
Run: `npm run build` → all `/cases` routes compile.

- [ ] **Step 4: Commit**

```bash
git add src/app/cases/[id]/page.tsx src/app/cases/methodology/page.tsx
git commit -m "feat(cases): AI-summary badge + disclaimer; methodology documents generation policy"
```

---

### Task 6: full validation sweep

**Files:** none (verification only; fix anything found, then re-run)

- [ ] **Step 1: Run the battery**

```bash
npm run typecheck
npx tsx scripts/test-cases-summarizer.ts
npx tsx scripts/test-cases-label-llm.ts
npx tsx scripts/test-cases-route.ts
npx tsx scripts/test-cases-inverted.ts
npx tsx scripts/test-cases-artifact.ts
npm run build
```

Expected: all green. **Do NOT run `npm run verify`** (freshSeed wipes the local real corpus + vectors; this change is additive and doesn't touch repo method logic, so `dynamo≡mock` is unaffected — record this justification in the PR body).

- [ ] **Step 2: Spec coverage sweep**

Re-read `docs/specs/2026-07-03-ai-case-summaries-design.md` §§1–6 and confirm each maps to landed code (§1→Task 3, §2→Task 2, §3→Task 2, §4→Task 1, §5→Task 4, §6→Task 5). Confirm no task invented extras beyond the spec.

- [ ] **Step 3: Commit any fixes; leave the branch ready for PR**

---

## Post-merge operational run (NOT part of this plan's tasks; needs AWS credentials)

Per spec "Operational run": ① `npm run cases:summarize` locally (~480 generations, serial, disk-cached); ② human spot-check 20–30 claims for paraphrase fidelity, record in the spec's Result section; ③ `npm run cases:summarize:cloud` (cache replay, ~free); ④ no search-artifact rebuild needed (`metaText` excludes summaries). If the local table was freshSeed-reset at some point, re-ingest first (`cases:ingest` + `cases:fetch-fulltext` + `cases:promote`), then summarize.
