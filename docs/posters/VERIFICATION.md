# Poster verification — numbers, figures, credits

Every numeral and figure on `poster-landscape.pdf` / `poster-portrait.pdf` cross-checked
against the Week 13 paper (`CS7980/Week 13/capstone_wip_week_13.pdf`) and the portal repo
(`CS7980/portal/`). Both posters share identical copy and figures, so one table covers both.

## Revision (2026-07-26) — contribution-forward + project section
Rebuilt per reviewer feedback ("tells *what*, not *why*"): the **contribution** (error
decorrelation is the lever; structure is not) is now a prominent banner; the four
architectures are demoted to a small "experiment — apparatus, not the finding" strip; the
**client project** gets its own presence (portal screenshot, "grounded in" the Institute's
framework, impact-for-client). Structure follows the essential sections (Problem → Approach
→ Key Results → Impact). Headline is a plain-language statement of the finding, not the
academic paper title (design-principle: avoid jargon-only headlines).

## Title & byline
| On poster | Source |
|---|---|
| Headline: "More AI Reviewers Don't Help — Decorrelation Does" | Plain-language statement of the paper's abstract ("communication is not the lever… verification [decorrelation] is") |
| Subtitle (companion line): "Evaluating Decorrelation in LLM Code Review: A Pre-Registered Study" | Paper title page (verbatim) |
| Byline: En-Ping Su, Tong Wu, Shiting Huang, Mengshan Li | Paper byline (verbatim) |

## Numbers → paper location
| Value on poster | Paper source |
|---|---|
| F1: Agentless **0.487**, Generalists-3 **0.357**, Hierarchical **0.378**, Consensus **0.369** | Table III (F1 column) |
| Recall "0.62–0.63 vs 0.50" | Table III R column (0.626/0.624 vs 0.503); §IV-A |
| Recall "0.624 vs 0.626, p=0.73" (specialization null) | §IV-A "Hierarchical ties Generalists-3 on recall (0.624 vs. 0.626; p=0.73)" + Table II |
| "0.487 vs 0.357–0.378; Holm p<0.001" | §IV-A "Agentless dominates … 0.487 vs. 0.357–0.378; all Holm p<0.001" |
| "Consensus does not beat Hierarchical (Holm p=0.12)" | §IV-A "does not (0.536, Holm p=0.12)" |
| "3–9× the calls" | Table III Calls (1 vs 3/3/9); Table III caption "extra agents buy recall at 3–9× the calls" |
| Cost/TP bars **0.34 · 0.45 · 0.50 · 1.76** (fig-cost.svg) | Table III, Cost/TP column (LLM calls per confirmed true positive) |
| "5× more expensive per confirmed finding **than single-pass review**" | §IV-A "0.34 … under Agentless and 1.76 under Consensus, a 5× premium". **Corrected 2026-07-26:** an earlier draft attached "5× the cost" to the *communication* contrast (Consensus vs Hierarchical ≈3.5×); the 5× premium is Consensus vs **Agentless**. Now stated against single-pass only. |
| "2,415 reviews" | Contributions §I (1,188 + 600 + 627) |
| "179 pull requests" | Table I (99 + 50 + 30) |
| "×3 runs each" | §III-A / Table I (three repetitions per architecture) |
| Decorrelation grouped bars — same-model **14/17/54%**, cross-family **28/51/89%** | Fig 2 |
| "89% … 54%" and "+35 pts" | §IV-B "golden-matched 89% of the time versus 54%"; Fig 2 gap "+34 and +35 points" |
| "≈0.83 recall ceiling" | §IV-D "the union … reaches only 0.83 recall … a robust ceiling"; Table IV |
| "κ = 0.03" (industrial boundary) | Abstract + §IV-H "LLM correctness judges themselves disagree (κ=0.03)" |
| Datasets: E1 99 PRs/1,188 reviews; E2 50 PRs/600 reviews; E3 30 PRs/627 reviews | Table I |
| Model "Claude Haiku 4.5" | §III-A / Fig 1 ("SAME MODEL (Claude Haiku 4.5)") |
| Ladder call counts 1 / 3 / 3 / 9 | Fig 1 "Calls per run"; Table III |

Non-data numerals on the poster (`01`–`07` panel numbers, `CS 7980`, `Showcase 2026`,
github handle) are labels, not claims.

## Figures
- `fig-null.svg`: bar heights and value labels equal Table III F1 (0.487/0.357/0.378/0.369);
  dashed reference line at Agentless 0.487; Agentless bar in green (single-pass), multi-agent
  arms in blue. ✔ matches paper.
- `fig-decorrelation.svg`: two series (same-model 14/17/54; cross-family 28/51/89) across
  1/2/3 sources; +35-pt gap bracket at depth 3. ✔ matches Fig 2.

## Portal screenshots (§02 Approach) — real captures, not mocks
`rap.png` and `legal.png` are live screenshots of the deployed portal (supplied 2026-07-26),
browser-framed on the poster. Claims in their captions come from the screenshots themselves:

| Caption claim | Source |
|---|---|
| "106 commitments across 100 organizations, 63% average progress" | RAP Index → *At a glance* tiles (106 / 100 / 63% / 0% confirmed) and the Key-takeaways line |
| "561 Indigenous economic-justice decisions, citation-anchored" | Legal Cases → "561 results · showing 1–10 · browse · **tier: core**" + page subtitle |

⚠️ **Note:** 561 is the **core tier** result count shown in the UI. The `LegalCases` DynamoDB
table holds far more items (chunks/substrate); the gallery diagram's "~43k cases" refers to
table items, not core decisions. Keep the two figures in their own contexts.

## Client panel (Panel 05) → portal repo
- "live RAP data platform … Indigenomics Institute" — confirmed in `portal/` (README/docs
  refer to it as the "RAP Data Portal" / "RAP platform" / Indigenomics). ✔
- "E3 … 30 real merged pull requests, 627 reviews" — Table I (E3 industrial: 30 PRs, 627
  reviews). ✔
- "κ = 0.03" ecological boundary — paper §IV-H. ✔

## Consistency / credit spellings (checked in both PDFs)
- Exact paper title present verbatim. ✔
- Byline matches paper byline. ✔
- Yvonne Coady (not "Coad"); Carol Anne Hilton; Shawn Anderson; Eve Marenghi;
  K. Krasnow Waterman; Lino Coria Mendoza; Indigenomics Institute (not "Indigenomics AI"). ✔
- No forbidden pilot numbers (`0.41`, V0–V3 verifier ladder, "self-consistency filter
  rescues"). ✔

## Format
- Landscape: 3370.08 × 2383.92 pt = **A0 landscape**. Portrait: 2383.92 × 3370.08 pt = **A0 portrait**.
- Both vector: fonts embedded (Helvetica Neue, Palatino); title and chart values extractable
  via `pdftotext` (not rasterized). ✔

**Result: both posters verified consistent with the paper and portal. No discrepancies.**
