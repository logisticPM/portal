# Indigenomics RAP Data Portal — Client Handoff Package

This folder is the delivery package for the Indigenomics RAP Data Portal. It gathers, in
one place, everything you need to understand the platform, run it in your own environment,
choose how it reads documents, and know what it costs and where its limits are.

Each document is provided as both **Markdown (`.md`)** and **PDF (`.pdf`)**. Start with this
page, then read in the order numbered below.

---

## Read this first — what you must know

**1. The platform runs today in a shared university *sandbox* account — you will need your own AWS account.**
Everything you see running now lives in a shared account (`106189426706`) provided through the
university. To operate the platform yourself, you deploy it into an **AWS account you own**.
The full step-by-step is in **[02 · Deploy Runbook](./02-deploy-runbook.md)**, which is written
specifically for a fresh, client-owned account. Nothing about the product ties it to the sandbox.

**2. Today the bill is ~$0 because of credits — in your account it becomes real money.**
Over seven months (Jan–Aug 2026) the platform used **≈ $371 of AWS services gross**, but the
**net out-of-pocket was ≈ $0.06** because the sandbox account's bill is covered by AWS credits.
**Your own account will not have those credits.** About **98% of the cost is AI (Amazon Bedrock
LLM) inference** — reading documents and extracting commitments. The rest of the platform
(servers, database, storage) runs for roughly **$1/month** and fits inside AWS's always-free
allowances at this scale. **Set an AWS Budget alarm on day one.** Full figures and the
month-by-month breakdown are in **[01 · Project Audit](./01-project-audit.md) §3**.

**3. The current limitations you may have heard about are the *sandbox's*, not the product's.**
Two AWS services (Textract OCR and CloudTrail) are blocked in the sandbox by a policy set by the
parent university organization — **not** by our software. In **your own account those blocks do
not exist**, so you *gain* the full document-OCR path and audit logging. Do not carry these
constraints forward as if they were built into the product. Details: **[01 · Project Audit](./01-project-audit.md) §4.3**.

**4. Canadian data residency: hosting is not the same as AI inference.**
Platform data can rest in Canada (`ca-central-1`). However, **Amazon's Bedrock AI models are not
hosted in Canada**, so the AI-reading step routes to a US/global region regardless of settings —
this is an AWS limitation, not a design choice, and it is the same for every extraction engine.
"In Canada" therefore means *data-at-rest and document-reading in Canada; the AI inference step
still leaves Canada.* See **[03 · Engine Comparison](./03-rap-engine-comparison.md)** and
**[01 · Project Audit](./01-project-audit.md) §4.2**.

**5. A human still needs to review AI extractions — that cannot be automated away.**
We tested whether a second AI could "check" the extraction AI's work automatically; on this kind
of data it does not work reliably (the two judges agreed no better than chance). Whichever engine
you choose, the **human-in-the-loop review step stays essential**. See
**[03 · Engine Comparison](./03-rap-engine-comparison.md)**, "Cross-cutting caveat."

---

## What's in this package

| # | Document | What it is | Primarily for |
|---|---|---|---|
| — | **README** (this file) | Orientation, the key things to know, and how to explore the live demo. | Everyone |
| 01 | **[Project Audit](./01-project-audit.md)** | The whole platform at a glance: architecture, **real cost figures**, what changes moving to your own account, data hygiene, and the top risks. | Decision-makers + whoever owns the AWS account |
| 02 | **[Deploy Runbook](./02-deploy-runbook.md)** | A linear "zero → running" checklist to stand the platform up in a fresh AWS account: prerequisites, per-account setup, region/residency choice, turning on real AI, verification, cost & teardown, troubleshooting. | Whoever deploys it |
| 03 | **[RAP Engine Comparison](./03-rap-engine-comparison.md)** | A live, measured comparison of the three document-extraction engines, with a recommendation for your account and whether each is valid in Canada. | Technical + product |
| 04 | **[Monitoring & Security Brief](./04-monitoring-and-security-brief.md)** | Plain-language summary of the self-monitoring and the security filter (WAF) we added, and their known limits. | Everyone |
| 05 | **[Design Decisions & User Journeys](./05-design-decisions-and-user-journeys.md)** | How each of the three users (business, supplier, Institute) uses the platform end-to-end, and **why** key choices were made (BN identity, the review gate, multiple engines, evidence precedence, …). Also documents the **Alignment** and **Notifications** tabs and their caveats. | Everyone |
| 06 | **[RAP Research — Data Verification & How Commitments Vary](./06-rap-research-data-verification-and-commitment-variation.md)** | What we learned about **verifying data sources** (the locate-and-quote contract, the human review gate, the κ≈0 finding that ruled out AI auto-validation) and how real RAPs **vary** — inconsistent terminology, and many commitments with **no due date and no measurable target**. Candid but evidenced, with the honest limits. | Everyone |

---

## See it running

A live demo of the current build is deployed (in the sandbox account):

- **Production demo:** https://d1hwn8hhp1ytc0.cloudfront.net
- **Canadian-residency demo:** https://d20w6ctg8j4zg2.cloudfront.net

You can sign in to explore. All demo accounts share the password **`demo-portal-2026`**:

- **Indigenomics staff view** (the review/extraction queue): `institute@demo`
- **A company view** (their own RAP commitments): e.g. `atb-financial@demo` or `bc-hydro@demo`
  (the full list of the 103 demo company logins is in `../demo-org-logins.md`; 100 map to real,
  publicly-sourced organizations, 3 are fictional demo companies)

> These demo accounts and the shared password are **for exploring the sandbox demo**. Before real
> use, the 103 demo *company* logins and the shared password should be removed — but **keep
> `institute@demo`** (giving it a real, private password) so the Indigenomics Institute keeps
> access through the transition. See the data-hygiene checklist in
> [01 · Project Audit](./01-project-audit.md) §4.4 and [02 · Deploy Runbook](./02-deploy-runbook.md) §5.3.

---

## Known limitations & caveats (consolidated)

Each is explained where it matters in the documents above; collected here so nothing is a surprise.

- **Cost is credit-subsidized today.** ~$371 gross → ≈ $0.06 net because of credits you will not
  have. ~98% is Bedrock AI inference and it is **bursty** — bulk extraction runs it up fastest.
  *(01 §3, §5.6)*
- **You need your own AWS account**, with a handful of one-time setup steps (a session secret,
  Bedrock model access, an email sender identity, and — only if you use the BDA engine — your own
  document-automation project). *(02 §2; 01 §4.1)*
- **AI inference is not available in Canada.** Data and document-reading can be in-country; the
  AI model call cannot. *(03; 01 §4.2)*
- **The legal-cases dataset is the trickiest thing to move** — it is not auto-created with the
  rest and must be either exported to you or rebuilt from source. *(01 §4.1; 02 §5.2)*
- **AI extraction needs human review.** Automated AI-checks-AI validation does not transfer to
  this data. *(03)*
- **Demo data must be replaced** — 103 demo company logins, a shared password, a hand-curated
  business-number crosswalk flagged "verify before production," and sample corpora that include
  copyright-sensitive third-party RAP content. **Keep `institute@demo`** (with a real password) for
  the Institute's access. A purge script (`scripts/purge-demo-logins.ts`, dry-run by default) removes
  the `@demo` logins except a keep-list. *(01 §4.4; 02 §5.3)*
- **Only the `production` stage retains data on teardown** — every other stage, **including the
  Canadian `ca` stage**, is destroyed (tables, buckets, and data) by `sst remove`. Protect a real
  `ca` residency environment deliberately (backups / point-in-time recovery) before it holds real
  data. *(02 §0, §8)*
- **Security filter (WAF) ships in "count-only" mode** — it watches and reports but does not yet
  block; flip it to blocking after a short observation window. *(04; 02 §7)*
- **Engine robustness is real but imperfect** — on the test set one engine failed on one
  malformed PDF and another on one document with unusual text geometry; text-layer has no OCR so
  it cannot read scanned (image-only) PDFs. *(03, "Findings")*
- **Some internal documentation says "SST v3"** while the code uses v4 — reconcile before the
  first deploy. *(02 §1; 01 Appendix)*

---

## AWS & platform terms, in plain language

The documents in this package use some Amazon Web Services (AWS) and technical terms. Here is what
they mean and how this platform uses each — you can refer back to this while reading.

| Term | What it means (and how this platform uses it) |
|---|---|
| **AWS** | Amazon Web Services — the cloud provider the whole platform runs on. |
| **AWS account** | Your own, isolated space within AWS, with its own login, resources, and bill. Today the platform runs in a shared *sandbox* account; you would run it in your own. |
| **Region** | A geographic location where AWS runs its data centres (e.g. `us-east-1` = Virginia, `ca-central-1` = Montreal). Where your data physically lives. |
| **Lambda** | A small piece of code that runs on demand without a server to manage — you pay only when it runs. The app itself and the document-reading jobs run as Lambdas. |
| **CloudFront** | AWS's content delivery network — the fast, secure front door that serves the website to visitors. Its address is the `…cloudfront.net` URL. |
| **DynamoDB** | AWS's managed database — where organizations, RAPs, and commitments are stored. |
| **S3** | AWS's file storage — where uploaded PDFs and generated data files are kept. |
| **Bedrock** | AWS's service for running AI (large language) models. **This is where almost all the cost is** — it reads documents and extracts commitments. |
| **Inference / inference profile** | "Inference" is the act of running the AI model on your input. An "inference profile" tells AWS which region runs it. Bedrock has no Canadian inference profile, so the AI step runs in the US even when data rests in Canada. |
| **Textract** | AWS's document-reading (OCR) service — turns a PDF's pages into text the AI can process. Blocked in the sandbox by org policy; available in your own account. |
| **BDA (Bedrock Data Automation)** | An alternative, managed AWS document-extraction engine — one of the three engines compared in doc 03. |
| **SES (Simple Email Service)** | AWS's email-sending service — used to send the monitoring alert emails and notifications. |
| **WAF (Web Application Firewall)** | A security filter in front of the website that screens traffic and can block harmful requests (doc 04). |
| **SCP (Service Control Policy)** | An organization-wide rule set by whoever owns the parent AWS organization. The sandbox's SCPs block Textract/CloudTrail — these are the university org's rules and **disappear in your own account**. |
| **ARN (Amazon Resource Name)** | The unique full address of an AWS resource (a long `arn:aws:…` string). A few are hardcoded to the sandbox account and must be recreated in yours (01 §4.1). |
| **SST** | The open-source toolkit used to define and deploy all the AWS resources with one command (`sst deploy`). |
| **OpenNext** | The adapter that lets the Next.js website run on AWS Lambda + CloudFront. |
| **SSM / Parameter Store** | AWS's secure store for configuration secrets (e.g. the session signing key). |
| **OIDC + deploy role** | A secure way to let the code repository deploy to AWS automatically, without long-lived passwords. Optional. |
| **PITR (point-in-time recovery)** | A DynamoDB backup feature that lets you restore the database to an earlier moment — recommended for a real `ca` environment. |
| **CloudWatch / X-Ray** | AWS's monitoring and request-tracing tools — used for the self-monitoring in doc 04. |
| **`retain` vs `remove`** | Whether a stage's data survives teardown. Only `production` is `retain`; `ca` and others are `remove` (deleted by `sst remove`). See 02 §0. |

---

*These are point-in-time handoff copies. The living versions of 01–03 are in the repository at
`docs/PROJECT-AUDIT.md`, `docs/DEPLOY-RUNBOOK.md`, and `docs/rap-engine-comparison.md`; the
Monitoring & Security brief (04) was authored in the team's working folder and its delivered copy
is the one in this package. Cost figures are real AWS Cost Explorer data (unblended, Jan–Aug 2026);
the engine comparison is a live n=8 run.*
