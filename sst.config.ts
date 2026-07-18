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
    const commitments = new sst.aws.Dynamo("Commitments", {
      ...singleTableShape,
      stream: "new-and-old-images",
    });
    const alignment = new sst.aws.Dynamo("Alignment", singleTableShape);
    // NOTE: the alignment stream subscriber is declared LATER (after bedrockPerms),
    // since `const bedrockPerms` is in the temporal dead zone up here.

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

    // Prebuilt legal-cases search-index artifacts (spec 2026-07-03): the server
    // loads bm25.bin (and vectors.bin when a query-time embedder is configured)
    // once per instance instead of scanning the ~43k-item table per cold start —
    // the prod search-504 fix. Populated by `cases:index-build:cloud` after
    // corpus-changing pipeline runs (ingest / fulltext / embed / promote).
    const casesIndex = new sst.aws.Bucket("CasesIndex");

    // Shared extraction config for BOTH the Next server function and the async
    // extraction worker. Scoped to "*" for the capstone; tighten to specific
    // model/blueprint ARNs for production. AWS_REGION is a reserved Lambda env
    // var (auto-set to the function's region) — do not set it here.
    // Real RAP extraction wiring. The BDA/Bedrock engines exist in code, but the
    // deployed extractor ran EXTRACTION_IMPL=mock because these values were only
    // settable via ambient deploy-time env vars, which CI never sets — so a live
    // /extract upload returned canned mock output, not a real extraction. Wire
    // the PRODUCTION stage to real BDA by default (other stages stay on the mock
    // unless explicitly overridden), so uploads actually extract the document.
    //
    // BDA runtime lives ONLY in us-east-1: the ca-central-1 control plane can
    // create a project, but InvokeDataAutomationAsync there fails with an invalid
    // profile ARN (see docs/rap-extraction-findings.md). So prod pins us-east-1
    // and uses the runtime project `rap-extraction-use1` + the standard us
    // data-automation profile. These are resource ARNs (not secrets); a deploy
    // can still override any of them via env (or SST Secrets) — see docs/deploy-rap.md.
    const isProd = $app.stage === "production";
    const RAP_BDA_PROJECT_ARN =
      "arn:aws:bedrock:us-east-1:106189426706:data-automation-project/c8c9dfbd3f8e"; // rap-extraction-use1 (LIVE)
    const RAP_BDA_PROFILE_ARN =
      "arn:aws:bedrock:us-east-1:106189426706:data-automation-profile/us.data-automation-v1";

    const extractionEnv = {
      REPO_IMPL: "dynamo",
      RAP_TABLE: rapData.name,
      RAP_UPLOAD_BUCKET: rapUploads.name,
      RAP_ANALYTICS_BUCKET: rapAnalytics.name,
      BDA_OUTPUT_BUCKET: rapAnalytics.name,
      // "mock" / "bda" (multi-page native, primary) / "bedrock" (Textract→Claude).
      EXTRACTION_IMPL: process.env.EXTRACTION_IMPL ?? (isProd ? "bda" : "mock"),
      // BDA runtime is us-east-1 only; non-prod keeps ca-central-1 (Claude/bedrock).
      BEDROCK_REGION: process.env.BEDROCK_REGION ?? (isProd ? "us-east-1" : "ca-central-1"),
      REVIEW_MODE: process.env.REVIEW_MODE ?? "indigenomics",
      BDA_PROJECT_ARN: process.env.BDA_PROJECT_ARN ?? (isProd ? RAP_BDA_PROJECT_ARN : ""),
      BDA_PROFILE_ARN: process.env.BDA_PROFILE_ARN ?? (isProd ? RAP_BDA_PROFILE_ARN : ""),
      BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID ?? "",
    };
    const bedrockPerms = [
      // Option B (pipeline.bedrock.ts) streams via InvokeModelWithResponseStream — a
      // SEPARATE IAM action from InvokeModel. Without it, a RAP extraction in the
      // Lambda role fails AccessDenied on the stream call (surfaced deploying the
      // ca stage with EXTRACTION_IMPL=bedrock; prod runs BDA so it never bit there).
      { actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"], resources: ["*"] },
      { actions: ["bedrock:InvokeDataAutomationAsync", "bedrock:GetDataAutomationStatus"], resources: ["*"] },
      { actions: ["textract:AnalyzeDocument", "textract:StartDocumentTextDetection", "textract:GetDocumentTextDetection", "textract:DetectDocumentText"], resources: ["*"] },
    ];

    // Recompute alignment opportunities when a commitment changes. Declared here
    // (not next to the Alignment table) because it needs `bedrockPerms` above.
    commitments.subscribe("AlignmentEngine", {
      handler: "src/functions/alignment.handler",
      link: [commitments, alignment, dataPortal],
      permissions: bedrockPerms,
      environment: {
        REPO_IMPL: "dynamo",
        COMMITMENTS_TABLE: commitments.name,
        ALIGNMENT_TABLE: alignment.name,
        DYNAMO_TABLE: dataPortal.name,
        EMBED_PROVIDER: process.env.EMBED_PROVIDER ?? "stub",
        EMBED_MODEL: "amazon.titan-embed-text-v2:0",
        EMBED_DIM: "1024",
        EMBED_REGION: "us-east-1",
        LABEL_MODELS: process.env.LABEL_MODELS ?? "stub:a,stub:b",
      },
    });

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

    // Async briefing-note generator (spec 2026-07-05). Generation takes 15-60s —
    // beyond the web request Lambda's budget — so the requestBriefing server
    // action invokes this fire-and-forget (same seam as rapExtract). The BM25
    // search artifact loads from casesIndex on cold start.
    const briefGen = new sst.aws.Function("BriefGen", {
      handler: "src/functions/brief-generate.handler",
      timeout: "120 seconds",
      memory: "1536 MB", // bm25 artifact (~60MB) + generation headroom
      link: [casesIndex],
      permissions: [
        ...bedrockPerms,
        // Corpus reads + brief/quota writes on the literal LegalCases table
        // (created out-of-band by the cases:*:cloud pipeline — same reason the
        // Web block wires it by ARN, not link).
        {
          actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:PutItem", "dynamodb:UpdateItem"],
          resources: [
            "arn:aws:dynamodb:us-east-1:*:table/LegalCases",
            "arn:aws:dynamodb:us-east-1:*:table/LegalCases/index/*",
          ],
        },
      ],
      environment: {
        CASES_TABLE: "LegalCases",
        INDEX_BUCKET: casesIndex.name,
        // Explicit us-east-1: the Llama model lives there; do NOT inherit the
        // extraction stack's ca-central-1.
        BEDROCK_REGION: "us-east-1",
        // Dense retrieval (spec 2026-07-06): query-side Bedrock embedding for
        // hybrid search. Matches the embedder that wrote the vectors so the
        // stored/active embedder ids agree and dense engages. EMBED_REGION pins
        // us-east-1 (where Titan v2 + the vectors live).
        EMBED_PROVIDER: "bedrock",
        EMBED_MODEL: "amazon.titan-embed-text-v2:0",
        EMBED_DIM: "1024",
        EMBED_REGION: "us-east-1",
      },
    });

    // Scheduled new-case monitor (spec 2026-07-07). Detection-only — additively
    // records newly-published cases as substrate + writes a scan report; NO Bedrock,
    // no promotion, no artifact mutation. Enrichment stays a human-run op.
    new sst.aws.Cron("CaseMonitor", {
      schedule: "rate(7 days)",
      function: {
        handler: "src/functions/case-monitor.handler",
        timeout: "300 seconds",
        memory: "512 MB",
        environment: { CASES_TABLE: "LegalCases", SCAN_WINDOW_DAYS: "90" },
        permissions: [{
          actions: ["dynamodb:Query", "dynamodb:PutItem"],
          resources: [
            "arn:aws:dynamodb:us-east-1:*:table/LegalCases",
            "arn:aws:dynamodb:us-east-1:*:table/LegalCases/index/*",
          ],
        }],
      },
    });

    // HMAC key for signing session cookies (auth.ts). Set per stage with:
    //   npx sst secret set AuthSecret <random-string> --stage <stage>
    const authSecret = new sst.Secret("AuthSecret");

    new sst.aws.Nextjs("Web", {
      // Least-privilege access to exactly these resources (tables + GSIs + buckets).
      link: [dataPortal, rapSurvey, rapData, rapUploads, exports, rapAnalytics, commitments, alignment, casesIndex],
      transform: {
        server: {
          // Search-index artifacts resident in memory + faster CPU for
          // deserialization. The original "~160MB vectors" estimate was 6× low:
          // the real vectors.bin is ~979MB (bm25.bin ~155MB), and deserialized
          // alongside the Next.js runtime that OOM'd a 2048MB Lambda on the first
          // dense-search request (Runtime.OutOfMemory, observed on the ca stage).
          // 4096MB holds the ~1.1GB of artifacts + working set with headroom, and
          // the extra CPU that comes with it speeds the one-time index load.
          // NOTE: a request Lambda holding a ~1GB index is heavy for a feature
          // used on a fraction of requests — a later refactor should move dense
          // retrieval off the request path (separate function / vector service).
          memory: "3008 MB", // account Lambda cap is 3008MB (4096 rejected); raise quota for more
          // Bedrock/Textract aren't SST-linkable → attach IAM directly. Plus
          // permission to invoke the async extraction worker.
          permissions: [
            ...bedrockPerms,
            { actions: ["lambda:InvokeFunction"], resources: [rapExtract.arn] },
            { actions: ["lambda:InvokeFunction"], resources: [briefGen.arn] },
            // Legal-cases corpus table. NOT SST-managed: it is created + seeded by
            // the cases:*:cloud pipeline (scripts/create-table.ts, cases-ingest.ts,
            // cases-fetch-fulltext.ts, cases-embed.ts) under the literal name
            // "LegalCases", so it can't go in `link:` — wire read access by ARN.
            // The web app only ever reads cases (GSI1 scan / GetItem / chunk Query),
            // plus writes brief/quota items for the requestBriefing action.
            {
              actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:PutItem", "dynamodb:UpdateItem"],
              resources: [
                "arn:aws:dynamodb:us-east-1:*:table/LegalCases",
                "arn:aws:dynamodb:us-east-1:*:table/LegalCases/index/*",
              ],
            },
          ],
        },
      },
      environment: {
        ...extractionEnv,
        // The app resolves table names from these env vars (client.ts + survey-
        // table.ts + rap-table.ts + commitments-table.ts), not the SST Resource object.
        DYNAMO_TABLE: dataPortal.name,
        SURVEY_TABLE: rapSurvey.name,
        AUTH_SECRET: authSecret.value, // HMAC session-signing key (server-side; never NEXT_PUBLIC_)
        COMMITMENTS_TABLE: commitments.name,
        ALIGNMENT_TABLE: alignment.name,
        // Legal-cases corpus: literal table name (created/seeded out-of-band by the
        // cases:*:cloud pipeline — see the IAM grant in transform.server above).
        // Matches the app default (client code falls back to "LegalCases"), but
        // explicit is better than implicit for a prod dependency.
        CASES_TABLE: "LegalCases",
        // The LegalCases table lives in us-east-1 regardless of the app's region
        // (residency split, spec §4). The cases client (casesDdbDoc) pins here so
        // the ca-central-1 Lambda reads the corpus cross-region instead of looking
        // for LegalCases in ca-central-1 (where it doesn't exist).
        CASES_REGION: "us-east-1",
        // Search-index artifacts (spec 2026-07-03): prebuilt bm25/vectors objects
        // the server loads once per instance instead of scanning the table — the
        // prod search-504 fix. Bucket is SST-linked above.
        INDEX_BUCKET: casesIndex.name,
        // Present → uploadRapAction hands extraction to the worker instead of
        // running it inline (which would hit the request-Lambda timeout).
        EXTRACTOR_FUNCTION_NAME: rapExtract.name,
        // Present → requestBriefing hands generation to the worker; unset locally
        // → the action runs generation inline (next dev has no request timeout).
        BRIEF_FUNCTION_NAME: briefGen.name,
        // Dense retrieval (spec 2026-07-06). EMBED_REGION=us-east-1 overrides the
        // inherited extractionEnv BEDROCK_REGION=ca-central-1 for cases embedding
        // ONLY — RAP extraction still uses ca-central-1. The query router keeps
        // dense's embed call to conceptual/topical queries; known-item stays BM25.
        EMBED_PROVIDER: "bedrock",
        EMBED_MODEL: "amazon.titan-embed-text-v2:0",
        EMBED_DIM: "1024",
        EMBED_REGION: "us-east-1",
      },
    });
  },
});
