# Option B Chunked Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Option B extracts a RAP of any size by splitting the commitments extraction across several small Claude calls that each stay inside the regime measured to work, instead of one forced tool call that must emit all 20-50 commitments and dies.

**Architecture:** Split the one monolithic call into (1) **one header call** over the document head with a header-only tool schema, and (2) **N commitment calls**, one per document chunk, each with a commitments-only tool schema. Merge in document order. Chunks are split on paragraph/sentence boundaries with **no overlap** (so no dedupe is needed); a chunk that still truncates is **recursively halved and retried**, which makes correctness independent of how dense the document is. Transient stream aborts get bounded retry with backoff.

**Tech Stack:** TypeScript, `@aws-sdk/client-bedrock-runtime` (`InvokeModelWithResponseStream`), Textract for OCR. **No test framework** — tests are `scripts/test-*.ts` run via `npx tsx` with a `check(name, ok)` helper.

## Global Constraints

- **Depends on `fix/bedrock-model-id`** (the model id must be an inference profile or nothing runs at all). Branch from it, not from main, if it has not merged.
- **The grounding contract is non-negotiable.** Every extracted value keeps `Grounded<T>` = `{value, quote, page, confidence}`; the deterministic gate `validateAndFlag(raw, { requireQuote: true })` still runs on the merged result. **Do not lighten the schema to save tokens** — chunking is the fix; the `docs/rap-extraction-findings.md` §4 "lighten grounding" option was measured NOT to address the actual failure (see Measured Facts).
- **No commitment may be silently dropped.** A chunk that fails after its retries must fail the extraction loudly, never return partial results as if complete. Silent under-extraction on a compliance product is worse than an error.
- **No test framework.** Do NOT add vitest/jest.
- **Verification** = `npm run typecheck` (check the REAL exit code — do not pipe it through `tail`, which masks it) && `npm run build` && the `scripts/test-*.ts` scripts && the Task 5 live run.
- Commit after each task.

## Measured Facts (2026-07-16, live against Bedrock — design to these, do not re-derive)

Measured with `scripts/diag-truncation.ts` (untracked; ask the author) using synthetic RAP text:

| Commitments | max_tokens | Result |
|---|---|---|
| 8 | 16000 | ✅ 8/8, `stop_reason: tool_use` |
| 22 | 16000 | ✅ 22/22 — **3/3 runs**, us-east-1 AND ca-central-1, ~8.9k-10.2k output tokens |
| 32 | 16000 | ❌ connection `aborted` at ~69s — 3/3 runs, both regions, and also on sonnet-4-5 |
| 32 | 4000 | ❌ `stop_reason: max_tokens`, **4000 tokens billed for ~430 tokens of visible JSON** |
| 45 | 16000 | ❌ aborted |

- **Cost model: ~410 output tokens per commitment.** 22 commitments ≈ 9-10k tokens.
- **~15% run-to-run variance on identical input** (8915 vs 10236 tokens for the same 22). Margins must absorb this.
- **The failure mechanism is NOT understood.** At 32 commitments the model burns ~89% of its output budget on tokens that appear in **no stream channel** (`{ tool_use: 1 }` only — no text block, no thinking block), always dying at ~1,380 chars, exactly where the commitments array begins. It reproduces on sonnet-4-5 and sonnet-4-6, in both regions. **This plan does not try to explain it — it stays inside the regime that demonstrably works.** Do not "fix" it by raising `max_tokens`; that was measured to make things worse (the 32@16000 case dies where 32@4000 at least returns).
- Because the burn is invisible (not JSON), shrinking the schema cannot recover it.

**Chunk-size target: aim for ≤12 commitments per call** (~5k output tokens — roughly half the proven-good 22, leaving room for the 15% variance and for prose denser than the synthetic fixture).

## File Structure

- **Create** `src/lib/rap/chunk.ts` — pure document chunker. No AWS.
- **Create** `scripts/test-rap-chunk.ts` — chunker tests.
- **Modify** `src/lib/rap/extraction-schema.ts` — split `CLAUDE_TOOL` into a header-only and a commitments-only tool.
- **Create** `scripts/test-extraction-schema-split.ts` — proves the split schemas together still cover `ExtractedRap`.
- **Modify** `src/lib/rap/pipeline.bedrock.ts` — the call orchestration: header call + per-chunk calls, recursive split-on-truncation, retry-on-abort, merge.
- **Create** `scripts/test-rap-merge.ts` — merge/ordering tests (pure).
- **Create** `scripts/smoke-extract-bedrock.ts` — the live end-to-end run (Task 5).

**Not in scope:** Textract QUERIES for header grounding (verified available in ca-central-1 and it returns `Text`+`Page`+`Confidence` natively — a real improvement, but headers already succeed reliably, so it is a **follow-up**, tracked separately); lightening `Grounded<T>`; BDA.

---

### Task 1: Pure document chunker

**Files:**
- Create: `src/lib/rap/chunk.ts`
- Test: `scripts/test-rap-chunk.ts`

**Interfaces:**
- Consumes: nothing (pure leaf).
- Produces: `interface DocChunk { text: string; index: number }`; `function chunkDocument(text: string, targetChars?: number): DocChunk[]`; `function splitInHalf(chunk: DocChunk): DocChunk[] | null`.

**Context:** `src/lib/cases/ingest/a2aj.ts:42-78` (`chunkText`/`splitLarge`) is the house precedent — paragraph boundaries first, sentence boundaries for oversized paragraphs, **no overlap**. Read it and follow its shape. Do NOT import it: it lives in the cases domain and returns a cases-specific `CaseChunk`; the domains must not import each other (see the identity/index-evidence seam precedent). Reimplement the splitting idea here, RAP-shaped.

**Why no overlap:** overlap would duplicate commitments across chunks and force a dedupe step with no reliable identity key (a commitment has no id until we assign one). No-overlap + paragraph boundaries means concatenating chunks reproduces the source exactly, so every commitment lives in exactly one chunk. The residual risk — a commitment straddling a boundary — is mitigated by splitting only at blank-line paragraph boundaries, which is where RAP commitments actually separate, and is caught by Task 5's real-document run.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-rap-chunk.ts`:

```ts
// Run: npx tsx scripts/test-rap-chunk.ts
import { chunkDocument, splitInHalf } from "../src/lib/rap/chunk";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const para = (n: number) => `Commitment ${n}. Action: do thing ${n}.\nDeliverable: report ${n}.`;
const doc = Array.from({ length: 30 }, (_, i) => para(i + 1)).join("\n\n");

const chunks = chunkDocument(doc, 400);
check("splits a long document into several chunks", chunks.length > 1);
check("chunks are indexed in document order", chunks.every((c, i) => c.index === i));

// THE load-bearing property: no overlap, nothing lost. If this fails, commitments
// are being duplicated or dropped.
check(
  "concatenating chunks reproduces the source exactly (no overlap, no loss)",
  chunks.map((c) => c.text).join("\n\n").replace(/\s+/g, " ").trim() ===
    doc.replace(/\s+/g, " ").trim(),
);
check("every commitment paragraph survives somewhere", 
  Array.from({ length: 30 }, (_, i) => i + 1).every((n) =>
    chunks.some((c) => c.text.includes(`Commitment ${n}.`))));
check("respects the target size (allowing one paragraph of overshoot)",
  chunks.every((c) => c.text.length <= 400 * 2));

// A document under target is one chunk — do not fragment small RAPs.
const small = chunkDocument(para(1), 400);
check("a small document stays a single chunk", small.length === 1);
check("an empty document yields no chunks", chunkDocument("", 400).length === 0);

// Recursive split, for a chunk that still truncates.
const big = chunkDocument(doc, 100000)[0];
const halves = splitInHalf(big);
check("splitInHalf returns two halves", halves !== null && halves.length === 2);
check(
  "halves reproduce the chunk (no loss)",
  halves !== null &&
    halves.map((h) => h.text).join("\n\n").replace(/\s+/g, " ").trim() ===
      big.text.replace(/\s+/g, " ").trim(),
);
check("an unsplittable single-line chunk returns null (caller must fail loudly)",
  splitInHalf({ text: "oneline", index: 0 }) === null);

process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx scripts/test-rap-chunk.ts` → FAIL, cannot resolve `../src/lib/rap/chunk`.

- [ ] **Step 3: Implement**

Create `src/lib/rap/chunk.ts`. Requirements, all covered by the test above:
- Split on blank-line paragraph boundaries; accumulate paragraphs into a chunk until adding the next would exceed `targetChars` (default `6000`).
- A single paragraph larger than `targetChars` is split on sentence boundaries (`. ` / `.\n`), mirroring `splitLarge`.
- Never overlap. Never drop text.
- `splitInHalf` splits a chunk at the paragraph boundary nearest the middle; returns `null` when the chunk has no internal boundary to split at (the caller must then fail loudly, not silently return partial data).
- Export `DEFAULT_TARGET_CHARS = 6000` with a comment pointing at the plan's Measured Facts (≤12 commitments ≈ 5k output tokens, well inside the proven-good regime).

- [ ] **Step 4: Run it and confirm it passes** → 10 ✅, exit 0.

- [ ] **Step 5: Typecheck (check the real exit code) and commit**

```bash
npm run typecheck; echo "typecheck exit=$?"
git add src/lib/rap/chunk.ts scripts/test-rap-chunk.ts
git commit -m "feat(rap): pure document chunker for Option B extraction"
```

---

### Task 2: Split the tool schema into header-only and commitments-only

**Files:**
- Modify: `src/lib/rap/extraction-schema.ts`
- Test: `scripts/test-extraction-schema-split.ts`

**Interfaces:**
- Produces: `HEADER_TOOL` + `HEADER_TOOL_NAME` (every `ExtractedRap` field EXCEPT `commitments`); `COMMITMENTS_TOOL` + `COMMITMENTS_TOOL_NAME` (ONLY `commitments`). Keep the existing `CLAUDE_TOOL`/`EXTRACTION_TOOL_NAME` exports untouched — `pipeline.bda.ts` and others may reference them, and this task must not break them.

**Context:** read `src/lib/rap/extraction-schema.ts` fully first. `CLAUDE_TOOL` is one `input_schema` covering the header fields plus a `commitments` array whose items carry ~8 grounded sub-fields. The two new tools are that schema partitioned — **not rewritten**. Reuse the existing grounded-field builders; do not redefine the `{value, quote, page, confidence}` shape.

`EXTRACTION_SYSTEM` (the locate-and-quote rule set) is shared by both calls unchanged.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-extraction-schema-split.ts`:

```ts
// The split schemas must together cover exactly what the original did — no field
// silently lost when we stopped using one big tool.
// Run: npx tsx scripts/test-extraction-schema-split.ts
import { CLAUDE_TOOL, COMMITMENTS_TOOL, HEADER_TOOL } from "../src/lib/rap/extraction-schema";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}

const props = (t: any) => Object.keys(t.input_schema.properties ?? {});
const original = props(CLAUDE_TOOL);
const header = props(HEADER_TOOL);
const commitments = props(COMMITMENTS_TOOL);

check("header tool has NO commitments field", !header.includes("commitments"));
check("commitments tool has ONLY commitments", commitments.length === 1 && commitments[0] === "commitments");
check(
  "header ∪ commitments === the original field set (nothing lost)",
  new Set([...header, ...commitments]).size === new Set(original).size &&
    original.every((f) => header.includes(f) || commitments.includes(f)),
);
check("header and commitments do not overlap", header.every((f) => !commitments.includes(f)));
check("the two tools have distinct names", HEADER_TOOL.name !== COMMITMENTS_TOOL.name);

// The grounding contract must survive the split.
const commitItem: any = (COMMITMENTS_TOOL.input_schema.properties as any).commitments.items;
const sub = Object.values(commitItem.properties ?? {}) as any[];
check(
  "every commitment sub-field is still a grounded {value,quote,page,confidence}",
  sub.length > 0 &&
    sub.every((f) => ["value", "quote", "page", "confidence"].every((k) => k in (f.properties ?? {}))),
);

process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it and confirm it fails** (HEADER_TOOL not exported).

- [ ] **Step 3: Implement the split**, reusing the existing field definitions. Do not alter `CLAUDE_TOOL`.

- [ ] **Step 4: Run it and confirm it passes** → 6 ✅.

- [ ] **Step 5: Typecheck (real exit code) and commit.**

---

### Task 3: Chunked call orchestration — split-on-truncation + retry-on-abort

**Files:**
- Modify: `src/lib/rap/pipeline.bedrock.ts`
- Test: `scripts/test-rap-merge.ts`

**Interfaces:**
- Consumes: `chunkDocument`/`splitInHalf` (Task 1); `HEADER_TOOL`/`COMMITMENTS_TOOL` (Task 2); `resolveBedrockModelId` (already on `fix/bedrock-model-id`).
- Produces: `mergeExtraction(header, commitmentGroups)` — **exported and pure**, so it is testable without AWS.

**Context — the existing single call is at `pipeline.bedrock.ts:94-160` (`runExtractionBedrock`).** Keep `loadDocumentText` (Textract OCR) exactly as is. Keep the streaming loop's shape — it accumulates `input_json_delta.partial_json`, which is correct and was verified. Refactor the "build body → stream → parse" part into a reusable `callTool(tool, toolName, userText, maxTokens)` used by both the header call and each chunk call.

**Behaviour required:**
1. `loadDocumentText` → `chunkDocument(text)`.
2. **Header call:** `callTool(HEADER_TOOL, …)` over the **first chunk only** (RAP header fields live at the front; sending the whole document reintroduces the payload we are trying to avoid). If the header call truncates, that's a hard failure — headers were measured to fit comfortably.
3. **Commitment calls:** for each chunk, `callTool(COMMITMENTS_TOOL, …)`. **Run these sequentially, not in parallel** — the abort failure mode is not understood, and concurrency adds a variable we cannot yet reason about. (A bounded pool is a later optimisation.)
4. **On `stop_reason === "max_tokens"` for a chunk:** `splitInHalf` it and retry each half (recursive, max depth 3). If `splitInHalf` returns `null`, **throw** — never return partial.
5. **On a transient stream error** (the `aborted` error observed in Measured Facts): retry that chunk up to 2 times with backoff (1s, 4s). If it still fails, **split the chunk in half and try that** (a smaller generation is the one thing measured to help). If that fails, **throw**.
6. **Merge:** header fields + commitments concatenated **in chunk order**. No dedupe (chunks do not overlap — Task 1 guarantees it).
7. `validateAndFlag(merged, { requireQuote: true })` runs on the merged result, exactly as today.
8. Delete the old "too many commitments for the per-subfield grounded schema" error message — it is no longer the failure mode and would mislead.

- [ ] **Step 1: Write the failing test** — `scripts/test-rap-merge.ts`, covering `mergeExtraction` only (pure; no AWS):

```ts
// Run: npx tsx scripts/test-rap-merge.ts
import { mergeExtraction } from "../src/lib/rap/pipeline.bedrock";

let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fail++;
}
const g = (v: any) => ({ value: v, quote: "q", page: 1, confidence: 0.9 });
const commit = (a: string) => ({ action: g(a), deliverable: g("d") });

const header: any = { orgName: g("Acme"), sector: g("other"), commitments: undefined };
const merged: any = mergeExtraction(header, [[commit("a1"), commit("a2")], [commit("a3")]]);

check("header fields survive the merge", merged.orgName.value === "Acme");
check("all commitments from all chunks are present", merged.commitments.length === 3);
check(
  "commitments keep document order across chunks",
  merged.commitments.map((c: any) => c.action.value).join(",") === "a1,a2,a3",
);
check("an empty chunk group contributes nothing", 
  (mergeExtraction(header, [[], [commit("x")]]) as any).commitments.length === 1);
check("no chunks → zero commitments, not a crash",
  (mergeExtraction(header, []) as any).commitments.length === 0);

process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Implement** the refactor + orchestration above.
- [ ] **Step 4: Run it and confirm it passes** → 5 ✅.
- [ ] **Step 5: Typecheck (real exit code), build, commit.**

---

### Task 4: Guard the regression — the chunk size must stay inside the measured regime

**Files:**
- Test: `scripts/test-rap-chunk.ts` (extend)

**Context:** the whole plan rests on each call staying well inside the proven-good regime. If someone later raises `DEFAULT_TARGET_CHARS` "to reduce API calls", the bug returns silently and only on large real documents. Make that a test failure instead.

- [ ] **Step 1: Add the guard test** to `scripts/test-rap-chunk.ts`:

```ts
import { DEFAULT_TARGET_CHARS } from "../src/lib/rap/chunk";

// Measured 2026-07-16: ~410 output tokens per commitment; 22 commitments (~9-10k
// tokens) is the largest size that reliably succeeded; 32 failed 3/3. Synthetic
// RAP text ran ~340 document chars per commitment. So a chunk of N chars implies
// roughly N/340 commitments → N/340*410 output tokens. Keep that comfortably
// under the proven-good ~10k, allowing for ~15% run-to-run variance.
const impliedCommitments = DEFAULT_TARGET_CHARS / 340;
const impliedOutputTokens = impliedCommitments * 410;
check(
  `default chunk implies ~${Math.round(impliedOutputTokens)} output tokens — inside the measured-good regime`,
  impliedOutputTokens < 9000,
);
check(
  "default chunk implies well under the 32-commitment size that failed 3/3",
  impliedCommitments < 22,
);
```

- [ ] **Step 2: Run it; it must pass with `DEFAULT_TARGET_CHARS = 6000`** (≈17.6 commitments… **if this fails, lower the default until it passes — do not weaken the assertion**).
- [ ] **Step 3: Commit.**

---

### Task 5: Live end-to-end run against a REAL RAP PDF

**Files:**
- Create: `scripts/smoke-extract-bedrock.ts`

**This is the task that actually proves the fix.** Every measurement so far used synthetic `.txt`, which **bypasses Textract entirely** (`loadDocumentText` short-circuits on `.txt`). Nothing to date has exercised OCR, real page numbers, or real RAP prose.

**The target:** `s3://indigenomics-portal-ca-rapuploadsbucket-bbhvotne/test/BankOfCanada_RAP.pdf` (534 KB, the `ca` stage bucket) — the team's real test RAP, almost certainly the 13-page document in `docs/rap-extraction-findings.md`.

**Safety:** read-only. The script runs the pipeline with the **mock repo** and writes NOTHING to any table (mirror the `REPO_IMPL` mock pattern). Prod RapData is empty (verified 0 items) and must stay that way. Do not upload, delete, or modify any S3 object.

**Interfaces:** consumes `runExtractionBedrock`.

- [ ] **Step 1: Write the smoke script**

`scripts/smoke-extract-bedrock.ts` — invokes `runExtractionBedrock({ fileName, sourceS3Key })` against the real PDF and reports: chunk count, per-chunk output tokens and stop_reason, total commitments, how many have a quote and a page, elapsed, and any validation issues. It must **exit non-zero** if extraction throws or returns zero commitments.

- [ ] **Step 2: Run it live**

```bash
AWS_PROFILE=isb \
BEDROCK_REGION=ca-central-1 \
RAP_UPLOAD_BUCKET=indigenomics-portal-ca-rapuploadsbucket-bbhvotne \
SMOKE_KEY=test/BankOfCanada_RAP.pdf \
npx tsx scripts/smoke-extract-bedrock.ts
```

- [ ] **Step 3: Confirm ALL of these, and paste the real output**
  - Textract OCR succeeds on the real multi-page PDF.
  - No `aborted`, no `max_tokens` failure.
  - **Commitment count is plausible for this document** (the findings doc reports ~22 for the BDA run on the same RAP — a wildly different number means chunking is dropping or duplicating commitments, and is a FAILURE even though nothing threw).
  - **Every commitment has a non-null quote AND page** — the grounding contract.
  - Page numbers are plausible (within the document's page count), not all `1` and not null.
  - It runs in **ca-central-1** — this is the private-extraction path.

- [ ] **Step 4: Compare against the pre-fix behaviour**

Run the same script on `main` (or stash the changes) to confirm the real document actually failed before. If the real RAP happens to be small enough that it **already worked**, say so plainly in the report — that changes what this fix is worth and must not be papered over.

- [ ] **Step 5: Record the result in `docs/rap-extraction-findings.md`**

§4 is now substantially stale and actively misleading. Update it: the 8192-cap truncation no longer reproduces (the cap is 16000); the real failure is invisible budget burn at ~32+ commitments; the "~2,200 characters" figure is wrong (~2.8 chars/token means 8192 tokens ≈ 23k chars); "lighten the grounding" was measured NOT to address it; the fix is chunking. Cite the Measured Facts table.

- [ ] **Step 6: Commit.**

---

## Open questions for the PR

1. **The mechanism is still unexplained** — ~89% of the output budget is billed to tokens that appear in no stream channel, on two models, in two regions. Chunking sidesteps it rather than fixing it. Worth an AWS support case with the repro; if AWS confirms a bug, chunk sizes could be relaxed later.
2. **Textract QUERIES for header grounding** (follow-up, agreed): verified available in ca-central-1, returns `Text`+`Page`+`Confidence` natively — better grounding than a model-asserted page, and it removes the header call. Note we already call Textract and discard `Page`/`Confidence` on every block (`pipeline.bedrock.ts:74-77`).
3. **Sequential chunk calls** are a deliberate conservative choice. Revisit a bounded-concurrency pool (cf. `mapPool`, `src/lib/cases/search/embedder.ts:59-68`) once the abort mechanism is understood.
