# RAP Index evidence-precedence: opt-in surfacing + confirmation bridge

**Author:** Nate (En-Ping) · **Status:** proposed design for team review · **Date:** 2026-07-15

**Builds on:** [`2026-07-14-domain-reconciliation-crosswalk-design.md`](./2026-07-14-domain-reconciliation-crosswalk-design.md)
(the BN crosswalk — `businessNumber` on the commitments domain, the `src/lib/identity/` seam, and
BN-matched `RapData` reads). This spec is the **surfacing + trust layer** on top of that crosswalk and
**depends on it**.

---

## 1. Context & problem

Two facts set up this work:

1. **The team decided** that a company which has uploaded its RAP can **opt in** to have that uploaded
   data shown on the public RAP Index (`/commitments`). Today an uploaded RAP lands only in the
   `RapData` domain (`/my-rap`, `/extract`) and never reaches the Index — `publishAndConfirm` writes
   only to `rapRepo` (`src/lib/rap/stage-extraction.ts:106-113`), and `/commitments` reads only the
   commitments domain (`src/app/commitments/page.tsx:5`). PR #165 already removed the UI copy that
   falsely claimed uploads appear on the Index.

2. **Uploaded RAP data is self-reported and gameable.** Surfacing it on a *public* Index without a
   trust model would turn the Index into a greenwashing megaphone. The platform's whole value is
   provenance, so surfacing must be governed by *how independent* each piece of evidence is.

**The problem this spec solves:** let opted-in companies surface their self-reported RAP data on the
Index **without** letting self-report move their public standing, and make the currently-dead
"confirmed" metric real — by resolving every commitment's public status through one **evidence-
precedence rule**.

Related dead metric this fixes: the RAP Index "confirmed" tile is structurally always 0% — no runtime
path sets `Commitment.status="confirmed"` (`SUBMITTABLE_STATUS` caps company writes at `reported`,
`src/lib/commitments/actions.ts:19`; `orgs.ts:32,41` counts `status === "confirmed"`). The confirmation
bridge below finally drives it.

## 2. Goals / non-goals

**Goals**
- **Per-organization opt-in** to surface uploaded (`RapData`) commitments on the Index, revocable at
  any time, off by default (consent is explicit).
- **A single evidence-precedence rule** for a commitment's public status: `confirmed > research >
  self-reported`.
- **Read-time projection, not a copy.** Opted-in `RapData` is displayed by reading it live; nothing is
  written into the commitments domain. Opt-out = it disappears on the next render.
- **Self-report is visible but never ranks.** The leaderboard and an org's headline number are computed
  from research + confirmed evidence only.
- **A live confirmation bridge.** An independent supplier `Confirmation` of procurement spend elevates a
  procurement commitment to `confirmed`, making the metric move (resolves eval Finding B).
- **Provenance is legible.** Every surfaced row is badged by origin (research / company-uploaded) and,
  where confirmed, marked independently confirmed.

**Non-goals (deferred)**
- **Merging the two domains / copying RapData into `Commitments`.** Rejected — see the crosswalk spec.
  This is a read-time projection.
- **Commitment-level matching between a seeded `Commitment` and a specific `RapData` commitment.** They
  have no shared key below the org/BN level; fuzzy matching would misattribute. Self-reported rows are
  shown as **their own rows**, not merged onto seeded rows.
- **Capital / equity confirmation.** The confirmable flow in v1 is `procurement` (matching the economic-
  flow domain, where `capital` is marked H2 — `src/lib/repo/types.ts:58-60`).
- **Per-line → per-commitment dollar attribution.** v1 confirmation is org-level for procurement (§6);
  precise line-to-commitment matching is a later refinement.

## 3. Design principles

1. **Independence orders trust.** Rank evidence by how far it sits from the party it flatters:
   supplier confirmation (independent) > our research (external) > company self-report (self-interested).
2. **Derive, don't mutate.** A commitment's displayed status/tier is computed at read time by a pure
   resolver. No stored `status` is rewritten; nothing is copied between domains. Reversible by design.
3. **Transparency ≠ standing.** Opting in buys *visibility* of the self-reported layer, never a change
   to the public score or rank.
4. **Reuse the seams we're already building.** The resolver depends on the crosswalk's identity seam and
   the existing economic-flow `Coverage`; it does not make the two domains import each other.
5. **Honest labels over flattering numbers.** Where confidence is coarse (org-level confirmation), the UI
   says exactly what it means rather than implying a precision we don't have.

## 4. The evidence-precedence model

Every row shown for an org resolves to exactly one **tier**, which fixes both its displayed status and
whether it ranks:

| Tier | Source entity | Applies to | Displayed | Ranks? |
|---|---|---|---|---|
| **1 · Confirmed** | `Confirmation` on a procurement `ReportedLine` (via `Coverage`) | commitments-domain **procurement** rows with confirmed spend | `confirmed` | **yes** |
| **2 · Research** | the `Commitment` itself | all commitments-domain rows (seeded + company-created) | its stored `status` | **yes** |
| **3 · Self-reported** | projected BN-matched `RapData` commitment + its `CommitmentRollup` | opted-in orgs only, shown as **separate rows** | rollup status, badged | **no** |

Tiers 1–2 are two levels of the **same** commitments-domain rows (a research row is *elevated* to
confirmed when independent spend backs it). Tier 3 is an **additive, separate, non-ranking** set of rows.
This avoids fuzzy seeded↔RapData matching while honoring the rule the team approved: *self-report is
visible but never moves the ranking, and only confirmation raises a commitment to confirmed.*

## 5. The resolver (the heart)

A new pure module — proposed `src/lib/index-evidence/` — exposes one function, unit-testable with mock
readers, depending **up** on injected readers so neither domain imports the other:

```ts
type EvidenceTier = "confirmed" | "research" | "self_reported";

interface EvidenceRow {
  commitmentId: string;
  tier: EvidenceTier;
  displayStatus: CommitmentStatus;      // what the Index shows
  ranks: boolean;                       // counts toward headline + leaderboard
  provenance: "research" | "company_uploaded";
  confirmed?: { confirmedAmount: number; source: "supplier_attestation" };
}

// readers injected (from the identity seam + economic-flow + rap projection):
//   claims:        ClaimReader          — granted BNs + showcaseOptIn per party/org
//   confirmations: ConfirmationReader   — org's confirmed procurement $ (from Coverage)
//   projection:    RapProjectionReader  — BN-matched RapData commitments + rollups
function resolveOrgEvidence(orgRows: Commitment[], org: { bn?: string; optedIn: boolean }, deps): EvidenceRow[]
```

**Per commitments-domain row:** start `tier = "research"`, `displayStatus = row.status`, `ranks = true`,
`provenance = "research"`. If `row.type === "procurement"` **and** the org has confirmed procurement
spend (§6) → `tier = "confirmed"`, `displayStatus = "confirmed"`, attach `confirmed`.

**Projected self-reported rows** (only when `org.optedIn && org.bn`): for each BN-matched `RapData`
commitment, emit `tier = "self_reported"`, `ranks = false`, `provenance = "company_uploaded"`,
`displayStatus` = the RAP `CommitmentRollup.latestStatus` mapped into the commitments lifecycle.

> **Status mapping note.** RapData statuses (`not_started/on_track/delayed/met/missed`) must map to the
> commitments display lifecycle. No `statusToCanonical` helper exists today (the Fact-boundary mapping
> lives in `src/lib/rap-index/`); implementation must reuse/extend that mapping in one place rather than
> re-inventing it inline.

## 6. The confirmation bridge (Tier 1)

Connects the economic-flow domain (`ReportedLine` → `Confirmation` → `Coverage`,
`src/lib/repo/types.ts:65-100`) to a commitment's public status.

- **Scope:** `procurement`-type commitments only (the confirmable flow).
- **Signal:** an org has *independent procurement confirmation* when `Coverage.byFlow.procurement.
  confirmed > 0` — i.e. at least one supplier has attested procurement spend for that company.
- **v1 attribution — org-level.** Confirmed procurement spend elevates the org's procurement
  commitment(s) to `confirmed`. This honestly says "this company's procurement is backed by supplier-
  confirmed spend," without over-claiming a per-commitment dollar match we can't reliably make.
- **`confirmedPct` becomes real.** The org rollup's `confirmedPct` (`orgs.ts:41`) is redefined to be
  driven by the resolver: share of the org's **confirmable (procurement)** commitments whose tier
  resolves to `confirmed`. Non-zero exactly when supplier confirmations exist. The denominator is
  *confirmable* commitments (labeled as such), not all commitments — so the number reads honestly.
- **Surface the confirmed amount, not just a badge (coarseness mitigation).** Because v1 attribution is
  org-level and binary, a small confirmed line and a target-meeting one would both read "confirmed". So
  the confirmed tier carries the org's **actual confirmed procurement dollars** (`Coverage.byFlow.
  procurement.confirmed`) for display alongside the badge — e.g. *"Independently confirmed — $3M in
  supplier-attested procurement."* We surface the real attested figure; we never allocate it to a
  specific commitment or imply the target was met. This turns the org-level coarseness from a hidden
  overclaim into visible, reader-judgeable context. The resolver's `confirmed.confirmedAmount` (§5)
  carries this value.

Matching precision (org-level vs period-scoped vs target-proportional dollars) is an open decision
(§11.1). The honest refinement path is a schema change — a `commitmentId?` on `ReportedLine` so a
company can attribute a confirmed spend line to the commitment it serves; only then do per-commitment
confirmed-vs-target percentages become derivable rather than invented.

## 7. Opt-in mechanism

- **Storage:** `OrgClaim` gains `showcaseOptIn?: boolean` and `showcaseOptInAt?: string`. Org-level
  (matches the per-org decision); default absent/false (consent explicit). The RapData table is empty in
  prod, and `OrgClaim` lives in the RAP repo — an additive field with **no migration hazard**.
- **Control:** a new server action `setShowcaseOptInAction` on `/my-rap`, gated by
  `session.kind === "company"` + a granted `OrgClaim` (same guard as `recordRapProgressAction`,
  `src/lib/rap/actions.ts:171`). A visible toggle on `/my-rap` with copy that states plainly what
  surfacing does and that it never changes the public score.
- **Revocation:** flip the flag off → the resolver stops emitting self-reported rows → they vanish next
  render. Nothing to delete.

## 8. Read-path & UX changes

- **`/commitments` + org scorecard** (`src/lib/commitments/orgs.ts`, `src/app/commitments/`,
  `src/app/organizations/[id]`) run rows through `resolveOrgEvidence`. Headline `avgProgress`,
  leaderboard order, and counts are computed over `ranks === true` rows only (research + confirmed) —
  identical to today for non-opted-in orgs, plus confirmed elevation.
- **Self-reported rows** render in a clearly separated, badged group on the org scorecard ("Company-
  reported — uploaded RAP, not independently verified"), never blended into the headline number.
- **Provenance badges** per row: `Research` · `Company-uploaded` · `Independently confirmed`. The
  confirmed badge shows the org's **actual confirmed procurement dollars** beside it (§6 mitigation) —
  e.g. "Independently confirmed — $3M supplier-attested" — never a per-commitment allocation.
- **The "confirmed" tile** now reflects §6 (with an honest sublabel).

## 9. Phasing / PR breakdown

Depends on the crosswalk PRs landing first (`businessNumber` on `Commitment`, the identity seam, BN-
matched RapData reads). Then, each independently mergeable:

1. **PR-A — opt-in storage + control.** `showcaseOptIn` on `OrgClaim`; `/my-rap` toggle + action. Stored,
   not yet surfaced. Near-zero risk.
2. **PR-B — resolver.** `src/lib/index-evidence/` pure module + reusable status mapping; unit-tested with
   mock readers. No UI wiring yet.
3. **PR-C — confirmation bridge.** `ConfirmationReader` over `Coverage`; wire Tier 1 into the resolver;
   redefine `confirmedPct`. Makes "confirmed" move (resolves Finding B).
4. **PR-D — surfacing.** Render projected self-reported rows (badged, non-ranking) + provenance badges on
   the Index and org scorecard for opted-in orgs.

## 10. Testing

- **Resolver (mock readers):** confirmed elevation fires only for `procurement` + confirmed spend;
  self-reported rows always `ranks:false`; opt-off yields zero projected rows; a non-opted-in org
  resolves identically to today; `provenance` correct per row.
- **Rollups:** headline `avgProgress` / leaderboard exclude self-reported rows (a rosy upload cannot
  change rank); `confirmedPct` is non-zero iff confirmations exist and uses the confirmable denominator.
- **Opt-in action:** rejects a party without a granted claim on the BN (directly-POSTable action — test
  the raw path); toggling off removes surfacing.
- **Regression:** `/commitments` and org scorecards render unchanged for every non-opted-in org.

## 11. Open decisions (for sprint planning)

1. **Confirmation matching granularity (§6):** org-level procurement (recommended v1) vs period-scoped
   (`ReportedLine.period` ≈ `targetYear`) vs target-proportional dollars. Recommend org-level now; refine
   later — it's additive.
2. **`confirmedPct` denominator:** confirmable (procurement) commitments (recommended, honest) vs all
   commitments (comparable to today's shape but dilutes the signal).
3. **Public visibility of self-reported rows:** public + badged (as decided) vs visible only to
   authenticated viewers if the Institute prefers to gate unverified disclosure. Recommend public +
   badged.

## 12. Risks & mitigations

- **Over-claiming confirmation.** Org-level attribution could imply more than one confirmed line proves.
  Mitigation: conservative scope (procurement only), honest labels, confirmable-only denominator.
- **Greenwashing via self-report.** Mitigation: self-report is structurally non-ranking; the leaderboard
  cannot be moved by an upload.
- **Projection cost on the Index hot path.** Extra RapData reads per opted-in org. Mitigation: only
  opted-in orgs pay it; cache/limit the projection read.
- **Provenance confusion (two numbers for one org).** Mitigation: one headline number only; the tier
  distinction lives per-row as badges, not as a competing org-level percentage.
- **Prod data drift.** None expected — additive `OrgClaim` field on an empty table; everything else is
  read-time derivation over existing data.

## 13. What this unlocks

- Companies get real, current, *honest* presence on the public Index for their own disclosure.
- The "confirmed" metric stops being decorative and starts reflecting independent supplier attestation.
- The three platform domains — commitments, RAP extraction, economic flow — finally meet at the Index
  under one legible rule, which is exactly the story the client-facing system map illustrates.
