# Portal Architecture Gallery — Design Spec

**Date:** 2026-07-26
**Assignment:** CS7980 Week 11, Part 4 — Image gallery (up to 12 images)
**Deliverable:** 5 architecture diagrams (PNG) of the Indigenomics portal, split into the
RAP subsystem and the legal-cases subsystem, plus an overview and two supporting diagrams.

## Goal

A gallery of clean, accurate AWS architecture diagrams that show *what the portal is built
on* and *how each subsystem's workflow flows*, using real AWS service icons. Cohesive with
the showcase poster (shared cream palette) and grounded in the actual infrastructure
(`sst.config.ts`).

## Source of truth

- **Infrastructure:** `CS7980/portal/sst.config.ts` (authoritative for services, wiring,
  regions, streams, crons). Every component and arrow must trace to it.
- **Palette (match poster):** `--paper #EEF1EB`, `--ink #16201B`, `--muted #57665D`,
  `--line #C4CCBD`, `--blue #2C5F82`, `--green #1B6A52`, `--maroon #8A1A2B`. Fonts:
  Helvetica Neue (labels), SF Mono (service/table names), Palatino (titles).

## Icon inventory

- **Official (fetched from Iconify `logos:` set, in `gallery/icons/`):** cloudfront, lambda,
  dynamodb, s3, ses, eventbridge, athena, quicksight, secrets-manager, iam, api-gateway,
  cloudwatch, glue, cognito.
- **Hand-crafted to match (AWS ML-category teal tile + white glyph):** `bedrock`, `textract`
  (not available in fetchable sets). Build as `icons/aws-bedrock.svg`, `icons/aws-textract.svg`
  sized/styled to sit consistently beside the official icons.
- Actors (browser, institute user) and DynamoDB-stream arrows are drawn, not icons.

## The five diagrams

Numbered filenames double as the docent caption (assignment rule).

### 01 — `01-system-overview.png`
The big picture. **CloudFront → Next.js-on-Lambda (OpenNext)** front door serving both
subsystems. Two region group boxes: **ca-central-1 (RAP platform)** and **us-east-1 (legal
cases + Bedrock/BDA/Textract/Titan runtime)**, with a labeled **cross-region read** arrow
(the app in Canada reads the `LegalCases` table + embeddings in the US). Shared **DynamoDB
single-table design** (PK/SK + GSI1 + GSI2) called out. Auth via **Secrets Manager**
(AuthSecret, HMAC cookies).

### 02 — `02-rap-extraction-pipeline.png` (RAP subsystem)
Workflow, numbered ①→⑧:
1. Browser → **presigned PUT** → **S3 RapUploads**.
2. **Next.js/Lambda** `uploadRapAction` invokes the async **RapExtract** Lambda (fire-and-forget).
3. RapExtract runs the extraction engine — **BDA** (Bedrock Data Automation) *or* **Textract
   (LAYOUT) → Bedrock (Claude)** *or* mock — writes to **RapData** (DynamoDB, PITR + stream).
4. **REVIEW_MODE**: flagged → review queue (`PENDING_REVIEW`); clean → auto-publish.
5. Publish → canonical entities → **Commitments** (DynamoDB, stream).
6. **RapData stream → RollupAggregator** Lambda → recompute rollups.
7. **Commitments stream → AlignmentEngine** Lambda → **Bedrock Titan embeddings** → **Alignment** table.
8. **NotifyDigest** cron (**EventBridge**, prod) + institute button → **Notifications** table + **SES** email.
Side path: RapData → **PITR export → S3 RapAnalytics → Athena** (analytics on-ramp, deferred).

### 03 — `03-legal-cases-search-and-briefs.png` (legal-cases subsystem, us-east-1)
Two lanes:
- **Ingestion (offline pipeline):** harvest court decisions → **Textract** fulltext →
  **Bedrock Titan embeddings** → build **bm25.bin + vectors.bin** → **S3 CasesIndex**;
  corpus lands in **LegalCases** DynamoDB (43,443 items ≈ 3,489 case profiles + 39,954 text chunks; 561 promoted to the curated *core* tier).
- **Serve (request path):** **Next.js/Lambda** loads bm25 from CasesIndex on cold start →
  **hybrid search** (BM25 keyword + dense/Titan vector); **BriefGen** Lambda generates
  briefing notes via **Bedrock**; **CaseMonitor** cron (**EventBridge**, weekly) detects new
  decisions → LegalCases.

### 04 — `04-data-residency-governance.png` (extra)
The OCAP/residency story: which data stays in **Canada (ca-central-1)** — RAP uploads,
RapData, Commitments, Notifications — vs **US (us-east-1)** — LegalCases, embeddings, and all
Bedrock/BDA/Textract **inference** (no Canadian Bedrock geography). Show the **cross-region
inference boundary** and the deferred **Exports** bucket (OCAP "export my records").

### 05 — `05-research-to-product-bridge.png` (extra)
How the product feeds the research: the portal's **30 real merged PRs** became **E3** in the
paper *"Evaluating Decorrelation in LLM Code Review."* A compact flow: portal PRs → E3
industrial dataset → four-rung ladder eval → the κ=0.03 industrial boundary finding. Ties the
gallery to the poster/paper.

## Style

- **Canvas:** cream (`--paper`), one diagram per PNG, generous margins, a Palatino title +
  one-line caption per diagram, small "CS7980 · Indigenomics Portal" eyebrow.
- **Structure:** rounded region/group boxes (thin `--line` borders, region label chips);
  official AWS icons at consistent size (~64px tile) with a mono service label beneath;
  numbered workflow arrows (maroon circles ①②③) with short verbs on the arrows.
- **Legend** where helpful (region colors, stream vs request arrows).

## Format (assignment Part 4)

- **PNG**, long side ~3000 px (within 1600–4000), **≤ 5 MB** each.
- Named in display order: `01-system-overview.png` … `05-research-to-product-bridge.png`
  (filename-after-number = the docent caption, so it must be meaningful).

## Build pipeline

- One HTML file per diagram (shared `gallery.css`), icons inlined as `<img>`/inline SVG.
- Render to PNG via **headless Chrome** `--screenshot` at a fixed viewport with
  `--force-device-scale-factor` for high-DPI crispness (long side ~3000 px), then confirm
  ≤5 MB (downscale/optimize if over).

## Verification (required)

1. **Accuracy:** every service, arrow, region, and stream in each diagram traces to
   `sst.config.ts`. No invented components.
2. **Icons:** official icons render in color; crafted Bedrock/Textract match the AWS ML
   category style and sit consistently beside them.
3. **Format:** each PNG long side within 1600–4000 px and ≤5 MB; filenames `NN-slug.png`.

## Out of scope (YAGNI)

- No live/interactive diagrams; static PNGs only.
- No per-Lambda internal logic; service-level architecture only.
- No changes to the portal; `sst.config.ts` is read-only reference here.
