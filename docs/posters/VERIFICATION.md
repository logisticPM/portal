# Poster verification — numbers, figures, credits

Every numeral and figure on `poster-landscape.pdf` / `poster-portrait.pdf` cross-checked
against the Week 13 paper (`CS7980/Week 13/capstone_wip_week_13.pdf`) and the portal repo
(`CS7980/portal/`). Both posters share identical copy and figures, so one table covers both.

## Title & byline
| On poster | Source |
|---|---|
| Subtitle: "Evaluating Decorrelation in LLM Code Review: A Pre-Registered Study" | Paper title page (verbatim) |
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
| "5× the cost" | Table III Cost/TP (0.34 → 1.76 = 5.2×); §IV-A "a 5× premium" |
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
