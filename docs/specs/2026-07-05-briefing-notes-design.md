# Precedent-to-Policy Briefing Notes (client idea #6) — Design

**Date:** 2026-07-05 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases/briefs` (new) + `src/functions` + `src/app/cases/briefings`

## Motivation

Client brief, Ideas to Build #6 (verbatim): "a 'legal precedent to policy bridge'
automation: a tool that, given a current policy question or corporate decision,
surfaces the most relevant legal precedents from the database and generates a
structured briefing note." Every building block is now live and validated:
hybrid retrieval with query routing (prod search 200), citation-anchored
generation with mechanical verification (467 AI summaries in prod), the Bedrock
Converse client with disk caching, and the badge/disclaimer governance
conventions. This feature assembles them online.

## Decisions (from brainstorm)

- **Q1: generation for all logged-in personas, quota-gated.** Any mock-auth
  session can generate; default 10/day per requester; cache hits don't count.
  Browsing/search stays open as before (reads open, RAG cost gated).
- **Q2: briefings are saved with permanent URLs.** Each generation is stored;
  `/cases/briefings/[id]` is shareable and revisitable; the index page lists
  recent briefings (a public library — sharing is the point); identical
  questions return the existing briefing (cache = product feature).
- **Approach A: async worker mirroring the RAP extraction pattern.** The web
  request Lambda has a ~20s budget; Llama 70B needs 15–40s. Same seam as
  `rap-extract`: env-gated fire-and-forget invoke, and **when the worker env
  var is unset (local dev), the action runs generation synchronously inline**
  (Next dev has no 20s limit) — no local Lambda emulation needed.

## Architecture

### 1. Domain module — `src/lib/cases/briefs/` (new, three files)

**`types.ts`** — the briefs seam:

```ts
export type BriefStatus = "pending" | "done" | "failed";
export interface BriefPrecedent { caseId: string; establishes: string; relevance: string }
export interface BriefPrinciple { text: string; caseIds: string[] }
export interface BriefingBody {
  background: string;               // 1-2 sentences framing the question
  precedents: BriefPrecedent[];     // ≥2, each caseId ∈ retrieved set
  principles: BriefPrinciple[];     // cross-case principles, each caseId valid
  considerations: string;           // implications, non-advisory framing
}
export interface Briefing {
  id: string;                       // crypto.randomUUID()
  question: string;                 // as asked (trimmed)
  questionHash: string;             // sha256 of normalized question (see cache)
  status: BriefStatus;
  body?: BriefingBody;              // present when done
  retrievedCaseIds: string[];       // the top-k retrieval set (provenance)
  failReason?: string;              // present when failed (honest, user-visible)
  droppedPoints?: number;           // verification-dropped precedents/principles (telemetry)
  model: string;
  requester: string;                // "kind" or "kind:partyId" from session
  createdAt: string;                // ISO
}
```

**`generator.ts`** — pure + injectable (the summarizer pattern):

- `buildBriefContext(cases: LegalCase[]): string` — per case:
  `[case <id>] <styleOfCause>, <citation> (<court>, <year>) · themes: … ·
  holding: … · economic: <economicSummary if any> · summary: <claim texts
  joined>`. Cases without a summary degrade to holding-only. Deterministic,
  no chunks (context stays ~3–5k tokens).
- `buildBriefPrompt(question: string, context: string): string` — temperature 0,
  strict JSON matching `BriefingBody`; rules: cite ONLY the provided case ids;
  ≥2 and ≤6 precedents; plain language; `considerations` must describe what the
  precedents establish, NOT give advice or recommendations; no invented facts.
- `parseBriefing(raw: string): BriefingBody | null` — first `{` to last `}`,
  strict shape check (arrays, string fields), null on malformation.
- `verifyBriefing(body: BriefingBody, retrievedIds: string[]): { body: BriefingBody; dropped: number } | null` —
  mechanical gate: drop any precedent whose `caseId ∉ retrievedIds`; drop
  invalid ids from principles' `caseIds` and drop principles left with none;
  after filtering, `precedents.length < 2` → null (generation failed —
  宁缺毋滥). No hallucinated case can survive.
- `generateBriefing(question, cases, model: LlmModel): Promise<{ status: "done"; body; dropped } | { status: "failed"; failReason }>` —
  prompt → parse → one retry with the summarizer's cache-safe `RETRY_SUFFIX`
  convention (suffix changes the cache key) → verify. Pure of I/O; the model is
  injected (tests use fakes; runtime wraps in `cachedModel`).

**`repo.ts`** — DynamoDB access (deliberately NOT part of the `CaseRepo` seam:
briefings are user-generated artifacts, not corpus; keeping them out of the
seam preserves the `dynamo≡mock` gold standard untouched):

- Items in the existing `LegalCases` table: `PK=BRIEF#<id>`, `SK=BRIEF`,
  payload under `data`. **No GSI1PK/GSI2PK** ⇒ invisible to `scanAll`, browse,
  search, and the artifact builder by construction.
- Cache pointer: `PK=QHASH#<questionHash>`, `SK=QHASH`, `data: { briefId }` —
  written when a briefing completes (done only). `normalizeQuestion` =
  lowercase, fold whitespace + typographic punctuation (reuse `normWs`), strip
  trailing punctuation; hash = sha256 hex.
- Quota counter: `PK=BQUOTA#<yyyy-mm-dd>#<requester>`, `SK=BQUOTA`,
  `UpdateItem ADD count 1` returning the new value; limit read from
  `BRIEF_DAILY_LIMIT` (default 10). Cache hits bypass the counter.
- Listing WITHOUT a table scan (the FilterExpression-doesn't-reduce-reads
  lesson): brief items carry `GSI2PK="BRIEF#ALL"`, `GSI2SK=<createdAt ISO>` —
  `listRecentBriefs(limit)` = Query GSI2, `ScanIndexForward: false`. No
  collision with the winType browse (its keys are `WINTYPE#…`), and briefs
  stay invisible to `scanAll` (GSI1-based) by construction.
- `createBrief`, `getBrief`, `setBriefDone` (stores `body` + `droppedPoints`,
  writes the QHASH pointer), `setBriefFailed`, `findByQuestionHash`,
  `bumpQuota`, `listRecentBriefs(limit)`.

### 2. Worker — `src/functions/brief-generate.ts` (mirrors `rap-extract`)

Handler payload `{ briefId: string }`. Loads the brief (question), runs
retrieval `dynamoCaseRepo.hybridSearch(question, { tier: "core" })` → top 6
(the index artifact loads from `INDEX_BUCKET`; BM25-only today — no
`EMBED_PROVIDER` on the worker; dense arrives automatically with P0-2),
`generateBriefing(question, cases, cachedModel(modelFromId(BRIEF_MODEL, { maxTokens: 2048 })))`,
then `setBriefDone` (+ QHASH pointer) or `setBriefFailed`. Any throw →
`setBriefFailed(briefId, "generation error")` in a catch so no brief is
stranded in pending. `BRIEF_MODEL` default `us.meta.llama3-3-70b-instruct-v1:0`.

`sst.config.ts`: `new sst.aws.Function("BriefGen", { timeout: "120 seconds",
memory: "1536 MB" /* bm25 artifact ~60MB resident */, link: [casesIndex],
permissions: bedrockPerms + dynamodb read/write on the LegalCases table ARNs,
environment: { CASES_TABLE: "LegalCases", INDEX_BUCKET: casesIndex.name,
BEDROCK_REGION: "us-east-1" } })`. Web function env gains
`BRIEF_FUNCTION_NAME: briefGen.name` + `lambda:InvokeFunction` on its ARN.
**Explicit `BEDROCK_REGION: "us-east-1"` on the worker** (the ca-central-1
inheritance trap).

### 3. Server action — `src/app/cases/briefings/actions.ts`

`requestBriefing(formData)`: ① `getSession()` — reject if absent; requester =
`kind` or `kind:partyId`. ② validate question (trim, 10–500 chars). ③
`findByQuestionHash` → hit: redirect to the existing briefing (no quota, no
API call). ④ `bumpQuota` → over `BRIEF_DAILY_LIMIT` → redirect back with a
friendly "daily limit reached" message (form page reads it from a query
param). ⑤ `createBrief` (pending). ⑥ `BRIEF_FUNCTION_NAME` set → fire-and-
forget invoke (the RAP `invokeExtractor` pattern, `InvocationType: "Event"`);
unset (local dev) → run the worker's core inline, awaited. ⑦ redirect to
`/cases/briefings/[id]`.

### 4. UI — `src/app/cases/briefings/` (RSC, zero client JS)

- `page.tsx` (index): question form (plain `<form action=…>`) + recent
  briefings list (question, date, status, link). Copy sets expectations:
  "generates in ~30–60 seconds".
- `[id]/page.tsx`: `pending` → "Generating briefing…" + `<meta httpEquiv="refresh" content="4">`
  (RSC-safe auto-refresh, matches the zero-client-JS convention); `failed` →
  honest reason + "ask again" link; `done` → the briefing: question, background,
  precedent cards (styleOfCause, citation, year, theme chips, establishes,
  relevance, link to `/cases/[id]`), principles (each with linked supporting
  cases), considerations, sources list.
- Governance banner on every briefing page: "AI-generated briefing ·
  **not legal advice** · verify every point via the linked cases" — heavier
  than the summary disclaimer, because this is the closest the product comes
  to legal opinion. Precedent claims link to case pages whose own summaries
  carry paragraph-level verified anchors — the anchor unit here is the CASE.
- `src/app/cases/layout.tsx` nav gains "Briefings"; methodology page gains a
  section (retrieval-grounded, case-ids mechanically verified against the
  retrieved set, no free-form legal advice, quota + caching).

### 5. Failure handling

- Retrieval returns <2 core cases → `failed`, reason "not enough relevant
  cases found — try rephrasing".
- Parse fails twice / verification leaves <2 precedents → `failed`, reason
  "the model could not produce a verifiable briefing for this question".
- Worker crash → catch-all `setBriefFailed`; pending older than 5 minutes
  renders as failed in the UI (belt-and-suspenders against a lost invoke).
- Quota / auth rejections happen in the action before any spend.

## Testing (offline, TDD)

`scripts/test-cases-briefs.ts` (node:assert/strict, async IIFE, fake models):
- `verifyBriefing`: hallucinated caseId dropped; principle ids filtered;
  principle with no valid ids dropped; <2 surviving precedents → null; valid
  body passes untouched.
- `parseBriefing`: happy path, prose-wrapped JSON, malformed → null, wrong
  shapes (precedents not array etc.) → null.
- `generateBriefing`: happy path (fake returns valid JSON citing provided
  ids); retry-once semantics with RETRY_SUFFIX; double-malformed → failed;
  hallucination-heavy output → failed with honest reason.
- `buildBriefContext`: with/without summary; deterministic.
- `normalizeQuestion`: case/whitespace/punctuation variants hash equal.
- Repo functions + action flow: typecheck-level + minimal pure-logic tests
  (quota threshold arithmetic); Dynamo paths exercised in the operational run.
- `npm run typecheck`, `npm run build` clean. **`npm run verify` untouched**
  (briefs are outside the CaseRepo seam; if it is run, BRIEF items are
  invisible to it by key design).

## Operational run (after merge; needs AWS credentials)

1. Local: DynamoDB Local + real Bedrock (`BEDROCK_REGION=us-east-1`, no
   BRIEF_FUNCTION_NAME → inline path): generate 3–5 briefings on realistic
   questions (e.g. "What obligations does a mining company have before
   operating on treaty land?"), verify structure/links/quota/cache.
2. Fidelity spot-check (the summaries discipline): read every generated
   precedent/principle against the linked cases; record in Result.
3. Deploy (auto on merge) → prod smoke: generate one briefing end-to-end,
   confirm worker path, cache hit on repeat, quota counter.
4. Pre-generate 3 showcase briefings for the demo (same pipeline, cached).

## Governance

Generation is retrieval-grounded and mechanically gated: only retrieved core
cases can be cited; hallucinated ids cannot survive verification; <2 verified
precedents → no briefing. Content is organizational (what precedents
establish), explicitly not advice, and badged as AI-generated with the
strongest disclaimer in the product. Paragraph-level quote verification lives
one click away on the case pages (the verified summaries). Quota + cache keep
spend bounded; requester recorded per briefing. Curated corpus only (core
tier) — the noise-gated 373.

## Success criteria

- Offline: brief tests green with fakes; typecheck + build clean.
- Local credentialed: ≥3 realistic questions produce structured briefings with
  valid case links; identical re-ask returns the same URL instantly; 11th
  request of the day politely refused.
- Prod: end-to-end generation via the worker in ≤90s; shareable URL renders
  for a different session; methodology documents the pipeline.
