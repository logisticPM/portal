# Showcase posters (Aug 2026)

Research-focused capstone poster — *companion to* the paper
**"Evaluating Decorrelation in LLM Code Review: A Pre-Registered Study."**
Tells both the research story and the client story: the E3 industrial dataset is this
portal (the Indigenomics RAP platform).

## Deliverables (print-ready, A0 vector)
- `poster-landscape.pdf` — A0 landscape (1189×841 mm)
- `poster-portrait.pdf` — A0 portrait (841×1189 mm)

## Sources
- `poster-landscape.html`, `poster-portrait.html` — page layouts (share `poster.css`)
- `poster.css` — design tokens + component styles (from the team's `khoury-cs7980` set)
- `fig-null.svg`, `fig-decorrelation.svg` — the two hero charts (vector, exact paper data)
- `build_render.py` — inlines the SVGs and renders each HTML to A0 PDF via headless Chrome

## Rebuild
```
python3 build_render.py poster-landscape.html
python3 build_render.py poster-portrait.html
```
(Requires Google Chrome. Output PDF is A0 vector with embedded fonts.)

## Provenance / verification
- `VERIFICATION.md` — every number and figure mapped to its Week 13 paper section/table,
  and the client panel mapped to this repo.
- `2026-07-26-revised-research-poster-design.md` — design spec.
- `2026-07-26-revised-research-poster-plan.md` — implementation plan.

All figures use confirmatory Week 13 values (no pilot numbers). The prior Week 9 poster's
"self-consistency rescues" thesis is superseded: the confirmed lever is cross-family
**decorrelation**, which pays on precision.
