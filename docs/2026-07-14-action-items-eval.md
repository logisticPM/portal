# Portal evaluation & next-week action items — week of 2026-07-14

**Author:** Nate (En-Ping) · **Status:** proposed action items for team review · **Date:** 2026-07-11

This doc evaluates the current portal against the two anchor documents that have driven our
work — the client's **"Ideas to Build and Explore"** (6) and **"Questions to Drive the Work"**
(6) — plus the client's **data-governance requirement**. It records an honest pros/cons of the
current state and proposes prioritized action items for next week.

All claims below were verified against `main` on 2026-07-11 (not memory). File:line citations
are included so anyone can check.

---

## 0. TL;DR — the three things that actually need fixing

1. **The company-account ↔ seeded-data link does not exist (P0).** We seeded 115 public
   commitments from published RAPs, but a company that signs up and claims its Business Number
   is linked to a *completely separate* data world (`RapData`), not to its own seeded rows in the
   `Commitments` table. The two domains use disjoint identity schemes with no crosswalk. A company
   cannot see, claim, or update the public commitments we already hold for it. UI copy on `/my-rap`
   even tells companies their uploads "appear in the public RAP Index" — they do not.

2. **"Confirmed" on the RAP Index is structurally always 0% (P1 — mostly a framing fix).** No
   runtime path can move a commitment to `confirmed`; it is an enum value with no producer, by
   deliberate design. This is *honest* (self-reporting ≠ confirmation) but the tile currently reads
   as a dead metric. Meanwhile a **real** dollar-based confirmation layer already exists in a
   different domain (supplier attests a spend line) and is unused by the RAP Index.

3. **Canadian data residency + the consent/sovereignty layer are not built (P1 — not yet
   violated).** 100% of production data (including uploaded RAP PDFs) lives in `us-east-1` (USA).
   This is fine *today* because all data is public, but the client requires org-submitted/private
   data to be Canadian-hosted with access controls, and the "data consent layer reflecting
   Indigenous data sovereignty" (client Idea #4) does not exist as an enforced mechanism. Both must
   be solved **before** the first company uploads private data.

Everything else the client asked for is either built or partially built (scorecard below).

---

## 1. Scorecard — current state vs the client's anchor docs

### Ideas to Build and Explore

| # | Idea | State | Notes |
|---|------|-------|-------|
| 1 | RAP submission portal, AI extraction + tagging | ✅ **Built** | `/extract`, BDA pipeline; real extraction live in prod as of 2026-07-11 (Bank of Canada RAP → 22 grounded commitments, 68s). |
| 2 | RAP Index dashboard by sector/size/type + **automated progress over time** | 🟡 **Partial** | Dashboard built (`/commitments` Table+Explore). "Progress over time" is **static seeded values**; the company-driven update path exists but is disconnected from the seeded rows (see §0.1). |
| 3 | Automated **scoring / completeness framework** vs Indigenomics standards + structured feedback | 🔴 **Not built** | Grounding validation exists (quote/confidence flagging), but there is no depth/completeness score against a standard, and no feedback report. A "RAP maturity" column is stubbed/dead. |
| 4 | **Data consent layer** / Indigenous data sovereignty / access controls | 🔴 **Not built** | Framing + OCAP labels + one export endpoint only. No consent record, no access-audit log, no citation/query controls. |
| 5 | Alert/notification when orgs are **overdue** on milestones | 🟡 **Partial** | A static insight computes "34 past target year" / "45 due in 2026 behind pace," but there is no alert/notification delivery mechanism. |
| 6 | AI automation connecting RAP data to partner/corporate DB, flagging **alignment** in real time | ✅ **Built** | Alignment engine (BM25 + weighted score + honest rationale); recompute fires on Commitments-table Stream writes. |

### Questions to Drive the Work

| # | Question | State | Notes |
|---|----------|-------|-------|
| 1 | How many public RAPs collectable + reliable sources | 🟡 Ongoing | 115 commitments / 103 orgs collected; acquisition worklist exists. |
| 2 | Data schema for storage + analytics across varied formats | 🟡 Built-with-tension | Canonical taxonomy shipped (PR #145). But the **two-domain split** (commitments vs rap) is itself the schema problem behind §0.1. |
| 3 | Analytics most valuable to partners / corporates / Indigenous orgs | ✅ Built | Explore, Coverage, Alignment. |
| 4 | Automation tools for ongoing discovery / extraction / population | 🟡 Partial | Extraction automated; **discovery** (finding new RAPs) is still manual — no crawler/monitor. |
| 5 | Handle plans of varying quality/completeness while keeping analytical integrity | 🟡 Partial | Grounding gate + flag-for-review exist; the completeness scoring of Idea #3 is the missing half. |
| 6 | Live, publicly accessible RAP Index dashboard | ✅ Built | Live on CloudFront. |

### Data governance requirement

| Requirement | State | Evidence |
|---|---|---|
| Public data hostable anywhere | ✅ Met | All public today. |
| **Org-submitted/private data → Canadian hosting + access controls** | 🔴 **Not met** (not yet triggered) | Region hardcoded `us-east-1`; `sst.config.ts:32,152-170`. |
| Always carry provenance | ✅ **Met (strong)** | `Grounded<T>` + `Provenance` enforced and displayed; `src/lib/rap/types.ts:62,254,321`. |
| No secrets in repo | ✅ Met (one cleanup) | Clean; env/SSM/IAM. **But** a shared demo password `demo-portal-2026` is committed in seed scripts (`scripts/seed-org-logins.ts:16`, `src/lib/seed/fixtures.ts:79`). |

---

## 2. Detailed findings (pros / cons)

### Finding A — Two disjoint identity domains; company accounts can't reach seeded data (P0)

**What's true today.**
- The public RAP Index (`/commitments`) reads the **`Commitments` table** (`src/lib/commitments`), seeded with ~115 rows from public RAPs. Of 117 fixture rows, only **9 carry an `orgId`** (the 3 demo companies); the ~108 real public rows (Cenovus, Suncor, …) have **no `orgId` and no `businessNumber`** — they are grouped for display by `slugifyOrg(orgName)` → e.g. `"cenovus-energy"` (`src/lib/commitments/orgs.ts:20-37`).
- The claim + progress feature lives entirely in the **`RapData`** extraction domain (`src/lib/rap`). Claiming resolves a **BN** → `org-bn-<9-digit>` and writes an `OrgClaim`; progress is an append-only `Observation` on a `RapData` commitment, gated by that claim (`src/lib/rap/actions-core.ts:70-129`).
- **No crosswalk exists.** `"cenovus-energy"` (name slug) and `"org-bn-123456789"` (BN) never reconcile; the `Commitments` schema has no BN field; `src/lib/rap` and `src/lib/commitments` never touch each other's data.
- **Misleading UX.** `uploadRapAction`/`confirmExtractionAction` call `revalidatePath("/commitments")` and `/my-rap` copy says published commitments appear "in the public RAP Index" (`src/app/my-rap/page.tsx:220-222`), but `/commitments` never reads `RapData`. The claim is false.

**Pros of the current design.** Clean separation of concerns; the extraction domain is BN-anchored and dedup-hardened (good identity hygiene for *uploaded* data); progress is append-only and auditable.

**Cons.** The single most important user journey — "a company signs up to keep its RAP progress current" — **dead-ends**. The company's own public commitments (the ones that make the Index valuable) are unclaimable and uneditable by anyone. To contribute, the company must re-upload its RAP and have it re-extracted into a *parallel* `RapData` identity, duplicating itself and still not updating the public board. This undercuts Idea #2 ("automated progress tracking over time") and Question #2 (one schema for storage + analytics).

**Needs fixing: YES.** This is the structural centerpiece for next week.

### Finding B — "Confirmed" is a structurally dead metric on the Index (P1)

**What's true today.** `CommitmentStatus` includes `confirmed`, but the only write actions cap submissions at `reported` (`SUBMITTABLE_STATUS`, `src/lib/commitments/actions.ts:19,51,82`); no reviewer UI, action, or fixture ever sets `confirmed`. So `confirmedPct = confirmed/total` is always 0 (`src/lib/commitments/query.ts:76-77`). Separately, a **real** attestation layer exists for *spend lines* — the `Confirmation` entity + supplier `/confirm` page drive a **non-zero** dollar-based `confirmedPct` on `/coverage` and `/analytics` (`src/lib/repo/types.ts:82-89`).

**Pros.** The 0% is *honest*: a company grading its own homework is not confirmation; the tile refuses to manufacture false assurance. Provenance and grounding are strong.

**Cons.** As shown, the tile reads as broken/dead to a viewer; and we already have a genuine counterparty-attestation mechanism (spend lines) that the commitment ladder does not leverage. There is no path for a supplier/Nation to attest a *commitment outcome*.

**Needs fixing: YES, but lightweight** — primarily decide framing, optionally bridge to the existing attestation layer.

### Finding C — Canadian residency + consent/sovereignty layer absent (P1, pre-emptive)

**What's true today.** Production region is hardcoded `us-east-1`; every table, bucket (incl. `RapUploads` raw PDFs), and Lambda lands in the USA (`sst.config.ts:32`). The `ca` stage is a documented *escape hatch*, not deployed, and wouldn't be treated as production. The BDA extraction runtime only works in `us-east-1` today; an in-country path (Claude on Bedrock `ca-central-1`, "Option B") exists in code but is deferred. Access control **exists** at the app layer (HMAC session, per-kind action guards, `OrgClaim` ownership, re-extraction lock) but there is **no** consent record, access-audit log, or query/citation control — Idea #4 is framing + labels only.

**Pros.** Provenance is first-class; app-layer authz is real; the residency requirement is *known* (comments + an env-overridable region + a stubbed OCAP export bucket). Nothing private has been uploaded yet, so no requirement is currently violated.

**Cons.** The moment a real company uploads a private/unpublished RAP, we are storing Canadian org data in the USA with no consent layer — squarely against the client's stated requirement and the Indigenous-data-sovereignty framing. The in-country extraction path is also the weaker engine today.

**Needs fixing: YES — spec now, build before first private upload.**

### Finding D — Completeness/scoring framework missing (P2)

Idea #3 (score a RAP's depth/specificity vs Indigenomics standards → structured feedback) is not built. We have grounding validation but no standard-referenced completeness score. **Needs building — spec next week.**

### Finding E — Overdue alerting is compute-only (P2)

Idea #5's overdue signal is computed as a static insight but never delivered (no notification/subscription). **Needs building — small.**

### Finding F — Housekeeping (P3)

- Shared demo password `demo-portal-2026` committed in seed scripts and logged to console — rotate/remove before any non-demo environment is seeded.
- AWS account number appears in plaintext BDA ARNs (identifier, not a credential, but note it).

---

## 3. Action items for the week of 2026-07-14

> Prioritized. Each item is scoped to be a spec and/or a first PR next week, not a full build.
> Owners TBD at sprint planning.

### P0 — Reconcile the two identity domains (make companies able to claim & update their seeded RAP)

- [ ] **Decision spike:** choose the target architecture (see Open Decisions §4.1). Recommended:
      add a `businessNumber` (+ optional `orgId`) to the commitments domain and a crosswalk keyed on
      BN, so a company's BN claim resolves to *both* its `RapData` uploads and its seeded
      `Commitments` rows.
- [ ] Add a **BN ↔ seeded-org crosswalk** (a small mapping entity, or a BN column on commitments
      backfilled for the top orgs via the ISED registry).
- [ ] Let a claimed company **view and update progress on its seeded public commitments** (route the
      commitments-domain `updateCommitmentAction` ownership check through the `OrgClaim`/BN, not only
      `orgId === partyId`).
- [ ] **Fix the misleading UX now** (cheap, do first): correct the `/my-rap` copy and the
      `revalidatePath("/commitments")` so we don't claim uploads appear on a board they don't feed.

### P1 — Data residency + consent/sovereignty (spec, since no private data yet)

- [ ] **Data-classification tag** on every stored artifact: `public` vs `org_submitted`. This is the
      switch that later routes hosting + access.
- [ ] **Residency spec:** a `ca-central-1` home for `org_submitted` data (RapUploads + the private
      slice of RapData + progress), keeping the public index where it is. Document the BDA-us-east-1
      constraint and adopt **Option B (Claude on Bedrock, `ca-central-1`)** as the in-country
      extraction path for private uploads.
- [ ] **Consent layer v1 spec (Idea #4):** a consent record captured at upload (who may access/query/
      cite), an **access-audit log**, and enforcement hooks on the org-data read paths. Start minimal:
      record + log + a per-party access gate; defer query/citation licensing.

### P1 — Confirmation layer for commitments (framing + optional bridge)

- [ ] **Decide (Open Decision §4.2):** (a) reframe the Index tile to say "0% independently
      confirmed — self-reported" with a tooltip, and/or (b) bridge the existing spend-line
      `Confirmation` attestation into a commitment-level "confirmed" signal so the metric can move.

### P2 — RAP completeness / scoring framework (Idea #3)

- [ ] Spec a **completeness score** (coverage of expected RAP sections + specificity of targets +
      grounding coverage) against an Indigenomics standard, emitting a structured feedback report on
      `/extract`.

### P2 — Overdue milestone notifications (Idea #5)

- [ ] Turn the existing overdue *insight* into a delivered **alert** (digest email or an
      Indigenomics dashboard queue) — reuse the computed "past target year / behind pace" signal.

### P3 — Housekeeping

- [ ] Rotate/remove the committed demo password; stop logging it.

---

## 4. Open decisions for the team

1. **Domain reconciliation strategy (blocks P0).**
   - **Option A — Crosswalk (recommended, least disruptive):** keep both domains; add a BN key to the
     commitments domain + a mapping so a claim resolves to both. Lower risk, ships incrementally.
   - **Option B — Unify on one domain:** migrate seeded commitments into `RapData` (or vice-versa).
     Cleaner long-term, larger migration, higher risk.
2. **Confirmed-metric direction (blocks P1 framing):** reframe-only, bridge-to-spend-lines, or build a
   new commitment-outcome attestation. Recommendation: reframe now + bridge next.
3. **Residency scope:** private-slice-only in `ca-central-1` (recommended) vs move the whole stack to
   `ca-central-1` (simpler mental model, loses the stronger BDA engine for everything).

---

## 5. What is already solid (keep)

- Real extraction is live and grounded (provenance is a genuine strength — meets the governance
  "carry provenance" bar well).
- Alignment scoring is now honest (BM25 + weighted formula, real rationale) after the #149 fix.
- App-layer authz (HMAC sessions, per-kind guards, `OrgClaim` ownership, re-extraction lock) is a
  sound foundation to extend the consent layer onto.
- Dedup + BN identity hygiene on the *uploaded* side is good; the P0 work extends that same rigor to
  the seeded side.
