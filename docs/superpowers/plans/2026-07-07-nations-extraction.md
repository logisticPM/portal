# Nations Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the empty `nations` field on core cases by extracting the Indigenous party nation(s) from each judgment (style-of-cause-anchored, verbatim-verified), so the `/cases` nation facet/filter become real — without fabrication and without overwriting curated nations.

**Architecture:** Mirror the AI-summaries / recorded-figures pipeline — the LLM returns the party nation(s); a mechanical verifier keeps a name only if it appears verbatim (normWs) in the style of cause or judgment text. A batch runner writes `data.nations` (PROFILE-only) for cases whose `nations` is empty. `nations` already exists on `LegalCase` and round-trips, so no type or `itemToCase` change.

**Tech Stack:** TypeScript, `tsx`, AWS SDK v3 (`@aws-sdk/lib-dynamodb`), Bedrock (Llama 3.3 70B via Converse), `node:assert/strict` tests via `npx tsx`.

Each task leaves a green `tsc`. Run every command from the worktree root; do NOT run `npm run verify`.

---

### Task 1: Extractor + verifier (`ingest/nations.ts`)

**Files:**
- Create: `src/lib/cases/ingest/nations.ts`
- Test: `scripts/test-cases-nations.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-nations.ts`:

```ts
// Nations extraction (spec 2026-07-07): verify verbatim + skip rules. Async IIFE
// because this repo is NOT ESM (top-level await is illegal).
import assert from "node:assert/strict";
import { verifyNations, extractNations } from "../src/lib/cases/ingest/nations";
import type { LegalCase } from "../src/lib/cases/types";
import type { LlmModel } from "../src/lib/cases/ingest/llm";

(async () => {
  // --- verifyNations ---
  const chunks = [{ paragraph: "para-1", text: "The Musqueam Indian Band brought this claim." }];
  assert.deepEqual(verifyNations(["Haida Nation"], "Haida Nation v. British Columbia", chunks), ["Haida Nation"], "styleOfCause match kept");
  assert.deepEqual(verifyNations(["Musqueam Indian Band"], "R. v. Sparrow", chunks), ["Musqueam Indian Band"], "body match kept");
  assert.deepEqual(verifyNations(["Atlantis Nation"], "R. v. Sparrow", chunks), [], "not-in-record dropped");
  assert.deepEqual(verifyNations(["Haida Nation", "haida nation"], "Haida Nation v. BC", []), ["Haida Nation"], "case-insensitive dedupe");
  assert.equal(
    verifyNations(["A Nation", "B Nation", "C Nation", "D Nation", "E Nation", "F Nation"],
      "A Nation B Nation C Nation D Nation E Nation F Nation v. X", []).length,
    5, "capped at 5");

  // --- extractNations skip rules + generated (fake model) ---
  const base = (over: Partial<LegalCase>): LegalCase => ({
    id: "c1", citation: "2020 SCC 1", styleOfCause: "Haida Nation v. British Columbia", court: "SCC", level: "scc", year: 2020,
    jurisdiction: "CA", nations: [], themes: [],
    outcome: { outcomeType: "precedent", winType: "party_win", whoWon: "", holding: "consult" },
    chunks: [{ paragraph: "para-1", text: "The Haida Nation sought consultation." }],
    casesCited: [], casesCiting: [], citingCount: 0, enrichmentLevel: "index", corpusTier: "core", fullTextAvailable: true,
    provenance: { source: "a2aj", sourceUrl: "u", upstreamLicense: "open", ingestedAt: "2026", unofficial: true },
    ...over,
  });
  const fake: LlmModel = { id: "fake", call: async () => JSON.stringify({ nations: ["Haida Nation"] }) };
  const ok = await extractNations(base({}), fake);
  assert.equal(ok.status, "generated");
  assert.deepEqual(ok.nations, ["Haida Nation"]);
  assert.equal((await extractNations(base({ corpusTier: "substrate" }), fake)).status, "skipped_not_core");
  assert.equal((await extractNations(base({ nations: ["X Nation"] }), fake)).status, "skipped_has_nations");
  assert.equal((await extractNations(base({ chunks: [] }), fake)).status, "skipped_no_fulltext");

  console.log("✅ test-cases-nations passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `npx tsx scripts/test-cases-nations.ts`
Expected: FAIL — cannot resolve `../src/lib/cases/ingest/nations`.

- [ ] **Step 3: Create `src/lib/cases/ingest/nations.ts`**

```ts
// Nations extraction (spec 2026-07-07). Same discipline as figures/summarizer: the
// model returns the Indigenous PARTY nation(s); a mechanical verifier keeps a name
// only if it appears verbatim (normWs) in the style of cause or the judgment text.
// Fill-if-empty only — curated nations are authoritative and never overwritten.
import type { CaseChunk, LegalCase } from "../types";
import type { LlmModel } from "./llm";
import { assembleInput, normWs } from "./summarizer";

export type NationsStatus = "generated" | "skipped_not_core" | "skipped_has_nations" | "skipped_no_fulltext" | "failed";
export interface NationsResult { status: NationsStatus; nations: string[] }

const MAX_NATIONS = 5;

export function parseNations(raw: string): string[] | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const arr = (JSON.parse(raw.slice(start, end + 1)) as { nations?: unknown })?.nations;
    if (!Array.isArray(arr)) return null;
    return arr.map((n) => String(n ?? "")).filter(Boolean);
  } catch { return null; }
}

// Keep a name only if it appears verbatim (normWs, case-insensitive) in the style of
// cause or the judgment text. Dedupe case-insensitively (first surface form wins);
// cap at MAX_NATIONS. A name the model invents cannot survive.
export function verifyNations(names: string[], styleOfCause: string, chunks: CaseChunk[]): string[] {
  const hay = normWs([styleOfCause, ...chunks.map((c) => c.text)].join(" ")).toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name.length < 3) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    if (!hay.includes(normWs(name).toLowerCase())) continue; // not in the record → drop
    seen.add(key); out.push(name);
    if (out.length >= MAX_NATIONS) break;
  }
  return out;
}

export function buildNationsPrompt(c: LegalCase, body: string): string {
  return `You identify the Indigenous party in a Canadian court decision.

Case: ${c.styleOfCause}, ${c.citation} (${c.court}, ${c.year})

Return STRICTLY this JSON (no markdown, no commentary):
{"nations":["..."]}

Rules:
- List ONLY the Indigenous nation(s), band(s), tribal council(s), or Métis/Inuit group(s) that are a PARTY to THIS case (applicant/appellant/plaintiff/respondent) — usually named in the style of cause above.
- Copy each name VERBATIM as written (e.g. "Tsilhqot'in Nation", "Mikisew Cree First Nation", "Osoyoos Indian Band").
- Do NOT include nations that are only cited, referenced, or mentioned as precedent.
- Do NOT invent, translate, abbreviate, or normalize. If none is identifiable, return {"nations":[]}.

JUDGMENT TEXT:
${body}`;
}

export const NATIONS_RETRY_SUFFIX = "\n\nYour previous output was not valid JSON. Output ONLY the JSON object.";

export async function extractNations(c: LegalCase, model: LlmModel): Promise<NationsResult> {
  if (c.corpusTier !== "core") return { status: "skipped_not_core", nations: [] };
  if (c.nations.length > 0) return { status: "skipped_has_nations", nations: [] };
  if (!c.chunks || c.chunks.length === 0) return { status: "skipped_no_fulltext", nations: [] };
  const prompt = buildNationsPrompt(c, assembleInput(c.chunks, c.outcome.holding));
  let names = parseNations(await model.call(prompt));
  if (!names) names = parseNations(await model.call(prompt + NATIONS_RETRY_SUFFIX));
  if (!names) return { status: "failed", nations: [] };
  return { status: "generated", nations: verifyNations(names, c.styleOfCause, c.chunks) };
}
```

- [ ] **Step 4: Run it, verify it PASSES**

Run: `npx tsx scripts/test-cases-nations.ts && npx tsc --noEmit`
Expected: `✅ test-cases-nations passed`; tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/ingest/nations.ts scripts/test-cases-nations.ts
git commit -m "feat(cases): style-of-cause-anchored nations extraction + verbatim verifier"
```

---

### Task 2: Batch runner + npm scripts + methodology + gate

**Files:**
- Create: `scripts/cases-extract-nations.ts`
- Modify: `package.json`
- Modify: `docs/research/2026-06-28-legal-corpus-construction-methodology.md`

- [ ] **Step 1: Create the batch runner**

Create `scripts/cases-extract-nations.ts`:

```ts
// Batch nations extraction over core cases (spec 2026-07-07). Idempotent: LLM
// responses are disk-cached (scripts/.cache/llm) and only empty-nations cases are
// written, so curated nations are never overwritten and re-runs are free. Writes
// data.nations onto the PROFILE item ONLY — never rewrites CHUNK items.
import "./fetch-polyfill";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../src/lib/dynamo/client";
import { caseKeys } from "../src/lib/dynamo/cases-table";
import { dynamoCaseRepo } from "../src/lib/cases/repo.dynamo";
import { cachedModel, modelFromId } from "../src/lib/cases/ingest/llm";
import { extractNations } from "../src/lib/cases/ingest/nations";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
const MODEL_ID = process.env.NATIONS_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";

async function main() {
  const model = cachedModel(modelFromId(MODEL_ID, { maxTokens: 256 }));
  const profiles = await dynamoCaseRepo.listCases({ tier: "core" });
  console.log(`extracting nations from ${profiles.length} core cases with ${MODEL_ID}`);

  const stats = { filled: 0, empty: 0, skipped_has: 0, skipped_no_fulltext: 0, failed: 0 };
  const distinct = new Set<string>();
  let done = 0;

  for (const p of profiles) {
    if (p.nations.length > 0) { stats.skipped_has++; continue; } // curated / already-done → never overwrite
    const c = await dynamoCaseRepo.getCase(p.id);
    if (!c) continue;
    const r = await extractNations(c, model);
    if (r.status === "generated" && r.nations.length > 0) {
      await ddbDoc.send(new UpdateCommand({
        TableName: TABLE, Key: caseKeys.profile(c.id),
        UpdateExpression: "SET #d.#n = :n",
        ExpressionAttributeNames: { "#d": "data", "#n": "nations" },
        ExpressionAttributeValues: { ":n": r.nations },
      }));
      stats.filled++; r.nations.forEach((n) => distinct.add(n));
    } else if (r.status === "generated") stats.empty++;
    else if (r.status === "failed") stats.failed++;
    else if (r.status === "skipped_no_fulltext") stats.skipped_no_fulltext++;
    else if (r.status === "skipped_has_nations") stats.skipped_has++;
    if (++done % 25 === 0) console.log(`… ${done}/${profiles.length} · filled ${stats.filled} · distinct ${distinct.size}`);
  }

  console.log(`✅ extract-nations: filled ${stats.filled} · empty ${stats.empty} · has-already ${stats.skipped_has} · no-fulltext ${stats.skipped_no_fulltext} · failed ${stats.failed}`);
  console.log(`   distinct nations filled: ${distinct.size}`);
}
main().catch((e) => { console.error("❌ cases-extract-nations failed:", e); process.exit(1); });
```

- [ ] **Step 2: Add npm scripts**

In `package.json`, inside `"scripts"`, add these two lines immediately AFTER the existing `"cases:extract-figures:cloud": ...` line (keep valid JSON):

```json
    "cases:extract-nations": "cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-extract-nations.ts",
    "cases:extract-nations:cloud": "cross-env AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo BEDROCK_REGION=us-east-1 tsx scripts/cases-extract-nations.ts",
```

- [ ] **Step 3: Append the methodology note**

APPEND to the END of `docs/research/2026-06-28-legal-corpus-construction-methodology.md` (leading blank line):

```markdown

## Nations extraction (2026-07-07) — style-of-cause-anchored, verbatim-verified

The `nations` field was empty on all A2AJ-promoted core cases (only 2 curated
flagships had it), so the `/cases` nation facet was dead. `cases:extract-nations`
now fills it: an LLM returns the Indigenous **party** nation(s) — usually named in
the style of cause — and a mechanical verifier keeps a name only if it appears
verbatim (whitespace/typography-normalized) in the case title or judgment text.
Only cases with an empty `nations` array are written, so curated nations are never
overwritten. `nations` is part of the search `metaText`, so the artifact is rebuilt
after a run (no re-embed — chunks/vectors are unchanged). Precision caveat: verbatim
presence proves a name is in the record, not that it is the party; the style-of-cause
anchoring keeps this tight, but residual "mentioned, not party" noise is possible.
```

- [ ] **Step 4: Run the full offline gate**

Run: `npx tsx scripts/test-cases-nations.ts && npx tsc --noEmit && node -e "require('./package.json')" && npm run build`
Expected: test prints `✅ test-cases-nations passed`; `tsc` exit 0; `node` prints nothing (valid JSON); `next build` completes (compiles, generates pages, exit 0).

> Do NOT run `npm run verify` (it factory-resets the local corpus).

- [ ] **Step 5: Commit**

```bash
git add scripts/cases-extract-nations.ts package.json docs/research/2026-06-28-legal-corpus-construction-methodology.md
git commit -m "feat(cases): batch nations-extraction runner + npm scripts + methodology"
```

---

## Post-merge operational run (credentialed — NOT part of code tasks)

Against the cloud table with temporary SSO creds (`AWS_REGION=us-east-1 CASES_TABLE=LegalCases`), from the repo root:

1. `npm run cases:extract-nations:cloud` — fills nations on empty-nations core cases (reports filled / distinct).
2. `INDEX_BUCKET=indigenomics-portal-production-casesindexbucket-bbdveozx npm run cases:index-build:cloud` — rebuild + upload the search artifact (`nations` is in `metaText`). **No re-embed** (chunks/vectors unchanged).
3. Record in a Result section of the spec: cases filled, distinct nations now in the `byNation` facet (was 2), and a spot-check that each sampled nation appears in its case's title/text.
