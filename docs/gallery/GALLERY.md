# Portal Architecture Gallery (Assignment Part 4)

Six AWS architecture diagrams of the Indigenomics portal, split into the RAP and
legal-cases subsystems (including the RAP monitoring plane) plus an overview and two
supporting diagrams. Cream canvas matches
the showcase poster; official AWS icons (Iconify `logos:` set) with hand-crafted Bedrock /
Textract icons in the AWS ML category style.

Filenames double as the docent caption (Part 4 rule). All PNGs: long side 3000–3200 px
(within 1600–4000), ≤ 0.5 MB each, vector-crisp (rendered at 2× device scale).

| # | File | Caption / what it shows |
|---|------|-------------------------|
| 01 | `01-system-overview.png` | One Next.js app on Lambda behind CloudFront serves both subsystems across a Canada/US data-residency split. |
| 02 | `02-rap-extraction-pipeline.png` | RAP: upload → AI extraction → review → publish → stream-driven rollups, alignment, and the weekly digest. |
| 03 | `03-legal-cases-search-and-briefs.png` | Legal cases: offline ingest→embed→index feeds hybrid keyword+vector search and Bedrock briefing notes. |
| 04 | `04-data-residency-governance.png` | Data-at-rest stays in Canada; AI inference geo-routes to us-east-1 — the OCAP residency boundary. |
| 05 | `05-research-to-product-bridge.png` | The portal's own pull requests became E3 — the industrial testbed in the decorrelation paper. |
| 06 | `06-four-rung-experimental-ladder.png` | The four-rung ladder: each rung adds exactly one capability while everything else is held constant. |
| 07 | `07-where-the-signal-lives.png` | Cross-family agreement finds universal functional bugs, not project-specific rule violations. |
| 08 | `08-quality-versus-cost.png` | Quality against cost: the single-pass baseline has both the fewest calls and the best F1. |
| 09 | `09-extraction-observability.png` | RAP monitoring (ca): traces, a dead-letter queue, and cron-scanned EMF metrics become six CloudWatch alarms + a one-pane dashboard; a breach emails on-call over SNS. |

## Accuracy — traced to `portal/sst.config.ts`

Every service, arrow, region, and stream is real:

- **Front door:** CloudFront → `sst.aws.Nextjs("Web")` (OpenNext Lambda); `sst.Secret("AuthSecret")`.
- **RAP:** `S3 RapUploads` (presigned PUT, CORS) → `RapExtract` fn (900s, `EXTRACTION_IMPL` = bda/bedrock/mock) → `RapData` (PITR + stream) → `Commitments` (stream). `rapData.subscribe("RollupAggregator")`; `commitments.subscribe("AlignmentEngine")` → Titan embeddings (`amazon.titan-embed-text-v2:0`) → `Alignment`. `NotifyDigest` Cron (prod) + institute button → `Notifications` + `ses:SendEmail`. `RapAnalytics` (PITR export → Athena, roadmap).
- **Legal cases:** `LegalCases` table (us-east-1, created out-of-band — 43,443 items ≈ 3,489 case profiles + 39,954 chunks; **561** in the curated *core* tier that browse/search surfaces) + `CasesIndex` S3 (bm25.bin/vectors.bin); `BriefGen` fn (Bedrock briefing notes); `CaseMonitor` Cron `rate(7 days)`; hybrid BM25 + dense (Titan) search; `CASES_REGION=us-east-1` cross-region.
- **Residency:** `providers.aws.region` ca-central-1 for the RAP stage; BDA/Bedrock/Textract inference in us-east-1 via the `us.` inference profile (no Canadian Bedrock geography); `Exports` bucket (OCAP, roadmap).
- **Observability (09, ca only):** `if (extractDlq)` block in `sst.config.ts`. `ExtractDLQ` (SQS, 14-day retention) as the async on-failure destination for `RapExtract` + `BriefGen` (`FunctionEventInvokeConfig`); `RapExtract` `tracingConfig.mode = Active` → **X-Ray** (SDK clients wrapped via `src/lib/observability/xray.ts`); `StuckJobMonitor` Cron `rate(15 minutes)` scans `RapData` (`listByStatus` FAILED + EXTRACTING) and emits two EMF metrics in namespace `Indigenomics/RapExtraction`; **6** `MetricAlarm`s (RapExtractErrors/Throttles, BriefGenErrors, ExtractDlqNotEmpty, StuckExtractionJobs, FailedExtractionJobs) → `ObservabilityAlerts` **SNS** topic → email (alarm + OK actions); `ExtractionHealth` **Dashboard** (`indigenomics-ca-extraction-health`, 5 widgets). The design note captures the motivating case: the worker catches its own errors and returns `{status: failed}`, so the built-in `Errors` alarm + DLQ never fire — only the FAILED-partition scan sees a *handled* failure (the Textract-SCP outage shape).
- **Icons:** official (Lambda, S3, DynamoDB, CloudFront, SES, EventBridge, Athena, Secrets Manager, CloudWatch, SQS, SNS, X-Ray); crafted Bedrock + Textract (AWS ML teal).
- **Research (05):** 30 PRs, 627 reviews, κ=0.03, four-rung ladder, paper title — all from `Week 13/capstone_wip_week_13.pdf`.
- **Cost (08):** the paper's Fig. 3a at native resolution (992 px wide), beside an explanation panel. Values from Table III: Cost/TP 0.34 (Agentless) vs 1.76 (Consensus); F1 0.487 vs 0.357–0.378; recall 0.62–0.63 vs 0.50.
- **Signal (07):** the paper's Fig. 3b at native resolution (974 px wide, not upscaled), beside an explanation panel. Values from §IV-C: functional-bug recall 80/61/43% vs rule-violation 45/26/18% at 1/2/3 families agreeing (n=217 / n=220). Explains the residue under the ≈0.83 recall ceiling.
- **Ladder (06):** the paper's own Figure 1, reproduced at native resolution (1900 px wide, not upscaled) inside the gallery frame. Placed here rather than on the poster: its seven rows of fine print would render at ~7–11 pt at A0, below the 24 pt body-text minimum, and it would re-centre the *apparatus* over the contribution.

## Rebuild

```
python3 render_png.py 01-system-overview.html 1500 912
python3 render_png.py 02-rap-extraction-pipeline.html 1600 1060
python3 render_png.py 03-legal-cases-search-and-briefs.html 1600 1000
python3 render_png.py 04-data-residency-governance.html 1500 1020
python3 render_png.py 05-research-to-product-bridge.html 1500 610
python3 render_png.py 06-four-rung-experimental-ladder.html 1000 812
python3 render_png.py 07-where-the-signal-lives.html 900 462
python3 render_png.py 08-quality-versus-cost.html 900 462
python3 render_png.py 09-extraction-observability.html 1600 1040
```
(Requires Google Chrome. Sources: `NN-*.html` + shared `gallery.css` + `icons/`.)
