# 12 · Cost Management Plan

The single most important financial fact in this whole handoff: **today the platform costs almost
nothing because AWS credits cover it — in the Institute's own account, that becomes real money, and
almost all of it is AI inference.** This document explains where the cost comes from, what drives it
up or down, and the concrete levers and day-one steps to keep it under control.

Figures here are the **real billing numbers** from the audit ([01 · Project Audit §3](./01-project-audit.md),
AWS Cost Explorer, Jan–Aug 2026); this document turns them into a forward plan.

Companion documents: [01 · Project Audit](./01-project-audit.md) (the raw cost report),
[03 · Engine Comparison](./03-rap-engine-comparison.md) (per-engine cost),
[09 · Product Roadmap](./09-product-roadmap.md) (cheap-infra wins). Glossary in the [README](./README.md).

---

## Part A · The headline

- **Gross AWS usage, Jan–Aug 2026: ≈ $371.** Net out-of-pocket: **effectively zero** (a few cents) —
  because the shared/university account's bill is covered by **AWS credits.**
- **The Institute's own account will not have those credits.** That ~$371 of usage becomes real
  money.
- **≈ 98% of the cost is AI (Amazon Bedrock LLM) inference** — reading documents and generating
  briefings. Everything else — servers, database, storage, delivery — totaled **~$7 over seven
  months (~$1/month)** and fits inside AWS's always-free allowances at this scale.

**The one-sentence model:** *cost scales with how much AI extraction and generation you run — not
with uptime.* An idle platform costs about a dollar a month; a platform re-processing large corpora
costs real money.

---

## Part B · Where the money goes

From the real billing data (Jan–Aug 2026, gross):

| Category | Gross | Share | What it is |
|---|---:|---:|---|
| **Bedrock LLM inference** (Claude Haiku/Sonnet, Llama, Titan, BDA) | **~$364** | **~98%** | Document extraction, labeling, eval loops, brief generation |
| Amazon Textract | $0.63 | <1% | OCR (low — was SCP-blocked in the sandbox) |
| EC2/VPC (one-off) | ~$4.37 | ~1% | A corpus/embedding build box |
| DynamoDB / S3 / Config / CloudWatch / CloudFront / SQS | <$3 total | ~1% | The serverless infrastructure |

**And it is bursty.** Of the ~$371, **$366 was a single month (July)** — the capstone crunch of
re-running extraction over corpora and eval loops. Months with no development ran **from ~$0.14 (Mar–Jun combined) to ~$4/month.**
This is *development* volume, not steady-state serving.

---

## Part C · What it will cost the Institute (planning anchors)

Grounded in the measured usage:

| Scenario | Cost | Notes |
|---|---|---|
| **Idle** (running, occasional demo, no bulk extraction) | **~$1–3/month** | Non-AI infra rate; fits free tiers; Bedrock ≈ $0 when not extracting |
| **Cold storage** (compute torn down, data kept) | **~$1/month** | S3 + a database export |
| **Torn down entirely** | **$0** | `sst remove` (note: production is `retain`, so its buckets survive and need manual cleanup) |
| **Active development / bulk re-extraction** | **~$50–350/month** | The measured heavy-dev range |
| **Steady serving to end users** (no bulk re-extraction) | **a fraction of the dev range** | Variable cost is dominated by extraction volume |

The variable cost is **entirely LLM inference**, proportional to how many documents are extracted and
how many briefings are generated.

---

## Part D · The levers (how to control it)

**Biggest lever — control extraction/generation volume:**
- **Extract on demand, not in bulk.** The costly pattern is re-running extraction across whole
  corpora. Steady-state serving of already-extracted data is cheap.
- **Choose the cheaper engine where appropriate.** Per the [engine comparison (03)](./03-rap-engine-comparison.md),
  on the same 8-document test the engines cost **~$2.13 (text-layer) vs. ~$3.44 (Textract-LAYOUT) vs.
  ~$7.92 (BDA)** — BDA is ~3.7× the cheapest. Text-layer is the residency-friendly, lowest-cost
  option for born-digital PDFs; Textract-LAYOUT is the recommended default for quality. Matching
  engine to need is a direct cost lever.
- **Cache / avoid re-work.** Don't re-extract unchanged documents; the platform already avoids
  overwriting a RAP once progress is recorded.

**Cheap infrastructure wins** (small config changes, from [09 · Roadmap](./09-product-roadmap.md)):
- **Run Lambdas on arm64** (Graviton) — roughly **20% cheaper** compute.
- **Add S3 lifecycle rules** (expire old uploads/exports) and **DynamoDB TTL** on staging rows.
- **Reduce CloudWatch log retention** from the 30-day default where not needed.

These infra levers matter less in absolute dollars (~$1/month base) but are free wins and good
hygiene as traffic grows.

---

## Part E · Day-one actions (do these when you take the account)

1. **Set an AWS Budget alarm immediately** — e.g. alert at $25, $50, $100/month. This is the single
   most important safeguard; it turns a runaway extraction job into an email, not a surprise invoice.
2. **Confirm whether any credits apply** to the Institute's account (most won't have the sandbox's) —
   and plan for the real rate if not.
3. **Watch the first real extraction run** and note its cost, so you have a per-document anchor for
   your own usage.
4. **Turn on Cost Explorer** and check it monthly (there is **no in-app cost dashboard** — cost
   monitoring is done in the AWS console; see [08 · Content Stewardship §H](./08-content-stewardship-runbook.md)).
5. **Right-size before scaling** — apply the arm64 / lifecycle / TTL wins (Part D) before any large
   corpus run.

---

## Part F · What to watch as the platform grows

- **Bulk corpus ingestion is the cost event to plan for.** If the Institute decides to extract a large
  library of real RAPs (see [09 · Roadmap](./09-product-roadmap.md)), model that as a **one-time
  project cost**, estimate it from a small pilot run first, and set a budget for it — don't run it
  open-ended.
- **Briefing/Q&A generation** also consumes inference; heavy use of the legal-cases assistant adds
  variable cost.
- **SES email** (the digest) is negligible at this scale but requires production access (see
  [09](./09-product-roadmap.md)).
- **Steady-state serving stays cheap** — the serverless stack scales to near-zero when idle, which is
  the platform's cost advantage.

---

*This plan is anchored in real billing data (net ≈ $0 in the credit-covered sandbox; ~$371 gross,
~98% Bedrock inference, with $366 of it a single development month). The takeaway for the Institute:
budget for **AI inference proportional to how much you extract/generate**, protect the account with a
Budget alarm on day one, and treat any bulk re-extraction as a planned, estimated project rather than
a background activity.*
