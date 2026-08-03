# CanLegalRAGBench — Assessment, and Why We Are Not Adopting It

**Date:** 2026-08-03 · **Branch:** `feat/answer-quality-eval` · read-only, no code written

RM-3 has proposed adopting an external benchmark since the roadmap was drafted. The item was
deferred once already, in `2026-07-31-reasoning-first-outcome-design.md:191`, on the narrow
ground that it measures retrieval grounding rather than outcome polarity. This closes it on
its own terms.

**Decision: do not adopt. Its corpus does not cover our domain.** Borrow the instrument design
instead — see `docs/superpowers/specs/2026-08-03-answer-quality-eval-design.md`.

## What it is

[CanLegalRAGBench](https://arxiv.org/abs/2605.30497) (arXiv:2605.30497, 2026-05-28; code
[NLP-UBC/CanLegalRAGBench](https://github.com/NLP-UBC/CanLegalRAGBench), data
`UBC-VL/CanLegalRAGBench`, **MIT**). A Canadian legal QA benchmark whose queries are drawn from
users of public-facing legal assistants and whose reference answers were annotated by human
legal experts. Two evaluation layers: retrieval (recall/precision/MRR/nDCG against ground-truth
citations) and end-to-end answer quality (Ragas groundedness, factual precision).

On paper this was the strongest candidate available: Canadian, expert-labelled, and aimed at
exactly our product shape — a public-facing legal information tool. It is also the only source
of *human* relevance judgment within reach, since this project has no licensed practitioner and
its own gold set is LLM-judged (`docs/research/gold/cases-retrieval-gold.jsonl`, judge
`claude-opus-4-8`).

## The thresholds, declared before looking

- A query is **scoreable** if **≥2** of its ground-truth cases exist in our corpus. Not a
  percentage: with one present gold case, recall@10 is 0 or 1 and maximally noisy.
- An aggregate is **publishable** at **≥30 scoreable queries**. Our own eval is n=18 and
  `2026-08-03-retrieval-eval-production-searcher.md` warns that six-per-layer differences are
  "a direction, not a precise effect size". A smaller external set would be weaker than what we
  already have and already caveat.

Recorded because a threshold set after seeing the data is not a threshold.

## What the sample shows

`datasets-server` `/rows` and `/search` both fail for this dataset (502 / `Unexpected error`),
so sampling went through a direct range download of `documents.json`: **23,147,303 of
53,706,924 bytes (43%)**, yielding **386 complete JSONL records**. Every one carries
`is_ground_truth: true` and `dataset_source: "annotator"` — the file is ground-truth-first, so
this is a large share of the gold set, not a random 23% of rows (1,649 total).

Document schema: `citation · name · original_source · year · text · url · upstream_license ·
is_ground_truth · dataset_source · ground_truth_query_ids`. The join is
`ground_truth_query_ids`; `queries.json` is `{query_id, query_text, answer}`.

| courts (by citation token) | n |
|---|---:|
| SCC | 60 |
| CanLII | 38 |
| BCSC | 22 |
| ABQB | 20 |
| FCA · ONSC | 17 · 17 |
| ABCA | 13 |
| **BCPC · ABPC · ONCJ** | **11 · 11 · 7** |
| FC · ONCA · NLTD | 10 · 9 · 7 |

By decade: 2010s 143 · 2020s 89 · 2000s 85 · 1990s 41 · 1980s 23 · earlier 5.

### Three findings, worst first

**1. Indigenous-subject documents are roughly 1%.** A regex for
`aborigin|indigenous|first nation|métis|treaty right|band council|reserve land|inuit` over
`name` + `citation` + the first 6,000 characters of `text` hit **15 of 386 (3.9%)**. Reading
the 15, most are false positives: `Mylan Pharmaceuticals v AstraZeneca` is patent law,
`Mount Royal University v Faculty Association` is labour, `Vavilov` is administrative
standard-of-review. Genuinely Indigenous in subject: `Wallace v Madawaska Maliseet First
Nation, 2021 CHRT 23` and the `Yukon First Nations Land Claims Settlement Act`.

**2. Part of their ground truth is legislation, not case law.** `SC 1994, c 34` and
`HUMAN RIGHTS CODE, RSBC 1996, c 210, s 27.1` appear as ground-truth records. Our corpus holds
cases only, so those are unmatchable in principle rather than merely absent.

**3. The bench mix is general public law.** Provincial courts — BCPC, ABPC, ONCJ — carry
criminal, traffic and small-claims work. Consistent with the first query in `queries.json`
(`query_id: 792`), which asks whether quitting a part-time job for a summer position will sink
an Employment Insurance claim.

**The ≥30-scoreable-query bar is unreachable.** At ~1% Indigenous-subject documents, against a
corpus of Indigenous-related cases only, the expected number of scoreable queries is
approximately zero. No scoring was attempted, per the pre-registered rule.

## Limits of this evidence

- **386 of 1,649 rows.** Ground-truth-first ordering makes this most of the gold set, but that
  ordering is inferred from the sample, not documented.
- **The regex read only the first 6,000 characters of `text`.** A judgment that reaches
  Indigenous issues later would be missed, so 15 is a lower bound on *mentions*. It does not
  weaken the conclusion, because the 15 were then read individually and most were unrelated.
- **One record of `queries.json` was read.** Subject-matter distribution across their queries
  is not measured here; the courts and the Indigenous-term rate are the evidence.
- Nothing here disputes the benchmark's quality. It is a well-built instrument for Canadian
  public law. The mismatch is ours: a corpus scoped to Indigenous economic justice.

## What is worth keeping

- **Their reported failure rate is a genuine external reference point.** CanLegalRAGBench
  reports **8–29% of claims not supported by the retrieved documents**. Our post-recovery claim
  drop rate is **13.8%** (`2026-08-03-claim-recovery-results.md`). The two are not the same
  measurement — ours counts claims whose quote cannot be located in the source, theirs counts
  claims a judge finds unsupported by retrieved text — but they are the same order of magnitude
  and this is the first external number this project has had to sit beside its own.
- **The paper's own caution against automatic evaluation** applies directly to our LLM-judged
  gold set, and is quoted in the answer-quality spec rather than discovered later.
- **Query style.** Realistic, first-person, non-lawyer questions — the register our own question
  set should adopt, in place of the doctrinal phrasing in `eval-queries.ts`.

## Consequence

RM-3's external-benchmark branch is **closed on evidence**. The remaining sub-projects stand:
expand our own retrieval eval (n=18), and build the answer-quality instrument client question 4
requires. The latter is now the only path to that answer, and it will carry an LLM-judge
limitation that no external dataset is available to remove.
