# Portal Architecture Gallery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) or subagent-driven-development. Steps use `- [ ]`.

**Goal:** Produce 5 AWS architecture-diagram PNGs of the Indigenomics portal (overview, RAP pipeline, legal-cases, data-residency, research bridge), using official AWS icons + crafted Bedrock/Textract, on a cream canvas matching the poster.

**Architecture:** One HTML file per diagram sharing `gallery.css`; official icons (in `icons/`) inlined; two crafted icons (`aws-bedrock.svg`, `aws-textract.svg`). Rendered to PNG via headless Chrome `--screenshot` at 2× device scale (~3000 px long side).

**Tech Stack:** HTML/CSS, inline SVG icons, headless Google Chrome, `sips`/`pdfinfo`-style checks for PNG size.

**Working dir:** `/Users/eps/Desktop/Work/NEU/Summer 2026/CS7980/Week 13/gallery/`

## Global Constraints

- Every service/arrow/region traces to `CS7980/portal/sst.config.ts`. No invented components.
- Palette: `--paper #EEF1EB`, `--ink #16201B`, `--muted #57665D`, `--line #C4CCBD`, `--blue #2C5F82`, `--green #1B6A52`, `--maroon #8A1A2B`. Fonts: Helvetica Neue (labels), SF Mono (service/table names), Palatino (titles).
- Official icons live in `icons/` (14 fetched). Craft `aws-bedrock.svg` + `aws-textract.svg` in AWS ML-category teal (#01A88D tile, white glyph) to match.
- Each PNG: long side 1600–4000 px (target ~3000), ≤5 MB, named `NN-slug.png` (caption = filename).
- One diagram per file; cream canvas; Palatino title + one-line caption + "CS7980 · Indigenomics Portal" eyebrow on each.
- Regions shown as labeled group boxes: **ca-central-1** (RAP) tinted `--green`, **us-east-1** (cases + AI runtime) tinted `--blue`. Workflow steps = maroon numbered badges ①②③ with short verbs on arrows.

## Shared render command

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1500,1000 \
  --screenshot="01-system-overview.png" \
  "file://$PWD/01-system-overview.html"
# window-size = the diagram's CSS px canvas; 2× → ~3000 px long side.
```
Per-diagram window-size matches that file's `.canvas` width×height.

---

### Task 1: Crafted icons + `gallery.css`

**Files:** Create `icons/aws-bedrock.svg`, `icons/aws-textract.svg`, `gallery.css`.

- [ ] **Step 1: Craft `icons/aws-bedrock.svg`** — 64×64, rounded-square teal tile (#01A88D → #0B7A6E gradient), white glyph evoking Bedrock (stylized layered/parallel-bars "generative" mark). ML-category color.
- [ ] **Step 2: Craft `icons/aws-textract.svg`** — 64×64, same teal tile, white glyph evoking Textract (document with extracted-text lines + a highlight). ML-category color.
- [ ] **Step 3: Write `gallery.css`** — tokens + components:
  - `.canvas` (cream bg, fixed w/h per file via inline style, position:relative, Helvetica Neue).
  - `.title` (Palatino), `.eyebrow` (mono, faint), `.caption` (serif italic, muted).
  - `.region` (rounded box, 2px dashed border; `.region.ca` green tint `#E4EAE6`, `.region.us` blue tint `#E7EDF2`; `.region .chip` label top-left).
  - `.node` (flex column, centered): `.node img/svg` 64px, `.node .lbl` (Helvetica 15px bold), `.node .svc` (mono 12px, muted).
  - `.store` variant for DynamoDB/S3 tables (icon + table name in mono).
  - `.step` (maroon circle badge, 26px, white number) and `.edge` label (mono 12px on a pill).
  - Arrows drawn with inline SVG `<line>/<path>` + arrowheads (marker), or CSS bordered connectors; a `.legend` box.
- [ ] **Step 4: Verify** icons are valid SVG (`head -c5` = `<svg`) and gallery.css has no TODO. Commit-equivalent: files saved.

### Task 2: `01-system-overview.html` (canvas 1500×1000) + render

**Nodes/edges (trace to sst.config.ts):**
- Top: **Browser/User** → **CloudFront** (`aws-cloudfront`) → **Next.js on Lambda / OpenNext** (`aws-lambda`, "Web").
- Region box **ca-central-1 (RAP platform)**: S3 RapUploads, RapData, Commitments, Alignment, Notifications, DataPortal, RapSurvey (DynamoDB `aws-dynamodb`); RapExtract/RollupAggregator/AlignmentEngine Lambdas (grouped, "async workers").
- Region box **us-east-1 (legal cases + AI runtime)**: LegalCases (DynamoDB), CasesIndex/RapAnalytics (S3), **Bedrock** (BDA/Claude/Titan), **Textract**, BriefGen Lambda.
- **Cross-region read** dashed arrow: Web (ca) ⇢ LegalCases + embeddings (us).
- **Secrets Manager** (`aws-secrets-manager`, "AuthSecret") → Web.
- Caption: "One Next.js app on Lambda behind CloudFront serves two subsystems across a Canada/US data-residency split."

- [ ] Build HTML, render PNG (window 1500,1000), confirm ~3000 px & ≤5 MB, eyeball, iterate.

### Task 3: `02-rap-extraction-pipeline.html` (canvas 1600×1000) + render

Numbered flow ①→⑧ (verbatim from spec §02): Browser →① presigned PUT→ **S3 RapUploads** →② Web/Lambda invokes→ **RapExtract** →③ engine (**BDA** / **Textract**→**Bedrock**) writes→ **RapData** →④ REVIEW_MODE (review queue vs auto-publish) →⑤ **Commitments** →⑥ stream→ **RollupAggregator** →⑦ stream→ **AlignmentEngine** (**Bedrock Titan**)→ **Alignment** →⑧ **NotifyDigest** cron (**EventBridge**) + button → **Notifications** + **SES**. Side: RapData → PITR → **S3 RapAnalytics** → **Athena**.
Caption: "Upload → AI extraction → human review → publish → stream-driven rollups, alignment, and the weekly overdue digest."

- [ ] Build HTML, render (window 1600,1000), confirm specs, eyeball, iterate.

### Task 4: `03-legal-cases-search-and-briefs.html` (canvas 1600×1000) + render

Two lanes (spec §03): **Ingestion** — harvest → **Textract** fulltext → **Bedrock Titan** embeddings → build **bm25.bin + vectors.bin** → **S3 CasesIndex**; corpus → **LegalCases** (~3.5k cases / 43k items). **Serve** — Web/Lambda loads bm25 (cold start) → **hybrid BM25 + dense** search; **BriefGen** Lambda → **Bedrock** briefing notes; **CaseMonitor** cron (**EventBridge**, weekly) → LegalCases. All us-east-1.
Caption: "An offline ingest→embed→index pipeline feeds hybrid keyword+vector search and Bedrock-generated briefing notes."

- [ ] Build HTML, render (window 1600,1000), confirm specs, eyeball, iterate.

### Task 5: `04-data-residency-governance.html` (canvas 1500×1000) + render

Split panel: **Canada (ca-central-1)** holds RAP uploads (S3), RapData, Commitments, Notifications, DataPortal; **US (us-east-1)** holds LegalCases, embeddings/index (S3), and ALL **Bedrock/BDA/Textract inference** (no Canadian Bedrock geography). Draw the **cross-region inference boundary**; note **Exports** bucket (OCAP "export my records", deferred). Legend: "data at rest" vs "inference".
Caption: "Data-at-rest stays in Canada where it can; AI inference geo-routes to us-east-1 — the OCAP residency boundary."

- [ ] Build HTML, render (window 1500,1000), confirm specs, eyeball, iterate.

### Task 6: `05-research-to-product-bridge.html` (canvas 1500×900) + render

Flow: **This portal (30 real merged PRs)** → **E3 industrial dataset** → **four-rung ladder eval** (Agentless→Generalists-3→Hierarchical→Consensus) → finding **κ=0.03 industrial boundary** → paper *"Evaluating Decorrelation in LLM Code Review."* Small, poster-consistent. Numbers from the paper only.
Caption: "The portal's own pull requests became E3 — the industrial testbed in our decorrelation study."

- [ ] Build HTML, render (window 1500,900), confirm specs, eyeball, iterate.

### Task 7: Verification pass

- [ ] **Accuracy:** re-open `sst.config.ts`; confirm every service/arrow/region/stream in each of the 5 diagrams is real (RapExtract, RollupAggregator, AlignmentEngine, BriefGen, CaseMonitor, NotifyDigest; tables; buckets; EventBridge crons; SES; cross-region cases). Note any drift and fix.
- [ ] **Icons:** official icons render in color; crafted Bedrock/Textract match style.
- [ ] **Format:** each PNG long side 1600–4000 px and ≤5 MB; filenames `01..05-slug.png`. Use `sips -g pixelWidth -g pixelHeight <f>` and `ls -l`.
- [ ] Write `gallery/GALLERY.md` listing the 5 images + captions + the sst.config.ts anchors for each.

## Notes

- If a PNG exceeds 5 MB, re-render at scale 1.5× or run `sips -s format png` / `pngquant` to shrink.
- `CS7980` isn't a git repo; artifacts save to disk. (Portal repo committing is a separate step if wanted.)
