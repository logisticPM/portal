# Design: three-engine RAP extraction comparison (n=8)

**Date:** 2026-08-06
**Status:** approved design, pending spec review
**Author:** capstone team + Claude

## 1. Purpose

Compare and contrast the three RAP extraction engines on a fixed corpus and
produce a **defensible, reproducible scorecard** plus a written recommendation:
**which engine the client should run on their own AWS account**, where the parent-org
Service Control Policy (SCP) that currently blocks Textract-for-Lambda does not exist.

Deadline context: the team's final deliverable is due in ~1 week, so the design
minimizes human effort and reuses existing scaffolding.

## 2. The three engines (stated precisely)

| # | Engine | Where it runs today | Document reading | Grounding |
|---|--------|--------------------|------------------|-----------|
| 1 | **BDA** — Amazon Bedrock Data Automation | us-east-1 (runtime us-east-1 only) | BDA's own OCR/layout | by **confidence**; page numbers **inferred**; ~20pp cap → auto-chunk |
| 2 | **Bedrock + Textract-LAYOUT** | SSO session, ca-central-1 (SCP blocks Lambda role, not human principals) | Textract LAYOUT (vision over rendered page) → Claude extracts | verbatim **quote + read page** |
| 3 | **Bedrock + text-layer** (current CA deploy) | Lambda, ca-central-1 | PDF embedded glyph text (no AWS text service) → Claude extracts | verbatim **quote + read page** |

**Key interpretive point.** Engines 2 and 3 use the *same* Claude extraction and
differ **only in the document loader**. So "2 vs 3" isolates the loader (Textract
vision vs glyph geometry), while "BDA vs the rest" compares a wholly different
approach. The recommendation leans on this: on the client's unrestricted account
the SCP disappears, so **engine 2 becomes deployable as automated Lambda** — the
text-layer workaround (engine 3) was *only* ever forced by the SCP. The real
client decision is therefore likely **BDA vs Bedrock+Textract**, with text-layer as
the residency-maximizing fallback.

## 3. Corpus (n=8)

All eight are genuine, distinct RAPs with real embedded text layers (verified via
`pdftotext`), located in `CS7980/Week 7/rap_samples/` (outside the portal repo):

| Doc | Pages | Notes |
|-----|-------|-------|
| BankOfCanada_RAP | 17 | **has a human gold set** — the accuracy anchor |
| BCLeg_RAP_2024_2028 | 12 | |
| Populous_Reflect_RAP_2024 | 12 | |
| HydroQuebec_Reconciliation_Strategy | 13 | |
| OPG_Reconciliation_Action_Plan_2021 | 33 | BDA chunking |
| RBC_Pathways_to_Economic_Prosperity_RAP | 35 | BDA chunking |
| Deloitte_Expanding_Horizons_RAP | 41 | BDA chunking |
| ATB_TRAP_2025 | 76 | BDA chunking (largest) |

**Excluded** (not usable as RAPs): Agnico Eagle ESTMA (payment table), FNFA
(finance-committee brief), RBC_first20pp (trimmed duplicate of RBC Pathways).

**Corpus limitation (stated in the report):** every doc has a text layer, so the
corpus **cannot empirically test the text-layer engine's known weakness on scanned
/ image-only PDFs**. That remains a qualitative caveat, not an n=8 result.

## 4. Decision framework

**Balanced scorecard, quality-led, residency-aware.** Final composite weighting:

- **Quality 50%** — precision + recall + grounding fidelity
- **Operational fit 30%** — cost/doc, speed/doc, page-cap/chunking
- **Residency / governance 20%** — data-at-rest + inference geography

The best-accuracy engine wins unless cost or residency is disqualifying.

## 5. Quality measurement (the validity-critical part)

Only Bank of Canada has gold labels; building 8 gold sets in a week is out of
scope. So quality is measured in three tiers, all engine-neutral:

1. **Gold anchor (BoC, n=1, deep).** Run all three engines on BoC; compute true
   commitment **precision and recall** against the existing gold set. Zero new labeling.
2. **Dual-LLM-judge triage (other 7 docs × 3 engines).** Two judges of **different
   families from Claude and from each other** — **Amazon Nova Pro** (Bedrock,
   in-account) and **Kimi K2.5** (OpenRouter) — score each extracted commitment on:
   value-supported, quote-verbatim-present-and-supports, page-correct. Judges
   **agree → auto-label**; **disagree → human worklist**, hard-capped at ~25 items
   (~30–45 min total). Inter-judge agreement (Cohen's κ) is reported (mirrors the
   team's own decorrelation-study method).
3. **Cross-engine agreement (supporting signal, all docs).** A commitment
   corroborated by ≥2 engines is likely real; used to estimate **relative recall**
   (each engine vs the union of all engines' finds) on the non-gold docs.

### Validity guardrails (from the prior invalid comparison — see memory
`concept-card-corpus-and-grounding-validity`, `rap-sample-pdf-corpus`)

- **No engine judges itself.** LLM judges are different families from the Claude
  extractor. Textract is a *page* reference only where it is not the engine under
  test. **BDA page numbers are never used as a reference** (they are inferred, and
  page attribution is a property under test).
- **Absolute counts, never agreement ratios.** A ratio rewards worse recall (a
  setting that recovers less text is easier to agree with).
- **Recall on unlabeled docs is explicitly "relative to union," with the
  shared-blind-spot caveat stated** — a defect all engines miss is invisible here.
- **Honest abstention handling:** an engine correctly finding fewer commitments is
  not punished as hallucination; precision and recall are reported separately.

## 6. Scorecard columns

| Column | How measured | Human cost |
|--------|--------------|-----------|
| Precision | BoC vs gold; other 7 via dual-judge + capped human adjudication | ~25 items |
| Recall | BoC vs gold; other 7 relative-to-union (absolute counts) | 0 |
| Grounding fidelity | % extracted values whose quote is verbatim-present + page correct (Textract page reference where valid; BDA pages flagged inferred) | 0 |
| Cost / doc | estimated from token usage + Textract/BDA page pricing | 0 |
| Speed / doc | wall-clock per run | 0 |
| Page cap / chunking | pages handled before splitting | 0 |
| Scanned robustness | qualitative (corpus cannot test) | 0 |
| Residency | data-at-rest region + inference geography (all inference leaves CA regardless of engine) | 0 |
| Grounding mechanism | verbatim-quote vs confidence | 0 |

## 7. Harness architecture (Approach A — unified offline eval, reuse existing scripts)

New directory `scripts/engine-eval/`:

```
scripts/engine-eval/
  run-bda.ts        # us-east-1: upload to S3, InvokeDataAutomationAsync, chunk >20pp, merge with page offset
  run-textract.ts   # SSO/ca-central-1: Textract LAYOUT → Claude extraction
  run-textlayer.ts  # local/ca: embedded-text loader → Claude extraction
  judge.ts          # Nova Pro + Kimi K2.5 per-commitment scoring
  score.ts          # gold P/R + cross-engine agreement + operational metrics → scorecard.md + worklist.html
results/<doc>/<engine>.json   # raw per-run outputs (grounded commitments + timing + token/page counts)
```

- **Per-engine run phases** keep the three cred/region contexts cleanly separated
  (BDA needs us-east-1; Textract needs an SSO session in ca; text-layer is local).
  Each phase writes normalized JSON so scoring is engine-agnostic.
- **Reuse:** existing `score-extraction-vs-gold.ts`, `build-textract-reference.ts` /
  `fetch-textract-blocks.ts`, `compare-loader-vs-textract.ts`, `pipeline.bda.ts`,
  and the text-layer/Textract loaders.
- **Human worklist:** `worklist.html` renders the ~25 judge-disagreement items
  (source quote, page, both judges' verdicts) with accept/reject controls that
  write back a small JSON; `score.ts` folds those in.
- **No third-party prose committed:** results/ is git-ignored; only the scorecard
  (aggregate numbers) and the committed Textract-reference fixtures live in the repo.

## 8. Deliverables

- This spec: `docs/superpowers/specs/2026-08-06-rap-engine-comparison-design.md`.
- Final report: `docs/rap-engine-comparison.md` — scorecard table + per-engine
  narrative + the client recommendation (renderable to PDF via the existing
  md→PDF pipeline).
- Reproducible harness under `scripts/engine-eval/`.

## 9. Risks and limitations

- **n=1 gold anchor.** True precision/recall is only measured on BoC; the other 7
  lean on judges + agreement. Mitigation: report gold and non-gold tiers separately;
  optionally add one more gold set if time allows.
- **LLM-judge reliability.** The team's own research shows LLM correctness judges
  can disagree badly on unlabeled data (κ=0.03). Mitigation: two families +
  human adjudication of conflicts + report κ; judges never decide alone.
- **Scanned-PDF axis untested** (corpus has no scans) — qualitative note only.
- **BDA page inference** — excluded from the page reference; BDA scored on content,
  flagged on pages.
- **Cost is estimated**, not billed (token/page × published price), for reproducibility.
- **Judge model access is a dependency.** Nova Pro needs Bedrock model access in
  the account (us-east-1); Kimi K2.5 needs an OpenRouter API key. If either is
  unavailable at build time, substitute another non-Claude family from the
  research set (GLM 5 / DeepSeek V3.2) rather than falling back to a Claude judge.

## 10. Out of scope

- Persisting new extracted fields (frameworkRefs etc.) — tracked separately.
- Tuning any engine; this measures the engines as configured.
- Building gold sets for all 8 docs.
