/// <reference path="./.sst/platform/config.d.ts" />

// ===========================================================================
// SST v3 (Ion) + OpenNext — all-AWS hosting for the RAP Data Portal (RAP-28).
//
// One config provisions: the DynamoDB tables (DataPortal + RapSurvey + RapData),
// the RAP document-upload bucket, a stubbed S3 export bucket (Horizon 2 / OCAP)
// and an analytics-export bucket (DynamoDB→S3→Athena on-ramp), and the Next.js
// App Router site running as Lambda behind CloudFront.
//
//   sst dev      # local dev loop against live AWS resources
//   sst deploy   # deploy the stage → prints the CloudFront URL
//   sst remove   # tear the stage down (do this when idle — cost hygiene)
//
// Region is us-east-1 (matches the existing account/tables; see backend.md).
// The tables' key shape is the SAME generic single-table schema the code and
// scripts/create-table.ts already expect: PK/SK + GSI1 + GSI2, on-demand
// billing. `link: [...]` attaches least-privilege IAM to the Lambda role
// automatically — no static AWS keys, no NEXT_PUBLIC_ secrets.
// ===========================================================================
export default $config({
  app(input) {
    return {
      name: "indigenomics-portal",
      // Keep real data on accidental `sst remove` of a prod stage; dev stages
      // are disposable.
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: { aws: { region: "us-east-1" } },
    };
  },
  async run() {
    // Shared single-table shape. Only key attributes are declared to DynamoDB;
    // all other entity fields are schemaless. Both GSIs have a hash AND range
    // key — mirrors scripts/create-table.ts (the source of truth the repo
    // queries against). Default billing is on-demand (PAY_PER_REQUEST).
    const singleTableShape = {
      fields: {
        PK: "string",
        SK: "string",
        GSI1PK: "string",
        GSI1SK: "string",
        GSI2PK: "string",
        GSI2SK: "string",
      },
      primaryIndex: { hashKey: "PK", rangeKey: "SK" },
      globalIndexes: {
        GSI1: { hashKey: "GSI1PK", rangeKey: "GSI1SK" },
        GSI2: { hashKey: "GSI2PK", rangeKey: "GSI2SK" },
      },
    } as const;

    // report → confirm → coverage → Index (Party / ReportedLine / Confirmation)
    const dataPortal = new sst.aws.Dynamo("DataPortal", singleTableShape);
    // RAP Impact Survey (Organization / SurveyResponse)
    const rapSurvey = new sst.aws.Dynamo("RapSurvey", singleTableShape);
    // RAP submission portal + Index (ExtractionJob / RapDocument / Commitment /
    // Observation). PITR + Streams enabled:
    //   • PITR    → required for DynamoDB's native point-in-time export to S3
    //               (the serverless analytics on-ramp: export → Athena/QuickSight).
    //   • stream  → feeds the rollup-aggregation Lambda (Idea 2 dashboard) and
    //               any future OpenSearch sync. new-and-old-images so the
    //               aggregator can diff a commitment's before/after status.
    // NOTE: verify the transform/stream keys against the installed SST version
    // before deploy — the SST v3 Dynamo API has shifted across minor releases.
    const rapData = new sst.aws.Dynamo("RapData", {
      ...singleTableShape,
      stream: "new-and-old-images",
      transform: {
        table: (args: any) => {
          args.pointInTimeRecovery = { enabled: true };
        },
      },
    });

    // Streams aggregation: on every Observation write, recompute the affected
    // commitment's rollup (COMMIT#<id>/META) so the dashboard reads one item
    // instead of scanning history. Reads/writes RapData; the rollup write
    // (SK=META) doesn't re-trigger the OBS branch, so no loop.
    // (Verify the subscribe() shape against the installed SST version.)
    rapData.subscribe("RollupAggregator", {
      handler: "src/functions/rap-rollup.handler",
      link: [rapData],
      environment: { RAP_TABLE: rapData.name },
    });

    // Raw uploaded RAP documents (PDF/DOCX). The browser PUTs straight here via a
    // presigned URL (bypassing the Lambda 6 MB limit), so CORS must allow PUT.
    // allowOrigins "*" is fine for the capstone; tighten to the site URL for prod.
    // (Verify the cors shape against the installed SST version.)
    const rapUploads = new sst.aws.Bucket("RapUploads", {
      cors: {
        allowMethods: ["PUT", "GET"],
        allowOrigins: ["*"],
        allowHeaders: ["*"],
      },
    });

    // Horizon 2: OCAP "export my records" → S3 object + short-lived signed URL.
    // Provisioned now (empty buckets are free) so the export route can link to
    // it later without an infra change. Linked for IAM but unused by the MVP.
    const exports = new sst.aws.Bucket("Exports");

    // Analytics on-ramp (deferred): the destination for DynamoDB's point-in-time
    // export of RapData. Empty until the first export is triggered; Athena +
    // a Glue table over this bucket answers ad-hoc/cross-tab questions WITHOUT
    // touching the live table. Provisioned now so the path is one step away.
    const rapAnalytics = new sst.aws.Bucket("RapAnalytics");

    new sst.aws.Nextjs("Web", {
      // Grants the Lambda execution role least-privilege access to exactly these
      // resources (the tables + their GSIs, and the buckets).
      link: [dataPortal, rapSurvey, rapData, rapUploads, exports, rapAnalytics],
      // Extraction pipeline calls Bedrock/Textract from the Next server function.
      // These services aren't SST-linkable, so attach the IAM grant directly.
      // Scoped to "*" for the capstone; tighten to specific model/blueprint ARNs
      // for production. (Verify transform.server shape against installed SST.)
      transform: {
        server: {
          permissions: [
            { actions: ["bedrock:InvokeModel"], resources: ["*"] },
            { actions: ["bedrock:InvokeDataAutomationAsync", "bedrock:GetDataAutomationStatus"], resources: ["*"] },
            { actions: ["textract:AnalyzeDocument"], resources: ["*"] },
          ],
        },
      },
      environment: {
        REPO_IMPL: "dynamo",
        // The app resolves table names from these env vars (client.ts:21 +
        // survey-table.ts:15 + rap-table.ts), not from the SST Resource object —
        // so we feed the SST-managed names through, and the data layer is unchanged.
        DYNAMO_TABLE: dataPortal.name,
        SURVEY_TABLE: rapSurvey.name,
        RAP_TABLE: rapData.name,
        RAP_UPLOAD_BUCKET: rapUploads.name,
        RAP_ANALYTICS_BUCKET: rapAnalytics.name,
        // Extraction defaults to the in-process mock. Set "bda" (multi-page
        // native, primary) or "bedrock" (Textract→Claude, fallback) for the real
        // pipeline. BEDROCK_REGION pins Bedrock/BDA to ca-central-1 for Canadian
        // data residency even though the app runs in us-east-1 — ideally the whole
        // stack moves to ca-central-1 (see SH_RAP8_AWS_Architecture).
        EXTRACTION_IMPL: "mock",
        BEDROCK_REGION: "ca-central-1",
        REVIEW_MODE: "indigenomics",
        // BDA path: set to the custom-blueprint project ARN (field names must
        // match extraction-schema.ts) and, if your API version requires it, the
        // data-automation profile ARN. Output lands in the analytics bucket.
        BDA_PROJECT_ARN: process.env.BDA_PROJECT_ARN ?? "",
        BDA_PROFILE_ARN: process.env.BDA_PROFILE_ARN ?? "",
        BDA_OUTPUT_BUCKET: rapAnalytics.name,
        // Set after enabling Bedrock model access (Claude inference-profile id
        // for BEDROCK_REGION); used by the bedrock fallback path.
        BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID ?? "",
        // NOTE: AWS_REGION is a reserved Lambda env var, auto-set by the runtime
        // to the function's region (us-east-1) — do not set it here. The
        // client.ts fallback only matters for local runs.
      },
    });
  },
});
