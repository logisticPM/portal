# Labeling-Agent Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire `callProvider` (the only missing piece of the dual-LLM labeling pipeline): `stub:` ids → deterministic offline test stub; anything else → Bedrock Converse. Then run the credentialed labeling pass so the ~476 inclusion-passing cases get themes + promote to core.

**Architecture:** All code change in `src/lib/cases/ingest/llm.ts`. Everything downstream (`cachedCall`/`parseThemes`/`mergeLabels`/`labelCase`/`cases:promote`) already exists. Spec: `docs/specs/2026-07-03-labeling-agent-wiring-design.md`.

**Tech Stack:** TypeScript, `@aws-sdk/client-bedrock-runtime` (Converse API), `tsx` standalone tests, `node:assert/strict`.

---

### Task 1: wire `callProvider` (stub + Converse) + offline e2e test

**Files:**
- Modify: `src/lib/cases/ingest/llm.ts`
- Create: `scripts/test-cases-label-llm.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cases-label-llm.ts`:

```ts
// Offline e2e for the labeling pipeline using the deterministic test stub
// (LABEL_MODELS=stub:a,stub:b — no key, no network). Asserts stub determinism and
// that labelCase returns exactly the intersection of the two models' theme sets.
import assert from "node:assert/strict";
import { configuredModels, labelWithModel, parseThemes } from "../src/lib/cases/ingest/llm";
import { labelCase } from "../src/lib/cases/ingest/labeler";
import { labelPrompt, ALL_THEMES } from "../src/lib/cases/ingest/rubric";

process.env.LABEL_MODELS = "stub:a,stub:b";

const TEXT = "The Crown failed to consult the Nation before issuing forestry tenures on unceded territory.";

(async () => {
  const [a, b] = configuredModels();

  // determinism: same (id, prompt) → identical themes
  const p = labelPrompt(TEXT);
  const a1 = await labelWithModel(a, p);
  const a2 = await labelWithModel(a, p);
  assert.deepEqual(a1, a2, "stub must be deterministic");

  // outputs are valid theme subsets
  const bt = await labelWithModel(b, p);
  for (const t of [...a1, ...bt]) assert.ok(ALL_THEMES.includes(t), `unknown theme ${t}`);

  // different stub ids should not be forced identical (a and b differ on this text)
  // (not asserted strictly — overlap is fine; the e2e intersection below is the contract)

  // e2e: labelCase = intersection of the two stub outputs, dual_llm provenance
  const res = await labelCase(TEXT);
  const inter = a1.filter((t) => bt.includes(t));
  assert.deepEqual(res.themes, inter, "labelCase themes must equal the stub intersection");
  assert.equal(res.labelMeta.method, "dual_llm");
  assert.deepEqual(res.labelMeta.models, ["stub:a", "stub:b"]);
  const union = new Set([...a1, ...bt]);
  const expectedAgreement = union.size === 0 ? "none" : inter.length === union.size ? "full" : inter.length > 0 ? "partial" : "none";
  assert.equal(res.labelMeta.agreement, expectedAgreement);
  assert.equal(res.labelMeta.needsReview, expectedAgreement !== "full");

  // parseThemes hardening: junk in, empty out
  assert.deepEqual(parseThemes("no json here"), []);

  console.log(`✅ label-llm stub e2e (a=${JSON.stringify(a1)} b=${JSON.stringify(bt)} ∩=${JSON.stringify(inter)} agreement=${expectedAgreement})`);
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx tsx scripts/test-cases-label-llm.ts`
Expected: throws `callProvider not configured for stub:a`.

- [ ] **Step 3: Implement `callProvider`**

In `src/lib/cases/ingest/llm.ts`, replace the throwing `callProvider` with:

```ts
async function callProvider(modelId: string, prompt: string): Promise<string> {
  if (modelId.startsWith("stub:")) return stubLabelResponse(modelId, prompt);
  return converse(modelId, prompt);
}

// Deterministic TEST stub (no key, no network): sha256(id+prompt) picks a subset of
// ALL_THEMES and returns it as a JSON array string. Semantically meaningless by
// design (same ethos as the stub-hash-v1 embedder): it only makes labelCase runnable
// end-to-end offline and tests stable. NEVER authoritative — real labels come from
// the credentialed dual-LLM run.
function stubLabelResponse(modelId: string, prompt: string): string {
  const h = createHash("sha256").update(modelId + "\n" + prompt).digest();
  const picked = ALL_THEMES.filter((_, i) => h[i % h.length] % 3 === 0);
  return JSON.stringify(picked);
}

// Bedrock Converse API — uniform request/response across model families (Claude,
// Nova, Llama, …), which is what LABEL_MODELS' two-different-families requirement
// needs (no per-family body formats). Lazy import keeps the stub path offline.
let bedrockP: Promise<{ send: (modelId: string, prompt: string) => Promise<string> }> | null = null;
function bedrockConverse() {
  if (!bedrockP) {
    bedrockP = import("@aws-sdk/client-bedrock-runtime").then((m) => {
      const region = (process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-east-1").trim();
      const client = new m.BedrockRuntimeClient({ region });
      return {
        send: async (modelId: string, prompt: string) => {
          const res = await client.send(new m.ConverseCommand({
            modelId,
            messages: [{ role: "user", content: [{ text: prompt }] }],
            inferenceConfig: { temperature: 0, maxTokens: 256 },
          }));
          const parts = res.output?.message?.content ?? [];
          return parts.map((p) => ("text" in p && p.text ? p.text : "")).join("");
        },
      };
    });
  }
  return bedrockP;
}

async function converse(modelId: string, prompt: string): Promise<string> {
  return (await bedrockConverse()).send(modelId, prompt);
}
```

Also update the file-header comment's "Never used in unit tests (live calls only)" to
reflect the stub (e.g. "stub: ids run offline for tests; real ids call Bedrock Converse").

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx tsx scripts/test-cases-label-llm.ts`
Expected: `✅ label-llm stub e2e (...)` — note the printed a/b/∩ sets for the record.

- [ ] **Step 5: Typecheck + existing tests + commit**

Run: `npm run typecheck` (clean) and `npx tsx scripts/test-cases-labelmerge.ts` (still green).

```bash
git add src/lib/cases/ingest/llm.ts scripts/test-cases-label-llm.ts
git commit -m "feat(cases): wire callProvider — stub: test ids + Bedrock Converse for real labeling"
```

---

### Task 2: credentialed dual-LLM labeling run (operational)

**Precondition:** valid AWS creds in env; local DynamoDB up with the full corpus; cloud table seeded (done 2026-07-03).

- [ ] **Step 1: Probe model access (pick two families)**

Try a tiny Converse call against candidates until two DIFFERENT families work, e.g.:
`us.anthropic.claude-3-5-haiku-20241022-v1:0`, `anthropic.claude-3-5-haiku-20241022-v1:0`,
`us.amazon.nova-lite-v1:0`, `amazon.nova-lite-v1:0`. Record the two chosen ids.

- [ ] **Step 2: Local labeling + promotion**

```bash
LABEL_MODELS="<idA>,<idB>" AWS_RETRY_MODE=adaptive AWS_MAX_ATTEMPTS=10 \
DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo \
npx tsx scripts/cases-promote.ts
```
Expected: `✅ promoted: core <N≈400-500> of 3483 substrate` (serial, ~20–30 min, ~$1–3;
disk cache makes interruptions resumable). If Bedrock throttles, adaptive retry absorbs it.

- [ ] **Step 3: Cloud promotion (near-free thanks to the cache)**

```bash
LABEL_MODELS="<idA>,<idB>" AWS_REGION=us-east-1 CASES_TABLE=LegalCases REPO_IMPL=dynamo \
npx tsx scripts/cases-promote.ts
```
Expected: same N promoted on the cloud table (LLM responses come from the local cache).

- [ ] **Step 4: Verify + record**

- Local + prod `/cases/activation` and `/cases` browse (core default) now show labeled content.
- Record in the datasheet/docs: promoted count, agreement split (full vs partial/needsReview),
  the two model ids, RUBRIC_VERSION. Commit doc updates.
