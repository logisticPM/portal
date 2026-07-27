# Showcase posters (Aug 2026)

Research-focused capstone poster — *companion to* the paper
**"Evaluating Decorrelation in LLM Code Review: A Pre-Registered Study."**
Tells both the research story and the client story: the E3 industrial dataset is this
portal, and the portal itself is shown via live screenshots.

**Headline:** *More AI Reviewers Don't Help — Decorrelation Does.*

## Deliverables (print-ready, A0 vector)
- `poster-landscape.pdf` — A0 landscape (1189×841 mm)
- `poster-portrait.pdf` — A0 portrait (841×1189 mm)

## Structure (contribution-forward)
Revised after review feedback that the earlier draft "told *what* happened, not *why* it
matters" and spent half the poster on the four architectures:

1. **Title** — plain-language finding + the exact paper title as the companion line.
2. **Contribution banner** — *agreement predicts truth only when reviewers are independent*,
   with 89% vs 54% and the decorrelation figure. This is the visual centre.
3. **01 Problem & motivation** — the client's need and the research question.
4. **02 Approach** — the RAP Data Portal (real screenshots, two lenses) + the four
   architectures demoted to a small *"apparatus, not the finding"* strip with a
   held-constant / pre-registered line.
5. **03 Key results** — structure is null; decorrelation pays on precision; bounded.
6. **04 What the extra agents actually buy** — cost per confirmed finding (0.34 → 1.76).
7. **Impact cards** (field / client / next steps) + acknowledgements.

## Sources
- `poster-landscape.html`, `poster-portrait.html` — page layouts (share `poster.css`)
- `poster.css` — design tokens + components
- `fig-decorrelation.svg`, `fig-null.svg`, `fig-cost.svg` — the three custom charts
  (vector, exact paper data)
- `rap.png`, `legal.png` — live portal screenshots (RAP Index, Legal Cases)
- `build_render.py` — inlines the SVGs and renders each HTML to A0 PDF via headless Chrome

## Rebuild
```
python3 build_render.py poster-landscape.html
python3 build_render.py poster-portrait.html
```
(Requires Google Chrome. Output PDF is A0 vector with embedded fonts.)

## Provenance / verification
- `VERIFICATION.md` — every number and figure mapped to its Week 13 paper section/table,
  the screenshot claims mapped to the captures, and a record of one corrected claim
  (the 5× cost premium is Consensus vs Agentless, not vs Hierarchical).
- `2026-07-26-revised-research-poster-design.md` — design spec.
- `2026-07-26-revised-research-poster-plan.md` — implementation plan.

All figures use confirmatory Week 13 values (no pilot numbers). The Week 9 poster's
"self-consistency rescues" thesis is superseded: the confirmed lever is cross-family
**decorrelation**, which pays on precision.

See also `../gallery/` for the architecture diagrams and the full four-rung ladder figure.
