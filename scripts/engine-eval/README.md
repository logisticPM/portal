# Engine Evaluation Harness

## Purpose

This harness compares three document-extraction engines for RAP text-layer quality, cost, and recall on a curated corpus of 8 real RAP PDFs. The evaluation implements the specification in [RAP Engine Comparison Spec](../../docs/superpowers/specs/2026-08-06-rap-engine-comparison-design.md).

## Execution Order

### Phase 1: Offline Testing (no AWS, no Textract SSO required)
```bash
npm run eval:test
```
All pure-logic test suites run (`test-*.ts` scripts). Expected: every test prints ✅ and exits 0.

**Required env vars:** none (standard exports will use stubs).

### Phase 2: Corpus Upload
```bash
npm run eval:upload
```
Uploads the 8 RAP samples to the evaluation S3 bucket and generates a manifest.

**Required env vars:**
- `AWS_PROFILE=isb` (use the ISB prod profile)
- `RAP_UPLOAD_BUCKET` (exported in shell; see `.sst.env` or stack outputs)
- `RAP_SAMPLES_DIR` (local path to the 7–8 RAP sample PDFs, outside the repo)

### Phase 3: Extraction Runs (parallel, each ~15–30 min)
```bash
npm run eval:run:textlayer &
npm run eval:run:textract &
npm run eval:run:bda &
wait
```

**Textlayer (ca-central-1)**
```bash
export AWS_PROFILE=isb
npm run eval:run:textlayer
```
Env vars: `AWS_PROFILE`, `BEDROCK_REGION=ca-central-1` (set in script).

**Textract (ca-central-1, requires SSO login)**
```bash
aws sso login --profile isb  # Must be active — org SCP blocks Textract for Lambda
npm run eval:run:textract
```
⚠️ **Important:** Textract is SCP-blocked for the Lambda IAM role in prod but NOT for human principals with SSO. You must have an active SSO session before running this. Run `aws sso login --profile isb` if prompted.

Env vars: `AWS_PROFILE`, `BEDROCK_REGION=ca-central-1` (set in script).

**BDA (us-east-1, no SSO gate)**
```bash
npm run eval:run:bda
```
Env vars: `RAP_UPLOAD_BUCKET`, `BDA_PROJECT_ARN`, `BDA_PROFILE_ARN`, `BDA_OUTPUT_BUCKET` (plus `EXTRACTION_IMPL`, `BEDROCK_REGION=us-east-1`, `AWS_PROFILE=isb`, set in script).

### Phase 4: Scoring
```bash
npm run eval:score
```
Generates the comparison scorecard and human-review worklist.

**Judges:** two independent non-Claude families, both on Bedrock — Amazon Nova Pro (`us.amazon.nova-pro-v1:0`) + DeepSeek V3.2 (`deepseek.v3.2`), called via the shared Converse client. No third-party API key or data egress. Requires Bedrock on-demand model access enabled in the account (us-east-1) and `AWS_PROFILE=isb`. Override with `JUDGE_A_MODEL` / `JUDGE_B_MODEL` — they must stay non-Claude (the harness asserts this at startup, since the extractor is Claude and no engine may judge itself).

**Outputs:**
- `docs/rap-engine-comparison.md` — committed scorecard with P/R/F1, cost estimates, and recommendation
- `results/worklist.html` — git-ignored; human-review interface for ~25 edge cases

### Phase 5: Human Adjudication (manual, ~30–45 min)
1. Open `results/worklist.html` in a browser
2. Review the ~25 flagged disagreements
3. Resolve each by selecting the ground-truth label
4. Export the adjudicated results
5. Update the recommendation narrative in `docs/rap-engine-comparison.md` based on findings

## Environment Variables Reference

| Var | Purpose | Phase | Source |
|-----|---------|-------|--------|
| `AWS_PROFILE` | ISB prod AWS account | All cloud | Set to `isb` |
| `AWS_REGION` | Platform region (upload only) | Upload | `ca-central-1` (set in script) |
| `BEDROCK_REGION` | Inference region | Extraction | `ca-central-1` (textlayer/textract), `us-east-1` (BDA) |
| `EXTRACTION_IMPL` | Engine mode | Extraction | `bedrock` (textlayer/textract), `bda` (BDA) |
| `DOC_LOADER` | PDF parser | Extraction | `textlayer` or `textract` (set in script) |
| `RAP_UPLOAD_BUCKET` | S3 bucket for corpus | Upload | From `.sst.env` or stack outputs |
| `RAP_SAMPLES_DIR` | Local corpus path | Upload | Outside repo; e.g., `~/Downloads/rap_samples` |
| `BDA_PROJECT_ARN` | BDA project ARN | BDA run | From AWS console or stack outputs |
| `BDA_PROFILE_ARN` | BDA inference profile ARN | BDA run | From AWS console or stack outputs |
| `BDA_OUTPUT_BUCKET` | S3 bucket for BDA results | BDA run | From stack outputs |
| `JUDGE_A_MODEL` | Judge A model id (optional) | Scoring | default `us.amazon.nova-pro-v1:0` (Bedrock) |
| `JUDGE_B_MODEL` | Judge B model id (optional) | Scoring | default `deepseek.v3.2` (Bedrock) |

## Outputs

### Committed
- `docs/rap-engine-comparison.md` — Final scorecard and recommendation. Includes:
  - P/R/F1 per engine
  - Cost estimates (USD per document)
  - Relative-recall comparison (recall relative to union of all extractions)
  - Cohen's κ agreement with gold standard
  - Implementation recommendation

### Git-Ignored (in `results/`)
- `manifest.json` — Uploaded corpus metadata
- `textlayer.jsonl` — Textlayer raw extractions
- `textract.jsonl` — Textract raw extractions
- `bda.jsonl` — BDA raw extractions
- `gold-scores.json` — P/R/F1 per document and engine
- `agreement.json` — Judge agreement matrix and κ
- `grounding-fidelity.json` — Grounding validity per engine
- `cost-estimates.json` — Per-engine cost breakdown
- `worklist.html` — Human-review interface

## Validity Caveats

1. **BDA Page Count:** BDA output includes inferred page counts for documents without explicit page metadata. These counts are NOT validated against the PDF page count and should NOT be used for absolute page-level assertions. Use relative-recall comparisons instead.

2. **Relative Recall:** Recall is computed relative to the union of all extractions across the three engines. This is NOT absolute recall against a gold standard, but rather a proxy for engine coverage. A high relative-recall engine does not necessarily capture all true facts — only that it captures a superset of what other engines miss.

3. **Human Worklist:** The scoring harness generates a worklist of ~25 edge cases where judges disagree. These require manual resolution before the final recommendation can be finalized. This is by design and not a sign of incomplete automation.

4. **Corpus Size:** The evaluation uses n=8 real RAPs. Results generalize qualitatively (e.g., "BDA is more robust on tables") but NOT quantitatively to the full production corpus.

## Running the Full Pipeline

For a complete end-to-end run:

```bash
# Phase 1: Test
npm run eval:test

# Phase 2: Export env vars and upload
export AWS_PROFILE=isb RAP_UPLOAD_BUCKET=<bucket> RAP_SAMPLES_DIR=<path>
npm run eval:upload

# Phase 3: Extract (parallel)
npm run eval:run:textlayer &
npm run eval:run:textract &
npm run eval:run:bda &
wait

# Phase 4: Score (judges run on Bedrock — no extra key needed)
npm run eval:score

# Phase 5: Review results
open results/worklist.html
# ... manual adjudication and narrative update ...
```

Typical total time: ~2 hours (1 hour extraction, 30–45 min adjudication).
