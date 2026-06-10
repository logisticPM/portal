# RAP-8 · AWS Architecture Spike — Indigenomics Data Portal

**Owner:** Shiting Huang · **Card:** RAP-8 (architecture spike, scoped to AWS) · **Date:** 2026-06-07
**Status:** Proposal for team review (produced by En-Ping's session; reconcile against the design spec before building)

> Context: the app is a Next.js 14 (App Router) + TypeScript + Tailwind portal. A company reports itemized procurement lines naming Indigenous suppliers; each supplier confirms/disputes; output is a reported-vs-confirmed "RAP Index." The team uses **AWS**, data layer is **DynamoDB (single-table)**. The code is built contract-first: the UI calls a `PortalRepo` interface; today it runs on an in-memory mock and swaps to DynamoDB by flipping `REPO_IMPL=dynamo`. See `docs/specs/2026-06-05-data-portal-demo-design.md`.

---

## 1. The one decision that matters: how to host a Next.js App Router app on AWS

Next.js App Router uses **Server Components + Server Actions + dynamic SSR**, so we can't just dump static files in S3 — we need server compute. On AWS there are three realistic paths:

| Option | What it is | Pros | Cons | Fit for us |
|---|---|---|---|---|
| **SST v3 (Ion) + OpenNext** | IaC framework that builds Next via **OpenNext** and provisions Lambda + CloudFront + S3 (and your DB/auth) from one `sst.config.ts` | Free (pay only AWS usage); full control; **provisions DynamoDB, S3, Cognito in the same config**; portable; great local `sst dev` | Steeper learning curve; you own the infra | **Primary pick** — all-AWS, IaC, teaches the stack, one tool for app+data |
| **AWS Amplify Hosting (Gen 2)** | Managed Next.js hosting with built-in CI/CD; supports Next 12–15 SSR | Easiest setup; managed CI/CD from Git; CDN included | Less control; **no direct CDK integration** (abstraction lock-in); infra lives in Amplify's world | **Fallback** — use if SST proves fiddly before June 24 |
| **OpenNext + AWS CDK (raw)** | OpenNext as a CDK construct in your own CDK app | Maximum control; uniform if all infra is CDK | Most boilerplate; overkill for a capstone | Not recommended now |

**Recommendation: SST v3 with OpenNext as primary; Amplify Hosting Gen 2 as the fast fallback.** SST lets the team define the Next.js app *and* the DynamoDB table *and* (later) Cognito + an S3 export bucket in a single TypeScript config, deploy with `sst deploy`, and get a real local dev loop with `sst dev` — which is exactly what a team learning AWS wants. If the June 24 demo deadline gets tight, Amplify Gen 2 is a one-click-from-Git escape hatch (it natively runs App Router SSR), and we can migrate to SST after.

> Note: the design spec's default was "Vercel for the app + DynamoDB via a server-side IAM key, swap to Amplify/SST if all-AWS is required." Since the team has chosen AWS, we go straight to the all-AWS path (SST), and Vercel becomes irrelevant.

---

## 2. Target architecture (all-AWS, SST)

```
                       ┌─────────────────────────────────────────────┐
   Browser  ──────────▶│  CloudFront (CDN)            [SST/OpenNext]  │
                       │   ├── static assets ─────▶ S3 (Next assets)  │
                       │   └── SSR / Server Actions ─▶ Lambda (Next    │
                       │                              server function) │
                       └───────────────┬─────────────────────────────┘
                                       │ @aws-sdk/lib-dynamodb (server-side, IAM role)
                                       ▼
                       ┌─────────────────────────────────────────────┐
                       │  DynamoDB  (single table: DataPortal)        │
                       │   PK/SK + GSI1 (supplier inbox) + GSI2 (role)│
                       └─────────────────────────────────────────────┘
   OCAP export ───────▶  S3 (export bucket)         [Horizon 2: signed URLs]
   Auth (real) ───────▶  Amazon Cognito             [Horizon 2; MVP uses role-switcher]
```

- **Compute:** the Next.js server runs as a Lambda function (OpenNext packages it). Server Components and **Server Actions** (our `createLineAction`, `respondToLine`, `withdrawConfirmations`) run there. Streaming SSR is supported. The UI **never** imports the AWS SDK — only the server-side `repo.dynamo.ts` does.
- **Data:** one DynamoDB table (see the companion doc `Backend_DynamoDB_DataModel_and_repo-dynamo.md`). The Lambda's **IAM execution role** grants least-privilege access to that table — no static AWS keys in the app.
- **Storage (Horizon 2):** the OCAP "export my records" route writes/reads an S3 object and returns a short-lived signed URL instead of streaming JSON inline.
- **Auth (Horizon 2):** Amazon Cognito (hosted UI or Amplify Auth) replaces the MVP role-switcher. Keep it out of the MVP.
- **Region:** `ca-central-1` (data residency — appropriate for Indigenous Canadian economic data and OCAP/data-sovereignty framing).

---

## 3. Security / IAM / secrets

- **No `NEXT_PUBLIC_` AWS keys, ever.** All AWS access is server-side from the Lambda role.
- Least-privilege IAM: the app role gets only `dynamodb:GetItem/PutItem/UpdateItem/Query/BatchWrite` on the one table (+ its GSIs), and (H2) `s3:GetObject/PutObject` on the export bucket prefix.
- Local dev uses **DynamoDB Local** (no real AWS creds needed) — see `SH_RAP7_Repo_CI_DevEnv/`.
- Secrets/config via SST `Secret` / SSM Parameter Store, not committed `.env`. The committed `.env.local.example` documents the keys.

---

## 4. Infrastructure as code (SST sketch)

```ts
// sst.config.ts  (illustrative — verify against current SST docs before use)
export default $config({
  app: (input) => ({ name: "indigenomics-portal", region: "ca-central-1" }),
  async run() {
    const table = new sst.aws.Dynamo("DataPortal", {
      fields: { PK: "string", SK: "string", GSI1PK: "string", GSI1SK: "string", GSI2PK: "string" },
      primaryIndex: { hashKey: "PK", rangeKey: "SK" },
      globalIndexes: {
        GSI1: { hashKey: "GSI1PK", rangeKey: "GSI1SK" }, // supplier pending inbox
        GSI2: { hashKey: "GSI2PK" },                      // parties by role
      },
    });
    const exports = new sst.aws.Bucket("Exports"); // H2 OCAP export
    new sst.aws.Nextjs("Web", {
      link: [table, exports],            // injects table name + grants IAM automatically
      environment: { REPO_IMPL: "dynamo", AWS_REGION: "ca-central-1" },
    });
  },
});
```

`link: [table]` is the key SST idiom — it wires the table name into the app's env and attaches the right IAM policy to the Lambda automatically, so `repo.dynamo.ts` just reads `Resource.DataPortal.name`.

---

## 5. Cost (capstone scale)

For a low-traffic demo + dev, expect **≈ free**:
- DynamoDB on-demand: pennies at synthetic-data volume (and AWS free tier covers 25 GB + 25 RCU/WCU equivalent).
- Lambda + CloudFront: free tier covers demo traffic.
- S3: negligible.
- Cognito (H2): free tier covers thousands of MAUs.
**Watch-outs:** leaving a NAT Gateway running (don't add a VPC unless required — DynamoDB doesn't need one), and forgetting to `sst remove` an unused stage. Set an AWS Budget alert at ~$5 to be safe.

---

## 6. Phased plan

- **MVP (by June 24):** keep running on the **mock** for the demo if Dynamo isn't ready; in parallel, stand up DynamoDB Local + `repo.dynamo.ts`, prove `REPO_IMPL=dynamo` works locally. Deploying to AWS for the demo is optional — a local run satisfies the spec's DoD.
- **Post-MVP:** `sst deploy` to `ca-central-1`; smoke-test all pages against real DynamoDB; add an AWS Budget alert + a CI deploy step.
- **Horizon 2:** Cognito auth, S3-backed OCAP export with signed URLs, materialized/precomputed Index for real-data scale.

---

## 7. Hand-off checklist for Shiting

- [ ] Decide SST vs Amplify (recommend SST; timebox a 1-day spike — if `sst dev` + a Dynamo table isn't running by then, fall back to Amplify).
- [ ] Add `sst.config.ts` defining the table (+ GSIs), the Next site, and (stubbed) export bucket.
- [ ] Confirm `repo.dynamo.ts` reads the linked table name (not a hardcoded value).
- [ ] DynamoDB Local for dev (see RAP-7 handoff); seed script creates the table + loads fixtures.
- [ ] AWS Budget alert at $5; region pinned to `ca-central-1`.

**Sources:** [OpenNext — Next.js on AWS](https://opennext.js.org/aws/comparison) · [SST](https://sst.dev) · [Amplify Gen 2 — Next.js App Router](https://docs.amplify.aws/nextjs/start/quickstart/nextjs-app-router-client-components/) · [Next.js on AWS deployment strategies](https://medium.com/@redrobotdev/next-js-on-aws-a-guide-to-common-deployment-strategies-a583772e7372)
