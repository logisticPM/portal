# Handoff — run Wave B Stage 2 (real Bedrock embeddings → hybrid retrieval numbers)

> Forward this file to a teammate with AWS credentials. It is self-contained:
> her Claude Code can execute it start-to-finish and produce the hybrid-vs-BM25
> numbers. Replace `<REPO_PATH>` with wherever her clone of the portal repo lives.
>
> **You are Claude Code. Execute this end-to-end in the `portal` repo. Ask me only if a step hard-blocks.**

## What this is (context — you have none)

This repo has a legal-cases retrieval hub. A retrieval-eval harness already
exists and a **BM25 baseline** is committed (`docs/research/2026-06-30-retrieval-eval-results.md`).
A **real AWS Bedrock embedder** was added (Titan Text Embeddings V2, 1024-d,
L2-normalized). Goal of Stage 2: **compute real embedding vectors over the
corpus, then measure hybrid (BM25 + dense) retrieval vs the BM25 baseline** on
the existing graded gold set, and report the delta (we expect the biggest lift
on natural-language "conceptual" queries).

**Governance (do not violate):** displayed/judged content is extractive and
citation-anchored; relevance judgments are "Claude-as-judge" and must be labeled
as such; never fabricate relevance. This is metadata/eval work only — no
generated legal text.

## Preconditions — verify first, fix if needed

```bash
cd <REPO_PATH>
git checkout main && git pull            # need PR #51 (bedrock embedder) + the eval:bedrock scripts + the concurrency change
npm install                              # pulls @aws-sdk/client-bedrock-runtime
docker compose up -d || npm run ddb:up   # DynamoDB Local on :8000
aws sts get-caller-identity              # MUST print an account/identity. If not: `aws sso login` (or configure creds). Region us-east-1, needs bedrock:InvokeModel on Titan v2.
```

If `aws sts get-caller-identity` fails, STOP and tell the user — everything
below needs live AWS credentials.

## Step 1 — ensure the FULL corpus is loaded (not just fixtures)

`npm run verify` (if it was ever run) resets `LegalCases` to 4 seed fixtures.
Re-load the real corpus (cache-backed, mostly offline, a few minutes):

```bash
npm run cases:ingest && npm run cases:fetch-fulltext
```

Expected end state: ~3,489 cases / ~1,331 full-text / ~39,954 chunk items.
(You'll see the chunk total in Step 2's output — if it says only ~3 chunks, the
corpus isn't loaded; re-run this step.)

## Step 2 — compute real vectors (COSTS a few $ on Bedrock)

```bash
npm run cases:embed:bedrock
# fallback if that script is missing:
# npx cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases EMBED_PROVIDER=bedrock EMBED_MODEL=amazon.titan-embed-text-v2:0 EMBED_DIM=1024 BEDROCK_REGION=us-east-1 tsx scripts/cases-embed.ts
```

Expect: `embedder = bedrock:amazon.titan-embed-text-v2:0 (dim 1024)` and
`embedded <N> · total chunks ~39954`. Idempotent — safe to re-run (skips
already-embedded).

**Speed / `EMBED_CONCURRENCY`.** Titan is one-text-per-call, so the embedder
fans calls out through a bounded worker pool. The default concurrency is **16**,
which takes a full-corpus embed from ~2h down to **~10 min**. Tune it if needed:

```bash
# raise it if your account has a generous Titan requests-per-minute quota:
EMBED_CONCURRENCY=32 npm run cases:embed:bedrock
# lower it if you hit throttling (see guardrails):
EMBED_CONCURRENCY=4  npm run cases:embed:bedrock
```

Concurrency only changes *speed* — the vectors, embedder id, and dim are
identical regardless, so nothing downstream is affected.

## Step 3 — re-pool candidates WITH the dense retriever

The committed gold was pooled from **BM25 only**. Dense will surface relevant
cases BM25 missed; if you don't judge them they count as rel 0 and unfairly
penalize dense. So re-pool:

```bash
npm run cases:eval:pool:bedrock > /tmp/pool-bedrock.json
# fallback: append `--pool` to the raw command above and redirect to the file
```

This prints, per query, the top candidate `caseId`s (BM25 ∪ dense).

## Step 4 — adjudicate the NEW candidates (Claude-as-judge, rubric rel-v1)

Gold file: `docs/research/gold/cases-retrieval-gold.jsonl` (one JSON object per
line: `{qid, query, layer, judgedAt, judge, rubric, judgments:[{caseId, rel, why}]}`).

For each query in `/tmp/pool-bedrock.json`, find candidate `caseId`s **not
already** in that query's `judgments`. For each new one, read the case and grade
it:

```bash
# dump citation/name/court/year + first-chunk snippet for a caseId to judge from:
npx cross-env DYNAMO_ENDPOINT=http://localhost:8000 CASES_TABLE=LegalCases REPO_IMPL=dynamo tsx -e "import('./src/lib/cases').then(async({casesRepo})=>{const c=await casesRepo.getCase(process.argv[1]);console.log(c?.citation,'|',c?.styleOfCause,'|',c?.court,c?.year,'|',(c?.chunks?.[0]?.text||'').slice(0,300));})" <caseId>
```

**Rubric rel-v1:** `2` = on-point authority (the case the query is really asking
for); `1` = materially relevant but secondary; `0` = not relevant (**omit** —
unjudged = 0). When unsure, omit. Add only rel≥1 judgments, each with a short
factual `why`, to that query's `judgments` array. Set `judge:"claude-<model>"`,
`rubric:"rel-v1"`. Do NOT invent relevance; base it on the case
name/citation/holding/first paragraphs.

Then re-run the consistency test:

```bash
npx tsx scripts/test-cases-eval-queries.ts   # must print ✅
```

## Step 5 — measure hybrid vs BM25

```bash
npm run cases:eval:bedrock
# fallback: raw command above WITHOUT --pool
```

Expect the header to say `dense=ON` (if it says `SKIPPED`, the query embedder
id/dim doesn't match the stored vectors — you're not on the bedrock env; use the
`:bedrock` script). Capture the full per-layer + overall table (BM25 vs Hybrid +
Δ nDCG@10).

## Step 6 — write up + commit

- Update `docs/research/2026-06-30-retrieval-eval-results.md` with a "Stage 2
  (hybrid, Bedrock Titan v2)" section: the new table, the Δ vs BM25 per layer,
  and 2–3 sentences of interpretation (did conceptual lift most?). Note gold
  provenance (Claude-as-judge, rubric rel-v1, re-pooled with dense).
- Commit on a branch and open a PR to `main`:

```bash
git checkout -b feat/legal-retrieval-stage2-bedrock
git add docs/research/gold/cases-retrieval-gold.jsonl docs/research/2026-06-30-retrieval-eval-results.md
git commit -m "feat(cases): Wave B Stage 2 — Bedrock hybrid retrieval numbers + re-adjudicated gold

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push -u origin feat/legal-retrieval-stage2-bedrock && gh pr create --base main --fill
```

## Guardrails

- Vectors are only computed for chunks; nothing else changes.
  `searchCases`/`dynamo≡mock` untouched — if you touch repo/query logic, stop.
- The embedder **id + dim must match** between embed and eval (both `bedrock` /
  `amazon.titan-embed-text-v2:0` / 1024) or dense is silently skipped.
- If Bedrock throttles on the full embed, it's rate-limiting — first lower
  `EMBED_CONCURRENCY` (e.g. to 4–8), then re-run (idempotent), it resumes and
  skips already-embedded chunks.
