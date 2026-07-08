# AI Plain-Language Case Summaries (citation-anchored) — Design

**Date:** 2026-07-03 · **Status:** approved, pre-implementation · **Domain:** `src/lib/cases/ingest` + `src/app/cases`

## Motivation

Client brief, Ideas to Build #2: a searchable legal intelligence interface "with
AI-generated plain-language summaries of each case." Search, filters, and the
citation-anchored display layer are live; the summaries are the missing half. Today
only a handful of enrichment-curated flagships carry `summary: CitationAnchored`;
the ~476 dual-LLM-labeled core cases render with no summary block, so a non-lawyer
reading a core case gets a raw judgment and nothing else.

This is also the deliberate first step of the AI analysis layer (decided 2026-07-03):
batch summaries validate generation quality and the anchoring discipline on this
account's available models (no Claude family) at minimal cost, before the
precedent-to-policy briefing notes (client idea #6, separate spec) reuse the same
foundation online.

## Decisions (from brainstorm)

- **Q1: two specs, summaries first.** #2 (offline batch + existing detail-page
  rendering) ships alone; #6 (online RAG briefing notes) gets its own spec later.
- **Q2: coverage = core tier (482).** Substrate is excluded (unvetted, noisy);
  cases without full text are excluded (nothing to anchor to); flagships with a
  curated summary keep it — the generator never overwrites.
- **Q3: publish directly with a prominent AI label.** Mechanically verified
  summaries go live immediately, badged "AI-generated" with a disclaimer and
  clickable paragraph anchors; a 20–30-claim human spot-check happens after the
  run and is recorded in the Result section. (Mechanical verification guarantees
  the quote is real; the spot-check samples whether the paraphrase distorts it.)

## Architecture

### 1. Generation unit — `src/lib/cases/ingest/summarizer.ts` (new, pure + injectable)

```ts
summarizeCase(c: LegalCase, model: LlmModel): Promise<SummarizeResult>
```

- **Skip rules (checked in order):** existing `c.summary` → `skipped_curated`;
  `corpusTier !== "core"` → `skipped_not_core`; no full text / no chunks →
  `skipped_no_fulltext`.
- **Input assembly (deterministic):** chunks rendered as `[para <id>] <text>`
  lines under a 240,000-character budget (~60k tokens; Llama 3.3 70B holds 128k,
  so most judgments fit whole). If over budget, prioritize: (a) the first 10
  chunks (facts/background), (b) chunks containing tokens of `outcome.holding`,
  (c) chunks matching an economic-keyword list (`compensation, damages, royalt,
  revenue, settlement, $`), then document order until the budget fills.
- **Prompt:** temperature 0, output strictly JSON
  `{ "claims": [{ "text", "quote", "paragraph" }] }` — 3–6 claims, each `text` a
  1–2 sentence plain-language paraphrase (non-lawyer audience, no legalese),
  each `quote` a **verbatim** excerpt from the judgment, `paragraph` the para id
  it came from. Claims must cover: what the dispute was, what the court decided,
  and the economic significance. Parse = first `{` to last `}`; malformed JSON →
  one retry with a corrective suffix appended to the prompt ("Your previous
  output was not valid JSON. Output ONLY the JSON object.") — the suffix changes
  the cache key, so the retry cannot replay the cached bad response; second
  failure → `failed`.
- **Model injection:** takes an `LlmModel` (same interface as the labeler), so
  tests inject a canned-response fake; no network in unit tests, and no new
  `stub:` semantics in `llm.ts`.

### 2. Mechanical verifier (same file, pure function)

For each claim: the normalized `quote` (whitespace collapsed + typographic
punctuation folded symmetrically — quotes/dashes; added in review, cannot admit
letter/digit differences) must appear **verbatim somewhere in the judgment**;
`quote.length >= 15` (normalized); `text` non-empty. The anchor's
`sourceParagraph` is **computed, not model-claimed** (amended 2026-07-05 after
the first operational run: strict cited-paragraph matching dropped ~half of all
honest claims — models misattribute paragraph ids and long quotes span chunk
boundaries). Lookup order: the cited chunk (accepting bare `N` for `para-N`),
then any single chunk, then adjacent-chunk pairs (chunking splits at ~2KB with
no overlap; anchor = first chunk of the pair). A quote found nowhere is dropped
and counted — fabrications still cannot pass. Passing claims become
`CitationAnchor { text, sourceParagraph: <actual location>, sourceUrl:
c.provenance.sourceUrl }`. **Fewer than 2 survivors → `failed`, no summary
written (宁缺毋滥).** More than 6 survivors → keep the first 6 in model output
order.

### 3. Types — `src/lib/cases/types.ts` (additive only)

```ts
export interface SummaryMeta {
  method: "curated" | "llm";
  model?: string;        // e.g. "us.meta.llama3-3-70b-instruct-v1:0"
  generatedAt?: string;  // ISO date
  claimsDropped?: number;
}
// LegalCase gains: summaryMeta?: SummaryMeta;
```

Optional field ⇒ mock fixtures and the `dynamo≡mock` gold standard are untouched.
Curated flagships get no backfilled `summaryMeta`; UI treats absence as curated.

### 4. `llm.ts` — one signature extension

`callProvider`/`converse` gain `opts?: { maxTokens?: number }` (default stays
256; summarizer passes 1024). New export `modelFromId(id: string, opts?):
LlmModel` — returns `{ id, call: (p) => callProvider(id, p, opts) }`, baking the
options into the closure so `LlmModel.call`'s `(prompt) => Promise<string>`
signature and `cachedCall` stay untouched. The batch runner builds its model via
`modelFromId(SUMMARY_MODEL, { maxTokens: 1024 })`. Cache key stays
`sha256(id + "\n" + prompt)` — maxTokens is constant per use-site, so omitting
it from the key is safe. Labeler call sites unchanged.

### 5. Batch runner — `scripts/cases-summarize.ts` (+ npm scripts)

- Iterates core cases from the repo (local dynamo or cloud via `CASES_TABLE` /
  `AWS_REGION`, same pattern as `cases-promote.ts`); applies skip rules; calls
  `summarizeCase` with the model from `SUMMARY_MODEL` (default
  `us.meta.llama3-3-70b-instruct-v1:0` — this account has no Claude family;
  Llama 70B beats Nova Lite on prose and the cost over ~480 cases is negligible).
- LLM responses go through `cachedCall`'s disk cache → idempotent, resumable,
  and the cloud pass replays local answers for free.
- **Write path: `UpdateItem` on the PROFILE item only** (`PK=CASE#<id>`,
  `SK=PROFILE`, `SET summary, summaryMeta`) — never rewrites CHUNK items (the
  promote-wipes-vectors lesson). Themes untouched ⇒ no GSI churn.
- npm scripts: `cases:summarize` (local; sets `BEDROCK_REGION=us-east-1`
  explicitly via cross-env so nothing inherits ca-central-1) and
  `cases:summarize:cloud` (adds `AWS_REGION=us-east-1 CASES_TABLE=LegalCases
  REPO_IMPL=dynamo`).
- Progress every 25 cases; final stats: generated / skipped (by reason) /
  failed ids / total claims kept / dropped.
- Search index untouched: `metaText` excludes summaries ⇒ **no artifact rebuild**.

### 6. Frontend (minimal)

- `src/app/cases/[id]/page.tsx` summary block: when
  `summaryMeta?.method === "llm"`, title gains an "AI-generated · plain language"
  badge and the block footer gains one line: "AI paraphrase — unofficial; verify
  each claim against its anchored paragraph." Claim rendering (already
  citation-anchored) unchanged.
- `src/app/cases/methodology/page.tsx`: one paragraph — how summaries are
  generated, mechanically verified, coverage count, and that curated flagship
  summaries are human-written.

## Testing (offline, TDD)

New `scripts/test-cases-summarizer.ts` (node:assert/strict, async IIFE), fake
`LlmModel`s with canned JSON:

- verifier: valid quote+paragraph passes; fabricated quote dropped; wrong
  paragraph id dropped; whitespace differences still match; `<2` survivors →
  `failed` with no summary; `>6` survivors capped.
- skip rules: curated summary / non-core / no-fulltext each return the right
  status without calling the model.
- parser: malformed JSON retries once then fails; JSON wrapped in prose parses.
- input assembly: over-budget case includes head + holding + economic chunks,
  deterministic output.
- `npm run typecheck` clean; existing tests and `dynamo≡mock` untouched.

## Operational run (credentialed, after code lands)

1. Local: `npm run cases:summarize` over the local corpus (~480 generations,
   serial ~30–60 min, disk-cached; concurrency can be added later if painful).
2. Spot-check: sample 20–30 claims across themes/courts, judge paraphrase
   fidelity (not just quote validity); record pass rate + examples in Result.
3. Cloud: `cases:summarize:cloud` (cache replay, ~free) → prod detail pages.
4. Note: `npm run verify` freshSeed resets the local table (summaries wiped like
   vectors); re-run the script — cache makes it cheap. Cloud table unaffected.

## Governance

Display stays extractive-first: the full-text reader and curated blocks are
unchanged; the AI summary is an **addition**, clearly labeled, never replacing
judgment text. Every claim is anchored to a verbatim, mechanically verified
quote with a source link. Quotes are guaranteed real; paraphrase fidelity is
human-sampled (Q3) — the methodology page says exactly this. Curated (human)
summaries always win over generation. No free-form generation ships anywhere in
this spec.

## Success criteria

- Offline: summarizer tests green with fake models; typecheck clean.
- Credentialed run: ≥90% of eligible core cases get a verified summary
  (`failed` list printed and small); spot-check finds no meaning-distorting
  paraphrase (any found → prompt iteration before cloud replay).
- Prod: core case detail pages show badged plain-language summaries with
  working paragraph anchors; methodology page documents the pipeline.

## Result (operational run, 2026-07-05)

- **Model:** `us.meta.llama3-3-70b-instruct-v1:0` (Converse, temperature 0,
  maxTokens 1024), disk-cached; local table rebuilt from cache first (a prior
  `verify` freshSeed had reset it — the known hazard).
- **First pass (strict cited-paragraph verification): 355/476 generated,
  1,183/2,301 claims dropped.** Diagnosis over cached responses (zero API
  cost): no truncation, no parse failures — the drops were honest quotes with
  wrong pointers: models misattribute paragraph ids (quote verbatim, wrong
  chunk cited), long quotes span no-overlap ~2KB chunk boundaries, and models
  emit bare `N` for `para-N` ids.
- **Verifier amended (§2): anchors are computed, not model-claimed.** Lookup:
  cited chunk → any chunk → adjacent pair. Fabrications still cannot pass —
  the quote must appear verbatim in real judgment text; only the location
  attribution changed (strictly more honest: the [para] link now points where
  the quote actually lives).
- **Final: 467/476 generated (98%) · 1,827 claims kept (avg 3.9/case) ·
  548 dropped (true paraphrases, correctly rejected) · 9 failed** (all
  long-judgment SCC-tier cases where the model paraphrased every "quote":
  2025-scc-4, 2022-nssc-22, 2021-ykca-5, 2020-scc-4, 2018-scc-40, 2013-scc-14,
  2008-scc-41, 2005-scc-43, 1999-1-scr-10 — these correctly show no summary).
- **Spot-check (Q3): PASS.** 38 claims across 10 stratified cases (SCC/FCA/
  BCCA/BCSC/ONCA/FC/TCC, 1973–2024) checked claim-vs-anchored-paragraph: no
  fabrication, no meaning inversion. Weaknesses noted, not blocking: some
  claims anchor to topically-adjacent rather than directly-supporting
  paragraphs; some "significance" claims are generic. Separate corpus finding:
  agreement-none cases with empty themes (e.g. 2008-fc-1390, 2013-onca-683,
  2016-onca-767) are non-Indigenous noise promoted by design — a curation
  backlog item, not a summary defect (their summaries are faithful).
- Known cosmetic: the prompt renders chunk ids as `[para para-N]` (double
  prefix). Fixing it would invalidate the entire response cache for marginal
  gain; the bare-`N` fallback in the verifier absorbs the model confusion.
