# Enable Production Dense Retrieval (P0-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn on Bedrock query-side dense retrieval in production (Web + BriefGen Lambdas) by decoupling the cases embedder's region and flipping four env vars — no artifact rebuild, no IAM change.

**Architecture:** One code change (a dedicated highest-priority `EMBED_REGION` so cases embedding uses us-east-1 without disturbing RAP extraction's ca-central-1 Bedrock region), then env vars on both functions in `sst.config.ts`. Everything downstream (hybridSearch embed call gated on the query router, `getEmbedder`, `build-index` vector loading) is already wired and the vectors are already in the prod S3 artifact.

**Tech Stack:** TypeScript, AWS Bedrock (Titan Text Embeddings V2), SST, tsx + node:assert/strict.

**Spec:** `docs/specs/2026-07-06-prod-dense-retrieval-design.md` — read it before starting.

---

## Context you must know (read once)

- **Repo root:** `C:\Users\chntw\Documents\7980\demo`. Branch: `feat/prod-dense-retrieval` (Task 1 creates it from `main`, commits spec + plan).
- **Test convention:** standalone `scripts/test-cases-*.ts`, `node:assert/strict`, async IIFE (repo is NOT ESM). Run `npx tsx scripts/<file>.ts`. ALWAYS also `npm run typecheck`.
- **NEVER run `npm run verify`** (freshSeed resets the local corpus DB). This change is additive + env-gated; `dynamo≡mock` is unaffected.
- **The current region line** in `src/lib/cases/search/embedder.ts:142` (inside `getEmbedder`):
  ```ts
  const region = (process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-east-1").trim();
  ```
  This must gain `EMBED_REGION` as the highest-priority source, extracted into a pure testable helper.
- Commit messages: conventional style, NO Co-Authored-By trailer.

---

### Task 1: dedicated `EMBED_REGION` (pure resolver + test)

**Files:**
- Modify: `src/lib/cases/search/embedder.ts`
- Create: `scripts/test-cases-embedder-region.ts`

- [ ] **Step 1: Create the branch + commit docs**

```bash
git checkout main && git pull && git checkout -b feat/prod-dense-retrieval
git add docs/specs/2026-07-06-prod-dense-retrieval-design.md docs/superpowers/plans/2026-07-06-prod-dense-retrieval.md
git commit -m "docs: spec + plan for enabling production dense retrieval"
```

- [ ] **Step 2: Write the failing test** — create `scripts/test-cases-embedder-region.ts`:

```ts
// Region-resolution precedence for the cases embedder (spec 2026-07-06): a
// dedicated EMBED_REGION must win over BEDROCK_REGION (which the Web function
// sets to ca-central-1 for RAP extraction) so cases embedding uses us-east-1.
import assert from "node:assert/strict";

(async () => {
  const { resolveEmbedRegion } = await import("../src/lib/cases/search/embedder");

  // EMBED_REGION wins over everything
  assert.equal(resolveEmbedRegion({ EMBED_REGION: "us-east-1", BEDROCK_REGION: "ca-central-1", AWS_REGION: "eu-west-1" }), "us-east-1");
  // falls back to BEDROCK_REGION when EMBED_REGION absent
  assert.equal(resolveEmbedRegion({ BEDROCK_REGION: "ca-central-1", AWS_REGION: "eu-west-1" }), "ca-central-1");
  // then AWS_REGION
  assert.equal(resolveEmbedRegion({ AWS_REGION: "eu-west-1" }), "eu-west-1");
  // then the us-east-1 default
  assert.equal(resolveEmbedRegion({}), "us-east-1");
  // whitespace trimmed; empty strings ignored in favor of the next source
  assert.equal(resolveEmbedRegion({ EMBED_REGION: "  us-east-1  " }), "us-east-1");
  assert.equal(resolveEmbedRegion({ EMBED_REGION: "   ", BEDROCK_REGION: "ca-central-1" }), "ca-central-1");

  console.log("✅ test-cases-embedder-region passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx tsx scripts/test-cases-embedder-region.ts`
Expected: FAIL — `resolveEmbedRegion` is not exported.

- [ ] **Step 4: Implement in `src/lib/cases/search/embedder.ts`**

Add this exported helper directly above `getEmbedder` (after `isRealProvider`):

```ts
// Region for the cases (query/corpus) embedder. A dedicated EMBED_REGION takes
// priority so it can override the Web function's BEDROCK_REGION=ca-central-1
// (set for RAP extraction) — cases embedding must hit us-east-1, where the
// Titan v2 vectors were written. Empty/whitespace values fall through.
export function resolveEmbedRegion(env: Record<string, string | undefined> = process.env): string {
  for (const v of [env.EMBED_REGION, env.BEDROCK_REGION, env.AWS_REGION]) {
    const t = (v ?? "").trim();
    if (t) return t;
  }
  return "us-east-1";
}
```

Then change the region line inside `getEmbedder` (currently line 142) to:

```ts
    const region = resolveEmbedRegion();
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx tsx scripts/test-cases-embedder-region.ts` → PASS.
Run: `npm run typecheck` → clean.
Run: `npx tsx scripts/test-cases-artifact.ts` → still PASS (sanity: embedder module still imports cleanly for its consumers).

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/search/embedder.ts scripts/test-cases-embedder-region.ts
git commit -m "feat(cases): dedicated EMBED_REGION so cases embedding decouples from extraction region"
```

---

### Task 2: production env on Web + BriefGen (`sst.config.ts`)

**Files:**
- Modify: `sst.config.ts`

- [ ] **Step 1: Read `sst.config.ts`** — locate the `BriefGen` function's `environment` block (contains `CASES_TABLE`, `INDEX_BUCKET`, `BEDROCK_REGION: "us-east-1"`) and the `Web` (`sst.aws.Nextjs`) `environment` block (ends with `EXTRACTOR_FUNCTION_NAME`, `BRIEF_FUNCTION_NAME`; note it spreads `...extractionEnv` which carries `BEDROCK_REGION: "ca-central-1"`).

- [ ] **Step 2: Add the four dense env vars to the BriefGen function's `environment`** (after `BEDROCK_REGION: "us-east-1",`):

```ts
        // Dense retrieval (spec 2026-07-06): query-side Bedrock embedding for
        // hybrid search. Matches the embedder that wrote the vectors so the
        // stored/active embedder ids agree and dense engages. EMBED_REGION pins
        // us-east-1 (where Titan v2 + the vectors live).
        EMBED_PROVIDER: "bedrock",
        EMBED_MODEL: "amazon.titan-embed-text-v2:0",
        EMBED_DIM: "1024",
        EMBED_REGION: "us-east-1",
```

- [ ] **Step 3: Add the same four to the Web function's `environment`** (after `BRIEF_FUNCTION_NAME: briefGen.name,`):

```ts
        // Dense retrieval (spec 2026-07-06). EMBED_REGION=us-east-1 overrides the
        // inherited extractionEnv BEDROCK_REGION=ca-central-1 for cases embedding
        // ONLY — RAP extraction still uses ca-central-1. The query router keeps
        // dense's embed call to conceptual/topical queries; known-item stays BM25.
        EMBED_PROVIDER: "bedrock",
        EMBED_MODEL: "amazon.titan-embed-text-v2:0",
        EMBED_DIM: "1024",
        EMBED_REGION: "us-east-1",
```

(No IAM change: `bedrock:InvokeModel` is already in `bedrockPerms` on both functions. No artifact rebuild: `cases-index/v1/vectors.bin` is already in the bucket; `build-index` loads it once `isRealProvider()` is true.)

- [ ] **Step 4: Verify**

Run: `npm run typecheck` → clean (sst.config.ts is typechecked).

- [ ] **Step 5: Commit**

```bash
git add sst.config.ts
git commit -m "feat(cases): enable dense retrieval env on Web + BriefGen (EMBED_PROVIDER=bedrock, us-east-1)"
```

---

### Task 3: validation sweep

**Files:** none (verification only)

- [ ] **Step 1: Battery**

```bash
npm run typecheck
npx tsx scripts/test-cases-embedder-region.ts
npx tsx scripts/test-cases-artifact.ts
npx tsx scripts/test-cases-route.ts
npx tsx scripts/test-cases-inverted.ts
npm run build
```

Expected: all green; build compiles. Do NOT run `npm run verify`.

- [ ] **Step 2: Spec coverage sweep** — confirm §1 (EMBED_REGION resolver + getEmbedder use) → Task 1, §2 (four env vars on both functions) → Task 2. Confirm no unrelated files changed (`git diff --stat main...HEAD` = embedder.ts + its test + sst.config.ts + docs only).

- [ ] **Step 3: Leave branch ready for PR.**

---

## Post-merge operational verification (NOT part of this plan's tasks; needs AWS credentials)

Per spec: after deploy, ① re-run the two conceptual briefing questions refused on 2026-07-06 (expect them to ground now); ② confirm a conceptual `/cases` search no longer logs `[hybrid] … → BM25-only` in CloudWatch (dense engaged); ③ confirm a citation/case-name query still skips the embed (BM25-only, router by design); ④ record in the spec Result. Rollback if needed = delete the four env vars and redeploy.
