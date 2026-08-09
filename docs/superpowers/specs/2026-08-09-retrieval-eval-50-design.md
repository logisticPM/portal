# Retrieval Eval at n=50 — Design

**Date:** 2026-08-09 · **Branch:** `feat/retrieval-eval-50` · closes RM-3 item A.
Supersedes the query set and gold of
[`2026-06-30-retrieval-eval-gold-design.md`](../../specs/2026-06-30-retrieval-eval-gold-design.md);
last results [`2026-08-03-retrieval-eval-production-searcher.md`](../../research/2026-08-03-retrieval-eval-production-searcher.md).

## 1. Why, and why n is the smallest of three problems

The published run states its own weakness: *"n=18. Six queries per layer. A 0.06 difference on six
queries is a direction, not a precise effect size."* True — and two other defects matter more,
because they bias the numbers rather than merely widen them.

**Defect 1 — the pool covers two of the three systems being compared.**
[`cases-eval.ts:119`](../../../scripts/cases-eval.ts) pools `BM25 ∪ hybrid` at K=20 and passes `[]`
for extras; the runner then also scores **routed**. `scoreQuery` grades an unjudged case as
`rel 0` ([`retrieval.ts:13`](../../../src/lib/cases/validate/retrieval.ts)). So any case routed
surfaces that the other two miss is scored zero *whether or not it is relevant*. §4 of the 2026-06-30
spec titles itself "avoid single-system bias" and the implementation does not achieve it for the
system added afterwards. Routed already scores highest (0.492), so the bias understates it — which
makes it easy to ignore and no less wrong.

**Defect 2 — the original judge no longer exists.** Gold is stamped `judge: "claude-opus-4-8"`.
Probed 2026-08-09:

```
no   claude-opus-4-8                 The provided model identifier is invalid.
no   us.anthropic.claude-opus-4-8    ...is not available for this account
```

So the existing 140 judgments **cannot be extended, reproduced, or audited by their own judge**.
"Keep the 18, add 32 with a new judge" would produce a gold whose two halves came from different
and partly unavailable processes. That is not a preference — it removes the option.

**Defect 3 — n=18.**

## 2. What is built

A 50-query set, a pool that covers every system scored, and one gold produced by one currently
invocable judge over all 50.

**Query set — 50, layered 17 / 17 / 16.** The existing 18 are **kept as queries**: they are
well-layered and were written independently of any target document. 32 are added.

New queries are constructed *without reference to a target document*, which is the control that
matters. A query generated **from** the case it is supposed to retrieve inherits that case's
vocabulary, and lexical retrieval then wins for a reason that has nothing to do with retrieval
quality. This is the same failure the answer-quality eval guards with `isLexicalGimme`.

- `known_item` (+11): real neutral citations and party names drawn from the corpus by a seeded
  shuffle. Grounded in documents by definition — a known-item query *is* the citation — so no
  leakage concern. Each must resolve to ≥1 case or it is discarded and redrawn.
- `conceptual` (+11): plain-language questions in the style of the existing six, written from the
  *doctrinal area*, not from any case. Must not contain the doctrinal term of art the target uses.
- `topical` (+10): broad themes from the corpus theme taxonomy plus economic-justice vocabulary.

**Honest label:** these queries are model-written, as the original 18 were. The claim is *not* that
they are human-authored; it is that no query was written while looking at the case it should
retrieve.

**Pool — every scored system, plus the extras the code already promised.**
`BM25 ∪ hybrid ∪ routed` at K=20, plus structured extras the 2026-06-30 comment names and never
wired: same-theme core cases and citation-graph neighbours of already-pooled cases. Extras are
capped so judging cost stays bounded, and the cap is reported.

**Gold — one judge, all 50.** Rubric text is **unchanged** (`rel-v1`: 2 = controlling authority,
1 = materially relevant but secondary, 0 = off-topic). Changing the rubric would break comparability
for no reason; what changed is the judge, and the `judge` field already records that. Stamped
`judge: us.anthropic.claude-opus-4-5-20251101-v1:0`, `judgedAt: 2026-08-09`.

That judge is the answer-quality eval's judge. **Not circular here**: it never sees a ranking, only
(query, case) pairs, and retrieval quality is not what it was used to measure elsewhere.

## 3. Two things reported that the old harness could not

**Judge self-consistency.** A sample of judged pairs is re-judged at a different position in the
worklist and the agreement rate is reported. A gold built by one model with no consistency figure
is a gold whose error bars are unknown. This is a reported number, not a gate.

**Paired effect sizes with uncertainty.** The published run compared aggregate means on 18 queries
and called a 0.068 difference a direction. At n=50 the harness reports **per-query paired deltas**
with a bootstrap 95% CI, and a system difference is described as *supported* only when the CI
excludes 0. Pre-registered now, before any number is seen:

> `routed − hybrid`, `hybrid − bm25`, `routed − bm25` on nDCG@10, each as a paired bootstrap CI over
> the 50 queries. A comparison whose CI includes 0 is reported as **not separated at n=50**,
> whichever way the point estimate falls.

## 4. The comparability break, and how it is decomposed

New gold means the headline numbers are **not** comparable to 2026-08-03. Rather than assert the
break is small, it is measured:

| reported | query set | gold | what it isolates |
| --- | --- | --- | --- |
| published | 18 | old (`claude-opus-4-8`) | the record as it stands |
| **re-scored 18** | 18 | **new** | the effect of the **judge change alone** |
| **headline 50** | 50 | new | the measurement going forward |

The middle row costs nothing extra — it is the same scoring code over a subset — and it is the only
way to say whether a moved number came from the gold or from the larger sample.

## 5. What is explicitly not claimed

- **Not licensed-practitioner judgment.** Every relevance grade is model output. Unchanged from the
  2026-06-30 spec and restated because n=50 makes the numbers look more authoritative than they are.
- **`recall@10` is pooled recall**, not true recall: the denominator is relevant cases *within the
  pool*, so it cannot be compared across runs with different pooling. The old report did not say
  this. It will.
- **Not an answer to client question 4.** This measures whether relevant *cases* surface, not
  whether the generated answer is right.
- Nothing here changes product behaviour.

## 6. Guards

- **Abort rather than score nothing.** `evalAbortReason` already does this; unchanged.
- **A call that fails outright voids the judging run**, as in the sufficiency harness — with
  transient throttles retried first, since judging is ~2,000 calls.
- **Every query must have ≥1 judged case at rel≥1**, or it is reported as a dead query rather than
  silently contributing a zero to every system equally.
- **Re-probe the judge immediately before the judging run.** The cohere incident (2026-08-07) showed
  invocable-at-probe-time does not mean invocable later.

## 7. Cost

50 queries × pool of roughly 40 ≈ **2,000 judge calls**, plus a self-consistency sample. Prompts
carry the query and compact case metadata, not full judgment text, so these are small calls.
Responses are cached, so a re-run replays free.
