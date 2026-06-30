/// <reference path="./.sst/platform/config.d.ts" />

// ===========================================================================
// SST v3 (Ion) + OpenNext — all-AWS hosting for the RAP Data Portal (RAP-28).
//
// One config provisions: the two DynamoDB tables (DataPortal + RapSurvey), a
// stubbed S3 export bucket (Horizon 2 / OCAP), and the Next.js App Router site
// running as Lambda behind CloudFront.
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
    // RAP commitments index (Commitment) — the commitments dashboard
    const commitments = new sst.aws.Dynamo("Commitments", singleTableShape);

    // Horizon 2: OCAP "export my records" → S3 object + short-lived signed URL.
    // Provisioned now (empty buckets are free) so the export route can link to
    // it later without an infra change. Linked for IAM but unused by the MVP.
    const exports = new sst.aws.Bucket("Exports");

    new sst.aws.Nextjs("Web", {
      // Grants the Lambda execution role least-privilege access to exactly these
      // resources (the two tables + their GSIs, and the export bucket).
      link: [dataPortal, rapSurvey, commitments, exports],
      environment: {
        REPO_IMPL: "dynamo",
        // The app resolves table names from these env vars (client.ts:21 +
        // survey-table.ts:15 + commitments-table.ts), not from the SST Resource
        // object — so we feed the SST-managed names through, and the data layer
        // is unchanged.
        DYNAMO_TABLE: dataPortal.name,
        SURVEY_TABLE: rapSurvey.name,
        COMMITMENTS_TABLE: commitments.name,
        // NOTE: AWS_REGION is a reserved Lambda env var, auto-set by the runtime
        // to the function's region (us-east-1) — do not set it here. The
        // client.ts fallback only matters for local runs.
      },
    });
  },
});
