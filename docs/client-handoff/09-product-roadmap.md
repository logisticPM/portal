# 09 · Product Roadmap

A consolidated, prioritized view of **what is not yet built, partially built, or deliberately
deferred** — so the Institute can plan phases, scope funding, and decide what matters. Every item is
grounded in the code or the design docs (the detailed evidence and file references sit behind this
summary), and each carries an honest state and a rough size.

This is a *planning* document, not a promise: sizes are estimates, and some items are questions for
the Institute to decide rather than committed work.

Companion documents: [01 · Project Audit](./01-project-audit.md) (risks),
[03 · Engine Comparison](./03-rap-engine-comparison.md),
[07 · Data Governance](./07-data-governance-and-ocap.md),
[08 · Content Stewardship](./08-content-stewardship-runbook.md). Glossary in the [README](./README.md).

---

## 0 · How to read this

**State labels:** **Not built** · **Partial** · **Stub** (a working seam that's switched off/faked) ·
**Deferred** (designed, paused on purpose) · **Known limitation** · **Config flip** (largely a
setting to change).

**Size:** *small* (hours–days) · *medium* (weeks) · *large* (multi-week/quarter). **Type:**
*engineering* vs *data/curation* vs *ops/decision*.

**Two scope caveats, so the list is honest:**
- **Bilingual (EN/FR) and accessibility are *undocumented absences*, not promised work** — the app is
  English-only with no i18n and no stated accessibility commitment. For a Canadian public platform
  (with Government-of-Canada and TELUS content), we flag both as decisions to make, not deferrals
  already agreed.
- **A few large ideas were deliberately *paused* as low-return** (e.g. the full grounded-corpus
  cutover). Those are noted as such, not as unfinished obligations.

---

## Horizon 1 — Launch readiness (before real users and real data)

Mostly small config/ops steps, but each is a genuine gate. If the Institute does nothing else, do
these.

- **Flip the web firewall (WAF) to blocking.** It's in watch-only mode today; a one-setting change
  after a short observation window. *(Config flip · small)*
- **Move alerts off a personal address; get SES out of sandbox.** System alerts and the weekly digest
  currently point at a capstone member's Northeastern email, and production email delivery is not yet
  enabled. Subscribe a shared Institute inbox and request SES production access. *(Ops · small)*
- **Add a custom domain** (+ certificate). None is configured today. *(Ops · small)*
- **Purge demo data and rotate the shared password** before real users — see [08 §G](./08-content-stewardship-runbook.md). *(Ops · small)*
- **Provision the client-owned AWS account** — its own AI (Bedrock/BDA) project + ARNs, secrets,
  deploy role, SES identities, and the legal-cases data. Two sandbox ARNs are hardcoded and must be
  replaced. See [02 · Deploy Runbook](./02-deploy-runbook.md). *(Ops · medium)*
- **Decide the residency strategy and protect the environment.** Pick the region posture (Part
  Horizon 2), and enable backups/point-in-time recovery on a real Canadian environment — today only
  the production stage retains data and only one table has PITR. *(Ops + decision · medium)*
- **Switch the production extraction engine to Textract-LAYOUT (+ enable OCR).** The live engine is
  BDA — ranked *lowest on provenance*, with inferred page numbers and no OCR for scanned PDFs — while
  every handoff doc recommends Textract-LAYOUT. Largely a config-and-revalidate change that directly
  improves the citations users see. See [03](./03-rap-engine-comparison.md). *(Config flip + validation · small–medium)*

---

## Horizon 2 — The trust backbone (make identity and "confirmed" real)

The platform's core value — a *credible* index — rests on verified identity and a working confirmation
path. Several pieces are stubbed or structurally incomplete.

- **Activate business-registry (ISED) verification.** The seam exists but runs as a **stub**; until
  it's live, "registry-verified" means "matched a built-in list." Confirm the live API and switch it
  on. This unblocks self-serve upload and real supplier verification. *(Engineering · small–medium)*
- **Finish the Business-Number crosswalk curation** (37 of 103 orgs done; the file says *"verify
  before the prod migration"*). Human registry lookups; gated on the ISED check above for
  auto-validation. *(Data/curation · medium)*
- **Fix or honestly reframe the "Confirmed" tier.** On the Index it is **structurally always 0%** —
  no runtime path can move a commitment to "confirmed." Either build the counterparty-attestation
  bridge or reframe the tile so it isn't silently empty. *(Engineering + data · medium)*
- **Onboard real Indigenous suppliers.** The supplier confirmation *flow* is real code, but the
  supplier pool and confirmations are fixtures ("until a real set of suppliers is seeded, matches are
  fixture-quality"). This is an adoption/data effort more than a build. *(Data + adoption · medium–large)*
- **Build the company-account ↔ seeded-data crosswalk** (flagged internally as **P0**). Today a
  logged-in company is linked to a separate data world from its own public seeded commitments — the
  two don't join. *(Engineering · medium)*
- **Ship the "trackability" signal** (a rare quick win). The data model already records whether each
  commitment has a due date and a measurable target; surfacing *how many of an org's commitments are
  actually trackable* turns the honest gap in [06](./06-rap-research-data-verification-and-commitment-variation.md)
  into a first-class accountability feature. *(Engineering · small)*
- **Build the deferred governance enforcement layer** — the consent record, access-audit log,
  `ca-central-1` migration, customer-managed encryption key, and per-data-class access controls.
  Designed and approved; **only the classification tag is built** so far. Required before ingesting
  any private or community-linked data. See [07](./07-data-governance-and-ocap.md). *(Engineering + governance · large)*

---

## Horizon 3 — Reach, depth, and the bigger product

- **Bilingual EN/FR** — no internationalization exists; the UI is English-only. An official-languages
  question for a Canadian public platform. *(Engineering + translation · large · decision needed)*
- **Accessibility (WCAG) audit and remediation** — no stated commitment today. *(Engineering + audit · medium · decision needed)*
- **RAP maturity / completeness scoring + feedback report** — the largest unbuilt *product* idea: score
  a RAP's depth against an Indigenomics standard and emit a structured feedback report. Needs a rubric
  co-defined with the Institute. *(Engineering + data · large)*
- **Real authentication** (replace the shared demo password with Cognito-style logins + password
  reset). *(Engineering · medium)*
- **Real supplier identity verification** (CCAB / nation endorsement) to replace the stubbed identity
  tier — today a tier is just an enum. *(Engineering + partnership · large)*
- **Self-serve org upload for unclaimed organizations** (today only claimed companies can upload;
  gated on registry verification being real). *(Engineering · medium)*
- **Alignment engine depth** — semantic matching and AI rationale are **stubbed off by default**
  (BM25 + templates run today); plus equity/capital matching, a track-record signal, a feedback loop,
  and a proactive inbox. *(Engineering · medium–large)*
- **Web / statutory RAP ingestion** (HTML and statutory sources, plus a discovery crawler — RAP
  discovery is manual today). *(Engineering · medium)*
- **Legal-info depth** — multi-turn Q&A and a verified clinic directory; retrieval enhancements
  (rerank/ANN/snippets) are deliberately trigger-gated until scale warrants them. *(Engineering + content · medium)*
- **Whole-product Horizon-2 gaps** — dispute-resolution workflow, an Institute admin/curation surface,
  a visibility/privacy model, annual re-confirmation lifecycle. *(Engineering · large, multi-quarter)*

---

## Quick reference — the backlog by theme

| # | Item | State | Size / type |
|---|---|---|---|
| Data & Trust | ISED registry verification | Stub | small–med · eng |
| | BN-map curation (37/103) | Partial | med · data |
| | "Confirmed" tier (always 0%) | Not built | med · eng+data |
| | Real supplier onboarding | Partial (code real, data fixture) | med–lg · data |
| | Trackability signal | Not built | **small · eng (quick win)** |
| | Governance enforcement (consent/audit/KMS/ca-central-1) | Deferred (tag only built) | large · eng+gov |
| Extraction | Prod engine → Textract-LAYOUT | Config flip | small–med · eng |
| | Scanned-PDF OCR | Known limitation | small–med · eng |
| | In-country ("Option B") extraction | Deferred | med · eng+decision |
| | TELUS Canada-hosted inference | Prospective | med · eng+partner |
| | RAP maturity scoring + feedback | Not built | large · eng+data |
| | At-scale run + job queue | Known limitation | med · eng |
| Security & Ops | WAF → blocking | Config flip | small |
| | Custom domain | Known limitation | small |
| | Shared-inbox alerts + SES prod access | Partial | small · ops |
| | Client-account provisioning | To do | med · ops |
| | Backups/PITR + residency decision | Partial | med · ops+decision |
| | Infra cost wins (arm64, lifecycle, TTL) | Not done | small · config |
| Reach & Access | Bilingual EN/FR | Absent | large · eng+content |
| | Accessibility (WCAG) | Absent | med · eng+audit |
| | Self-serve org upload | Partial | med · eng |
| | Real auth (Cognito) | Deferred | med · eng |
| | Supplier identity verification | Stub | large · eng+partner |
| Product | Alignment engine depth | Stub-by-default + planned | med–lg · eng |
| | Company ↔ seeded-data crosswalk | Not built (**P0**) | med · eng |
| | Dispute/admin/visibility (Horizon 2) | Not built | large · eng |
| | Legal Q&A + retrieval depth | Deferred | med · eng+content |

*Deliberately paused (not recommended now):* the full **grounded-corpus cutover** was evaluated and
paused as low-return — the live Index stays on the curated illustrative dataset. The **second-AI
"judge" validation** is intentionally omitted, because the research showed it gives no reliable
signal on this data ([06](./06-rap-research-data-verification-and-commitment-variation.md)); human
review stays the right instrument.

---

## Suggested first five (if you must pick)

1. **Launch-readiness bundle** (Horizon 1): WAF→block, custom domain, shared-inbox alerts + SES,
   demo purge. Small steps, but real gates — and the alert email currently points at an address that
   will be deactivated.
2. **Switch production to Textract-LAYOUT + OCR.** Largely config; directly improves the citations
   every user sees.
3. **Activate ISED registry + finish BN curation.** The trust backbone; both are self-flagged
   blockers with the seam already built.
4. **The trackability signal.** Highest visibility per unit of effort — the data already exists.
5. **Company ↔ seeded-data crosswalk + reframe the 0% "Confirmed" tier.** Two quiet
   value-proposition holes worth closing (or honestly reframing) early.

---

*Grounded in the repository as handed off: the design specs' Future/Out-of-scope sections, the
internal action-items evaluation, and the code seams (`registry.ts`, `org-bn-map.ts`, the WAF and
engine config in `sst.config.ts`, `insights.ts`). Where an item is a **decision** rather than a build
— residency posture, bilingual support, accessibility target, the RAP-maturity rubric — it is flagged
as such, because those are the Institute's to make.*
