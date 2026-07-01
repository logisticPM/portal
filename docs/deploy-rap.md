# RAP Portal — Deploy & Test Runbook

End-to-end steps to take the RAP submission portal from the local mock to a live AWS deployment where a real RAP upload flows all the way to the dashboard. Companion to the general `docs/deploy.md`.

---

## 0. Architecture recap (what runs where)

```
Browser ──▶ CloudFront ──▶ Lambda (Next.js App Router, OpenNext)
   │  presigned PUT                 │  server actions / RSC
   ▼                                ▼
S3 RapUploads ──▶ [extraction] ──▶ DynamoDB RapData ──Streams──▶ Lambda RollupAggregator
                  BDA / Textract+Claude        │                    (recompute rollups)
                  (Bedrock)                     ▼
S3 RapAnalytics ◀── (DynamoDB PITR export → Athena, deferred)   /rap dashboard reads
```

---

## 1. Prerequisites (once)

- **AWS credentials** on your machine (`aws configure` or SSO) with rights to deploy (DynamoDB, S3, Lambda, CloudFront, IAM) + call Bedrock/BDA/Textract.
- **Region decision.** App/tables default to `us-east-1` (see `sst.config.ts`); Bedrock/BDA/Textract are pinned to `ca-central-1` via `BEDROCK_REGION`. Cross-region works; for Indigenous data residency consider moving the whole stack to `ca-central-1`. Confirm BDA/Bedrock/Textract are available in whatever `BEDROCK_REGION` you choose.
- **Bedrock model access** — in the Bedrock console, request/enable access to a Claude model in `BEDROCK_REGION` (needed for the `bedrock` engine; `InvokeModel` 403s without it).
- **Node deps** — `npm install`.
- **SST v3** — installed as a dev dep. Before deploy, sanity-check the SST API shapes flagged in `sst.config.ts` (`transform` PITR, `stream`, `subscribe`, `transform.server.permissions`, bucket `cors`) against your installed version — these have drifted across minor releases.
- **AWS Budget alert** (~$5) — cost hygiene.

---

## 2. First deploy — infra only (mock extraction)

Deploy with `EXTRACTION_IMPL=mock` (the default) to validate all the infra + UI before wiring AI.

```bash
npx sst deploy --stage <yourname>
```

Note the outputs: the **CloudFront URL**, and the SST-generated **table/bucket names** (e.g. `indigenomics-portal-<stage>-RapData…`).

**Validate on the live URL:**
- `/rap` dashboard renders (seeded data if you seed — step 3).
- Sign in as **Indigenomics** at `/login` → `/rap/upload` and `/rap/review` are reachable (they're curator-gated).
- Upload on the mock (filename only) → auto-publish or review works.
- Record a progress update on a commitment → rollup updates.
- Check the **RollupAggregator** function's CloudWatch logs fire on the observation write.

---

## 3. Seed cloud data (mind the table name)

SST creates `RapData` with a **stage-prefixed name** — do **not** run `rap:create:cloud` (that would make a second, wrong table). Seed against the SST name:

```bash
RAP_TABLE=<sst-generated-RapData-name> AWS_REGION=<region> REPO_IMPL=dynamo \
  npx tsx scripts/seed-rap.ts
```

(or `npx sst shell --stage <stage> -- ...` and still pass `RAP_TABLE` explicitly). Skip this if you'd rather start empty and populate via uploads.

---

## 4. Turn on real extraction

### Option A — BDA (recommended; multi-page native)

1. **Create the blueprint** from `src/lib/rap/bda-blueprint.json` (Bedrock console → Data Automation → Blueprints → create, or the `CreateBlueprint` API). Keep the field names — `pipeline.bda.ts` maps from them.
2. **Create a Data Automation project** using that blueprint; note its **project ARN**.
3. **Set config** (as SST secrets or deploy-env vars — see step 5):
   - `EXTRACTION_IMPL=bda`
   - `BDA_PROJECT_ARN=<arn>`
   - `BDA_PROFILE_ARN=<arn>` *(only if your BDA API version requires it)*
   - `BEDROCK_REGION=ca-central-1`
4. **Redeploy:** `npx sst deploy --stage <stage>`.

> Verify the BDA result-JSON traversal (`readInferenceResult`) against your account's actual output, and fill in the `sectorFields` mapping once your blueprint defines those sub-fields.

### Option B — Bedrock fallback (Textract → Claude)

- `EXTRACTION_IMPL=bedrock`, `BEDROCK_MODEL_ID=<Claude inference-profile id for the region>`, `BEDROCK_REGION=ca-central-1`.
- Caveat: `loadDocumentText` uses **sync** Textract (single-page/image). Multi-page PDFs need the async `StartDocumentTextDetection` flow — so for multi-page, prefer Option A.

---

## 5. Secrets & env

`sst.config.ts` reads `BDA_PROJECT_ARN`, `BDA_PROFILE_ARN`, `BEDROCK_MODEL_ID` from `process.env` at deploy time. For a real deploy, prefer **SST Secrets / SSM** over shell env, and never commit them.

| Var | Purpose | Example |
|---|---|---|
| `EXTRACTION_IMPL` | engine: `mock` / `bda` / `bedrock` | `bda` |
| `REVIEW_MODE` | `indigenomics` (queue) / `off` (auto-publish clean) | `indigenomics` |
| `BEDROCK_REGION` | Bedrock/BDA/Textract region | `ca-central-1` |
| `BDA_PROJECT_ARN` | BDA custom-blueprint project | `arn:aws:bedrock:…` |
| `BDA_PROFILE_ARN` | data-automation profile (if required) | `arn:aws:bedrock:…` |
| `BEDROCK_MODEL_ID` | Claude inference-profile id (bedrock engine) | `…anthropic.claude-…` |
| `RAP_TABLE` / `RAP_UPLOAD_BUCKET` / `RAP_ANALYTICS_BUCKET` | wired by SST | (auto) |

---

## 6. Smoke test — real, end to end

1. Sign in as **Indigenomics** → `/rap/upload`.
2. Upload `Week 7/rap_samples/BankOfCanada_RAP.pdf` → browser PUTs to `RapUploads` (presigned, any size).
3. Extraction runs (BDA job or Textract→Claude) → job lands `PENDING_REVIEW` (flagged) or auto-publishes (clean).
4. If flagged: `/rap/review` → confirm the fields (each shows its grounding) → **Approve & publish**.
5. `/rap` dashboard shows the new commitments (badged self-reported).
6. Record a progress update → the Streams **RollupAggregator** recomputes; the commitment's status/% updates.

---

## 7. Cost & teardown

- On-demand DynamoDB + Lambda + CloudFront ≈ free at demo scale. **BDA** ≈ $0.01/page, **Bedrock** per-token, **Textract** per-page — single-digit dollars for testing.
- `npx sst remove --stage <stage>` when idle. Keep the Budget alert on.

---

## 8. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `InvokeModel` AccessDenied/403 | Bedrock model access not enabled for that region. |
| BDA job `ClientError` | Blueprint field names / project ARN wrong, or `BDA_PROFILE_ARN` required. |
| Presigned PUT blocked (CORS) | `RapUploads` bucket CORS — confirm the `cors` block deployed. |
| Upload of a big file fails on the action | Ensure the presigned path is used (the client `UploadForm` does this); server-side action upload is capped ~6 MB by Lambda. |
| Rollup never updates | Streams enabled on `RapData`? `RollupAggregator` IAM/`RAP_TABLE` env? Check its CloudWatch logs. |
| Seed wrote nothing to the app's table | `RAP_TABLE` must be the **SST-generated** name, not literal `RapData`. |
| SST deploy type/prop error | Reconcile the flagged `sst.config.ts` API keys with your installed SST v3 version. |
