# Data Governance: OCAP® residency + access controls — design

**Author:** Nate (En-Ping) · **Date:** 2026-07-15 · **Amended:** 2026-07-16
**Status:** approved design · **Phase 1 (classification tag) is BUILT AND MERGED**; Phases 2-5 deferred.

> **Amendment log — 2026-07-16.** Two changes, both driven by verified evidence gathered after the
> original draft:
> 1. **§4 residency is no longer "whole-stack ca-central-1."** Meta Llama is unavailable in
>    ca-central-1 in any form (§8.1), which blocks the legal-cases briefing-note generator from running
>    there. Amended decision: **the platform runs in ca-central-1; the legal-cases corpus and its models
>    stay in us-east-1** (public court data, which the client's rule permits hosting anywhere). One app,
>    one CloudFront, one URL.
> 2. **The deny-outside-ca SCP in §4 is incompatible with that** and is now an open question (§11.6),
>    not a settled control. §12's "misclassification eliminated" claim is amended accordingly.
>
> §8.1 (new) records the verified ca-central-1 model-availability table. Phase 1's build is
> `docs/superpowers/plans/2026-07-16-data-classification-tag.md`.

**Scope of this doc:** a **design spec**, not an implementation. The platform holds no real
`org_submitted` (private) data yet, so this designs the governance layer to be *ready* before the first
private upload. It defines: the residency architecture, the classification model, and the access-control
+ consent design — structured around the four **OCAP®** principles and enforced with **native AWS
services** (IAM / KMS / CloudTrail / S3 / DynamoDB), not bespoke machinery.

---

## 1. Context & the client requirement

The Indigenomics client's data-governance guideline (verbatim):

> - **Public data may be hosted anywhere; org-submitted / private data needs Canadian hosting + access
>   controls — flag it, don't assume.**
> - **Always carry provenance through from the source repos.**
> - **No credentials or secrets in the repo, ever. Use environment variables.**

**Current state (2026-07-15):**
- 100% of prod data is **public** and lives in **us-east-1** — no violation today; this is pre-emptive.
- Residency infra is a **dormant escape hatch**: the SST region is env-overridable
  (`sst.config.ts:32`, `SST_AWS_REGION=ca-central-1`), and a ca-central-1 extraction path already exists
  (`BEDROCK_REGION` is us-east-1 in prod for BDA, ca-central-1 elsewhere — `sst.config.ts:167`).
- **Extraction reality (tested — `docs/rap-extraction-findings.md`, 2026-07-01):** the strong engine
  (BDA) runs **only in us-east-1** in this account (ca-central-1 runtime fails on the profile ARN);
  Option B (Claude) keeps data **at rest** in Canada but its **inference geo-routes** cross-region. So
  Canadian **hosting** is achievable; strict in-country **inference** is not, today (see §8). The client
  rule is about hosting.
- **No governance layer exists:** no data-classification tag, no consent record, no access-audit log, no
  encryption-at-rest with a managed key, no least-privilege IAM per data class. Only an OCAP-flavoured
  `withdrawn` soft-delete on the economic-flow lines/confirmations.
- Provenance is strong for extracted facts (`Grounded<T>`). Secrets are clean except one committed demo
  password (`scripts/seed-org-logins.ts` — a separate P3 rotation, not solved here).

**Decision drivers (from brainstorming):** structure the whole spec around **OCAP**, enforce **least
privilege**, and **use native AWS services — don't reinvent the wheel**.

## 2. Goals / non-goals

**Goals**
- A design that satisfies "org-submitted → Canadian hosting + access controls" and "flag it, don't
  assume" **by construction**.
- The four OCAP principles each mapped to a concrete mechanism delivered by a native AWS service.
- A **classification model** (`public | org_submitted`) that is mandatory at ingestion and conservative
  (uncertain ⇒ private).
- **Least-privilege** access enforced at the AWS layer (IAM/KMS), not only in app code.
- A **phased build plan** (deferred) so the governance layer lands incrementally before the first
  private upload.

**Non-goals (named as later phases or out of scope)**
- **Query / citation licensing** (an advanced OCAP-Control capability): who may *cite* or *derive* from
  org data. Deferred.
- **Rotating the committed demo password** — separate P3 cleanup (referenced in §11).
- **Actually deploying** anything — this is spec-only. The build plan (§10) is deferred.
- **Migrating existing public data** as a *governance* requirement — it moves as part of the residency
  decision (§4), not because governance demands it.

## 3. Design principles

1. **OCAP is the spine.** Ownership · Control · Access · Possession — every control in this spec traces
   to one principle (§5). This is the framework the client's mission is built on.
2. **Least privilege, enforced by AWS, not by app code alone.** The app-layer session gate is the first
   line; **IAM + KMS are the enforced backstop**. A role gets the *minimum* it needs, scoped per
   data-class and per-function. A public read path has **zero** permission to private data.
3. **Native AWS, don't reinvent.** Residency = the AWS Region. Access control = IAM (+ ABAC tags).
   Encryption/possession = KMS. Accountability = CloudTrail data events. Immutability = S3 Object Lock.
   We wire existing services; we do not build a custom access engine.
4. **Flag it, don't assume — conservative default.** Classification is mandatory at ingestion; when
   provenance is uncertain, the artifact defaults to **`org_submitted`** (private), never public.
5. **Provenance carries through.** Every `org_submitted` artifact records its owner + upload lineage;
   extracted facts keep `Grounded<T>`. Governance never severs provenance.

## 4. Residency architecture — ca-central-1 platform, us-east-1 legal cases

> **AMENDED 2026-07-16.** This section originally specified *whole-stack* ca-central-1. New verified
> evidence (§8) shows that is **not achievable as written**: Meta Llama — which powers the legal-cases
> briefing-note generator — is not available in ca-central-1 in any form. The decision below is the
> amended one. The original reasoning is preserved where it still holds.

**Decision: the platform runs in `ca-central-1`; the legal-cases corpus and its models stay in
`us-east-1`.** One app, one CloudFront distribution, one URL — the origin Lambda runs in ca-central-1
and reaches back to us-east-1 for public court data only.

```
                CloudFront (global edge — not a regional resource)
                                 │
                  Next.js origin Lambda — ca-central-1
                  ├── RapData / Commitments / DataPortal / uploads → ca-central-1
                  │     └── every `org_submitted` artifact lives here
                  └── /cases → LegalCases table + Llama + Titan vectors → us-east-1
                        └── public court decisions; `dataClass: public` by construction
```

- **Why the platform side goes to Canada:** every `org_submitted` artifact — company RAP uploads and
  everything extracted from them — lives in the RapData table and the uploads bucket. That is the data
  the client's rule is about, and Canadian hosting is achievable for it (§8).
- **Why legal cases stays in the US:**
  - **Llama is unavailable in ca-central-1** — not in-region, not via a geo profile, not via global
    (§8). The briefing-note generator cannot run in Canada without swapping models.
  - Its corpus is **public court decisions** — `dataClass: public` by construction, which the client's
    rule explicitly permits hosting anywhere. There is no compliance reason to move it.
  - Moving it is the expensive half of the migration for zero governance benefit: ~43k rows, the
    prebuilt bm25 (~60 MB) and vector (~160 MB) search artifacts, and a re-embedding pass.
- **This is NOT the "private-slice" split rejected in the original draft.** That split mixed data
  classes *inside one application*, where a mis-tagged private record could land in us-east-1 — a
  residency breach. This boundary is a whole **domain that structurally cannot hold private data**:
  the cases app has no upload path, no `OrgClaim`, no company session. The misclassification failure
  mode does not exist here. The boundary also lines up exactly with the in-flight repo split
  (`indigenomics-legal-cases` / `indigenomics-data-platform`), so it is where the seam was already going.
- **The code is already built for this.** `sst.config.ts` pins every cases dependency to us-east-1
  *explicitly, so it does not follow the stack region* — `briefGen`'s `BEDROCK_REGION: "us-east-1"`
  (`:239`, commented "do NOT inherit the extraction stack's ca-central-1"), `EMBED_REGION: "us-east-1"`
  (`:248`, `:337`), and the literal `arn:aws:dynamodb:us-east-1:*:table/LegalCases` grants (`:229`,
  `:262`, `:299`). Flipping the stack region leaves these pointing at us-east-1 on their own.
- **The cost is a one-time migration** of the five SST tables, the buckets, and the app tier — *not*
  the cases corpus. Phased in §10.
- **SST:** set `providers.aws.region = "ca-central-1"` for the prod stage (today it defaults us-east-1,
  `sst.config.ts:32`); `removal: retain` stays for prod (`:27`).
- **⚠️ Region guardrail — the original SCP no longer works as specified.** The draft called for a
  Service Control Policy denying resource creation outside ca-central-1 (`aws:RequestedRegion`) for the
  prod account/OU, making residency an *enforced invariant*. **That policy is incompatible with this
  decision** — it would block the legal-cases table, its buckets, and its Bedrock calls in us-east-1.
  Options, none free: (a) scope the deny to the *services* that hold `org_submitted` data, which is
  weaker and needs care to stay correct as resources are added; (b) move legal cases to a separate AWS
  account and apply the unconditional SCP only to the platform account — the clean answer, and real
  work; (c) drop the SCP and rely on the SST region default, i.e. residency stays a deploy-time
  convention rather than an enforced invariant. **Unresolved — see §11.6.** Also still unverified:
  whether we have AWS Organizations management-account access at all, without which no SCP is possible
  (the team's role is `myisb_IsbUsersPS` in a shared ISB account).

## 5. The OCAP spine → mechanism → AWS service

Each principle is delivered by a native service; nothing bespoke.

### Ownership — the company/community owns its submitted data
- **Mechanism:** every artifact carries a **classification tag** (`dataClass`) and, when
  `org_submitted`, the **owner Business Number** (the crosswalk key). Provenance + owner travel with the
  data forever.
- **AWS:** **resource tags** (`dataClass`, `ownerBN`) on S3 objects + DynamoDB items → the basis for
  attribute-based access control (ABAC) below. The existing `Grounded<T>` lineage is unchanged.

### Control — the owner decides who may access/use it
- **Mechanism:** a **consent record** captured at upload — the owner names who may access (default:
  Indigenomics staff only; optionally specific parties). Grant/revoke is the owner's, append-only
  (never silently widened). This is the OCAP "the community decides" principle.
- **AWS:** a **DynamoDB** consent item (owner-keyed) is the source of truth; **IAM ABAC** enforces it —
  a principal may read an object only when its session/principal tag (`ownerBN`, propagated via **STS
  session tags**) matches the resource's `ownerBN` tag, AND the app's consent check passes. Revocation =
  flip the consent item + (for hard cases) rotate the object's KMS grant.

### Access — the owner reaches their own data; accountability for everyone else
- **Mechanism:** a **per-party access gate** (only the owning company + consented parties + authorized
  Indigenomics staff may read `org_submitted`), plus a **tamper-evident access-audit log** — every read
  of private data is recorded (who, what, when), so a company can be shown exactly who touched its data.
- **AWS:** **IAM least-privilege roles** are the enforced gate (a public-app role literally cannot read
  the private tables/bucket). **CloudTrail data events** (S3 object-level `GetObject`, DynamoDB
  item-level reads) are the audit log; the trail lands in a **locked S3 bucket with Object Lock**
  (ca-central-1) so the log is immutable/tamper-evident. **S3 server access logging** as a second record.

### Possession — physical custody stays in Canada
- **Mechanism:** **every `org_submitted` artifact** is **physically stored in ca-central-1**,
  **encrypted at rest with a customer-managed key** whose custody is Canadian and whose decrypt is scoped
  to owner roles. **Possession = data *at rest* in Canada** — which is exactly what the client's
  "Canadian hosting" requires. (Note: *inference* is a separate matter — see §8; the model call currently
  crosses the border for both engines, a documented tradeoff, not a hosting violation.)
- **AWS:** **S3** bucket + **DynamoDB** tables in `ca-central-1`; **KMS customer-managed key (CMK)** in
  `ca-central-1` with a key policy granting `Decrypt` only to the owner-scoped roles (so possession +
  control are one mechanism). S3: Block Public Access on, SSE-KMS, versioning + Object Lock for the
  private uploads bucket. The **region SCP** (§4) keeps possession in-country by construction.

## 6. Data classification model ("flag it, don't assume")

- **Tag:** `dataClass: "public" | "org_submitted"` on every stored artifact — uploaded RAP PDFs (S3
  objects), RapData entities (org/rap/commitment/observation/rollup), progress, and any future
  org-provided document. Public: seeded commitments, supplier showcase, legal cases, alignment.
- **Applied at ingestion**, never inferred later. **Conservative default:** if the ingestion path can't
  prove an artifact is public disclosure, it is `org_submitted`. A company upload is *always*
  `org_submitted`; a research-curated public-disclosure record is `public` (mirrors the existing
  `source`-presence provenance signal — a present `source` ⇒ public disclosure).
- **The tag drives everything:** which KMS key encrypts it, which IAM policy governs it, and whether
  it's in the CloudTrail audit scope. It deliberately does **not** drive region: under the amended §4,
  region is decided per-*domain* (platform → ca-central-1, legal cases → us-east-1), not per-row. That
  separation is what keeps the misclassification failure mode structurally absent — a mis-tagged row
  cannot relocate itself (§12).

## 7. AWS enforcement architecture (least privilege)

- **Roles per data-class × function** (least privilege):
  - *public-app role* — read public tables/bucket only; **no** access to private resources or the CMK.
  - *private-read role* — read `org_submitted`, but **only the owner's items** via
    **`dynamodb:LeadingKeys`** condition (partition = `org-bn-<ownerBN>`) and ABAC on the S3 `ownerBN`
    tag; `Decrypt` on the CMK; assumed per-request via **STS with the owner's session tag**.
  - *private-extractor role* (Option B, ca-central-1) — write RapData for one job's owner; no public
    access.
  - *staff/admin role* — broader read of `org_submitted` for QA, but **still logged** (CloudTrail), and
    scoped by consent.
- **ABAC over per-owner policies:** tag resources with `ownerBN`; one policy with an
  `aws:PrincipalTag/ownerBN == aws:ResourceTag/ownerBN` condition scales to all owners without a policy
  per company — the "don't reinvent" way to do per-tenant isolation.
- **App-layer gate stays** (`getSession()` + kind checks + `OrgClaim` ownership) as the first line and
  UX; **IAM/KMS is the backstop** — even a coding bug can't exfiltrate private data because the role
  lacks the permission and the key grant.
- **Encryption:** SSE-KMS everywhere for `org_submitted`; TLS in transit (default). KMS key rotation on.

## 8. Extraction under residency — the honest tradeoff

**Critical distinction: data-at-rest residency ≠ in-country inference.** Per the team's tested findings
(`docs/rap-extraction-findings.md`, 2026-07-01), *neither* extraction engine currently achieves strict
in-country inference in this account — the model call crosses the border either way:

| | **BDA** (Option A) | **Claude on Bedrock** (Option B) |
|---|---|---|
| Data **at rest** | us-east-1 (BDA reads input from a same-region bucket) | **ca-central-1** ✅ |
| **Inference** (model call) | us-east-1 | cross-region profile (`us.`/`global.` — no in-region-only Claude profile here) |
| Runtime works in ca-central-1? | **No** — control plane yes, but `InvokeDataAutomationAsync` fails with "invalid ARN" for the `data-automation-profile`; only us-east-1 succeeds | Yes (data at rest); inference still geo-routes |
| Quality | works end-to-end (22 commitments, 64s); ~20-page cap, chunked | better-grounded, but **truncates** on many-commitment RAPs today (fixable token-budget bug) |

**What this means for the design:**
- The client's requirement is **Canadian *hosting*** (data at rest) — **Option B satisfies it** (uploads
  + RapData at rest in ca-central-1). BDA does **not** (it forces the upload bucket to us-east-1).
- So for `org_submitted` uploads, **extraction must run on Option B (data at rest in ca-central-1)** to
  meet the hosting rule — accepting that *inference* geo-routes cross-region (disclose to the client).
- **Public** RAP extraction may use BDA (us-east-1) — public data may be hosted anywhere. Under the
  sovereignty posture the default is still Option B; BDA is an optional public-only path. (Open decision §11.1.)
- **True in-country inference** (data *and* processing in Canada) needs a **self-hosted / Canada-hosted
  model** — a larger future investment, flagged as the trigger-if-it-becomes-a-hard-requirement path.
- **BDA in Canada is confirmed impossible** (§11.4, verified 2026-07-15 by live test + AWS's
  cross-region-inference region table): there is no Canadian BDA geography, so BDA can't process
  Canadian-resident data. For `org_submitted` uploads this makes **Option B the only option**, not a
  preference — the truncation bug below is therefore a hard prerequisite, not a nice-to-have.
- Before Option B carries real private uploads, its **truncation bug** (grounded call runs out of output
  budget before the commitments array) must be fixed — it's a blocker for private extraction, tracked in
  the findings doc §4.
- Today's `BEDROCK_REGION` split (`sst.config.ts:167`) already encodes the switch; the change is making
  ca-central-1 the default and gating BDA behind `dataClass === "public"`.

### 8.1 Model availability in ca-central-1 — verified 2026-07-16

Checked against AWS's own per-model Regional Availability tables (not aggregators — one popular
aggregator was found to be **wrong** about Llama in ca-central-1; primary sources only).

| Model / service | ca-central-1 | Consequence |
|---|---|---|
| **Titan Text Embeddings V2** (`amazon.titan-embed-text-v2:0`) | ✅ **In-region**, on-demand | Dense retrieval *could* run in Canada. No cross-region routing exists for embedding models at all. |
| **Amazon Textract** | ✅ Available | The Textract→Claude path is viable in-region. |
| **Anthropic Claude** | ⚠️ **No in-region invocation.** `us.` geo profile or `global.` only | Option B keeps data at rest in Canada; inference geo-routes. Confirms §8's core tradeoff. |
| **Meta Llama** | ❌ **Not available in any form** — not in-region, not geo, not global. US-only on Bedrock | **Blocks the legal-cases briefing-note generator from running in Canada.** The reason for §4's amended boundary. |
| **BDA** | ❌ Not available (already established, §11.4) | Independently corroborated: no `ca.` profile prefix exists. |

**Two findings worth carrying forward:**
- **There is no `ca.` inference-profile prefix in AWS's catalogue at all.** Documented geo prefixes are
  `us`, `eu`, `au`, `jp` only. This independently corroborates the BDA conclusion in §11.4 — it is not a
  BDA-specific gap, it is that **Canada is not a Bedrock inference geography**.
- **The `us.` geo profile does include ca-central-1 as a destination** (for Claude Sonnet 4.5, sources
  from ca-central-1 → may route to ca-central-1, us-east-1, us-east-2, us-west-2). So an inference call
  *may* stay in Canada — but AWS documents no guarantee, and abuse-detection storage lands in the
  destination region. **Do not represent this to the client as in-country inference.** It is
  best-effort routing within a US-named geography, which is precisely §8's honest tradeoff, not an
  escape from it.

## 9. Consent model (OCAP Control), v1

- **Consent record** (DynamoDB, owner-keyed), captured at upload:
  `{ ownerBN, grantedTo: ["indigenomics" | partyId…], scope: "access", grantedAt, grantedBy }`.
  Default `grantedTo: ["indigenomics"]` (staff QA) — the owner may add/remove grantees. Append-only
  history; revocation is explicit.
- **Enforcement hooks** on every `org_submitted` read path: the app checks the consent record *and* the
  IAM/ABAC gate must independently allow it (defence in depth).
- **Deferred:** `scope` values beyond `access` — `query` / `cite` licensing (who may run analytics over
  or cite the data) — an advanced Control capability for a later phase.

## 10. Phased build plan (deferred — no private data yet)

Each phase is independently shippable; do them before the first private upload, in order.

1. **Classification tag** — add `dataClass` to the upload/RapData/progress write paths (defaulted
   conservatively) + thread it through the item mappings. Pure-additive; no infra. *(This is the one
   piece worth doing early even ahead of need — retrofitting classification onto existing data is
   harder than tagging from day one.)*
2. **ca-central-1 stack** — deploy the prod stage to ca-central-1 and migrate the five SST tables +
   buckets (one-time). **Legal cases does NOT move** (§4): its table, buckets, and Bedrock calls stay
   pinned to us-east-1 and the existing explicit pins in `sst.config.ts` already achieve this. KMS CMK +
   SSE-KMS + Block Public Access + Object Lock on the private uploads bucket. **Region SCP is
   unresolved — see §11.6**; it cannot be the unconditional deny the draft assumed.
   *Phase 2 is bigger than one line suggests — scope reality, surveyed 2026-07-16:* changing the SST
   provider region **replaces** rather than moves every resource (`removal: retain` leaves the
   us-east-1 originals as orphans, so it is build-new-then-copy); there is **no custom domain**
   (`sst.aws.Nextjs("Web")` has no `domain:`), so a cutover **changes the public URL**
   `d1hwn8hhp1ytc0.cloudfront.net`, which is referenced in `DATA_VERIFICATION.md`, the sprint hand-ins,
   and the showcase materials. Consider adding a custom domain *first* so the URL stops being
   load-bearing. Needs its own plan.
3. **Least-privilege IAM + ABAC** — split the monolithic service role into per-data-class roles;
   `dynamodb:LeadingKeys` + `ownerBN` ABAC; STS session-tag propagation from the app.
4. **CloudTrail access-audit + consent record** — enable S3/DynamoDB data events → locked trail;
   consent item + upload-time capture + read-path enforcement hooks.
5. **Extraction routing** — default extraction to Option B (ca-central-1); gate BDA behind
   `dataClass === "public"`.

## 11. Open decisions (for the team)

1. **BDA for public extraction:** retain BDA (us-east-1) as an optional path for *public* documents
   (better engine, but data + inference transit the US), or go **all-Option-B in ca-central-1** (data at
   rest in Canada; inference still geo-routes)? (Recommend: all-Option-B default; BDA only if a
   public-doc quality gap appears AND §11.4 confirms it can't run in-region.)
2. **Consent default grantees:** `["indigenomics"]` only (staff QA) vs also auto-granting the owner's
   own supplier counterparties. (Recommend: `["indigenomics"]` only; owner adds others explicitly.)
3. **~~Migration timing~~ — DECIDED 2026-07-16: do Phase 1 now, then Phase 2.** Phase 1 (the
   classification tag) is **built and merged** — see the plan
   `docs/superpowers/plans/2026-07-16-data-classification-tag.md`. Phase 2 (the ca-central-1 migration)
   is next, scoped per the amended §4: platform moves, legal cases stays. Note the original
   "SCP + region default are cheap to set early" parenthetical no longer holds — the SCP is now an open
   question (§11.6), not a cheap default.
4. **~~Re-test BDA runtime in ca-central-1~~ — RESOLVED 2026-07-15: BDA is genuinely unavailable in
   Canada.** Verified two ways: (a) live-tested this account — `ca.data-automation-v1` is an invalid ARN,
   and a us-east-1 profile ARN is rejected in ca-central-1 "for the service region"; (b) AWS's own
   cross-region-inference table ([bda-cris](https://docs.aws.amazon.com/bedrock/latest/userguide/bda-cris.html))
   lists only **US / EU / APAC / GovCloud** geo profiles — **there is no Canadian BDA geography**, and
   ca-central-1 is not a supported source region for any profile. Since BDA keeps inference within the
   data's geography and Canada isn't one, **BDA cannot process Canadian-resident data at all.** ⇒ For
   `org_submitted` (Canadian-hosted) uploads, **Option B is the only path** (this closes §11.1 for
   private data: not a choice — a constraint). Public docs *may* still use BDA (us geo), but require
   the upload/input bucket in a US region.
5. **In-country inference bar:** is *inference* residency (model call in Canada) a client requirement, or
   only *hosting* (data at rest)? If only hosting, the current design suffices; if inference too, that
   triggers the self-hosted/Canada-hosted-model investment (§8). (Recommend: confirm with the client —
   the guideline says "hosting," which we read as data at rest.)
6. **The region SCP (§4).** The unconditional deny-outside-ca SCP is incompatible with keeping legal
   cases in us-east-1. Pick: (a) scope the deny to the services holding `org_submitted` data — weaker,
   needs maintenance; (b) split legal cases into its own AWS account and apply the unconditional SCP to
   the platform account only — clean, real work; (c) drop the SCP, residency stays a deploy-time
   convention. **Prerequisite either way:** confirm we have AWS Organizations management-account access
   — unverified, and without it no SCP is possible at all. (Recommend: verify Organizations access
   first; if absent, (c) by default and revisit when the repo split gives legal cases its own deploy.)
7. **Titan is in-region in Canada (§8.1) — does dense retrieval move?** `EMBED_REGION` is pinned to
   us-east-1 because that is where the *existing vectors* were embedded. The model itself is available
   in ca-central-1. Not a governance question (cases are public), purely latency vs. a re-embedding
   pass. (Recommend: leave it pinned; no benefit worth the re-embed.)

## 12. Risks & mitigations

- **Region misclassification** → **structurally absent, but no longer SCP-enforced** (amended
  2026-07-16). The concern was a mis-tagged `org_submitted` record landing in us-east-1. That cannot
  happen under the amended §4: the only us-east-1 resources are the legal-cases corpus and its models,
  and the cases domain has **no ingestion path at all** — no upload, no `OrgClaim`, no company session —
  so there is no mechanism by which private data reaches it. The residual gap is that the guardrail is
  now a *deploy-time convention* (the SST region default) rather than an enforced invariant, because
  the unconditional SCP is incompatible with the us-east-1 cases resources (§11.6). Mitigation until
  resolved: the `dataClass` tag (Phase 1, merged) means every private artifact is identifiable, and the
  Phase 3 IAM/ABAC gate does not depend on region.
- **App bug exfiltrates private data** → mitigated by IAM/KMS least privilege: the role lacks the
  permission and the CMK grant, so a code path alone cannot read another owner's data.
- **Audit-log tampering** → mitigated by CloudTrail → S3 Object Lock (immutable).
- **BDA quality loss for public docs** → mitigated by retaining BDA as an optional public-only path
  (§11.1); low impact given the public corpus is curated, not extracted. (The draft's "re-test whether
  BDA now runs in-region" is **settled — it does not, and cannot**: §11.4 and §8.1 both confirm Canada
  is not a Bedrock inference geography. Nothing to re-test unless AWS adds one.)
- **Option B truncation on many-commitment RAPs** (findings §4) → a **blocker for private extraction**;
  must be fixed before Option B carries real `org_submitted` uploads. Mitigation: fix the grounded-call
  output-budget bug (chunk the commitments extraction, as BDA does for pages) before Phase 5.
- **Inference crosses the border for both engines** → NOT a hosting violation (client rule is about
  hosting/data-at-rest, which ca-central-1 satisfies), but **disclose it honestly** to the client. If
  strict in-country *inference* becomes a hard requirement (§11.5), the mitigation is a self-hosted /
  Canada-hosted model — a larger, deferred investment.
- **Migration disruption to the live app** → mitigated by phasing (§10): tag first (no infra), migrate
  region only when warranted, `removal: retain` protects prod data.

## 13. Out of scope / references

- **Provenance** is already strong (`Grounded<T>`); this spec extends the *discipline* (owner + lineage
  on `org_submitted`) but doesn't rebuild it.
- **Committed demo password** (`scripts/seed-org-logins.ts`) — the client's "no secrets in repo" bullet;
  a separate P3 rotation, not solved here.
- Builds conceptually on the crosswalk's BN identity (owner = BN) and the merged evidence-precedence work
  (public Index unaffected — it's all `public`).
- **Extraction reliability / dual-engine cross-check — related but separate (not a governance concern).**
  Since inference geo-routes for both engines anyway, one might keep BDA + Option B and cross-check them
  for higher-confidence extraction (they ground differently — BDA by page+confidence, Option B by
  verbatim quote — so agreement = high trust, disagreement = flag for review). Two caveats keep this out
  of *this* spec: (1) **BDA can't touch `org_submitted` data** — it forces the input bucket into a US
  region, a *hosting* violation (§8), so a cross-engine ensemble can't serve the dominant (private) path;
  the private-data version would be *within-Canada* (Option B self-consistency / grounded-quote coverage),
  with cross-engine agreement usable only for the *public* corpus. (2) It's an extraction-*quality*
  feature, orthogonal to residency/consent. Near-term priority remains **fixing Option B's truncation**
  (the only path for private extraction). Capture as its own extraction-reliability note if pursued.
