# Precedent-to-Policy Briefing Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a policy/business question, retrieve the most relevant curated cases and generate a saved, shareable, mechanically-verified briefing note (client idea #6).

**Architecture:** New `src/lib/cases/briefs/` domain module (types + pure generator + Dynamo repo + shared runner), an async worker Lambda mirroring the RAP extraction pattern (env-gated: unset locally → inline synchronous path), and two RSC pages under `/cases/briefings` with zero client JS (meta-refresh polling). Retrieval reuses `dynamoCaseRepo.hybridSearch`; generation reuses `modelFromId`/`cachedModel`/`RETRY_SUFFIX`.

**Tech Stack:** TypeScript, Next.js 14 RSC + server actions, DynamoDB single-table (`LegalCases`), AWS Lambda (SST), Bedrock Converse (Llama 3.3 70B), tsx + node:assert/strict.

**Spec:** `docs/specs/2026-07-05-briefing-notes-design.md` — read it before starting.

---

## Context you must know (read once)

- **Repo root:** `C:\Users\chntw\Documents\7980\demo`. Branch: `feat/briefing-notes` (Task 1 creates it from `main` and commits the spec + this plan).
- **Test convention:** standalone `scripts/test-cases-*.ts`, `node:assert/strict`, async IIFE (repo is NOT ESM). Run `npx tsx scripts/<file>.ts`; ALWAYS also `npm run typecheck` (covers `scripts/` and `src/`). For UI tasks also `npm run build`.
- **NEVER run `npm run verify`** (freshSeed resets the local corpus DB).
- **Storage shape:** items in `LegalCases` keep payload under the `data` attribute; `DATA`, `STATUS`, `COUNT` are DynamoDB reserved words — alias every one (`#d`, `#s`, `#c`). Existing helpers in `src/lib/dynamo/cases-table.ts` (exports `GSI2 = "GSI2"`).
- **Existing seams to reuse (do NOT reimplement):** `dynamoCaseRepo.hybridSearch(q, { tier: "core" })` (`src/lib/cases/repo.dynamo.ts`); `modelFromId`, `cachedModel` (`src/lib/cases/ingest/llm.ts`); `RETRY_SUFFIX`, `normWs` (`src/lib/cases/ingest/summarizer.ts`); `getSession` (`src/lib/auth.ts` — `{ kind, partyId? } | null`); the fire-and-forget invoke pattern in `src/lib/rap/actions.ts:16-24`.
- **⚠ IAM trap:** the Web function's dynamodb permission on `LegalCases` is currently **read-only** (GetItem/Query/Scan). The briefing server action WRITES (brief + quota items) from the Web Lambda — Task 4 MUST extend Web's actions with `dynamodb:PutItem` + `dynamodb:UpdateItem` or prod fails at the first form submit.
- Commits: conventional style, NO Co-Authored-By trailer.

---

### Task 1: briefs types + pure generator

**Files:**
- Create: `src/lib/cases/briefs/types.ts`
- Create: `src/lib/cases/briefs/generator.ts`
- Create: `scripts/test-cases-briefs.ts`

- [ ] **Step 1: Branch + docs commit**

```bash
git checkout main && git pull && git checkout -b feat/briefing-notes
git add docs/specs/2026-07-05-briefing-notes-design.md docs/superpowers/plans/2026-07-05-briefing-notes.md
git commit -m "docs: spec + plan for precedent-to-policy briefing notes"
```

- [ ] **Step 2: Create `src/lib/cases/briefs/types.ts`**

```ts
// THE BRIEFS SEAM. Briefings are user-generated artifacts, deliberately OUTSIDE
// the CaseRepo seam (keeps the dynamo≡mock gold standard untouched).
export type BriefStatus = "pending" | "done" | "failed";
export interface BriefPrecedent { caseId: string; establishes: string; relevance: string }
export interface BriefPrinciple { text: string; caseIds: string[] }
export interface BriefingBody {
  background: string;            // 1-2 sentences framing the question
  precedents: BriefPrecedent[];  // ≥2 after verification, each caseId ∈ retrieved set
  principles: BriefPrinciple[];  // cross-case principles, each caseId valid
  considerations: string;        // what the precedents mean — non-advisory framing
}
export interface Briefing {
  id: string;                    // crypto.randomUUID()
  question: string;              // as asked (trimmed)
  questionHash: string;          // sha256 of the normalized question
  status: BriefStatus;
  body?: BriefingBody;           // when done
  retrievedCaseIds: string[];    // provenance: the top-k retrieval set
  failReason?: string;           // when failed (honest, user-visible)
  droppedPoints?: number;        // verification-dropped precedents/principles
  model: string;
  requester: string;             // "kind" or "kind:partyId"
  createdAt: string;             // ISO timestamp
}
```

- [ ] **Step 3: Write the failing tests** — create `scripts/test-cases-briefs.ts`:

```ts
// Tests for the briefing-notes pipeline (spec 2026-07-05). Offline: fake models.
import assert from "node:assert/strict";

(async () => {
  const { buildBriefContext, buildBriefPrompt, parseBriefing, verifyBriefing, generateBriefing } =
    await import("../src/lib/cases/briefs/generator");
  const { RETRY_SUFFIX } = await import("../src/lib/cases/ingest/summarizer");
  type LM = import("../src/lib/cases/ingest/llm").LlmModel;
  type LC = import("../src/lib/cases/types").LegalCase;

  const mkCase = (id: string, over: Partial<LC> = {}): LC => ({
    id, citation: id.toUpperCase(), styleOfCause: `Nation v. Crown (${id})`,
    court: "SCC", level: "scc", year: 2004, jurisdiction: "CA",
    nations: ["Testwa"], themes: ["duty_to_consult"],
    outcome: { outcomeType: "precedent", winType: "doctrine_win", whoWon: "Nation",
      holding: "The Crown owed a duty to consult before acting." },
    casesCited: [], casesCiting: [], citingCount: 0,
    enrichmentLevel: "index", corpusTier: "core", fullTextAvailable: true,
    summary: { claims: [{ text: "The court required consultation first.", sourceParagraph: "para-1", sourceUrl: "u" }] },
    summaryMeta: { method: "llm" },
    provenance: { source: "a2aj", sourceUrl: "u", upstreamLicense: "open", ingestedAt: "2026-07-05", unofficial: true },
    ...over,
  });
  const cases = [mkCase("case-a"), mkCase("case-b"), mkCase("case-c")];

  // --- context: tagged per case, includes holding + summary claim text; summary-less degrades ---
  const ctx = buildBriefContext(cases);
  assert.ok(ctx.includes("[case case-a]"));
  assert.ok(ctx.includes("duty to consult before acting"));
  assert.ok(ctx.includes("The court required consultation first."));
  const noSum = buildBriefContext([mkCase("case-x", { summary: undefined, summaryMeta: undefined })]);
  assert.ok(noSum.includes("[case case-x]") && noSum.includes("holding:"));
  assert.equal(buildBriefContext(cases), ctx, "deterministic");

  // --- prompt carries question, rules, context ---
  const prompt = buildBriefPrompt("What duties before mining on treaty land?", "CTX-SENTINEL");
  assert.ok(prompt.includes("What duties before mining on treaty land?"));
  assert.ok(prompt.includes("CTX-SENTINEL"));
  assert.ok(prompt.includes('"precedents"'));
  assert.ok(/do NOT give advice/i.test(prompt));

  // --- parser ---
  const goodBody = {
    background: "BG.",
    precedents: [
      { caseId: "case-a", establishes: "Duty to consult.", relevance: "Directly on point." },
      { caseId: "case-b", establishes: "Accommodation follows.", relevance: "Extends the duty." },
    ],
    principles: [{ text: "Consult before acting.", caseIds: ["case-a", "case-b"] }],
    considerations: "The precedents establish consultation obligations.",
  };
  const goodJson = JSON.stringify(goodBody);
  assert.deepEqual(parseBriefing(`intro\n${goodJson}\nout`), goodBody);
  assert.equal(parseBriefing("no json"), null);
  assert.equal(parseBriefing(`{"background":"x","precedents":"nope","principles":[],"considerations":"y"}`), null);
  assert.equal(parseBriefing(`{"background":1,"precedents":[],"principles":[],"considerations":"y"}`), null);

  // --- verifier: hallucinated caseId dropped; principle ids filtered; empty principle dropped ---
  const retrieved = ["case-a", "case-b", "case-c"];
  const withHallucination = {
    ...goodBody,
    precedents: [...goodBody.precedents, { caseId: "1997-fake-99", establishes: "X.", relevance: "Y." }],
    principles: [
      { text: "Real.", caseIds: ["case-a", "1997-fake-99"] },
      { text: "All fake.", caseIds: ["2001-fake-1"] },
    ],
  };
  const v = verifyBriefing(withHallucination, retrieved);
  assert.ok(v);
  assert.equal(v!.body.precedents.length, 2);
  assert.ok(v!.body.precedents.every((p) => retrieved.includes(p.caseId)));
  assert.deepEqual(v!.body.principles, [{ text: "Real.", caseIds: ["case-a"] }]);
  assert.equal(v!.dropped, 2); // 1 fake precedent + 1 all-fake principle

  // --- verifier: <2 surviving precedents → null ---
  const thin = { ...goodBody, precedents: [goodBody.precedents[0], { caseId: "9999-nope-1", establishes: "X.", relevance: "Y." }] };
  assert.equal(verifyBriefing(thin, retrieved), null);

  // --- generateBriefing: happy path ---
  const fake = (responses: string[]): LM & { calls: string[] } => {
    const calls: string[] = [];
    return { id: "fake:brief", calls, call: async (p: string) => { calls.push(p); return responses[Math.min(calls.length - 1, responses.length - 1)]; } };
  };
  let f = fake([goodJson]);
  let r = await generateBriefing("Q?", cases, f);
  assert.equal(r.status, "done");
  if (r.status === "done") { assert.equal(r.body.precedents.length, 2); assert.equal(r.dropped, 0); }
  assert.equal(f.calls.length, 1);

  // --- retry with suffix, then success ---
  f = fake(["NOT JSON", goodJson]);
  r = await generateBriefing("Q?", cases, f);
  assert.equal(r.status, "done");
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[1].endsWith(RETRY_SUFFIX));

  // --- double malformed → failed; hallucination-only → failed; <2 cases → failed without model call ---
  f = fake(["NOT JSON", "STILL NOT"]);
  r = await generateBriefing("Q?", cases, f);
  assert.equal(r.status, "failed");
  const allFake = JSON.stringify({ ...goodBody, precedents: [{ caseId: "fake-1", establishes: "X.", relevance: "Y." }, { caseId: "fake-2", establishes: "X.", relevance: "Y." }] });
  f = fake([allFake]);
  r = await generateBriefing("Q?", cases, f);
  assert.equal(r.status, "failed");
  if (r.status === "failed") assert.ok(r.failReason.length > 0);
  const throwing: LM = { id: "fake:never", call: async () => { throw new Error("must not be called"); } };
  r = await generateBriefing("Q?", [cases[0]], throwing);
  assert.equal(r.status, "failed");

  console.log("✅ test-cases-briefs passed");
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run — must FAIL** (module not found): `npx tsx scripts/test-cases-briefs.ts`

- [ ] **Step 5: Create `src/lib/cases/briefs/generator.ts`**

```ts
// Briefing generation (spec 2026-07-05). Pure + injectable, mirroring the
// summarizer: model passed in, mechanical verification gates the output.
// Governance: the model may cite ONLY retrieved case ids — hallucinated ids are
// dropped; <2 surviving precedents → failed, no briefing (宁缺毋滥).
import type { LegalCase } from "../types";
import type { LlmModel } from "../ingest/llm";
import { RETRY_SUFFIX } from "../ingest/summarizer";
import type { BriefingBody, BriefPrecedent, BriefPrinciple } from "./types";

// Compact per-case context from PROFILE data only (holding + curated fields +
// AI-summary claim texts) — no chunks; ~3-5k tokens for 6 cases.
export function buildBriefContext(cases: LegalCase[]): string {
  return cases.map((c) => [
    `[case ${c.id}] ${c.styleOfCause}, ${c.citation} (${c.court}, ${c.year})`,
    c.themes.length ? `themes: ${c.themes.join(", ")}` : "",
    c.outcome.holding ? `holding: ${c.outcome.holding}` : "",
    c.economic?.economicSummary ? `economic: ${c.economic.economicSummary}` : "",
    c.summary?.claims.length ? `summary: ${c.summary.claims.map((cl) => cl.text).join(" ")}` : "",
  ].filter(Boolean).join(" · ")).join("\n");
}

export function buildBriefPrompt(question: string, context: string): string {
  return `You are preparing a briefing note for policy and business readers WITHOUT legal training, based ONLY on the Canadian court decisions provided below.

QUESTION: ${question}

Produce STRICTLY this JSON (no markdown, no commentary):
{"background":"...","precedents":[{"caseId":"...","establishes":"...","relevance":"..."}],"principles":[{"text":"...","caseIds":["..."]}],"considerations":"..."}

Rules:
- Cite ONLY case ids that appear as [case <id>] below. Never invent a case.
- 2 to 6 precedents. "establishes": what the decision established (1-2 plain sentences). "relevance": why it matters for the question (1 sentence).
- 1 to 4 principles: cross-case principles, each listing its supporting case ids.
- "considerations": 2-4 sentences on what these precedents mean for the question. Describe what the law establishes — do NOT give advice, recommendations, or predictions.
- Plain language. No legalese. No invented facts.

CASES:
${context}`;
}

// Parse: first "{" to last "}", strict shape check; null on any malformation.
export function parseBriefing(raw: string): BriefingBody | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof o.background !== "string" || typeof o.considerations !== "string") return null;
    if (!Array.isArray(o.precedents) || !Array.isArray(o.principles)) return null;
    const precedents: BriefPrecedent[] = o.precedents
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p) => ({ caseId: String(p.caseId ?? ""), establishes: String(p.establishes ?? ""), relevance: String(p.relevance ?? "") }));
    const principles: BriefPrinciple[] = o.principles
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p) => ({ text: String(p.text ?? ""), caseIds: Array.isArray(p.caseIds) ? p.caseIds.map(String) : [] }));
    return { background: o.background, precedents, principles, considerations: o.considerations };
  } catch { return null; }
}

// Mechanical gate: only retrieved case ids survive; principles keep only valid
// ids and are dropped when none remain; <2 surviving precedents → null.
export function verifyBriefing(
  body: BriefingBody, retrievedIds: string[],
): { body: BriefingBody; dropped: number } | null {
  const valid = new Set(retrievedIds);
  const precedents = body.precedents
    .filter((p) => valid.has(p.caseId) && p.establishes.trim() && p.relevance.trim())
    .slice(0, 6);
  const principles = body.principles
    .map((pr) => ({ text: pr.text.trim(), caseIds: pr.caseIds.filter((id) => valid.has(id)) }))
    .filter((pr) => pr.text && pr.caseIds.length > 0);
  const dropped = (body.precedents.length - precedents.length) + (body.principles.length - principles.length);
  if (precedents.length < 2) return null;
  return { body: { ...body, precedents, principles }, dropped };
}

export type GenerateResult =
  | { status: "done"; body: BriefingBody; dropped: number }
  | { status: "failed"; failReason: string };

export async function generateBriefing(question: string, cases: LegalCase[], model: LlmModel): Promise<GenerateResult> {
  if (cases.length < 2) return { status: "failed", failReason: "not enough relevant cases found — try rephrasing" };
  const prompt = buildBriefPrompt(question, buildBriefContext(cases));
  let parsed = parseBriefing(await model.call(prompt));
  // Cache-safe retry: the suffix changes the disk-cache key (summarizer convention).
  if (!parsed) parsed = parseBriefing(await model.call(prompt + RETRY_SUFFIX));
  if (!parsed) return { status: "failed", failReason: "the model could not produce a verifiable briefing for this question" };
  const verified = verifyBriefing(parsed, cases.map((c) => c.id));
  if (!verified) return { status: "failed", failReason: "the model could not produce a verifiable briefing for this question" };
  return { status: "done", body: verified.body, dropped: verified.dropped };
}
```

- [ ] **Step 6: Run tests + typecheck** — `npx tsx scripts/test-cases-briefs.ts` → PASS; `npm run typecheck` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cases/briefs/types.ts src/lib/cases/briefs/generator.ts scripts/test-cases-briefs.ts
git commit -m "feat(briefs): types + pure generator — context, prompt, parse, hallucination gate"
```

---

### Task 2: briefs repo (Dynamo) + question normalization

**Files:**
- Create: `src/lib/cases/briefs/repo.ts`
- Modify: `scripts/test-cases-briefs.ts` (append pure-function tests)

- [ ] **Step 1: Write the failing tests** — append inside the IIFE before the final console.log:

```ts
  const { normalizeQuestion, questionHash, briefKeys } = await import("../src/lib/cases/briefs/repo");

  // normalization: case / whitespace / trailing + typographic punctuation fold together
  const q1 = "What duties before mining on treaty land?";
  assert.equal(normalizeQuestion("  what   DUTIES before mining on treaty land ?? "), normalizeQuestion(q1));
  assert.equal(normalizeQuestion("What duties before mining on treaty land"), normalizeQuestion(q1));
  assert.equal(questionHash("WHAT duties before mining on treaty land?"), questionHash(q1));
  assert.notEqual(questionHash("A different question entirely"), questionHash(q1));
  assert.equal(questionHash(q1).length, 32);

  // key shapes (storage contract)
  assert.deepEqual(briefKeys.brief("abc"), { PK: "BRIEF#abc", SK: "BRIEF" });
  assert.deepEqual(briefKeys.qhash("h1"), { PK: "QHASH#h1", SK: "QHASH" });
  assert.deepEqual(briefKeys.quota("2026-07-05", "company:c-1"), { PK: "BQUOTA#2026-07-05#company:c-1", SK: "BQUOTA" });
```

- [ ] **Step 2: Run — must FAIL**: `npx tsx scripts/test-cases-briefs.ts`

- [ ] **Step 3: Create `src/lib/cases/briefs/repo.ts`**

FIRST verify in `scripts/create-table.ts` that GSI2 is projected `ALL` (it is for GSI1; confirm GSI2 matches — if not, STOP and report). Then:

```ts
// Dynamo access for briefings. Items live in the LegalCases table but are
// invisible to the corpus by construction: no GSI1PK (scanAll scans GSI1), and
// listing rides GSI2 under a dedicated "BRIEF#ALL" partition (no collision with
// WINTYPE#… browse keys). Payload sits under `data` like every other item.
import { createHash } from "node:crypto";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc } from "../../dynamo/client";
import { GSI2 } from "../../dynamo/cases-table";
import { normWs } from "../ingest/summarizer";
import type { Briefing, BriefingBody } from "./types";

const TABLE = process.env.CASES_TABLE ?? "LegalCases";
export const BRIEF_DAILY_LIMIT = Number(process.env.BRIEF_DAILY_LIMIT ?? 10);

export const briefKeys = {
  brief: (id: string) => ({ PK: `BRIEF#${id}`, SK: "BRIEF" }),
  qhash: (h: string) => ({ PK: `QHASH#${h}`, SK: "QHASH" }),
  quota: (date: string, requester: string) => ({ PK: `BQUOTA#${date}#${requester}`, SK: "BQUOTA" }),
};

// Same-question detection: lowercase, fold whitespace/typographic punctuation
// (normWs), strip trailing punctuation. Hash = first 32 hex of sha256.
export function normalizeQuestion(q: string): string {
  return normWs(q).toLowerCase().replace(/[?!.,;:'"\s]+$/g, "");
}
export const questionHash = (q: string): string =>
  createHash("sha256").update(normalizeQuestion(q)).digest("hex").slice(0, 32);

export async function createBrief(b: Briefing): Promise<void> {
  await ddbDoc.send(new PutCommand({
    TableName: TABLE,
    Item: { ...briefKeys.brief(b.id), et: "Brief", GSI2PK: "BRIEF#ALL", GSI2SK: b.createdAt, data: b },
  }));
}

export async function getBrief(id: string): Promise<Briefing | null> {
  const r = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: briefKeys.brief(id) }));
  return (r.Item?.data as Briefing | undefined) ?? null;
}

export async function setBriefRetrieved(id: string, caseIds: string[]): Promise<void> {
  await ddbDoc.send(new UpdateCommand({
    TableName: TABLE, Key: briefKeys.brief(id),
    UpdateExpression: "SET #d.#r = :r",
    ExpressionAttributeNames: { "#d": "data", "#r": "retrievedCaseIds" },
    ExpressionAttributeValues: { ":r": caseIds },
  }));
}

export async function setBriefDone(id: string, body: BriefingBody, droppedPoints: number): Promise<void> {
  await ddbDoc.send(new UpdateCommand({
    TableName: TABLE, Key: briefKeys.brief(id),
    // STATUS is a DynamoDB reserved word — alias every path segment.
    UpdateExpression: "SET #d.#s = :s, #d.#b = :b, #d.#dp = :dp",
    ExpressionAttributeNames: { "#d": "data", "#s": "status", "#b": "body", "#dp": "droppedPoints" },
    ExpressionAttributeValues: { ":s": "done", ":b": body, ":dp": droppedPoints },
  }));
  const brief = await getBrief(id);
  if (brief) {
    await ddbDoc.send(new PutCommand({
      TableName: TABLE,
      Item: { ...briefKeys.qhash(brief.questionHash), et: "BriefQHash", data: { briefId: id } },
    }));
  }
}

export async function setBriefFailed(id: string, failReason: string): Promise<void> {
  await ddbDoc.send(new UpdateCommand({
    TableName: TABLE, Key: briefKeys.brief(id),
    UpdateExpression: "SET #d.#s = :s, #d.#f = :f",
    ExpressionAttributeNames: { "#d": "data", "#s": "status", "#f": "failReason" },
    ExpressionAttributeValues: { ":s": "failed", ":f": failReason },
  }));
}

export async function findByQuestionHash(hash: string): Promise<Briefing | null> {
  const r = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: briefKeys.qhash(hash) }));
  const briefId = (r.Item?.data as { briefId?: string } | undefined)?.briefId;
  return briefId ? getBrief(briefId) : null;
}

// Returns the requester's usage count for the day AFTER incrementing.
export async function bumpQuota(requester: string, date: string): Promise<number> {
  const r = await ddbDoc.send(new UpdateCommand({
    TableName: TABLE, Key: briefKeys.quota(date, requester),
    // COUNT is a DynamoDB reserved word — alias it.
    UpdateExpression: "ADD #c :one",
    ExpressionAttributeNames: { "#c": "count" },
    ExpressionAttributeValues: { ":one": 1 },
    ReturnValues: "UPDATED_NEW",
  }));
  return Number(r.Attributes?.count ?? 0);
}

export async function listRecentBriefs(limit = 20): Promise<Briefing[]> {
  const r = await ddbDoc.send(new QueryCommand({
    TableName: TABLE, IndexName: GSI2,
    KeyConditionExpression: "GSI2PK = :p",
    ExpressionAttributeValues: { ":p": "BRIEF#ALL" },
    ScanIndexForward: false, Limit: limit,
  }));
  return (r.Items ?? []).map((i) => i.data as Briefing);
}
```

- [ ] **Step 4: Run tests + typecheck** — both green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/briefs/repo.ts scripts/test-cases-briefs.ts
git commit -m "feat(briefs): dynamo repo — brief/qhash/quota items, GSI2 listing, question hashing"
```

---

### Task 3: shared runner + async worker

**Files:**
- Create: `src/lib/cases/briefs/run.ts`
- Create: `src/functions/brief-generate.ts`

- [ ] **Step 1: Create `src/lib/cases/briefs/run.ts`**

```ts
// Shared briefing runner — called by the async worker (deployed) and inline by
// the server action (local dev, where there is no 20s request-Lambda limit).
// Never throws: every failure path lands in setBriefFailed so no brief is
// stranded in "pending".
import { dynamoCaseRepo } from "../repo.dynamo";
import { cachedModel, modelFromId } from "../ingest/llm";
import { generateBriefing } from "./generator";
import { getBrief, setBriefDone, setBriefFailed, setBriefRetrieved } from "./repo";

const BRIEF_MODEL = process.env.BRIEF_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0";
const TOP_K = 6;

export async function runBriefGeneration(briefId: string): Promise<void> {
  try {
    const brief = await getBrief(briefId);
    if (!brief || brief.status !== "pending") return;
    // Retrieval over the curated core only (same ranked search as the site).
    const results = await dynamoCaseRepo.hybridSearch(brief.question, { tier: "core" });
    const cases = results.slice(0, TOP_K);
    await setBriefRetrieved(briefId, cases.map((c) => c.id));
    const model = cachedModel(modelFromId(BRIEF_MODEL, { maxTokens: 2048 }));
    const r = await generateBriefing(brief.question, cases, model);
    if (r.status === "done") await setBriefDone(briefId, r.body, r.dropped);
    else await setBriefFailed(briefId, r.failReason);
  } catch (e) {
    console.error("[briefs] generation error:", e);
    await setBriefFailed(briefId, "generation error — please try again").catch(() => {});
  }
}
```

- [ ] **Step 2: Create `src/functions/brief-generate.ts`**

```ts
// Async briefing worker. Invoked fire-and-forget (InvocationType "Event") by the
// requestBriefing server action — generation takes 15-60s, beyond the web
// function's ~20s budget. Function config lives in sst.config.ts ("BriefGen").
import { runBriefGeneration } from "../lib/cases/briefs/run";

export async function handler(event: { briefId?: string }) {
  if (!event?.briefId) return;
  await runBriefGeneration(event.briefId);
}
```

- [ ] **Step 3: Typecheck** — `npm run typecheck` → clean; re-run `npx tsx scripts/test-cases-briefs.ts` → still PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/cases/briefs/run.ts src/functions/brief-generate.ts
git commit -m "feat(briefs): shared runner + async worker handler"
```

---

### Task 4: SST wiring (worker function + Web write perms)

**Files:**
- Modify: `sst.config.ts`

- [ ] **Step 1: Read the file** — locate `bedrockPerms`, `casesIndex`, the `rapExtract` function, and the `Web` block (its `permissions` array contains a read-only dynamodb block on the `LegalCases` table + index ARNs).

- [ ] **Step 2: Add the worker function** AFTER `casesIndex` is defined and BEFORE the Web block:

```ts
    // Async briefing-note generator (spec 2026-07-05). Generation takes 15-60s —
    // beyond the web request Lambda's budget — so the server action invokes this
    // fire-and-forget (same seam as rapExtract). BM25 search artifact resident.
    const briefGen = new sst.aws.Function("BriefGen", {
      handler: "src/functions/brief-generate.handler",
      timeout: "120 seconds",
      memory: "1536 MB", // bm25 artifact (~60MB) + headroom
      link: [casesIndex],
      permissions: [
        ...bedrockPerms,
        // Read the corpus + read/write brief/quota items (same literal-table ARNs
        // as the Web block — copy them, adding PutItem/UpdateItem).
        { actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:PutItem", "dynamodb:UpdateItem"], resources: [/* copy the exact ARN strings/expressions from the Web dynamodb block */] },
      ],
      environment: {
        CASES_TABLE: "LegalCases",
        INDEX_BUCKET: casesIndex.name,
        // Explicit us-east-1: the Llama model lives there; do NOT inherit the
        // extraction stack's ca-central-1.
        BEDROCK_REGION: "us-east-1",
      },
    });
```

Use the SAME resource ARN expressions the Web block already uses for `LegalCases` (read them from the file — do not invent a different ARN format).

- [ ] **Step 3: Extend the Web block:**
  - In `permissions`: (a) add `"dynamodb:PutItem", "dynamodb:UpdateItem"` to the existing LegalCases dynamodb actions array (⚠ the action WRITES brief + quota items from the request Lambda — without this, prod fails on first submit); (b) add `{ actions: ["lambda:InvokeFunction"], resources: [briefGen.arn] }`.
  - In `environment`: add `BRIEF_FUNCTION_NAME: briefGen.name,` with a comment mirroring `EXTRACTOR_FUNCTION_NAME`'s ("Present → requestBriefing hands generation to the worker; unset locally → inline").

- [ ] **Step 4: Typecheck** — `npm run typecheck` → clean (sst.config.ts is typechecked).

- [ ] **Step 5: Commit**

```bash
git add sst.config.ts
git commit -m "feat(briefs): BriefGen worker function + Web write perms and invoke wiring"
```

---

### Task 5: server action + pages + nav + methodology

**Files:**
- Create: `src/app/cases/briefings/actions.ts`
- Create: `src/app/cases/briefings/page.tsx`
- Create: `src/app/cases/briefings/[id]/page.tsx`
- Modify: `src/app/cases/layout.tsx` (nav link)
- Modify: `src/app/cases/methodology/page.tsx` (new section)

Before writing UI, read `src/app/cases/page.tsx` and `src/app/cases/ui.tsx` once to match form/button/badge classes (custom palette: amber/ink/ink2/ink3/line/panel/cedar).

- [ ] **Step 1: Create `src/app/cases/briefings/actions.ts`**

```ts
"use server";
// Briefing request flow (spec 2026-07-05 §3): session gate → validation →
// question-hash cache → daily quota → create pending brief → async worker
// (deployed) or inline generation (local dev) → redirect to the brief page.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import {
  BRIEF_DAILY_LIMIT, bumpQuota, createBrief, findByQuestionHash, questionHash, setBriefFailed,
} from "@/lib/cases/briefs/repo";
import { runBriefGeneration } from "@/lib/cases/briefs/run";

async function invokeBriefWorker(functionName: string, briefId: string) {
  const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
  await new LambdaClient({}).send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: "Event",
    Payload: new TextEncoder().encode(JSON.stringify({ briefId })),
  }));
}

export async function requestBriefing(formData: FormData) {
  const session = getSession();
  if (!session) redirect("/login");
  const question = String(formData.get("question") ?? "").trim();
  if (question.length < 10 || question.length > 500) redirect("/cases/briefings?err=length");
  const requester = session!.partyId ? `${session!.kind}:${session!.partyId}` : session!.kind;

  // Cache: identical (normalized) question → the existing briefing, no spend, no quota.
  const hash = questionHash(question);
  const existing = await findByQuestionHash(hash);
  if (existing) redirect(`/cases/briefings/${existing.id}`);

  const today = new Date().toISOString().slice(0, 10);
  const used = await bumpQuota(requester, today);
  if (used > BRIEF_DAILY_LIMIT) redirect("/cases/briefings?err=quota");

  const id = globalThis.crypto.randomUUID();
  await createBrief({
    id, question, questionHash: hash, status: "pending", retrievedCaseIds: [],
    model: process.env.BRIEF_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0",
    requester, createdAt: new Date().toISOString(),
  });

  const workerFn = process.env.BRIEF_FUNCTION_NAME;
  if (workerFn) {
    // Deployed: fire-and-forget — the brief page polls via meta-refresh.
    try { await invokeBriefWorker(workerFn, id); }
    catch (e) { await setBriefFailed(id, `worker invoke failed: ${e instanceof Error ? e.message : String(e)}`); }
  } else {
    // Local dev: inline (no request-Lambda time limit in `next dev`).
    await runBriefGeneration(id);
  }
  redirect(`/cases/briefings/${id}`);
}
```

- [ ] **Step 2: Create `src/app/cases/briefings/page.tsx`**

```tsx
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { listRecentBriefs } from "@/lib/cases/briefs/repo";
import { requestBriefing } from "./actions";

export const dynamic = "force-dynamic";

export default async function BriefingsPage({ searchParams }: { searchParams?: { err?: string } }) {
  const session = getSession();
  const recent = await listRecentBriefs(20);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Precedent → policy</div>
        <h1 className="font-serif text-3xl">Briefing notes</h1>
        <p className="mt-1 text-sm text-ink3">
          Ask a policy or business question; get a structured note grounded in the curated case
          library. Generates in ~30–60 seconds. <strong>AI-generated · not legal advice.</strong>
        </p>
      </div>

      {searchParams?.err === "quota" && (
        <p className="rounded border border-line bg-amber/10 px-3 py-2 text-sm text-ink2">Daily briefing limit reached — please try again tomorrow.</p>
      )}
      {searchParams?.err === "length" && (
        <p className="rounded border border-line bg-amber/10 px-3 py-2 text-sm text-ink2">Please ask a question between 10 and 500 characters.</p>
      )}

      {session ? (
        <form action={requestBriefing} className="space-y-2">
          <textarea
            name="question" rows={3} required minLength={10} maxLength={500}
            placeholder="e.g. What obligations does a mining company have before operating on treaty land?"
            className="w-full rounded border border-line bg-panel p-3 text-sm"
          />
          <button className="rounded border border-line bg-panel px-4 py-2 text-sm hover:border-amber/50 hover:text-amber">Generate briefing →</button>
        </form>
      ) : (
        <p className="text-sm text-ink3">
          Sign in to generate a briefing (browsing stays open).{" "}
          <Link href="/login" className="text-amber hover:underline">Log in →</Link>
        </p>
      )}

      <section>
        <h2 className="font-serif text-lg">Recent briefings</h2>
        <ul className="mt-2 space-y-1 text-sm text-ink2">
          {recent.map((b) => (
            <li key={b.id}>
              <Link href={`/cases/briefings/${b.id}`} className="hover:text-amber hover:underline">{b.question}</Link>{" "}
              <span className="text-xs text-ink3">· {b.status} · {b.createdAt.slice(0, 10)}</span>
            </li>
          ))}
          {recent.length === 0 && <li className="text-ink3">None yet — ask the first question.</li>}
        </ul>
      </section>
    </div>
  );
}
```

(Adjust the button/badge classes to match what you observed in `src/app/cases/page.tsx` if they differ.)

- [ ] **Step 3: Create `src/app/cases/briefings/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrief } from "@/lib/cases/briefs/repo";
import { repo } from "@/lib/repo"; // NOTE: verify the cases repo import used by src/app/cases/[id]/page.tsx and use the SAME one
import type { LegalCase } from "@/lib/cases/types";

export const dynamic = "force-dynamic";

const STALE_MS = 5 * 60_000;

export default async function BriefingPage({ params }: { params: { id: string } }) {
  const b = await getBrief(params.id);
  if (!b) notFound();

  const stalePending = b.status === "pending" && Date.now() - Date.parse(b.createdAt) > STALE_MS;

  if (b.status === "pending" && !stalePending) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        {/* Browsers honor meta-refresh in the body; keeps the zero-client-JS convention. */}
        <meta httpEquiv="refresh" content="4" />
        <h1 className="font-serif text-2xl">Generating briefing…</h1>
        <p className="text-sm text-ink3">“{b.question}”</p>
        <p className="text-sm text-ink3">Retrieving precedents and drafting — this usually takes 30–60 seconds. The page refreshes automatically.</p>
      </div>
    );
  }

  if (b.status === "failed" || stalePending) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <h1 className="font-serif text-2xl">Briefing unavailable</h1>
        <p className="text-sm text-ink3">“{b.question}”</p>
        <p className="rounded border border-line bg-amber/10 px-3 py-2 text-sm text-ink2">
          {b.failReason ?? "Generation did not complete."}
        </p>
        <Link href="/cases/briefings" className="text-sm text-amber hover:underline">← Ask again</Link>
      </div>
    );
  }

  const body = b.body!;
  const caseMap = new Map<string, LegalCase>();
  const ids = [...new Set([...body.precedents.map((p) => p.caseId), ...body.principles.flatMap((p) => p.caseIds)])];
  for (const c of await Promise.all(ids.map((id) => repo.getCase(id)))) if (c) caseMap.set(c.id, c);
  const nameOf = (id: string) => caseMap.get(id)?.styleOfCause ?? id;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <div className="text-amber text-xs uppercase tracking-widest mb-1">Briefing note</div>
        <h1 className="font-serif text-2xl">{b.question}</h1>
        <p className="mt-2 rounded border border-line bg-amber/10 px-3 py-2 text-xs text-ink2">
          <strong>AI-generated briefing · not legal advice.</strong> Every precedent below links to
          its case page — verify each point there (case summaries carry paragraph-level anchors).
        </p>
      </div>

      <section>
        <h2 className="font-serif text-lg">Background</h2>
        <p className="text-sm text-ink2">{body.background}</p>
      </section>

      <section>
        <h2 className="font-serif text-lg">Precedents</h2>
        <div className="mt-2 space-y-3">
          {body.precedents.map((p) => {
            const c = caseMap.get(p.caseId);
            return (
              <div key={p.caseId} className="rounded border border-line bg-panel p-4">
                <Link href={`/cases/${p.caseId}`} className="font-serif hover:text-amber hover:underline">
                  {c ? `${c.styleOfCause} (${c.court}, ${c.year})` : p.caseId}
                </Link>
                {c && c.themes.length > 0 && <span className="ml-2 text-xs text-ink3">{c.themes.join(" · ")}</span>}
                <p className="mt-1 text-sm text-ink2">{p.establishes}</p>
                <p className="mt-1 text-xs text-ink3">Why it matters here: {p.relevance}</p>
              </div>
            );
          })}
        </div>
      </section>

      {body.principles.length > 0 && (
        <section>
          <h2 className="font-serif text-lg">Principles across the cases</h2>
          <ul className="mt-1 space-y-2 text-sm text-ink2">
            {body.principles.map((pr, i) => (
              <li key={i}>
                {pr.text}{" "}
                <span className="text-xs text-ink3">
                  [{pr.caseIds.map((id, j) => (
                    <span key={id}>{j > 0 && "; "}<Link href={`/cases/${id}`} className="text-amber hover:underline">{nameOf(id)}</Link></span>
                  ))}]
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-serif text-lg">Considerations</h2>
        <p className="text-sm text-ink2">{body.considerations}</p>
      </section>

      <p className="border-t border-line pt-3 text-xs text-ink3">
        Grounded in {b.retrievedCaseIds.length} retrieved cases from the curated core · model: {b.model} ·{" "}
        {b.createdAt.slice(0, 10)} · <Link href="/cases/briefings" className="text-amber hover:underline">all briefings</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Nav + methodology**

(a) `src/app/cases/layout.tsx` — in the nav, after the Activation link:
```tsx
            <Link href="/cases/briefings" className="hover:text-amber">Briefings</Link>
```

(b) `src/app/cases/methodology/page.tsx` — after the "AI plain-language summaries" `<div>`, insert:
```tsx
        <div>
          <h2 className="font-serif text-lg">Briefing notes</h2>
          <p>Briefing notes are generated on demand: a question retrieves the most relevant curated cases (the same ranked search used across the site), and the model may cite <strong>only those retrieved cases</strong> — any invented case reference is mechanically discarded, and a briefing with fewer than two verifiable precedents is refused rather than published. Notes describe what precedents establish, not what a reader should do; they are AI-generated, badged, rate-limited, and <strong>not legal advice</strong>.</p>
        </div>
```

- [ ] **Step 5: Verify** — `npm run typecheck` → clean; `npm run build` → `/cases/briefings` + `/cases/briefings/[id]` compile; `npx tsx scripts/test-cases-briefs.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/cases/briefings src/app/cases/layout.tsx src/app/cases/methodology/page.tsx
git commit -m "feat(briefs): request action, briefing pages, nav + methodology"
```

---

### Task 6: full validation sweep

**Files:** none (verification only)

- [ ] **Step 1: Battery**

```bash
npm run typecheck
npx tsx scripts/test-cases-briefs.ts
npx tsx scripts/test-cases-summarizer.ts
npx tsx scripts/test-cases-label-llm.ts
npx tsx scripts/test-cases-table.ts
npm run build
```
All green. Do NOT run `npm run verify`.

- [ ] **Step 2: Spec coverage sweep** — re-read `docs/specs/2026-07-05-briefing-notes-design.md` §§1–5 + Testing + Governance and confirm each maps to landed code (§1→T1/T2, §2→T3/T4, §3→T5 action, §4→T5 pages, §5 failure handling→T3 catch-all + T5 stale/failed rendering + T5 action guards). Confirm nothing extra was built.

- [ ] **Step 3: Leave branch ready for PR.**

---

## Post-merge operational run (NOT part of this plan; needs AWS credentials)

Per spec "Operational run": ① local inline generations (DynamoDB Local + real Bedrock, `BEDROCK_REGION=us-east-1`, no BRIEF_FUNCTION_NAME) on 3–5 realistic questions; ② fidelity spot-check of every precedent/principle against linked cases → record in spec Result; ③ prod end-to-end (worker path, cache hit, quota); ④ pre-generate 3 showcase briefings for the demo.
