# BriefGen P0 Unblock (stuck `pending` + model upgrade) — Design

**Date:** 2026-07-30 · **Status:** approved (design), implementing · **Domain:** `sst.config.ts` (BriefGen + Web env only)

## Incident

A client demo of the **Legal information assistant** (`/cases/briefings`) hung: the question
*"how many legal success victories for failing to consult with nation by industry"* sat at
**`pending`** forever while the result page kept polling. In the "Recent briefings" list, **every
`done` entry is dated 2026-07-06** — nothing has succeeded in over three weeks.

### Root cause

`BriefGen` is configured at **1536 MB / 120 s** with **`EMBED_PROVIDER: "bedrock"` hardcoded**
(`sst.config.ts`), and its comment still assumes a *"bm25 artifact (~60MB)"*. But
`build-index.ts` gates the vectors download on `wantVectors = isRealProvider()` — and `bedrock`
IS a real provider, so **every cold start downloads the whole dense-vector segment**.

That segment is now **985 MB** (bm25 157.6 MB + vectors 985.0 MB, buildId `1784593544116`), and
loading it costs **three concurrent copies**:

1. S3 `transformToByteArray()` → ~985 MB
2. `Buffer.from(...)` (`build-index.ts:69`) → ~985 MB
3. `loadArtifacts` per-section 4-byte-alignment copy (`artifact.ts:73-78`:
   `const copy = new Uint8Array(s[1]); copy.set(buf.subarray(...))`) → ~985 MB

**Peak ≈ 2.95 GB for vectors + ~470 MB for bm25 + runtime ≈ 3.5 GB, inside a 1536 MB Lambda.**
The process is killed (OOM, or the 120 s timeout during a ~1 GB download).

### Why it shows as `pending`, never `failed`

`briefs/run.ts`'s own comment says it: every catchable failure lands in `setBriefFailed`, and
*"the only re-run path is a **timeout/OOM (uncatchable)**"*. A killed process writes no terminal
state, so the record is stranded at `pending` and the page polls forever. **A stuck `pending` is
therefore diagnostic of an uncatchable kill** — it rules out invoke failure (caught →
`"worker invoke failed"`), Bedrock errors (caught), and governance refusals (→ `failed`).

### Timeline

Vectors grew **301 MB → 979 MB on 2026-07-09** (corpus-wide dense embed backfill), then 984 → 985 MB
via the Yukon/NB index rebuilds. The last successful briefings are 2026-07-06. **The feature has
been broken since ~07-09**, silently, for three weeks. It was flagged as a watch-item at the time
("if cold start OOMs, raise Web/BriefGen memory") and not acted on.

## Decision: BM25-only, not a memory bump

Raising memory to keep dense was considered and **rejected — it is not merely risky, it is
impossible**. `sst.config.ts` (Web block) records the empirical result: loading `vectors.bin`
into a Lambda **"OOMs even at the account's 3008 MB Lambda cap (observed on the ca stage)"**, and
3008 MB *is* this account's cap. With a 3-copy peak of ~3.5 GB, **no available memory tier can hold
it**, and the artifact keeps growing with the corpus.

**P0 therefore turns BriefGen's dense off** (no vectors download at all → bm25 157 MB × 3 ≈ 470 MB,
comfortable) and accepts a temporary retrieval-quality regression. **P1 (separate) is the real
fix:** brief retrieval on **case-level `pvec`** — already maintained for core by
`cases:embed-profiles` and read by `coreSimilarityData()` straight from the table, at
**541 × 1024 × 4 B ≈ 2.2 MB** instead of 985 MB. Case-level is also the right granularity, since a
briefing selects top-6 **cases**, not chunks.

**Honest cost of the regression:** dense is what rescued conceptual questions (measured: conceptual
nDCG@10 0.470 → 0.620, MRR → 1.000; and two conceptual briefing questions went from refused to
grounded when dense was enabled on 2026-07-06). BM25-only makes conceptual refusals more likely
again — partially offset by the model upgrade below, and fully addressed by P1.

## Changes (config only — no application code)

### 1. BriefGen — stop loading the vector artifact

```ts
// Dense is OFF for this worker: the vectors segment is ~985MB and loading it costs three
// concurrent copies (S3 byte array → Buffer.from → the 4-byte-alignment copy in
// artifact.ts), peaking ~3.5GB and killing the process (OOM leaves briefs stranded at
// "pending" — briefs/run.ts cannot catch a kill). BM25-only loads just bm25.bin (~157MB).
// P1 restores the dense signal from core pvec (~2.2MB) instead of the chunk artifact.
EMBED_PROVIDER: process.env.BRIEF_EMBED_PROVIDER ?? "stub",
```

`stub` is safe and degrades gracefully: `isRealProvider()` is false → vectors are never fetched →
`loadArtifacts` leaves `embedderId` null → in `hybridSearch` the `else if (idx.embedderId)` branch
is skipped, `queryVec` stays null → BM25-only ranking. **The stub embedder is never actually
called**, so no stub vectors can enter any comparison.

### 2. BriefGen — headroom

- `timeout: "120 seconds"` → **`"300 seconds"`** (async worker; nobody waits on a request budget,
  and cost accrues only if a run actually takes longer. Claude Sonnet is slower per token than
  Llama 70B.)
- `memory: "1536 MB"` → **`"2048 MB"`** (bm25 is 157 MB today, not the ~60 MB the old comment
  claimed, and it grows with the corpus; the stale comment is corrected in the same edit.)

### 3. Model → Claude Sonnet 4.6, set on **Web** (the one that takes effect) and BriefGen

`BRIEF_MODEL` is currently **set nowhere** in `sst.config.ts`, and it is read in two places:

| Where | Code | Effect |
|---|---|---|
| **Web** (server action) | `actions.ts:43` `model: process.env.BRIEF_MODEL ?? "us.meta.llama3-3-70b-instruct-v1:0"` | **records the model on the brief record** |
| BriefGen (worker) | `run.ts` `const modelId = brief.model ?? BRIEF_MODEL` | uses the **recorded** value; env is only a fallback for older records |

**The recorded value wins**, so setting `BRIEF_MODEL` only on BriefGen would have **no effect**. Set
it on **both**, primarily Web:

```ts
// Claude Sonnet 4.6 via the us. cross-region inference profile. The bare id
// ("anthropic.claude-sonnet-4-6") is REJECTED by Bedrock for on-demand invoke
// ("...isn't supported. Retry with the ID or ARN of an inference profile") — the mistake that
// made us believe for four weeks that this account had no Claude access. There is no "ca."
// geo prefix. See src/lib/rap/bedrock-model.ts, which verified this id from us-east-1 and
// ca-central-1 on 2026-07-16. Cases-domain calls go through Bedrock Converse, whose
// request/response shape is uniform across model families, so no code change is needed.
BRIEF_MODEL: process.env.BRIEF_MODEL ?? "us.anthropic.claude-sonnet-4-6",
```

No IAM change: `bedrockPerms` grants `bedrock:InvokeModel` on `resources: ["*"]`.

**Why the upgrade rides along:** the known failure modes are exactly the ones a stronger model
should improve — strict-JSON adherence (figures extraction still fails ~8% on unparseable JSON),
long/bilingual SCC judgments, and citation accuracy (mis-cited cases are dropped by
`verifyBriefing`, which is what produced the `failed` entries the client saw). Worst case is a
`failed`, never a wrong answer: `parseBriefing` already tolerates prose/fence wrapping (it slices
from the first `{` to the last `}`), and `verifyBriefing` still drops any case id outside the
retrieved set and refuses below 2 distinct precedents.

**Scope note:** only the briefing path moves to Claude. **Batch corpus jobs
(`SUMMARY_MODEL`/`FIGURES_MODEL`/`NATIONS_MODEL`/`LABEL_MODELS`) stay on Llama/Nova** — they run
hundreds to thousands of calls where Sonnet's cost matters, and changing their model id would also
invalidate every entry of the `cachedCall` cache (key = model id + prompt) and force a full re-run.

### 4. Web — flip the dense default to `stub` (same root cause, latent prod bug)

The Web block's comment already states that dense "OOMs even at the account's 3008 MB cap" and that
dense is therefore "opt-in … and OFF where memory can't hold it" — **but its default was
`CASES_EMBED_PROVIDER ?? "bedrock"`, i.e. ON.** The `ca` stage passes `stub` explicitly (per the
notifications runbooks), while **production's `deploy.yml` runs a bare `sst deploy --stage
production` and passes nothing** — so production Web (2048 MB) has been configured for a ~985 MB
load that cannot succeed, since the same 2026-07-09 artifact growth. `/cases` **search** is the
affected surface (browse is unaffected: it uses the GSI1 scan, not the artifact).

Flipping the default to `stub` makes the safe path the default and matches the comment's stated
intent. This is a strict reliability improvement, not a quality trade: at 2048 MB nobody was getting
working dense search — only an OOM or the table-scan fallback.

```ts
EMBED_PROVIDER: process.env.CASES_EMBED_PROVIDER ?? "stub",
```

## Files

| File | Change |
|---|---|
| `sst.config.ts` | **BriefGen:** `EMBED_PROVIDER` → `BRIEF_EMBED_PROVIDER ?? "stub"`, timeout 120→300 s, memory 1536→2048 MB, corrected stale comment, `BRIEF_MODEL`. **Web:** `BRIEF_MODEL` (the one that takes effect) + dense default `"bedrock"` → `"stub"`. |

Unchanged: all application code (`briefs/*`, `build-index.ts`, `artifact.ts`, `repo.dynamo.ts`),
IAM, storage schema, the case-QA path, retrieval for `/cases` search.

## Verification

- **Offline gate:** `npm run typecheck` clean; `npm run build` succeeds (the config change must not
  disturb the app build).
- **Post-deploy (credentialed):** ask 3–5 real questions on prod and confirm they reach `done` in
  well under the old failure mode; check the CloudWatch log line `[index] artifact loaded` shows the
  bm25-only path with **no** vectors fetch; confirm the brief record's `model` reads
  `us.anthropic.claude-sonnet-4-6`. **Pre-generate the demo samples** so the next client demo does
  not depend on a cold start.
- Also spot-check `/cases` **search** on prod after the deploy (it is behind the login gate, so this
  needs a session): with the default flipped to `stub` it should return results without a 500/504.
  **Measure, don't assume** — the pre-fix state was never directly observed, only inferred from the
  configuration plus the recorded "OOMs even at 3008 MB" finding.

## Deferred (explicitly not in P0)

- **P1:** brief retrieval on core `pvec` (restores dense quality at ~2.2 MB) — the real fix.
- **P1:** stuck-brief reaper (mirror `stuck-job-monitor`): `pending` beyond N minutes → `failed`
  with an honest message + quota refund; and stop showing raw `failed`/`pending` to visitors in
  "Recent briefings".
- **P1:** share RAP's `isInvocableModelId` guard with the cases domain so a bare model id fails at
  config time instead of mid-run.
- **P2:** counting-style questions ("how many victories…") — the extractive engine cannot count
  across the corpus by design; steer them to `/cases/activation` + methodology stats rather than
  letting the assistant appear to fail.
- **Monitoring:** the `BriefGenErrors` alarm exists (`sst.config.ts:354`) and an OOM/timeout does
  count as a Lambda `Errors` datapoint — it should have fired three weeks ago. Find out whether it
  fired and where the notification went.

## Success criteria

A logged-in user asks a conceptual question on prod and gets a **published briefing or an honest
`failed`** — never an endless `pending`; BriefGen logs show no vectors download; the brief record
names Claude Sonnet 4.6; typecheck + build clean; no application-code, IAM, or schema change.
