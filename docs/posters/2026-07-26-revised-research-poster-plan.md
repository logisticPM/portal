# Revised Research Poster — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce two print-ready A0 vector PDFs (landscape + portrait) of a research-focused poster for *"Evaluating Decorrelation in LLM Code Review"* that also tells the Indigenomics Institute client story, with every number verified against the Week 13 paper.

**Architecture:** Two HTML files (`poster-landscape.html`, `poster-portrait.html`) share one CSS design layer (`poster.css`) and two inline-SVG figures. Rendered to A0 vector PDF via headless Chrome `--print-to-pdf`, which honors `@page { size: … }`. A final verification task cross-checks every numeral/figure/credit against `capstone_wip_week_13.pdf` and the `portal/` repo.

**Tech Stack:** HTML5 + CSS (self-hosted system fonts), inline SVG for charts, headless Google Chrome for PDF rendering, `pdffonts`/`pdftotext`/`mdls` for PDF verification.

**Working directory:** `/Users/eps/Desktop/Work/NEU/Summer 2026/CS7980/Week 13/poster/`

## Global Constraints

- Exact paper title verbatim on the poster (subtitle): **"Evaluating Decorrelation in LLM Code Review: A Pre-Registered Study"**.
- Byline verbatim, matches paper: **En-Ping Su, Tong Wu, Shiting Huang, Mengshan Li** (no nicknames).
- Every number must appear in `capstone_wip_week_13.pdf`. FORBIDDEN pilot values (from the old `_vR` poster): `.37/.48/.39/.41/.41/.48` and any "V0–V3 verifier ladder". This poster's story is decorrelation, not self-consistency.
- Advisor spelled **Yvonne Coady**; partner **Indigenomics Institute**; founder **Carol Anne Hilton**; acknowledgements: **Lino Coria Mendoza, Shawn Anderson, Eve Marenghi, K. Krasnow Waterman**; **AWS Bedrock** compute.
- Output PDFs must be **A0** (landscape 1189×841 mm; portrait 841×1189 mm) and **vector** (selectable text, embedded fonts) — not rasterized.
- One page per file; two files total.
- Design tokens (from `Week 9/khoury-cs7980-code-review-topologies.html`): `--paper:#EEF1EB; --ink:#16201B; --muted:#57665D; --faint:#7C8A81; --line:#D6DCD0; --line2:#C4CCBD; --blue:#2C5F82; --green:#1B6A52;` accent maroon `#8A1A2B` for the thesis fragment + section numbers. Fonts: display=Helvetica Neue; serif=Palatino Linotype; mono=SF Mono.

### Verified content (copy verbatim; all traceable to the paper)

**Title block**
- Headline: `More AI Reviewers Help — Only If Their Mistakes Differ` (the "— Only If Their Mistakes Differ" fragment in maroon italic).
- Subtitle (exact paper title, italic).
- Byline + `Khoury College of Computer Sciences, Northeastern University · Vancouver, Canada · Advisor: Yvonne Coady · Industry Partner: Indigenomics Institute (Carol Anne Hilton, Founder)`.

**Panel 1 — Motivation / RQ.** "LLMs increasingly automate code review, and frameworks split the work across specialized agents — managers, specialists, voters — priced accordingly. Does the *structure* of that collaboration improve review quality, or just cost more? We hold the model, PR snapshot, prompts, and pipeline fixed and vary only structure. Pre-registered on OSF; prompts frozen before confirmatory data."

**Panel 2 — Method: the four-rung ladder.** Rungs: `Agentless` (single-pass, 1 LLM call) → `Generalists-3` (same prompt sampled 3×, merged; compute-matched control, 3 calls) → `Hierarchical` (coordinator routes to frontend/backend/DB specialists, deterministic synthesis, 3 calls) → `Consensus` (specialists review independently, then debate + vote, 9 calls). "Each rung adds exactly one capability; adjacent contrasts isolate sampling vs specialization vs communication. Model: Claude Haiku 4.5, frozen." Datasets: `E1 Qodo — 99 PRs, 1,188 reviews, injected ground truth`; `E2 SWE-PRBench — 50 PRs, 600 reviews, human-reviewer agreement`; `E3 industrial — 30 PRs, 627 reviews, no oracle`.

**Panel 3 — Hero two-beat figure** (data in Task 1).
- Left caption: "No multi-agent arm beats single-pass F1. Extra agents raise recall (0.62–0.63 vs 0.50) but halve precision — buying recall at 3–9× the calls and 5× the cost per confirmed finding."
- Right caption: "Agreement predicts truth only when the agreeing sources are *independent*. Three independent model families match injected ground truth **89%** of the time; one model repeated three times saturates at **54%**. Decorrelation — not more compute — is the signal."

**Panel 4 — Key findings.** Bullets (verbatim numbers): "Specialization is null — Hierarchical ties Generalists-3 (recall 0.624 vs 0.626, p=0.73)."; "No arm beats Agentless on F1 (0.487 vs 0.357–0.378, Holm p<0.001)."; "Communication unsupported — Consensus does not beat Hierarchical (Holm p=0.12) at 5× the cost."; "Cost rises monotonically along the ladder (efficiency)."; "Grounding bounds recall at a ≈0.83 ceiling — residue is linter-recoverable conventions + an execution-reachable functional core."; "Self-consistency fails; cross-family agreement is what lifts precision."

**Panel 5 — Client panel: E3 is the Indigenomics RAP platform.** "Our E3 industrial dataset is the live RAP data platform we built for the **Indigenomics Institute** — its **30 real merged pull requests, 627 reviews**. On this unlabeled industrial code the verification relationship reaches its *ecological boundary*: LLM correctness judges themselves disagree (**κ=0.03**), so the decorrelation signal that holds on labeled benchmarks cannot be validated without an oracle. This is where the research meets the client's product." (Verify platform facts against `portal/`.)

**Panel 6 — Why it matters.** "Don't deploy multi-agent review expecting a quality lift — you buy recall, not F1, at 3–9× the cost."; "Decorrelate verifiers: independent model families, not a model repeating itself."; "Measure benchmark completeness — a 0.83 recall ceiling means much 'imprecision' is the benchmark's."; "Treat LLM-judged evaluation on real code as unreliable (κ=0.03)."

**Panel 7 — Next steps / open science.** "Tool-grounded verifiers — execution + static analysis as a correctness oracle."; "All runs, ablations, and artifacts released for replay."

**Acknowledgements footer.** "Lino Coria Mendoza (weekly progress check-ins). Indigenomics Institute: Shawn Anderson (technical point of contact), Eve Marenghi (scheduling), K. Krasnow Waterman (legal advice). Compute: AWS Bedrock."

---

### Task 1: Shared CSS design system + the two hero-figure SVGs

**Files:**
- Create: `poster.css`
- Create: `fig-null.svg` (hero-left), `fig-decorrelation.svg` (hero-right)

**Interfaces:**
- Produces: `poster.css` (design tokens + `.poster`, `.title`, `.panel`, `.eyebrow`, `.tag`, `.byline`, `.ack` classes); two standalone SVGs the poster HTML embeds with `<img>`/inline.

- [ ] **Step 1: Write `poster.css` with the design tokens and print sizing**

```css
:root{
  --paper:#EEF1EB; --ink:#16201B; --muted:#57665D; --faint:#7C8A81;
  --line:#D6DCD0; --line2:#C4CCBD; --blue:#2C5F82; --green:#1B6A52; --maroon:#8A1A2B;
  --disp:"Helvetica Neue",-apple-system,system-ui,sans-serif;
  --serif:"Palatino Linotype",Palatino,Georgia,serif;
  --mono:"SF Mono",ui-monospace,Menlo,monospace;
}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;margin:0}
html,body{background:var(--paper);color:var(--ink);font-family:var(--disp)}
.poster{background:var(--paper);position:relative;overflow:hidden}
.title h1{font-family:var(--disp);font-weight:820;letter-spacing:-.015em;line-height:1.02}
.title h1 .thesis{color:var(--maroon);font-style:italic}
.title .sub{font-family:var(--serif);font-style:italic;color:var(--muted)}
.byline{font-size:.9em;color:var(--ink)}
.eyebrow{font-family:var(--mono);text-transform:uppercase;letter-spacing:.14em;color:var(--faint)}
.panel h2{font-family:var(--disp);font-weight:750;text-transform:uppercase;letter-spacing:.03em}
.panel .num{font-family:var(--mono);color:var(--maroon)}
.panel p,.panel li{font-family:var(--disp);line-height:1.4;color:var(--ink)}
.serif{font-family:var(--serif)}
.tag{font-family:var(--mono);font-size:.72em;border-radius:6px;padding:2px 8px}
.client{border-left:6px solid var(--blue);background:#E4EAE6}
.ack{font-family:var(--serif);font-size:.8em;color:var(--muted)}
/* A0 page boxes set per-orientation in each HTML file's <style> */
```

- [ ] **Step 2: Verify the CSS has no forbidden pilot tokens**

Run: `grep -nE "0\.37|0\.41|V0|V1|V2|V3|self-consistency" poster.css`
Expected: no matches (exit 1).

- [ ] **Step 3: Build `fig-null.svg` — per-arm F1 bar chart with the exact Table III values**

Bars (F1, y-axis 0→0.6): Agentless **0.487** (fill `--green`), Generalists-3 **0.357**, Hierarchical **0.378**, Consensus **0.369** (multi-agent bars fill `--blue`). Dashed horizontal reference line at y=0.487 labeled `single-pass 0.487`. Under each multi-agent bar, a small mono label of its call count: `3 / 3 / 9 calls`. Title: "Semantic F1 (E1 Qodo, 99 PRs)". Print each bar's value above it.

```
Data (authoritative — Table III):
Arm            P      R      F1     Calls  Cost/TP
Agentless      0.525  0.503  0.487  1      0.34
Generalists-3  0.270  0.626  0.357  3      0.45
Hierarchical   0.294  0.624  0.378  3      0.50
Consensus      0.322  0.536  0.369  9      1.76
```

- [ ] **Step 4: Build `fig-decorrelation.svg` — grouped bars (golden-match rate) from Fig 2**

Grouped bars, y-axis 0→100%, x = "sources agreeing on a finding" (1, 2, 3). Series A "same model ×3 runs" (fill `--line2`/grey): **14, 17, 54**. Series B "cross-family ×3" (fill `--blue`): **28, 51, 89**. Annotate the depth-3 pair with `89%` and `54%` and a maroon `+35 pts` gap bracket. Title: "Agreement predicts truth only when sources are independent (E1, injected ground truth)".

```
Data (authoritative — Fig 2):
depth:            1    2    3
same-model ×3:    14   17   54   (%)
cross-family ×3:  28   51   89   (%)
gap at depth 3: +35 points
```

- [ ] **Step 5: Verify both SVGs carry only paper-sourced numbers**

Run: `grep -oE ">[0-9]+%?<" fig-null.svg fig-decorrelation.svg`
Expected: values are a subset of {0.487,0.357,0.378,0.369,0,0.2,0.4,0.6,1,3,9,14,17,54,28,51,89,25,50,75,100}. Any other numeral = defect.

- [ ] **Step 6: Commit**

```bash
git add poster.css fig-null.svg fig-decorrelation.svg 2>/dev/null; echo "(commit if repo initialized; else artifacts saved)"
```

### Task 2: Landscape A0 poster HTML + render + verify

**Files:**
- Create: `poster-landscape.html`

**Interfaces:**
- Consumes: `poster.css`, `fig-null.svg`, `fig-decorrelation.svg`.
- Produces: `poster-landscape.pdf` (A0 landscape vector).

- [ ] **Step 1: Write `poster-landscape.html`**

`<style>` sets `@page{size:1189mm 841mm;margin:0}` and `.poster{width:1189mm;height:841mm;padding:26mm 30mm}`. Layout: title band across the top; a CSS grid `grid-template-columns:repeat(4,1fr)` below. Placement: col1 = Panels 1+2; cols2–3 = Panel 3 (two-beat hero, the two SVGs side by side) with Panel 4 beneath; col4 = Panel 6 + Panel 7. Panel 5 (client) = a full-width `.client` band spanning the bottom above the `.ack` footer. Use all verbatim copy from Global Constraints.

- [ ] **Step 2: Confirm Chrome is available for rendering**

Run: `ls "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`
Expected: path exists. (If not, report BLOCKED — need a Chromium binary.)

- [ ] **Step 3: Render to PDF**

Run:
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --no-pdf-header-footer --print-to-pdf="poster-landscape.pdf" \
  "file://$(pwd)/poster-landscape.html"
```
Expected: `poster-landscape.pdf` created.

- [ ] **Step 4: Verify the PDF is A0 and vector**

Run: `mdls -name kMDItemPageWidth -name kMDItemPageHeight poster-landscape.pdf` (A0 landscape ≈ 3370×2384 pt, i.e. 1189×841 mm) and `pdffonts poster-landscape.pdf` (fonts embedded) and `pdftotext poster-landscape.pdf - | grep -c "Decorrelation"` (≥1 → text is real, not rasterized).
Expected: page ≈ A0 landscape; fonts listed; title text extractable.

- [ ] **Step 5: Verify no forbidden pilot numbers leaked in**

Run: `pdftotext poster-landscape.pdf - | grep -nE "0\.41|V[0-3] |self-consistency filter rescues"`
Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add poster-landscape.html poster-landscape.pdf 2>/dev/null; echo "saved"
```

### Task 3: Portrait A0 poster HTML + render + verify

**Files:**
- Create: `poster-portrait.html`

**Interfaces:**
- Consumes: `poster.css`, both SVGs.
- Produces: `poster-portrait.pdf` (A0 portrait vector).

- [ ] **Step 1: Write `poster-portrait.html`**

Identical copy/figures as landscape. `<style>` sets `@page{size:841mm 1189mm;margin:0}` and `.poster{width:841mm;height:1189mm;padding:28mm 26mm}`. Vertical flow: title block; then Panels 1–2 in a 2-col row; Panel 3 hero (two SVGs side by side across full width); Panel 4 key findings full width; Panel 5 client band full width; Panels 6–7 in a 2-col row; `.ack` footer. Reuse the exact verbatim copy — do not paraphrase (keeps the two posters consistent for the docent).

- [ ] **Step 2: Render to PDF**

Run:
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --no-pdf-header-footer --print-to-pdf="poster-portrait.pdf" \
  "file://$(pwd)/poster-portrait.html"
```

- [ ] **Step 3: Verify A0 portrait + vector + no forbidden numbers**

Run: `mdls -name kMDItemPageWidth -name kMDItemPageHeight poster-portrait.pdf` (≈2384×3370 pt), `pdffonts poster-portrait.pdf`, `pdftotext poster-portrait.pdf - | grep -c Decorrelation`, and `pdftotext poster-portrait.pdf - | grep -nE "0\.41|V[0-3] "` (no matches).
Expected: A0 portrait, fonts embedded, title extractable, no pilot numbers.

- [ ] **Step 4: Commit**

```bash
git add poster-portrait.html poster-portrait.pdf 2>/dev/null; echo "saved"
```

### Task 4: Content verification pass vs paper + portal (REQUIRED)

**Files:**
- Create: `VERIFICATION.md` (records each number's source)

**Interfaces:**
- Consumes: both PDFs, `capstone_wip_week_13.pdf`, `portal/`.

- [ ] **Step 1: Extract every numeral from both posters**

Run: `pdftotext poster-landscape.pdf - | grep -oE "[0-9]+\.?[0-9]*%?|κ=0\.03|p=0\.73" | sort -u`
Expected: a list to check off.

- [ ] **Step 2: Map each numeral to a paper location and write `VERIFICATION.md`**

For each: title, byline, `0.487/0.357/0.378/0.369` (Table III), `0.503/0.626/0.624/0.536` recall (Table III), `0.34/1.76` cost & `3–9×`/`5×` (Table III), `p=0.73` (Table II / §IV-A), `Holm p<0.001`, `Holm p=0.12`, `89%`/`54%`/`+35` (Fig 2 / §IV-B), `0.83` ceiling (Table IV / §IV-D), `κ=0.03` (abstract / §IV-H), dataset sizes `99/50/30` & `1,188/600/627` (Table I). Record `claim → paper section/table` for each. Any numeral with no source → FIX in the HTML and re-render.

- [ ] **Step 3: Verify the hero figures against the paper**

Confirm `fig-null.svg` bar order/values equal Table III F1 column and the dashed line = Agentless 0.487; confirm `fig-decorrelation.svg` equals Fig 2's two series. Note the check in `VERIFICATION.md`.

- [ ] **Step 4: Verify the client panel against the portal repo**

Confirm the platform is the RAP data platform for the Indigenomics Institute and E3 = 30 PRs. Cross-check the description against `portal/README` or `portal/docs/` and record the path in `VERIFICATION.md`. Correct any overclaim.

- [ ] **Step 5: Verify credit spellings**

Run: `pdftotext poster-landscape.pdf - | grep -oED "Yvonne Coady|Carol Anne Hilton|Shawn Anderson|Eve Marenghi|K. Krasnow Waterman|Lino Coria Mendoza|Indigenomics Institute"`
Expected: all present, correctly spelled; NO "Coad" (missing y) and NO "Indigenomics AI".

- [ ] **Step 6: Commit**

```bash
git add VERIFICATION.md 2>/dev/null; echo "verification recorded"
```

---

## Notes

- The `CS7980` tree is not a git repo; `git add` steps are best-effort (they no-op if no repo). Artifacts are saved to disk regardless. Offer to init a repo or move into `rap-review-research` if version control is wanted.
- If headless Chrome is unavailable, the fallback render is any Chromium (`chromium --headless`) or a `weasyprint poster-landscape.html poster-landscape.pdf` path (WeasyPrint honors `@page size`); report which was used.
