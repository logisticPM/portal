# Revised Research Poster — Design Spec

**Date:** 2026-07-26
**Assignment:** CS7980 Week 11, Part 3 — Revised Poster (showcase, Aug 10)
**Deliverable:** Two print-ready A0 vector PDFs (one landscape, one portrait) of a
research-focused poster that also tells the client's project story.

---

## Goal

A research-focused poster for the multi-agent code-review study that (a) carries the
final Week 13 confirmatory results, (b) satisfies the assignment's requirement to tell
BOTH the research AND the client's project story, and (c) meets the Part 3 consistency
rules (exact paper title present, byline matches the paper, every number appears in the
paper). Printed at A0 in both landscape and portrait.

## Source of truth (authoritative references)

- **Paper:** `CS7980/Week 13/capstone_wip_week_13.pdf` — *"Evaluating Decorrelation in
  LLM Code Review: A Pre-Registered Study."* All research numbers, the exact title, and
  the byline come from here.
- **Portal repo:** `CS7980/portal/` — the Indigenomics RAP platform = the E3 industrial
  testbed. Client-panel facts (what the platform is, the 30-PR E3 dataset) are grounded
  here.
- **Design language (reuse):** `CS7980/Week 9/khoury-cs7980-code-review-topologies.html`
  (fonts, colors, section/eyebrow/tag styles). Visual reference for the prior revision:
  `CS7980/Week 9/khoury-cs7980-multiagent-code-review_vR.pdf` (its *pilot* numbers are
  superseded — do NOT reuse them).

## Global constraints (bind every part of the build)

- **Exact paper title present, verbatim:** "Evaluating Decorrelation in LLM Code Review:
  A Pre-Registered Study" (subtitle / companion line).
- **Byline matches the paper exactly:** En-Ping Su, Tong Wu, Shiting Huang, Mengshan Li.
  No nicknames unless later requested.
- **Every number on the poster must appear in the Week 13 paper.** No pilot numbers, no
  invented values. The prior poster's per-arm F1 (`.37/.48/.39/.41/.41/.48`) were pilot
  values and are FORBIDDEN here.
- **Client-panel facts must match the portal repo** (platform description, E3 = 30 real PRs).
- **Vector PDF**, text as real text (not rasterized), so it stays crisp at any zoom and
  the docent can read it.
- **One page/image each**, two files: landscape A0 and portrait A0.

## Build pipeline

- **HTML/CSS → vector PDF via headless Chrome** (`--headless --print-to-pdf`), reusing the
  `khoury-cs7980` design system. Two HTML source files share one CSS design layer:
  - `poster-landscape.html` → `@page { size: 1189mm 841mm; margin: 0 }` (A0 landscape)
  - `poster-portrait.html`  → `@page { size: 841mm 1189mm; margin: 0 }` (A0 portrait)
- Sizes/spacing in mm or a proportional root unit so text scales to A0 print (the prior
  posters were authored at a 1920×1080 px canvas; this build targets true A0 mm).
- Fonts embedded/self-hosted so the PDF is self-contained and vector.
- Render check: confirm output PDF page box = A0 (1189×841mm / 841×1189mm) and text is
  selectable (vector), not an image.

## Content — title block

- **Display headline (punchy, decorrelation thesis):** working title
  *"More AI Reviewers Help — Only If Their Mistakes Differ."* (Swappable at review.)
- **Subtitle (exact paper title, italic):** *"Evaluating Decorrelation in LLM Code Review:
  A Pre-Registered Study."*
- **Byline:** En-Ping Su · Tong Wu · Shiting Huang · Mengshan Li
- **Affiliation/advisor/partner line:** Khoury College of Computer Sciences, Northeastern
  University (Vancouver) · Advisor: Yvonne Coady · Industry Partner: Indigenomics
  Institute — Carol Anne Hilton, Founder.

## Content — the seven panels

1. **Motivation / RQ.** Multi-agent code review is proliferating (managers, specialists,
   voters) and priced accordingly. Does the *structure* of collaboration improve review
   quality, or just cost more? Pre-registered on OSF; one frozen model; prompts frozen
   before confirmatory data.
2. **Method — the four-rung ladder.** Agentless (single-pass) → Generalists-3
   (compute-matched sampling) → Hierarchical (manager + deterministic specialists) →
   Consensus (peer debate + vote). Each rung adds exactly one capability; adjacent
   contrasts isolate sampling vs specialization vs communication. Three datasets:
   **E1 Qodo** (99 PRs, 1,188 reviews, injected ground truth), **E2 SWE-PRBench**
   (50 PRs, 600 reviews, human-reviewer agreement), **E3 industrial** (30 PRs, 627
   reviews, corroboration proxies — no oracle).
3. **Hero — two-beat figure (equal billing).**
   - **Left (the null / myth-buster):** bar chart of per-arm semantic F1 across the four
     arms, showing no multi-agent arm beats the single-pass baseline; extra agents buy
     recall at 3–9× the per-review cost. *Per-arm F1 values PULLED from the paper's
     results table (Table III) at build time and verified — not from the pilot poster.*
   - **Right (the positive / decorrelation):** independent model families agree on
     findings that match injected ground truth **89%** of the time vs **54%** for one
     model repeating itself — error decorrelation pays on **precision, not coverage.**
4. **Key findings (confirmatory outcomes).** Specialization is null (p=0.73); communication
   unsupported (Holm p=0.12); cost rises monotonically along the ladder (efficiency
   supported); grounding bounds both at a **≈0.83 recall ceiling** (residue = linter-
   recoverable conventions + an execution-reachable core); self-consistency does NOT
   restore parity (H-verify fails) while cross-family agreement does (H-hetero-precision
   confirmed). *All values verified against the paper.*
5. **Client panel — E3 is the Indigenomics RAP platform.** The team built a live RAP data
   platform for the **Indigenomics Institute**; its **30 real merged PRs** became the E3
   industrial dataset. On unlabeled industrial code the verification relationship reaches
   its **ecological boundary — LLM correctness judges themselves disagree (κ=0.03)** — so
   the decorrelation signal that works on labeled data can't be validated without an
   oracle. This panel is where the research meets the client's real product. Facts checked
   against `portal/`.
6. **Why it matters.** Don't deploy multi-agent review expecting a quality lift; decorrelate
   verifiers (independent model families) for precision; measure benchmark completeness
   (the 0.83 ceiling); treat LLM-judged evaluation on real code as unreliable.
7. **Next steps / open science.** Tool-grounded verifiers (execution + static analysis as a
   correctness oracle); all runs, ablations, and artifacts released for replay.

## Acknowledgements (footer panel)

Lino Coria Mendoza (weekly progress check-ins); at the Indigenomics Institute — Shawn
Anderson (technical point of contact), Eve Marenghi (meeting scheduling), K. Krasnow
Waterman (legal advice); AWS Bedrock compute.

## Layout per orientation

- **Landscape A0:** title band across the top; a 4-column grid below; the two-beat hero
  figure spans the two center columns; client panel occupies the lower-right; acknowledge-
  ments as a thin footer.
- **Portrait A0:** title block at top; a narrowing single-to-double column vertical flow;
  the two-beat figure mid-poster (side-by-side within the width); client panel as a
  full-width band lower down; acknowledgements footer.
- Both share identical copy and figures; only column count and panel placement differ.

## Post-build verification pass (REQUIRED — per user instruction)

After each PDF is generated, before it is called done:
1. **Numbers:** cross-check every numeral on the poster against the Week 13 paper (title,
   byline, p=0.73, 89%/54%, ≈0.83, κ=0.03, 3–9×, 99/50/30 PRs, 1,188/600/627 reviews, and
   the per-arm F1 bar values). Any number not traceable to the paper is removed or fixed.
2. **Figures:** confirm the hero bar chart's per-arm F1 values and ordering match the
   paper's results table, and the decorrelation figures (89% vs 54%) match the text.
3. **Client panel:** confirm the platform description and the E3 = 30-PR claim match the
   portal repo.
4. **Consistency:** exact paper title present verbatim; byline matches the paper byline;
   credit names spelled correctly (Yvonne Coady, Carol Anne Hilton, Shawn Anderson, Eve
   Marenghi, K. Krasnow Waterman, Lino Coria Mendoza).
5. **Vector/size:** PDF page box is A0; text is selectable (vector), not rasterized.

## Deliverables

- `poster-landscape.html`, `poster-portrait.html`, shared CSS.
- `poster-landscape.pdf`, `poster-portrait.pdf` (A0 vector, print-ready).
- Verification notes recording each number's source (paper section/table or portal path).

## Out of scope (YAGNI)

- No dedicated platform screenshots/architecture section (research-focused; the client is
  one panel, framed as E3).
- No animation/interactivity; static print artifacts only.
- No changes to the paper or the portal; this task only consumes them as references.
