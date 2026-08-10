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

---

## See it running

A live demo of the current build is deployed (in the sandbox account):

- **Production demo:** https://d1hwn8hhp1ytc0.cloudfront.net
- **Canadian-residency demo:** https://d20w6ctg8j4zg2.cloudfront.net

You can sign in to explore. All demo accounts share the password **`demo-portal-2026`**:

- **Indigenomics staff view** (the review/extraction queue): `institute@demo`
- **A company view** (their own RAP commitments): e.g. `atb-financial@demo` or `bc-hydro@demo`
  (the full list of 103 demo organizations is in `../demo-org-logins.md`)

> These demo accounts and the shared password are **for exploring the sandbox demo only**. They
> must be **purged before real use** — see the data-hygiene checklist in
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
- **Demo data must be replaced** — 103 demo logins, a shared password, a hand-curated
  business-number crosswalk flagged "verify before production," and sample corpora that include
  copyright-sensitive third-party RAP content. *(01 §4.4; 02 §5.3)*
- **Security filter (WAF) ships in "count-only" mode** — it watches and reports but does not yet
  block; flip it to blocking after a short observation window. *(04; 02 §7)*
- **Engine robustness is real but imperfect** — on the test set one engine failed on one
  malformed PDF and another on one document with unusual text geometry; text-layer has no OCR so
  it cannot read scanned (image-only) PDFs. *(03, "Findings")*
- **Some internal documentation says "SST v3"** while the code uses v4 — reconcile before the
  first deploy. *(02 §1; 01 Appendix)*

---

*These are point-in-time handoff copies. The living versions of 01–03 are in the repository at
`docs/PROJECT-AUDIT.md`, `docs/DEPLOY-RUNBOOK.md`, and `docs/rap-engine-comparison.md`; the
Monitoring & Security brief (04) was authored in the team's working folder and its delivered copy
is the one in this package. Cost figures are real AWS Cost Explorer data (unblended, Jan–Aug 2026);
the engine comparison is a live n=8 run.*
