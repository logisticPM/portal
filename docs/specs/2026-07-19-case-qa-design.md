# Ask This Judgment (single-case Q&A) — Design

**Date:** 2026-07-19 · **Status:** approved (design), pre-implementation · **Domain:** `src/lib/cases/caseqa/*`, `src/app/cases/[id]/*`, `src/functions/brief-generate.ts`

## Motivation

Borrowed from legal-research tools' "chat with this document," adapted to our DNA: on a case
page, a user asks a question about **that one judgment** and gets a grounded answer whose every
point is a **verbatim quote anchored to a paragraph of the case**. Single-source makes it even
safer than the multi-case briefing — no cross-case fabrication surface — and it reuses the
existing extractive/verification engine.

**Red line:** extractive, paragraph-anchored, **not legal advice**; if the judgment does not
address the question, the assistant **says so** rather than inventing an answer.

## Scope (confirmed)

- Answer shape = **anchored claims list only** (each: plain-language point + verbatim quote +
  paragraph), mirroring the case summary — no free "synthesis" sentence.
- **caseqa subsystem** mirroring `briefs/`; **reuse the BriefGen Lambda** (job-type branch) —
  no new Lambda, **no SST change**.
- Single-turn (no follow-up threads); single case (cross-case is the briefing feature).

## Architecture

### 1. Generation — `src/lib/cases/caseqa/generator.ts` (reuses the summarizer)

```ts
import type { LegalCase, CaseChunk } from "../types";
import type { LlmModel } from "../ingest/llm";
import type { CaseQaAnswer } from "./types";
import { assembleInput, parseClaims, verifyClaims, RETRY_SUFFIX } from "../ingest/summarizer";

export type QaResult =
  | { status: "done"; answer: CaseQaAnswer; dropped: number }
  | { status: "failed"; failReason: string };

export function buildAskPrompt(c: LegalCase, question: string, body: string): string; // see below
export async function answerCaseQuestion(
  c: LegalCase, chunks: CaseChunk[], question: string, model: LlmModel,
): Promise<QaResult>;
```

- `buildAskPrompt` mirrors the summarizer's `buildPrompt` but is **question-conditioned**:
  role = "answer the QUESTION using ONLY this judgment"; **same JSON contract**
  `{"claims":[{"text","quote","paragraph"}]}` (so `parseClaims`/`verifyClaims` apply
  unchanged); rules: 1–6 claims, each `quote` a ≥15-char verbatim excerpt from a `[para <id>]`,
  plain language, no invented facts; **"If the judgment does not address the question, output
  `{"claims":[]}`."**
- `answerCaseQuestion`: `assembleInput(chunks, c.outcome.holding)` (whole judgment under the
  240k budget; long cases auto-select) → `buildAskPrompt` → `model.call` → `parseClaims`
  (cache-safe retry with `RETRY_SUFFIX`) → `verifyClaims(claims, chunks, c.provenance.sourceUrl)`
  → **0 anchors ⇒ `failed("This judgment does not appear to address that question.")`**; empty
  chunks ⇒ failed; unreadable model output ⇒ failed. Otherwise `done` with the verified anchors.
- **All fabrication protection is the summarizer's, unchanged**: a claim survives only if its
  quote appears verbatim (normWs) in a real paragraph; the anchor is the computed location.

### 2. Storage — `src/lib/cases/caseqa/{types,repo}.ts` (mirrors `briefs/`)

```ts
// types.ts  (CaseQaAnswer defined here; generator imports it)
import type { CitationAnchor } from "../types";
export type CaseQaStatus = "pending" | "done" | "failed";
export interface CaseQaAnswer { claims: CitationAnchor[] }
export interface CaseQa {
  id: string; caseId: string; question: string; questionHash: string;
  status: CaseQaStatus; answer?: CaseQaAnswer; failReason?: string; droppedClaims?: number;
  model: string; requester: string; createdAt: string;
}
```

`repo.ts` (Dynamo, `casesDdbDoc`, mirrors briefs; **invisible to the corpus** — `et:"CaseQa"`,
**no GSI1PK**; no GSI2/global listing needed for MVP):
- keys: `caseqa(id)={PK:`CASEQA#${id}`,SK:"CASEQA"}`, `qhash(h)={PK:`CQHASH#${h}`,SK:"CQHASH"}`,
  `quota(date,requester)={PK:`CQUOTA#${date}#${requester}`,SK:"CQUOTA"}`.
- `CASEQA_DAILY_LIMIT = Number(process.env.CASEQA_DAILY_LIMIT ?? 10)`.
- `caseQuestionHash(caseId, question)` = `sha256(caseId + "\n" + normalizeQuestion(question))`
  first 32 hex — **scoped per case** (same question on two cases ⇒ different hash). Reuses
  `normalizeQuestion` from `../briefs/repo`.
- `createCaseQa`, `getCaseQa`, `setCaseQaDone(id, qhash, answer, dropped)` (+ CQHASH pointer),
  `setCaseQaFailed`, `findByCaseQuestionHash`, `bumpCaseQaQuota` (ADD, fail-closed like briefs).

### 3. Runner + worker — `caseqa/run.ts` + reuse `BriefGen`

```ts
// caseqa/run.ts — never throws (every failure → setCaseQaFailed)
export async function runCaseQa(id: string): Promise<void>;
```
`getCaseQa` → guard `status==="pending"` → `dynamoCaseRepo.getCase(caseId)` (returns chunks) →
`cachedModel(modelFromId(qa.model, { maxTokens: 1024 }))` → `answerCaseQuestion(c, c.chunks ?? [],
qa.question, model)` → `setCaseQaDone`/`setCaseQaFailed`.

`src/functions/brief-generate.ts` — add a job-type branch (the only briefing-side change):
```ts
export async function handler(event: { briefId?: string; caseQaId?: string }) {
  if (event?.caseQaId) return void (await runCaseQa(event.caseQaId));
  if (event?.briefId)  return void (await runBriefGeneration(event.briefId));
  console.warn("[worker] invoked without briefId/caseQaId");
}
```
**No SST change**: the Web function already has `BRIEF_FUNCTION_NAME` + invoke perms; BriefGen
already has table + Bedrock access; the caseqa code ships in the same bundle.

### 4. Entry + result — `src/app/cases/[id]/`

- **`ask-actions.ts`** (`"use server"`, mirrors `requestBriefing`): `askCase(formData)` →
  session gate (redirect `/login`) → read `caseId` + `question` (validate 8–400 chars, else
  `?askerr=length`) → `caseQuestionHash` → `findByCaseQuestionHash` (redirect to existing) →
  `bumpCaseQaQuota` (over ⇒ `?askerr=quota`) → `createCaseQa(pending)` → invoke BriefGen with
  `{caseQaId}` (fire-and-forget; local dev without `BRIEF_FUNCTION_NAME` ⇒ inline `runCaseQa`)
  → redirect `/cases/{caseId}?ask={id}`.
- **`[id]/page.tsx`** (extend `searchParams` to `{ q?; ask?; askerr? }`): add an **"Ask this
  judgment"** section — a login-gated form (`action={askCase}`, hidden `caseId`, `textarea`),
  the `askerr` banners, and, when `?ask` is present, load `getCaseQa(ask)` and render:
  - `pending` → `<meta refresh>` auto-poll ("reading the judgment…");
  - `failed` → the honest `failReason`;
  - `done` → the **anchored claims list** (each: `claim.text` + `[{sourceParagraph}]` linking to
    `sourceUrl`, same style as the summary block) under an "Answer — from this judgment" heading.
  - Always: **"Answer drawn only from this judgment · not legal advice"** + reuse
    `isAdviceSeeking(question)` → the advice-deflection banner.
- **Methodology** note: extractive single-source Q&A, verbatim-anchored, refuses when the case
  doesn't address the question.

### Files

| File | Change |
|---|---|
| `src/lib/cases/caseqa/types.ts` | **New.** `CaseQa`, `CaseQaStatus`, `CaseQaAnswer`. |
| `src/lib/cases/caseqa/generator.ts` | **New.** `buildAskPrompt`, `answerCaseQuestion` (reuse summarizer parse/verify/assemble). |
| `src/lib/cases/caseqa/repo.ts` | **New.** keys/hash/quota/CRUD (mirror briefs; reuse `normalizeQuestion`). |
| `src/lib/cases/caseqa/run.ts` | **New.** `runCaseQa`. |
| `src/functions/brief-generate.ts` | Add the `caseQaId` branch. |
| `src/app/cases/[id]/ask-actions.ts` | **New.** `askCase` server action. |
| `src/app/cases/[id]/page.tsx` | Ask box + result render (`?ask`) + `askerr` banners. |
| `src/app/cases/methodology/page.tsx` | Short note. |
| `scripts/test-cases-caseqa.ts` | **New** unit tests. |

Unchanged: `briefs/*` (except none — we only import `normalizeQuestion`), `summarizer.ts`,
`CaseRepo`, SST config, storage schema. No parity impact (caseqa items are `et:"CaseQa"`, no
GSI1PK — invisible to `scanAll`/browse, like briefs).

## Governance / safety

- **Single-source, extractive, anchored** — every claim's quote is verbatim in a real
  paragraph of THIS case (summarizer `verifyClaims`); fabrication cannot pass.
- **Refuses** when nothing verifies ("does not appear to address that question").
- **Not advice** — disclaimer + `isAdviceSeeking` advice-deflection banner.
- Login-gated + per-requester daily quota; same-question cache avoids re-spend.

## Testing (offline, TDD)

`scripts/test-cases-caseqa.ts` (fake models, no network):
- `answerCaseQuestion`: happy path (claims whose quotes are verbatim in the chunks → `done`,
  anchors populated, correct paragraphs); quotes-not-in-text → `failed` ("does not address");
  model returns `{"claims":[]}` → `failed`; unreadable then retry with `RETRY_SUFFIX` → recovers;
  empty chunks → `failed`.
- `buildAskPrompt`: contains the question, the `{"claims"` contract, and the "does not address
  → empty claims" instruction.
- `repo`: `caseQuestionHash` deterministic and **case-scoped** (same question, different caseId
  ⇒ different hash); key shapes (`CASEQA#`/`CQHASH#`/`CQUOTA#`).
- (Anchoring itself is already covered by the summarizer's `verifyClaims` tests.)

Gate: `npx tsx scripts/test-cases-caseqa.ts` passes; `npm run typecheck` clean; `npm run build`
compiles. `verify` (dynamo≡mock) unaffected. Browser spot-check on prod after deploy (login +
a full-text case, e.g. Haida `2004-scc-73`).

## Operational / deploy

- **No credentialed data run.** Ships on the merge deploy. **First deploy creates no new
  resource** (reuses BriefGen); confirm the worker handles both payload shapes in CloudWatch.
- Post-deploy: ask 2–3 real questions on a full-text case; confirm anchored answers + a
  correct refusal on an off-topic question.

## Explicitly NOT doing (YAGNI + red line)

- No multi-turn / follow-up threads (single-shot).
- No cross-case answering (that is the briefing feature).
- No new Lambda / SST resource (reuse BriefGen).
- No synthesis paragraph — anchored claims only.
- No treatment/advice/opinion generation.

## Success criteria

- On a full-text case, a logged-in user asks a question and gets an anchored claims answer
  (verbatim quote + paragraph link) or an honest refusal; off-topic questions refuse rather
  than fabricate; quota + same-question cache work; briefing is untouched and still works.
- `caseqa` unit tests green; typecheck + build clean; no new AWS resource; no ops data run.
