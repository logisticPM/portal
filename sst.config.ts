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
      // Region is env-overridable so a Canada (ca-central-1) stack can be
      // deployed for data residency without changing the team's us-east-1
      // default (SST_AWS_REGION=ca-central-1 npx sst deploy --stage ca).
      providers: { aws: { region: process.env.SST_AWS_REGION ?? "us-east-1" } },
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
    // RAP commitments index (Commitment) — the commitments dashboard (from main)
    const commitments = new sst.aws.Dynamo("Commitments", singleTableShape);

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
    // CORS restricts which browser ORIGINS may make the presigned PUT/GET. Set
    // RAP_CORS_ORIGINS (comma-separated: the CloudFront URL + http://localhost:3000)
    // at deploy; falls back to "*" for a first deploy (CloudFront URL not known
    // yet) or local-only use. NOTE: this is browser-only defense-in-depth, not the
    // access control — presigned URLs + Block-Public-Access are the real gate.
    const corsOrigins = (process.env.RAP_CORS_ORIGINS ?? "*").split(",").map((o) => o.trim()).filter(Boolean);
    const rapUploads = new sst.aws.Bucket("RapUploads", {
      cors: {
        allowMethods: ["PUT", "GET"],
        allowOrigins: corsOrigins,
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

    // Shared extraction config for BOTH the Next server function and the async
    // extraction worker. Scoped to "*" for the capstone; tighten to specific
    // model/blueprint ARNs for production. AWS_REGION is a reserved Lambda env
    // var (auto-set to the function's region) — do not set it here.
    const extractionEnv = {
      REPO_IMPL: "dynamo",
      RAP_TABLE: rapData.name,
      RAP_UPLOAD_BUCKET: rapUploads.name,
      RAP_ANALYTICS_BUCKET: rapAnalytics.name,
      BDA_OUTPUT_BUCKET: rapAnalytics.name,
      // "mock" (default) / "bda" (multi-page native, primary) / "bedrock"
      // (Textract→Claude, fallback). BEDROCK_REGION pins Bedrock/BDA.
      EXTRACTION_IMPL: process.env.EXTRACTION_IMPL ?? "mock",
      BEDROCK_REGION: process.env.BEDROCK_REGION ?? "ca-central-1",
      REVIEW_MODE: process.env.REVIEW_MODE ?? "indigenomics",
      BDA_PROJECT_ARN: process.env.BDA_PROJECT_ARN ?? "",
      BDA_PROFILE_ARN: process.env.BDA_PROFILE_ARN ?? "",
      BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID ?? "",
    };
    const bedrockPerms = [
      { actions: ["bedrock:InvokeModel"], resources: ["*"] },
      { actions: ["bedrock:InvokeDataAutomationAsync", "bedrock:GetDataAutomationStatus"], resources: ["*"] },
      { actions: ["textract:AnalyzeDocument", "textract:StartDocumentTextDetection", "textract:GetDocumentTextDetection", "textract:DetectDocumentText"], resources: ["*"] },
    ];

    // Async extraction worker — long timeout (BDA takes ~60-80s, past the web
    // request Lambda's ~20s limit). uploadRapAction invokes it fire-and-forget
    // so extraction runs outside the request; it updates the job when done.
    const rapExtract = new sst.aws.Function("RapExtract", {
      handler: "src/functions/rap-extract.handler",
      // Long timeout: chunks run in parallel (~one job's wall time), but BDA
      // concurrency limits can serialize many chunks on very long docs.
      timeout: "900 seconds",
      memory: "1536 MB", // pdf-lib loads the whole PDF in memory to split it

      link: [rapData, rapUploads, rapAnalytics],
      permissions: bedrockPerms,
      environment: extractionEnv,
    });

    new sst.aws.Nextjs("Web", {
      // Least-privilege access to exactly these resources (tables + GSIs + buckets).
      link: [dataPortal, rapSurvey, rapData, rapUploads, exports, rapAnalytics, commitments],
      transform: {
        server: {
          // Bedrock/Textract aren't SST-linkable → attach IAM directly. Plus
          // permission to invoke the async extraction worker.
          permissions: [
            ...bedrockPerms,
            { actions: ["lambda:InvokeFunction"], resources: [rapExtract.arn] },
          ],
        },
      },
      environment: {
        ...extractionEnv,
        // The app resolves table names from these env vars (client.ts + survey-
        // table.ts + rap-table.ts + commitments-table.ts), not the SST Resource object.
        DYNAMO_TABLE: dataPortal.name,
        SURVEY_TABLE: rapSurvey.name,
        COMMITMENTS_TABLE: commitments.name,
        // Present → uploadRapAction hands extraction to the worker instead of
        // running it inline (which would hit the request-Lambda timeout).
        EXTRACTOR_FUNCTION_NAME: rapExtract.name,
      },
    });
  },
});
