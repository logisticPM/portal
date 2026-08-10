# Design Decisions & User Journeys

This document explains **how the platform is used** (the three kinds of user and what each does,
start to finish) and **why it is built the way it is** (the design decisions behind the parts that
aren't obvious). It also covers two features the other handoff documents don't: the **Alignment**
and **Notifications** tabs.

Unfamiliar terms (Lambda, ARN, Bedrock, BN, …) are defined in the glossary in the
[README](./README.md). Companion documents: [01 · Project Audit](./01-project-audit.md),
[02 · Deploy Runbook](./02-deploy-runbook.md), [03 · Engine Comparison](./03-rap-engine-comparison.md),
[04 · Monitoring & Security](./04-monitoring-and-security-brief.md).

---

## Part A — The three user journeys

The platform serves **three kinds of user** (each login is exactly one kind). They see different
pages and can take different actions; a shared, public **RAP Index** and **Legal Cases** library sit
underneath all three.

### 1. Business / company

*A company that publishes a Reconciliation Action Plan (RAP) and reports its Indigenous-supplier spend.*

1. **Report supplier spend** — on their questionnaire they add itemized lines, each naming an
   Indigenous supplier, an amount, and a flow type (procurement or capital). New lines start as
   **"pending"** — unconfirmed until the named supplier responds.
2. **Watch coverage** — a read-only view shows what share of their reported spend has been
   *confirmed* by suppliers. It is framed as "a data view, not a rating."
3. **Track commitments** — they add and update their own RAP commitments, see **overdue / at-risk**
   alerts, and see **suggested Indigenous suppliers** for each procurement commitment (the Alignment
   feature, Part C).
4. **Claim their organization** — they enter their federal **Business Number (BN)** to claim the org.
   Claiming is what authorizes them to post progress against their published RAP.
5. **Upload & track their RAP** — they upload their RAP PDF (it goes to the Institute for
   AI-extraction and review), then record progress against the published, grounded commitments. The
   extracted text itself is read-only to them; they add progress on top. They can optionally opt their
   RAP onto the public Index.

### 2. Supplier (Indigenous business)

*An Indigenous-owned business that confirms the spend companies report against it and showcases its record.*

1. **Confirm inbox** — they see every line a company reported naming them, and respond:
   **Confirm / Dispute / Correct** (correction carries a corrected amount). The rule is
   *"silence is never confirmed"* — nothing counts as confirmed unless the supplier acts.
2. **My Record (data sovereignty)** — confirmed revenue accrues here; they can **export** their data
   (JSON) and **withdraw** confirmations at any time. This is a deliberate OCAP® gesture — the
   supplier owns and controls their data.
3. **Profile / showcase** — they edit a public profile (sector, region, website, blurb), toggle it
   public, and **claim certifications** (CCIB, ISC Indigenous Business Directory, a Nation, or a
   regional body) by linking an external reference — which stays *pending* until the Institute reviews it.
4. **Public showcase page** — a shareable public page shows their verification tier, confirmed track
   record, and spend breakdown.

### 3. Indigenomics Institute (staff)

*The steward that reviews extractions, verifies suppliers, monitors the network, and brokers matches.*

1. **RAP Index (landing)** — the network-wide dashboard: key takeaways, KPIs, status and
   confirmation-integrity charts, deadline/risk tables, sector/type breakdowns, and a full filterable
   commitment list with CSV export.
2. **Organizations & suppliers** — per-organization RAP scorecards, and a searchable directory of
   verified suppliers.
3. **Extract & review** — upload RAP PDFs and run AI extraction. Clean, high-confidence extractions
   **auto-publish**; anything the AI was unsure about is **flagged into a review queue** for a human to
   check against the source PDF and publish (guided by the reviewer guide at `/extract/guide`).
4. **Verify suppliers** — approve or reject supplier certification claims ("we verify the link; we
   don't re-certify").
5. **Alignment** — broker introductions between company procurement commitments and fitting verified
   suppliers (Part C).
6. **Coverage & integrity analytics** — confirmed-vs-reported spend, spend by ownership-certification
   tier, and integrity signals (e.g. certified-but-no-activity, self-declared-with-activity).
7. **Notifications** — generate/review the weekly overdue-and-at-risk milestone digest (Part C).

> **Small known rough edges (worth noting for a future team):** an internal `personaHome()` helper is
> defined but no longer used for routing (the real post-login path is `/home`, which sends the
> Institute to the RAP Index); the public landing page links to the RAP Index, but a logged-out
> visitor who clicks it is sent to the login page first; and the coverage/analytics view is readable by
> any signed-in user, not only the Institute. None affects data integrity; all are easy tidy-ups.

---

## Part B — Design decisions (the "why")

### B.1 Business Number (BN) as organization identity — resolved in the review queue

**Decision.** A published organization is keyed on its **federal Business Number**, resolved during
review (verified free against the ISED federal registry, with a pre-filled Corporations Canada
lookup link), **not** on the organization name the AI read from the document.

**Why.** *A name is not an identity.* The same brand can hide several legal entities, and one entity
can be written several ways:
- **False merge** — a RAP says "Enbridge," but Corporations Canada lists *three* distinct entities
  (Enbridge Inc., Enbridge Pipelines Inc., Enbridge Frontier Inc.), each with its own BN. A name key
  could attach commitments to the wrong legal entity.
- **False split** — "Enbridge Inc." vs "Enbridge Gas Inc." fragments one entity into two.

Only the BN disambiguates. Resolving it **at review** (before a RAP becomes canonical) means identity
is pinned by a human at exactly the moment the document enters the record — and the same BN is what
later authorizes the company to post progress. Entities the federal registry can't confirm (e.g.
provincial-only) publish as **self-asserted**, clearly badged, rather than being blocked.

### B.2 Human-in-the-loop review gate — not full auto-publish

**Decision.** Clean, high-confidence extractions publish automatically; anything the AI flags goes to
a **human review queue** before publishing.

**Why.** AI extraction is strong but not perfect, and this is a provenance-first, citation-anchored
platform where a wrong commitment attributed to a real company matters. Critically, our own study
(see [03](./03-rap-engine-comparison.md)) found that using a **second AI to "check" the first does not
work on this data** (the two AI judges agreed no better than chance, κ=0). So a human — not an
automated AI check — is the correct arbiter. Grounding (B.4) makes this fast: each flagged field shows
the exact quote and page to verify against.

### B.3 Two-to-three extraction engines — residency, provenance, and fallback

**Decision.** The platform can read documents through more than one engine, chosen along **two
independent switches**: *which AI extraction path* (`EXTRACTION_IMPL` = BDA / Bedrock / mock) and
*which document reader* (`DOC_LOADER` = Textract OCR / text-layer). This yields the three real engines
compared in [03](./03-rap-engine-comparison.md): **BDA**, **Bedrock + Textract-LAYOUT**, and
**Bedrock + text-layer**.

**Why not just one?** Three different pressures pull in different directions:
- **Data residency.** In the current sandbox, AWS Textract is blocked for automated (Lambda) use by
  the parent organization's policy, so the **text-layer** reader — which needs no AWS OCR service — is
  the only fully in-country automated reader. It exists precisely so the Canadian stage can run without
  the blocked service. *(This block disappears in a client-owned account — see [01](./01-project-audit.md) §4.3.)*
- **Provenance / grounding fidelity.** The verbatim-quote readers (Textract-LAYOUT and text-layer)
  ground far better than BDA, which grounds by confidence and infers page numbers — a real difference
  for a citation-anchored product.
- **Robustness & cost/speed.** The engines fail on *different* documents and trade cost against speed
  differently, so having more than one is a genuine fallback, not redundancy.

The measured recommendation (Bedrock + Textract-LAYOUT primary, text-layer as the cheapest/most
in-country fallback, BDA only where speed beats provenance) is in [03](./03-rap-engine-comparison.md).

### B.4 Grounding & provenance — verbatim quotes, and three separate claims

**Decision.** Every extracted field carries the **verbatim quote and page** it came from, and the
system keeps three *distinct* kinds of claim separate and never conflates them:

1. **Extracted-by** — who/what produced the field (the AI pipeline + the human reviewer).
2. **Progress-reported-by** — the company's self-reported progress, an *append-only* layer on top of
   the immutable extraction.
3. **Confirmed-by** — independent confirmation (a supplier confirming reported spend).

**Why.** Trust in this data depends on being able to trace every value to its source and to know *who*
is asserting *what*. A company's optimistic progress note must never look like an independently
verified fact, and the grounded extraction must never be silently rewritten.

### B.5 Evidence precedence — confirmed > research > self-reported

**Decision.** Everything shown for an organization resolves to one of three tiers, which fixes both
how it's displayed and whether it counts toward rankings:

| Tier | Source | Ranks? |
|---|---|---|
| **1 · Confirmed** | a supplier confirmed the reported procurement spend | **yes** |
| **2 · Research** | the commitment as recorded (seeded or company-created) | **yes** |
| **3 · Self-reported** | a company's own uploaded-RAP progress (opted-in orgs only, shown as separate rows) | **no** |

**Why.** Self-report should be *visible* but must never move the ranking — only independent
confirmation elevates a commitment. This keeps the public Index honest: a company cannot climb the
leaderboard by marking its own homework. Surfacing an uploaded RAP on the public Index is **opt-in**
by the company.

### B.6 Hybrid ownership — staff and companies both upload; only a claimed company posts progress

**Decision.** Both Institute staff and companies can upload RAPs; but only a company that has
**claimed its BN** can post progress, and its progress is append-only and never edits the grounded
extraction.

**Why.** It shares the workload (the Institute isn't the sole data-entry bottleneck) while keeping a
clear trust boundary: the objective, grounded extraction stays under stewardship, and the subjective
progress layer is clearly owned by, and attributed to, the company.

### B.7 Canadian residency split — data in Canada, AI inference is not

**Decision.** Platform data can rest in `ca-central-1` (Canada), but the AI-inference step routes to a
US/global region.

**Why.** It's an AWS reality, not a design preference: Amazon's Bedrock models are **not hosted in
Canada**, so "in Canada" here means *data-at-rest and document-reading in Canada; the AI model call
still leaves Canada.* This is the same for every engine. Detail in [01](./01-project-audit.md) §4.2 and
[03](./03-rap-engine-comparison.md).

### B.8 Serverless single-table database + mock-first development

**Decision.** The app runs serverless (Lambda + CloudFront + DynamoDB, one table per domain) and
defaults to an **in-memory mock** backend unless real-backend flags are set.

**Why.** Serverless keeps the non-AI running cost near zero (~$1/month — see [01](./01-project-audit.md) §3);
mock-first lets the whole app run locally with no AWS account or cloud calls, which made development
and demos fast and cheap and keeps onboarding simple.

### B.9 Edge protection & self-monitoring

**Decision.** A Web Application Firewall (WAF) sits in front of the site, shipped **count-first**
(watching, not yet blocking), and the extraction pipeline monitors its own health with alerts.

**Why.** Both were added deliberately and conservatively — the WAF counts before it blocks so real
users aren't caught by a false positive, and monitoring exists because a silent extraction failure
once went unnoticed. Full detail in [04](./04-monitoring-and-security-brief.md).

---

## Part C — Alignment & Notifications (features not covered elsewhere)

Both are **Institute-facing**, both are real and working, and both carry caveats worth knowing.

### C.1 Alignment — the supplier-matchmaking radar

**What it does.** Alignment matches a company's RAP **procurement commitment** to **verified Indigenous
suppliers** that fit it, so the Institute can broker introductions. Each card is one company
commitment with its top-ranked suppliers, each showing a *fit %* and a one-line rationale. The same
engine also powers a per-company "suppliers that fit this commitment" panel on the company side.

**How it works.** When a commitment changes, a database trigger recomputes matches in near-real-time.
The fit score is a **deterministic weighted sum** — sector match (heaviest), lexical relevance
(a genuine BM25 keyword-overlap score), identity-tier trust (Nation > CCIB > self-declared), and
ownership share — keeping the strongest few per commitment.

> **Caveats.**
> - **"AI-matched" overstates the default.** Optional AI (semantic embeddings + an LLM-written
>   rationale) only activates when real AI providers are configured. In the **default deployed
>   configuration these are stubbed**, so the score is fully deterministic (sector + keyword overlap +
>   tier + ownership) and the rationale is a template sentence built from real facts — not live AI.
> - **Procurement commitments only** — capital/equity commitments are out of scope.
> - **Verified suppliers only** — self-declared suppliers are filtered out of matches.
> - **Needs real supplier data to be credible** — until a real set of Indigenous suppliers is seeded,
>   matches are fixture-quality, and the radar can legitimately show as empty.
> - **Demo-scale** — the Institute radar ranks across a capped set (top ~100 commitments); weights are
>   hand-tuned with no feedback/learning loop; unknown ownership is assumed at bare majority (51%).

### C.2 Notifications — weekly overdue / at-risk milestone digest

**What it does.** A weekly digest of **overdue and at-risk** RAP milestones across the Index,
delivered to an Institute inbox (in-app) and by email. "Overdue" = the target year has passed without
confirmation; "at-risk" = due this year with low or stalled progress. There's a manual
"Generate & send now" button for demos. It closes a gap where this risk signal was computed but never
delivered.

**How it works.** A weekly schedule (and the manual button) compute the digest deterministically
(reusing the same risk logic as the dashboards), **save the in-app record first** (so the inbox
survives an email failure), then attempt email via AWS SES. Records are idempotent per ISO week — one
row per week, re-runnable without duplicates.

> **Caveats.**
> - **Single recipient.** There is one sender and one recipient address — not a distribution list. No
>   per-company digests, per-user preferences, or unsubscribe.
> - **Email is in the AWS "sandbox."** SES will only send to **verified** addresses (not arbitrary
>   staff inboxes) until AWS production access is requested — which has **not** been done. Sender *and*
>   recipient must be verified, per region.
> - **Production currently does not send.** The recipient/sender aren't configured on the production
>   stage, so it records **"skipped"** every week (the in-app inbox still works); the **Canadian (`ca`)
>   stage does send** real email, verified end-to-end. Configuration is baked in at deploy time, so a
>   deploy that forgets it **silently reverts to "skipped"** — there's no warning.
> - **Institute-only** — there are no company-facing notifications today (company demo logins are
>   placeholders and undeliverable).
> - Digest content is aggregate, PII-free commitment data by design.

---

## Where to go next

- Costs, risks, and the sandbox → client-owned account transition → [01 · Project Audit](./01-project-audit.md)
- Standing the platform up in your own account → [02 · Deploy Runbook](./02-deploy-runbook.md)
- Which extraction engine to use, and CA validity → [03 · Engine Comparison](./03-rap-engine-comparison.md)
- Monitoring & security in plain language → [04 · Monitoring & Security Brief](./04-monitoring-and-security-brief.md)
