# 06 · Indigenous Business Verification System — design (RAP-43)

**Sprint:** 2 (Horizon carry) · **Type:** Feature design (brainstormed + competitively adjusted) · **Owner:** supplier-side (Jack) + seam (Data group)
**Status:** Design approved 2026-06-12 (scheme + 5 adjustments) → spec → plan → build
**Branch:** `rap-43-verification`

---

## Goal (one line)

Make a supplier's tier **trustworthy** and add the integrity layer **no competitor has**: verify **substance** (did set-aside spend actually reach a *real, working* Indigenous business?) — not just **status** (who is certified). **Consume** CCIB / ISC / Nation certifications; **don't re-certify, don't build a rival marketplace.**

## Why this shape (competitive grounding)

- **CCIB runs BOTH** the CIB certification **and** the *Supply Change* procurement marketplace (Uber-backed, relaunched 2026, ~1,751 CIBs + 160 buyers). → Don't compete on certification or marketplace; we'd lose.
- The **federal program is "failing" on integrity** (Procurement Ombud): shell companies meet ≥51% **on paper** but **don't do the work**, capturing set-aside contracts. → **That integrity gap is our wedge.** Directories/marketplaces verify *status*; none verifies *substance*.
- ISC is **devolving Indigeneity verification to Indigenous partners** → our model must be **Indigenous-led + consume authorities, never be the authority.**

## The two layers (the core idea)

| Layer | Verifies | Source | Who |
|---|---|---|---|
| **A — Status** | Is this a genuine ≥51% Indigenous business? | CCIB **CIB** / ISC **IBD** / **Nation** / regional | **Consumed** (referenced), NOT re-adjudicated by us |
| **B — Substance** *(our moat)* | Did real economic activity actually flow to this named business? | the **confirmation engine** (already built) | **Ours** |

**A shell company passes A but fails B** (no/low confirmed activity, disputes, anomalous patterns). **Trust = A × B.** The integrity signal = the **mismatch**: *certified but ~$0 confirmed*, or *self-declared with large claims*.

---

## 1. Data model — `types.ts` (additive)

```ts
// A linked EXTERNAL certification (Layer A). We reference it; we do not issue it.
export type VerificationSource = "nation" | "ccib" | "isc_ibd" | "regional";
export type VerificationStatus = "verified" | "pending" | "expired" | "revoked";

export interface Verification {
  source: VerificationSource;
  reference?: string;   // CIB member #, IBD listing id, band-council-resolution ref…
  status: VerificationStatus;
  verifiedAt?: string;  // ISO
  expiresAt?: string;   // re-verify cadence (CCIB annual etc.); past → auto-expired
  verifiedBy?: string;  // the authority/verifier who confirmed the link
}
// Supplier gains:  verifications?: Verification[];
```

**`identityTier` becomes a verification-backed CACHE, never self-set:**
- Recomputed whenever verifications change: any **active** `nation` → `"nation"`; else any active `ccib | isc_ibd | regional` → `"ccab"` (= "certified"); else `"self_declared"`.
- Keeps all downstream (`byTier`, showcase) working unchanged. **Registration no longer lets a supplier pick `nation`/`ccab`** — they start `self_declared`; the tier only rises through a *verified* `Verification`.

## 2. Repo (seam) methods

```ts
claimVerification(supplierId, { source, reference }): Promise<Verification>;   // status: "pending"
resolveVerification(supplierId, source, { status, expiresAt, verifiedBy }): Promise<Supplier>; // verify/expire/revoke → recompute identityTier
listPendingVerifications(): Promise<{ supplier: Supplier; verification: Verification }[]>; // the review queue
```
`getSupplierShowcase` already returns the activity (Layer B). Add the supplier's **active verifications** (Layer A provenance) to the showcase payload; add an **integrity flag** helper (see §4).

## 3. Verification flow

1. **Claim** (supplier, in `/profile`): pick a source (CCIB CIB / ISC IBD / Nation / regional) + enter the reference (cert #, IBD id, BCR ref) → `pending`. *This is a LINK claim, not a re-certification.*
2. **Resolve** (verifier): confirm the link against the real source (CCIB Member Directory lookup / ISC IBD / Nation confirmation) → `verified` + `expiresAt` + `verifiedBy`; recompute tier. **AI assists only** (OCR the cert, fuzzy-match the directory, flag anomalies) — it never decides Indigeneity (sovereignty + correctness red line).
3. **Expiry / revoke**: past `expiresAt` → `expired` → tier recomputes down. OCAP: supplier can withdraw a verification / their data.

## 4. Surfaces

- **Supplier `/profile`** — a **"My certifications"** section: list verifications + status; "claim a certification" form. (Supplier-side, Jack.)
- **Verification review** — `listPendingVerifications` + a `resolveVerification` action. *P1: a lean reviewer view / demo verify action. Full queue + role-gating = H2.*
- **Showcase `/s/[id]`** — show the **linked certifications** (provenance: "CIB #… · verified … · expires …") next to the **confirmed track record**. The combination IS the credential.
- **Index (Indigenomics)** — the **integrity lens** becomes the **mismatch detector** (Layer A × Layer B): surface *certified-but-~$0-confirmed* and *self-declared-with-large-claims* counts. counts-only; targets fraud **structures**, not individual businesses.

## 5. Governance (unchanged, reinforced)

- **Nations = apex authority for identity** (route Nation verifications to the Nation / designated Indigenous verifier). CCIB/ISC = consumed cert sources. **We aggregate-with-consent + show provenance; we never certify.**
- **Consent-inverted**: supplier owns + presents (not a 企查查/dossier). **AI = assist-only.**

## 6. Phasing

| Phase | Scope | Who |
|---|---|---|
| **P1 (build now)** | `verifications[]` + derived/locked tier; claim form; lean resolve/verify action; provenance on showcase; **mismatch integrity flag** on the Index; registration no longer self-sets tier | **engineering** |
| **P2 (H2)** | real CCIB directory / ISC IBD lookups; Nation endorsement workflow; AI anomaly agent; interop **output** (credential other platforms can consume) | **Indigenomics MOUs** + eng |
| **P3** | verifiable credentials (CCIB/Nations issue; cryptographic verify, no central query) | ecosystem |

## 7. Out of scope (YAGNI / red lines)

- ❌ Re-certifying ownership (CCIB/ISC do this).
- ❌ A rival marketplace / directory (CCIB Supply Change owns it).
- ❌ AI deciding who is Indigenous.
- ❌ Named-buyer exposure (counts-only stays).
- ❌ Real auth / role system (demo `?as=` stands; reviewer view is a demo surface).

## 8. Acceptance (P1)

1. A supplier in `/profile` can claim a CIB/IBD/Nation/regional verification (→ pending); it shows in their certifications list.
2. Resolving a verification to `verified` raises the derived tier (e.g. self_declared → ccab) and it appears on `/s/[id]` as provenance.
3. Registration/new suppliers default to `self_declared` — tier can NOT be self-selected.
4. The Index shows the **mismatch** signal: a certified supplier with ~$0 confirmed activity is flagged; a self-declared supplier with large claims is flagged.
5. `npm run typecheck` + `npm run build` green; renders on mock.

## 9. Companion edit — product doc §2 positioning

Update the product spec §2 north-star/positioning to record the competitively-adjusted stance:
> **Verify substance, not status; complement CCIB/ISC/Nations, don't compete; not a marketplace; consent-inverted.** The differentiator is the confirmation/integrity layer (Layer B), not another directory or certifier.

**Refs:** `05_Supplier_Showcase_Design` (showcase = Layer A+B surface) · `04_Pillar_Model_Proposal` (tier = ownership/equity verification) · spec §9 OCAP / §15 gap 1 · competitive sources: CCIB Supply Change (Uber relaunch 2026), Procurement Ombud "failing" review, ISC verification devolution.
