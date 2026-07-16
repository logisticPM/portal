# Data Governance: OCAP® residency + access controls — design

**Author:** Nate (En-Ping) · **Status:** proposed design (spec-only — no build yet) · **Date:** 2026-07-15

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

## 4. Residency architecture — whole-stack in ca-central-1

**Decision: the entire platform's data-at-rest lives in `ca-central-1`.** (Weighed against a
"private-slice" split; chosen for the reasons below.)

- **Why whole-stack, not private-slice:**
  - The client *permits* public-anywhere but doesn't require it, so both are compliant — this is an
    engineering/mission call, and Indigenomics is a **data-sovereignty organization**: hosting
    everything in Canada is coherent with their mission and pre-empts a future "all of it" ask.
  - It **eliminates the region-misclassification failure mode** entirely: with a split, a mis-tagged
    private record could land in us-east-1 — a residency breach. Whole-stack makes that impossible;
    "flag it, don't assume" then guards *access*, not *region*.
  - **One region** is simpler to build, reason about, and afford for a small team.
  - The usual counter — "keep the stronger **BDA** extraction engine (us-east-1-only)" — is weak here:
    company uploads are `org_submitted` and **must** extract in-country via Option B regardless, so BDA
    would only ever serve *public* RAP extraction, which is minor (the public corpus is curated
    commitments, and the prod RapData table is empty). See §8.
- **The cost is a one-time migration** of the existing live us-east-1 stack (commitments, suppliers,
  legal cases, alignment, the app + CloudFront) to ca-central-1 — phased in §10, not a governance blocker.
- **Region guardrail (native):** a **Service Control Policy** (or permissions boundary) that **denies
  resource creation outside `ca-central-1`** for the prod account/OU — so nothing can accidentally land
  outside Canada. `aws:RequestedRegion` condition. This turns the residency rule into an *enforced
  invariant*, not a deploy-time convention.
- **SST:** set `providers.aws.region = "ca-central-1"` for the prod stage (today it defaults us-east-1,
  `sst.config.ts:32`); `removal: retain` stays for prod (`:27`).

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
- **Mechanism:** `org_submitted` data (and, per §4, all data) is **physically stored in ca-central-1**,
  **encrypted at rest with a customer-managed key** whose custody is Canadian and whose decrypt is scoped
  to owner roles.
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
- **The tag drives everything:** which KMS key encrypts it, which IAM policy governs it, whether it's in
  the CloudTrail audit scope, and (in a private-slice world) which region — under whole-stack, region is
  uniform, but the tag still gates access, encryption, and audit.

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

## 8. Extraction under residency

- **Private (`org_submitted`) uploads MUST extract in-country** → **Option B (Bedrock / Claude,
  ca-central-1)**. BDA (us-east-1-only) is off-limits for private data — it cannot leave Canada.
- **Public RAP extraction** *may* use BDA (us-east-1) since public data may be hosted anywhere — but
  under the whole-stack + sovereignty posture, the **default is Option B (ca-central-1) for all
  extraction**, with BDA retained only as an optional path for public documents if extraction quality
  demands it. (Open decision §11.)
- Today's `BEDROCK_REGION` split (`sst.config.ts:167`) already encodes the mechanism; the change is
  making ca-central-1 the default and gating BDA behind `dataClass === "public"`.

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
2. **ca-central-1 stack + region SCP** — deploy the prod stage to ca-central-1; add the
   deny-outside-ca SCP; migrate existing public data (one-time). KMS CMK + SSE-KMS + Block Public
   Access + Object Lock on the private uploads bucket.
3. **Least-privilege IAM + ABAC** — split the monolithic service role into per-data-class roles;
   `dynamodb:LeadingKeys` + `ownerBN` ABAC; STS session-tag propagation from the app.
4. **CloudTrail access-audit + consent record** — enable S3/DynamoDB data events → locked trail;
   consent item + upload-time capture + read-path enforcement hooks.
5. **Extraction routing** — default extraction to Option B (ca-central-1); gate BDA behind
   `dataClass === "public"`.

## 11. Open decisions (for the team)

1. **BDA for public extraction:** retain BDA (us-east-1) as an optional path for *public* documents
   (better engine, but data transits the US), or go **all-Option-B in ca-central-1** for a clean
   sovereignty story? (Recommend: all-Option-B default; BDA only if a public-doc quality gap appears.)
2. **Consent default grantees:** `["indigenomics"]` only (staff QA) vs also auto-granting the owner's
   own supplier counterparties. (Recommend: `["indigenomics"]` only; owner adds others explicitly.)
3. **Migration timing:** migrate the public stack to ca-central-1 now (Phase 2) vs only when the first
   private upload is imminent. (Recommend: do Phase 1 now; Phases 2-5 when a real private upload is on
   the horizon — but the SCP + region default are cheap to set early.)

## 12. Risks & mitigations

- **Region misclassification** → **eliminated** by whole-stack + the deny-outside-ca SCP (nothing can
  land outside Canada).
- **App bug exfiltrates private data** → mitigated by IAM/KMS least privilege: the role lacks the
  permission and the CMK grant, so a code path alone cannot read another owner's data.
- **Audit-log tampering** → mitigated by CloudTrail → S3 Object Lock (immutable).
- **BDA quality loss for public docs** → mitigated by retaining BDA as an optional public-only path
  (§11.1); low impact given the public corpus is curated, not extracted.
- **Migration disruption to the live app** → mitigated by phasing (§10): tag first (no infra), migrate
  region only when warranted, `removal: retain` protects prod data.

## 13. Out of scope / references

- **Provenance** is already strong (`Grounded<T>`); this spec extends the *discipline* (owner + lineage
  on `org_submitted`) but doesn't rebuild it.
- **Committed demo password** (`scripts/seed-org-logins.ts`) — the client's "no secrets in repo" bullet;
  a separate P3 rotation, not solved here.
- Builds conceptually on the crosswalk's BN identity (owner = BN) and the merged evidence-precedence work
  (public Index unaffected — it's all `public`).
