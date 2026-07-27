# Showcase artifacts — full number audit

**Date:** 2026-07-26
**Scope:** every numeric claim in `docs/posters/` (landscape + portrait A0) and
`docs/gallery/` (images 01–08).
**Method:** each numeral extracted from the rendered artifacts, then traced to a primary
source — the Week 13 paper (`capstone_wip_week_13.pdf`), the portal's own infrastructure
(`sst.config.ts`, `docs/specs/`), or the live-product screenshots. Claims were re-derived
from source rather than confirmed against earlier working notes.

**Result: 2 errors found and fixed, 1 precision gap closed. All remaining claims verified.**

---

## Errors found and fixed

### 1. LegalCases corpus overstated ~12× (gallery 01, 03)
- **Was:** "~43k cases"
- **Actual:** `docs/specs/2026-07-02-cases-readpath-scale-design.md` — the table holds
  **43,443 items** = ~**3,489** `Case` profiles + ~**39,954** `CaseChunk` items. Of those
  cases, **561** are promoted to the curated **core** tier that browse/search surfaces.
- **Now:** 01 → `~3.5k cases · 43k items`; 03 → `~3.5k cases · 561 core`.
- **Also reconciles** the gallery with the poster's "561 decisions" screenshot caption.

### 2. RAP table count wrong (gallery 01)
- **Was:** "single-table · ×7"
- **Actual:** `sst.config.ts` declares **6** application tables (`DataPortal`, `RapSurvey`,
  `Commitments`, `Alignment`, `Notifications`, `RapData`). The 7th table in the live stage
  listing is `WebRevalidationTable` — Next.js/OpenNext ISR internal, not a RAP data table.
- **Now:** `single-table · ×6`.

### 3. Precision gap — unlabelled dataset scope (poster §03/§04, gallery 08)
The F1 and cost-per-finding figures are **E1-only** (Table III is titled "E1 (Qodo, 99 PRs)")
but were presented without a dataset label, which could read as "across all data." On E2 the
F1 comparison is a four-way tie rather than a single-pass win, so the scope matters.
- **Now:** both figures and gallery 08 carry `E1 · Qodo, 99 PRs`.

---

## Verified — research numbers (source: Week 13 paper)

| Claim | Source |
|---|---|
| 2,415 reviews | Contributions §I; = 1,188 + 600 + 627 (Table I) |
| 179 pull requests | Table I, 99 + 50 + 30 |
| 4 architectures · ×3 runs each | §III-A; Fig. 1 "Three Repetitions Per Architecture" |
| E1 Qodo 99 PRs · E2 SWE-PRBench 50 PRs · E3 industrial 30 PRs | Table I |
| E3 = 627 reviews, no oracle | Table I |
| Model: Claude Haiku 4.5 | §III-A; Fig. 1 held-constant row |
| F1 0.487 / 0.357 / 0.378 / 0.369 | Table III (F1 column) |
| Calls 1 / 3 / 3 / 9 | Table III |
| Cost per confirmed finding 0.34 / 0.45 / 0.50 / 1.76 | Table III (Cost/TP) |
| "5× more expensive … than single-pass" | §IV-A "0.34 … under Agentless and 1.76 under Consensus, a 5× premium" |
| Recall 0.62–0.63 vs 0.50 | §IV-A "reach 0.62–0.63 vs. 0.503" |
| Specialists tie compute-matched sampling, p=0.73 | Table II (H-specialization → Null); §IV-A "0.624 vs. 0.626; p=0.73" |
| Peer debate adds nothing over a manager, Holm p=0.12 | Table II (H-communication → Unsupported, Holm p=0.12) |
| 89% vs 54%, +35 pts | §IV-B; Fig. 2 ("+34 and +35 points") |
| Decorrelation bars 14/17/54 and 28/51/89 | Fig. 2 |
| Recall ceiling ≈0.83 | §IV-D "the union of all eleven configurations … reaches only 0.83 recall (97 PRs) … a robust ceiling" |
| κ = 0.03 | Abstract; §IV-H |
| Gallery 07: functional bug 80/61/43% (n=217) vs rule violation 45/26/18% (n=220) | Fig. 3b |
| Gallery 08: F1-vs-cost scatter | Fig. 3a; values cross-checked to Table III |

## Verified — product numbers (source: live screenshots)

| Claim | Source |
|---|---|
| 106 commitments · 100 organizations · 63% average progress | `rap.png` — RAP Index *At a glance* tiles and Key-takeaways line |
| 561 Indigenous economic-justice decisions | `legal.png` — "561 results · showing 1–10 · browse · **tier: core**" |

## Verified — infrastructure numbers (source: `sst.config.ts`, specs)

| Claim | Source |
|---|---|
| 6 application DynamoDB tables, single-table design | `sst.config.ts` — six `sst.aws.Dynamo(...)` declarations, all `singleTableShape` |
| RapExtract async worker, 900 s timeout | `sst.config.ts` `timeout: "900 seconds"` |
| CaseMonitor `rate(7 days)` | `sst.config.ts` Cron schedule |
| NotifyDigest weekly cron (prod) + institute button | `sst.config.ts` `cron(0 13 ? * MON *)`, prod-gated |
| Titan embeddings v2 | `EMBED_MODEL: amazon.titan-embed-text-v2:0` |
| RapData PITR + stream | `sst.config.ts` `pointInTimeRecovery`, `stream: "new-and-old-images"` |
| LegalCases 43,443 items (3,489 cases + 39,954 chunks); 561 core | `docs/specs/2026-07-02-cases-readpath-scale-design.md`; `docs/specs/2026-06-28-corpus-ingestion-design.md` (two-tier core/substrate model) |

---

## Known scope notes (accurate, but worth knowing if questioned)

- **"No multi-agent arm beats single-pass F1"** is exact on E1 (Holm p<0.001) and holds on
  E2 as a *tie* (0.325 vs 0.329–0.357, all n.s.) — it is a "does not beat" claim, not a
  "loses everywhere" claim.
- **561 vs 3,489 vs 43,443** are three different things (core-tier cases · all case
  profiles · all table items). The poster shows 561 because that is what the product's
  browse UI surfaces; the gallery now states all three.
- **≈0.83** is the union of all eleven configurations, not any single arm's recall.
