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

    // Weekly overdue-milestone digest records (spec 2026-07-25). One partition
    // (NOTIFY#institute) of per-ISO-week digests; the institute /notifications
    // inbox reads it, the cron + button write it.
    const notifications = new sst.aws.Dynamo("Notifications", singleTableShape);

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
      // "textract" | "textlayer" — how a document becomes text. Explicit; the
      // loader throws on anything else. Defaults to textract so this refactor
      // is behaviour-neutral; ca flips to textlayer in Task 5 after measurement.
      DOC_LOADER: process.env.DOC_LOADER ?? "textract",
    };
    const bedrockPerms = [
      // Option B (pipeline.bedrock.ts) streams via InvokeModelWithResponseStream — a
      // SEPARATE IAM action from InvokeModel. Without it, a RAP extraction in the
      // Lambda role fails AccessDenied on the stream call (surfaced deploying the
      // ca stage with EXTRACTION_IMPL=bedrock; prod runs BDA so it never bit there).
      { actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"], resources: ["*"] },
      { actions: ["bedrock:InvokeDataAutomationAsync", "bedrock:GetDataAutomationStatus"], resources: ["*"] },
      { actions: ["textract:AnalyzeDocument", "textract:StartDocumentTextDetection", "textract:GetDocumentTextDetection", "textract:DetectDocumentText", "textract:StartDocumentAnalysis", "textract:GetDocumentAnalysis"], resources: ["*"] },
    ];

    // ---------------------------------------------------------------------
    // Observability (ca + production) — docs/superpowers/specs/2026-07-28-observability-monitoring-design.md
    //
    // Closes the PUSH side of failure visibility (#193 opened the pull side).
    // Two stages run REAL extraction and so get the full stack: `ca` (the real
    // textlayer engine, and the stage the Textract SCP outage bit) and
    // `production` (the live, client-facing stage running real BDA — it was
    // previously blind, which is backwards for the demo stage). Raw aws.* Pulumi
    // resources because SST v3 Functions expose neither alarms nor async
    // on-failure destinations first-class. Log RETENTION is intentionally NOT
    // here — SST v3 already defaults every Lambda log group to 30 days
    // (verified live 2026-07-28). Every resource below is stage-scoped by
    // SST/Pulumi, so ca and production get independent copies (no collision).
    // ---------------------------------------------------------------------
    const isCa = $app.stage === "ca";
    // Gate for the observability stack: the stages that run real extraction.
    const observe = isCa || isProd;

    // --- Edge protection: AWS WAF on the CloudFront distribution -------------
    // (design: docs/superpowers/specs/2026-08-02-cloudfront-waf-design.md).
    // CLOUDFRONT-scoped WebACLs must be created in us-east-1, so use a dedicated
    // provider regardless of the stack region (prod is us-east-1; ca is
    // ca-central-1). observe-gated so dev/mock stages get nothing.
    const wafUsEast1 = observe ? new aws.Provider("WafUsEast1", { region: "us-east-1" }) : undefined;
    // Count-first: every rule starts in COUNT mode (nothing blocked) so we can
    // watch sampled requests for false positives, then flip to blocking by
    // setting WAF_BLOCKING=true (or changing this default in a follow-up PR).
    const wafBlocking = process.env.WAF_BLOCKING === "true";
    const managedOverride = wafBlocking ? { none: {} } : { count: {} };
    const rateAction = wafBlocking ? { block: {} } : { count: {} };
    const wafVis = (name: string) => ({
      cloudwatchMetricsEnabled: true,
      sampledRequestsEnabled: true,
      metricName: name,
    });
    const webAcl = observe
      ? new aws.wafv2.WebAcl(
          "WebAcl",
          {
            scope: "CLOUDFRONT",
            defaultAction: { allow: {} },
            visibilityConfig: wafVis(`indigenomics-${$app.stage}-waf`),
            rules: [
              {
                name: "RateLimit",
                priority: 1,
                action: rateAction,
                statement: { rateBasedStatement: { limit: 1000, aggregateKeyType: "IP" } },
                visibilityConfig: wafVis(`indigenomics-${$app.stage}-waf-ratelimit`),
              },
              {
                name: "CommonRuleSet",
                priority: 2,
                overrideAction: managedOverride,
                statement: {
                  managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesCommonRuleSet" },
                },
                visibilityConfig: wafVis(`indigenomics-${$app.stage}-waf-common`),
              },
              {
                name: "KnownBadInputs",
                priority: 3,
                overrideAction: managedOverride,
                statement: {
                  managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesKnownBadInputsRuleSet" },
                },
                visibilityConfig: wafVis(`indigenomics-${$app.stage}-waf-knownbad`),
              },
            ],
          },
          // webAcl and wafUsEast1 are observe-gated together, so the provider is
          // defined whenever this resource is created.
          { provider: wafUsEast1! },
        )
      : undefined;

    // Dead-letter capture for the fire-and-forget workers. If a worker dies
    // BEFORE writing a terminal job status, the job is stranded EXTRACTING and
    // the event payload is lost; this queue keeps the original
    // {jobId,fileName,sourceS3Key} for inspection or a #194 hand-retry.
    // Capture-only — no auto-redrive (the SCP failures were deterministic and
    // would loop). Created before the workers so its ARN can be granted.
    const extractDlq = observe
      ? new aws.sqs.Queue("ExtractDLQ", { messageRetentionSeconds: 60 * 60 * 24 * 14 }) // 14 days (SQS max)
      : undefined;
    // Async on-failure destinations are delivered using the FUNCTION ROLE, not
    // the Lambda service principal, so the workers need sqs:SendMessage.
    const dlqSendPerm = extractDlq ? [{ actions: ["sqs:SendMessage"], resources: [extractDlq.arn] }] : [];

    // X-Ray (ca + production) — docs/superpowers/specs/2026-07-28-xray-tracing-design.md.
    // Per-request tracing of the extraction worker: S3 → loader → Bedrock/BDA →
    // DynamoDB, with timings, so a slow/failed extraction resolves into WHERE.
    // The worker's role needs to emit segments; Active tracing is set on the
    // function below. Verified NOT SCP-blocked (unlike CloudTrail on this
    // Control-Tower account). The SDK-client wrapping (src/lib/observability/
    // xray.ts) only activates where AWS_XRAY_DAEMON_ADDRESS is set — i.e. this
    // function — so nothing else changes. On production the wrapped BDA client
    // (pipeline.bda.ts) puts the InvokeDataAutomationAsync call in the trace too.
    const xrayPerm = observe
      ? [{ actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules", "xray:GetSamplingTargets"], resources: ["*"] }]
      : [];

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
      permissions: [...bedrockPerms, ...dlqSendPerm, ...xrayPerm],
      environment: extractionEnv,
      // Active tracing (ca + production) — originate an X-Ray trace per
      // invocation so the wrapped SDK clients' calls appear as timed subsegments.
      ...(observe
        ? { transform: { function: (args: any) => { args.tracingConfig = { mode: "Active" }; } } }
        : {}),
    });

    // Async briefing-note generator (spec 2026-07-05). Generation takes 15-60s —
    // beyond the web request Lambda's budget — so the requestBriefing server
    // action invokes this fire-and-forget (same seam as rapExtract). The BM25
    // search artifact loads from casesIndex on cold start.
    const briefGen = new sst.aws.Function("BriefGen", {
      handler: "src/functions/brief-generate.handler",
      timeout: "300 seconds", // async worker — nobody waits on a request budget; Sonnet is slower per token than Llama
      memory: "2048 MB", // bm25 artifact (157MB today, grows with the corpus) × the alignment copy + generation headroom
      link: [casesIndex],
      permissions: [
        ...bedrockPerms,
        ...dlqSendPerm,
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
        // Briefing model: Claude Sonnet 4.6 via the `us.` CROSS-REGION INFERENCE
        // PROFILE. The bare id ("anthropic.claude-sonnet-4-6") is rejected by Bedrock
        // for on-demand invoke ("...isn't supported. Retry your request with the ID or
        // ARN of an inference profile") — the mistake that made us believe for four
        // weeks that this account had no Claude access. There is no "ca." geo prefix.
        // src/lib/rap/bedrock-model.ts verified this id from us-east-1 AND ca-central-1
        // (2026-07-16). Cases-domain calls go through Bedrock Converse, whose shape is
        // uniform across model families, so no code change is needed.
        // NOTE: the value that actually takes effect is the one on the WEB function —
        // actions.ts records the model on the brief and run.ts prefers `brief.model`.
        // This one is the worker's fallback for records created before it was set.
        BRIEF_MODEL: process.env.BRIEF_MODEL ?? "us.anthropic.claude-sonnet-4-6",
        // Dense is back ON (2026-07-30). It was switched off in the incident fix because the
        // float32 vectors segment was ~985MB and loading it cost three concurrent copies (S3
        // byte array → Buffer.from → artifact.ts's alignment copy), peaking ~3.5GB — which
        // OOMs even at the account's 3008MB cap, and an OOM is uncatchable, so briefs were
        // stranded at "pending" for three weeks. The artifact is now QUANTIZED (binary 1 bit/dim
        // resident + int8 read positionally from /tmp, which does not count against MemorySize):
        // MEASURED on the real corpus of 240,245 vectors — 984.0MB → 30.8MB + 246.0MB, binary
        // top-200 coverage of the true top-10 0.9940, Recall@10 binary-only 0.7855 → 0.9750 with
        // int8 rescoring, against a 0.95 gate (scripts/cases-quant-eval.ts, re-runnable).
        // Set BRIEF_EMBED_PROVIDER=stub to roll dense back off without a code change.
        EMBED_PROVIDER: process.env.BRIEF_EMBED_PROVIDER ?? "bedrock",
        EMBED_MODEL: "amazon.titan-embed-text-v2:0",
        EMBED_DIM: "1024",
        EMBED_REGION: "us-east-1",
      },
    });

    // Observability wiring (ca + production). Everything below is gated on the
    // DLQ existing, i.e. `observe`; on other stages this whole block is skipped.
    if (extractDlq) {
      // Attach the DLQ as the async on-failure destination for both workers.
      for (const [label, fn] of [["RapExtract", rapExtract], ["BriefGen", briefGen]] as const) {
        new aws.lambda.FunctionEventInvokeConfig(`${label}OnFailure`, {
          functionName: fn.name,
          destinationConfig: { onFailure: { destination: extractDlq.arn } },
        });
      }

      // Alarm sink: one SNS topic → email. ALERTS_EMAIL defaults to
      // DIGEST_RECIPIENT so no new REQUIRED var; the subscription needs a
      // one-time click-confirm on the address AWS emails.
      const alertsEmail = process.env.ALERTS_EMAIL || process.env.DIGEST_RECIPIENT || "";
      const alertTopic = new aws.sns.Topic("ObservabilityAlerts", {});
      if (alertsEmail) {
        new aws.sns.TopicSubscription("ObservabilityAlertsEmail", {
          topic: alertTopic.arn,
          protocol: "email",
          endpoint: alertsEmail,
        });
      }

      // treatMissingData "notBreaching": event-driven metrics (Errors, DLQ
      // depth) have no datapoint in a quiet period — that is health, not an
      // alarm. okActions so a recovery also emails an all-clear.
      // Collected so the dashboard's status widget can reference every ARN.
      const alarms: any[] = [];
      const alarm = (name: string, args: any) => {
        const a = new aws.cloudwatch.MetricAlarm(name, {
          comparisonOperator: "GreaterThanOrEqualToThreshold",
          evaluationPeriods: 1,
          threshold: 1,
          treatMissingData: "notBreaching",
          alarmActions: [alertTopic.arn],
          okActions: [alertTopic.arn],
          ...args,
        });
        alarms.push(a);
        return a;
      };

      // Hard failures / throttling on the workers (built-in AWS/Lambda metrics).
      alarm("RapExtractErrors", { namespace: "AWS/Lambda", metricName: "Errors", statistic: "Sum", period: 300, dimensions: { FunctionName: rapExtract.name } });
      alarm("RapExtractThrottles", { namespace: "AWS/Lambda", metricName: "Throttles", statistic: "Sum", period: 300, dimensions: { FunctionName: rapExtract.name } });
      alarm("BriefGenErrors", { namespace: "AWS/Lambda", metricName: "Errors", statistic: "Sum", period: 300, dimensions: { FunctionName: briefGen.name } });
      // A payload landed in the dead-letter queue — a worker died before it
      // could mark the job failed.
      alarm("ExtractDlqNotEmpty", { namespace: "AWS/SQS", metricName: "ApproximateNumberOfMessagesVisible", statistic: "Maximum", period: 300, dimensions: { QueueName: extractDlq.name } });
      // A job hung in EXTRACTING without the worker erroring. period 900 matches
      // StuckJobMonitor's cadence.
      alarm("StuckExtractionJobs", { namespace: "Indigenomics/RapExtraction", metricName: "StuckExtractionJobs", statistic: "Maximum", period: 900, dimensions: { Stage: $app.stage } });
      // Unresolved FAILED jobs. THIS is what catches the SCP-outage shape: the
      // worker CATCHES its errors and returns {status:failed} (stage-extraction.ts
      // "Never throws"), so the Lambda succeeds and AWS/Lambda Errors + the DLQ
      // never fire. Only a scan of the FAILED partition sees a handled failure.
      // Self-clears when the operator retries/dismisses (#194).
      alarm("FailedExtractionJobs", { namespace: "Indigenomics/RapExtraction", metricName: "FailedExtractionJobs", statistic: "Maximum", period: 900, dimensions: { Stage: $app.stage } });

      // The scanner that emits the StuckExtractionJobs metric (EMF). Mirrors the
      // NotifyDigest/CaseMonitor cron shape; thin handler over scanStuckExtractions.
      new sst.aws.Cron("StuckJobMonitor", {
        schedule: "rate(15 minutes)",
        function: {
          handler: "src/functions/stuck-job-monitor.handler",
          timeout: "60 seconds",
          memory: "256 MB",
          link: [rapData], // IAM for listByStatus (GSI1 Query); table name via env below
          environment: { REPO_IMPL: "dynamo", RAP_TABLE: rapData.name, STAGE: $app.stage },
        },
      });

      // One-pane extraction health, for the demo and for on-call. Read top-to-
      // bottom: are we healthy (alarm grid) → is anything queued wrong (custom
      // counts) → is the worker erroring/throttling → how long is it taking →
      // did anything hit the DLQ. $jsonStringify resolves the function/queue
      // name Outputs into the dashboard body. 24-column grid.
      const G = "Indigenomics/RapExtraction"; // custom namespace
      const REGION = process.env.SST_AWS_REGION ?? "us-east-1";
      new aws.cloudwatch.Dashboard("ExtractionHealth", {
        dashboardName: `indigenomics-${$app.stage}-extraction-health`,
        dashboardBody: $jsonStringify({
          widgets: [
            // Row 0 — alarm status grid (green/red at a glance).
            {
              type: "alarm",
              x: 0, y: 0, width: 24, height: 3,
              properties: { title: "Alarms", alarms: alarms.map((a) => a.arn) },
            },
            // Row 1 — extraction queue health (the two custom EMF metrics).
            {
              type: "metric",
              x: 0, y: 3, width: 12, height: 6,
              properties: {
                title: "Extraction queue health (jobs)",
                region: REGION,
                stat: "Maximum",
                period: 900,
                view: "timeSeries",
                yAxis: { left: { min: 0 } },
                metrics: [
                  [G, "FailedExtractionJobs", "Stage", $app.stage, { label: "Failed (unresolved)" }],
                  [G, "StuckExtractionJobs", "Stage", $app.stage, { label: "Stuck in EXTRACTING" }],
                ],
              },
            },
            // Row 1 — worker invocations + hard errors/throttles.
            {
              type: "metric",
              x: 12, y: 3, width: 12, height: 6,
              properties: {
                title: "RapExtract worker (5-min sums)",
                region: REGION,
                stat: "Sum",
                period: 300,
                view: "timeSeries",
                yAxis: { left: { min: 0 } },
                metrics: [
                  ["AWS/Lambda", "Invocations", "FunctionName", rapExtract.name, { label: "Invocations" }],
                  ["AWS/Lambda", "Errors", "FunctionName", rapExtract.name, { label: "Errors (throws/timeouts)" }],
                  ["AWS/Lambda", "Throttles", "FunctionName", rapExtract.name, { label: "Throttles" }],
                ],
              },
            },
            // Row 2 — extraction duration (the 90s–7min question) vs the 900s cap.
            {
              type: "metric",
              x: 0, y: 9, width: 12, height: 6,
              properties: {
                title: "RapExtract duration (ms) — ceiling is the 900s timeout",
                region: REGION,
                period: 300,
                view: "timeSeries",
                yAxis: { left: { min: 0 } },
                metrics: [
                  ["AWS/Lambda", "Duration", "FunctionName", rapExtract.name, { stat: "p50", label: "p50" }],
                  ["AWS/Lambda", "Duration", "FunctionName", rapExtract.name, { stat: "p90", label: "p90" }],
                  ["AWS/Lambda", "Duration", "FunctionName", rapExtract.name, { stat: "Maximum", label: "max" }],
                ],
              },
            },
            // Row 2 — dead-letter depth (hard-crash capture).
            {
              type: "metric",
              x: 12, y: 9, width: 12, height: 6,
              properties: {
                title: "Dead-letter queue depth",
                region: REGION,
                stat: "Maximum",
                period: 300,
                view: "timeSeries",
                yAxis: { left: { min: 0 } },
                metrics: [
                  ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", extractDlq.name, { label: "Messages in DLQ" }],
                ],
              },
            },
          ],
        }),
      });
    }

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

    // Weekly overdue-milestone digest (spec 2026-07-25). Prod-only so dev/ca
    // stages never emit stray emails; the institute /notifications BUTTON path
    // (Web server action) runs in every stage for the showcase demo.
    if (isProd) {
      new sst.aws.Cron("NotifyDigest", {
        schedule: "cron(0 13 ? * MON *)", // Mondays 13:00 UTC (~6am PT)
        function: {
          handler: "src/functions/notify-digest.handler",
          timeout: "120 seconds",
          memory: "512 MB",
          link: [notifications, commitments],
          permissions: [{ actions: ["ses:SendEmail"], resources: ["*"] }],
          environment: {
            REPO_IMPL: "dynamo",
            NOTIFICATIONS_TABLE: notifications.name,
            COMMITMENTS_TABLE: commitments.name,
            DIGEST_SENDER: process.env.DIGEST_SENDER ?? "",
            DIGEST_RECIPIENT: process.env.DIGEST_RECIPIENT ?? "",
          },
        },
      });
    }

    // HMAC key for signing session cookies (auth.ts). Set per stage with:
    //   npx sst secret set AuthSecret <random-string> --stage <stage>
    const authSecret = new sst.Secret("AuthSecret");

    new sst.aws.Nextjs("Web", {
      // Least-privilege access to exactly these resources (tables + GSIs + buckets).
      link: [dataPortal, rapSurvey, rapData, rapUploads, exports, rapAnalytics, commitments, alignment, casesIndex, notifications],
      transform: {
        server: {
          // Holds the BM25 search-index artifact (~155MB bm25.bin) + the Next.js
          // runtime. NOTE: dense retrieval's vectors.bin is ~979MB — loading it
          // into this request Lambda OOMs even at the account's 3008MB cap, so
          // dense is opt-in via CASES_EMBED_PROVIDER (see the Web env below) and
          // OFF where memory can't hold it. Re-enabling dense in a Lambda needs a
          // memory-quota increase, or better, moving dense off the request path.
          memory: "2048 MB",
          // Bedrock/Textract aren't SST-linkable → attach IAM directly. Plus
          // permission to invoke the async extraction worker.
          permissions: [
            ...bedrockPerms,
            { actions: ["lambda:InvokeFunction"], resources: [rapExtract.arn] },
            { actions: ["lambda:InvokeFunction"], resources: [briefGen.arn] },
            // Weekly digest button (Task 6): the /notifications server action
            // sends the SES email inline (no worker Lambda needed for this path).
            { actions: ["ses:SendEmail"], resources: ["*"] },
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
        // Attach the WAF WebACL (observe stages only) to the CloudFront
        // distribution. CLOUDFRONT association is by the WebACL ARN. Verify the
        // arg name (webAclId) against the installed SST version.
        cdn: (args: any) => {
          if (webAcl) args.webAclId = webAcl.arn;
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
        // Explore (/commitments/explore, getIndexFacts) data source. On the two
        // real-extraction stages (ca + production) use "merge": Explore shows the
        // seeded commitments demo AND approved RAP extractions, unioned/deduped,
        // so it stays rich while real RAPs appear as they're confirmed. Other
        // stages keep the default (seeded only). An env override still wins.
        RAP_INDEX_SOURCE: process.env.RAP_INDEX_SOURCE ?? (observe ? "merge" : ""),
        ALIGNMENT_TABLE: alignment.name,
        // Weekly overdue-milestone digest (spec 2026-07-25): the institute
        // /notifications button (server action) reads/writes this table and
        // sends via SES using the same env the cron uses.
        NOTIFICATIONS_TABLE: notifications.name,
        DIGEST_SENDER: process.env.DIGEST_SENDER ?? "",
        DIGEST_RECIPIENT: process.env.DIGEST_RECIPIENT ?? "",
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
        // Briefing model — THIS is the value that takes effect: actions.ts records
        // `model` on the brief record at creation time and run.ts prefers
        // `brief.model` over its own env, so setting this only on BriefGen would be a
        // no-op. Claude Sonnet 4.6 via the `us.` CROSS-REGION INFERENCE PROFILE; the
        // bare id is rejected by Bedrock for on-demand invoke (see the BriefGen block
        // and src/lib/rap/bedrock-model.ts). Web only records the id — BriefGen invokes.
        BRIEF_MODEL: process.env.BRIEF_MODEL ?? "us.anthropic.claude-sonnet-4-6",
        // Dense retrieval (spec 2026-07-06). EMBED_REGION=us-east-1 overrides the
        // inherited extractionEnv BEDROCK_REGION=ca-central-1 for cases embedding
        // ONLY — RAP extraction still uses ca-central-1. The query router keeps
        // dense's embed call to conceptual/topical queries; known-item stays BM25.
        //
        // Dense is back ON (2026-07-30) now that the vectors artifact is QUANTIZED. It was
        // briefly defaulted to stub because the float32 segment was ~985MB and loading it cost
        // three concurrent copies, which OOMs even at the account's 3008MB cap (observed on the
        // ca stage) — so no memory tier could hold it, and production was configured for a load
        // that cannot succeed (deploy.yml passes no override). MEASURED after quantization on
        // the real corpus of 240,245 vectors: 984.0MB → 30.8MB binary resident + 246.0MB int8
        // streamed to /tmp (ephemeral storage does not count against MemorySize), binary top-200
        // coverage of the true top-10 0.9940, Recall@10 0.7855 binary-only → 0.9750 with int8
        // rescoring, against a 0.95 gate (scripts/cases-quant-eval.ts, re-runnable).
        //
        // Request-path note: 277.7MB streams on cold start instead of the ~157MB bm25-only path,
        // so expect the first search after a cold start to be slower — but per-query work goes
        // DOWN, because an exhaustive Hamming scan over 30.8MB replaces a float32 dot product
        // over 984MB. Set CASES_EMBED_PROVIDER=stub to roll dense back off without a code change.
        EMBED_PROVIDER: process.env.CASES_EMBED_PROVIDER ?? "bedrock",
        EMBED_MODEL: "amazon.titan-embed-text-v2:0",
        EMBED_DIM: "1024",
        EMBED_REGION: "us-east-1",
      },
    });
  },
});
