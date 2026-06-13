# 07 · Verification System — Phase 2 design & research (RAP-43 Horizon-2)

**Sprint:** 2 (Horizon-2 research) · **Type:** Design + research memo · **Status:** Research complete; **build is partner-gated** (P1.5 buildable now, P2 needs MOUs)
**Builds on:** `06_Verification_System_Design` (P1, shipped on `main`) — `verifications[]` + derived/locked tier + claim→resolve queue + provenance + status×substance integrity flag.

> **What P1 shipped vs what P2 adds.** P1 = the *model + manual* verification (consume external certs, don't re-certify; AI assist-only; consent-inverted; data off-chain). **P2 = real integration with the authorities, the design gaps closed, and the interop / verifiable-credential layer.**

---

## 1. The real landscape (researched, sourced)

| Source | Reality (2025–26) | Integration consequence |
|---|---|---|
| **CCIB — Certified Indigenous Business (CIB)** | Independent ≥51% owned+controlled + heritage proof; public **Member Directory (~2,460), NO public API**; **CCIB↔ISC have a $3.4M+ funding agreement** | No API → directory-assisted human re-check now; **data feed / VC via MOU** (the CCIB↔ISC tie makes this plausible) |
| **ISC Indigenous Business Directory (IBD)** | Web registration; ≥51% docs but **self-attestation-heavy**; **TIPS reform is devolving the "definition + verification of an Indigenous business" to Indigenous peoples** | ⚠️ **Don't hard-wire to a registry being replaced**; track TIPS |
| **NACCA — First Nation Procurement Org (FNPO)** | Building an **Indigenous-managed** First Nation business certification + directory | **This is where the puck is going — design to consume it** |
| **Nation** | modern-treaty / distinctions-based definitions | relationship-based; route to the Nation; Nation-issued VC ideal |
| **VC infrastructure** | **OrgBook BC** (live, Hyperledger Indy/Aries, 1.4M entities / 3.8M creds) · **DIACC Pan-Canadian Trust Framework (PCTF)** | real Canadian substrate for the interop layer |

## 2. Technology-selection stance (decided)

- **Verifiable Credentials are the eventual *interop* layer, not the foundation.** The core stays a **governed datastore + the confirmation engine**. (See `06`; the differentiator is Layer B, which needs no VC/ledger.)
- **Data never goes on a ledger.** OCAP requires the right to *withdraw*; an immutable ledger cannot forget. Only public crypto material (DIDs, schemas, revocation/status registries — no PII) may ever touch a ledger. This is exactly the VC model.
- **`did:web` first; a ledger-anchored DID only if a partner ecosystem (e.g. OrgBook BC) requires it.** Blockchain per se is rarely the optimal mechanism here — `did:web` + signatures beat it on simplicity, OCAP-compatibility, and readiness.

## 3. Design gaps closed (the substance of P2)

### 3.1 Source rigor — make the tier reflect *how* a supplier was verified (was: critical gap)
P1 collapsed `ccib` and `isc_ibd` into one "certified" tier — but ISC IBD (self-attested, the *failing* program) is **not** equivalent to CCIB CIB (independent) or a Nation endorsement (apex). Treating them the same undermines the whole rigor thesis.
**Design:** keep the derived `identityTier` for rollups, but carry a **`method`/rigor** on each `Verification` and **surface the source + method** everywhere the tier shows:
- `nation` → *Nation-endorsed (apex / self-determined)*
- `ccib` → *independently certified (CCIB CIB)*
- `isc_ibd` → *federal directory (self-attested)* — visibly weaker
- `regional` → *regional body*
- `self_declared` → *unverified*
The **integrity lens weights self-attested-only spend** alongside self-declared as elevated risk (not just `self_declared`).

### 3.2 Revocation / renewal "sync-back" — pluggable, buildable now (was: critical gap)
A cert can **expire** (time) or be **revoked / diluted** (event) before expiry. Design the pipeline **once**, swap the "how we learn" mechanism per source/maturity.
- **Model:** each `Verification` carries `status`, `verifiedAt`, `expiresAt`, **`lastCheckedAt`, `nextRecheckAt`**; a **recheck queue** surfaces due items into the same reviewer flow as new claims.
- **Mechanisms (pluggable, increasing fidelity):**
  1. **Expiry** — auto: past `expiresAt` → inactive → tier recomputes. **(P1 already.)** + add **expiry reminders** (notify supplier + reviewer N days before).
  2. **Periodic re-check** — on cadence, re-confirm active certs against the source; **AI assists** (directory lookup → "still listed?"), **human confirms** a revocation. **Buildable now** (CCIB directory + the queue).
  3. **Issuer revocation feed** — push from CCIB/ISC/NACCA-FNPO via a data agreement. *(MOU-gated; trivial to ingest.)*
  4. **VC status/revocation registry** — checked at verify-time, no call to issuer, privacy-preserving (W3C Status List / Indy rev-reg, as OrgBook BC). *(Issuer-VC-gated; the clean end-state.)*
- **Latency is honest:** only #3/#4 give near-real-time; #2 has a re-check window. **Backstop:** Layer B — a phantom that lost its cert but keeps claiming trips the **status×substance mismatch / anomaly** signal, so the two layers cover each other.

### 3.3 Verifier governance — route by source (was: critical gap)
P1 has one generic demo verifier. **Design:** verification of each source routes to the right authority — **Nation claims → that Nation / a designated Indigenous verifier; CCIB → CCIB confirmation; ISC → ISC**; Indigenomics is the orchestrator, **not the identity authority**. This aligns to the **TIPS devolution** (verification belongs to Indigenous peoples).

### 3.4 Important (iterative / H2)
- **Evidence handling** beyond a reference string: optional document upload + **AI OCR** to pre-fill + tamper flag (assist-only).
- **Distinctions-based** granularity: split `nation` into First Nations / Métis / Inuit (constitutionally distinct; CIB + Nations require it).
- **Multi-verification confidence:** CCIB **+** Nation should read as stronger than either alone (show all; the tier is the max, the *confidence* is the union).

### 3.5 Interop — the verifiable-credential layer
- **Verify incoming VCs:** if an issuer (CCIB / NACCA-FNPO / a Nation) issues a cert as a VC, verify the issuer signature against its DID + status registry → auto-set the verification (no central query). `did:web` first.
- **Issue our differentiator as a VC:** mint the supplier's **confirmed-track-record** as a holder-owned VC they can present to CCIB Supply Change / buyers / federal procurement. This turns the portal from an island into the ecosystem's **"confirmed-activity credential" issuer** — the thing none of the directories/marketplaces have.

### 3.6 Edge: dispute / conflict
A challenged claim, or "IBD-listed but a Nation disputes," routes to the relevant authority; status `disputed` until resolved; never auto-judged.

## 4. AI anomaly agent (assist-only, sovereign infra)
On the **confirmed dataset** (Layer B): flag phantom-JV clustering (same principals fronting many "Indigenous" JVs), cert-with-no-activity, self-declared-high-value, ownership-change-after-contract → **route to human / Nation / CCIB review**. **Never decides Indigeneity.** Runs on **Indigenomics' sovereign infrastructure** (CARE), not an uncontrolled third-party model.

## 5. Dependency split — what's engineering vs what needs a relationship

| Buildable now (engineering, no partner) | Partner-gated (Indigenomics MOU/policy) |
|---|---|
| Source-rigor `method` + surfacing; integrity weighting | CCIB / ISC / NACCA-FNPO **data feeds** (mechanism #3) |
| Recheck pipeline (`lastCheckedAt`/`nextRecheckAt` + queue) + expiry reminders + periodic-recheck (AI+human) | Issuers **issuing VCs** (mechanism #4) |
| Verifier **routing-by-source** scaffolding | Recognition as a verifier under **TIPS devolution** |
| `did:web` VC **verify + issue** prototype (confirmed-record credential) | **DIACC PCTF** certification |
| AI anomaly agent (on synthetic/confirmed data) | Nation endorsement workflows (per-Nation) |

## 6. Phasing

- **P1.5 (now, no partners):** §3.1 source-rigor labels · §3.2 recheck/expiry pipeline (mechanisms #1–2) · §3.3 routing-by-source scaffolding · optional `did:web` VC verify/issue prototype.
- **P2 (MOU-gated):** real feeds / VC from CCIB / ISC / NACCA-FNPO; anomaly agent on richer data; recognition under TIPS.
- **P3 (ecosystem):** full VC — issuers issue, we verify + issue the confirmed-record VC; DIACC-PCTF-certified; status-list revocation.

## 7. Red lines (recap)
Consume, don't certify · AI never decides identity · **data never on a ledger** · counts-only on the Index · not a marketplace.

## 8. Open questions (client / team)
- Which sources to prioritize first (CCIB vs the emerging NACCA-FNPO)?
- Appetite to align with **DIACC PCTF** + the **TIPS** devolution as the recognition path?
- How to present the **rigor tier** (ordered ladder vs source+method label) to buyers without stigmatizing self-declared Indigenous businesses?
- Does Indigenomics want to be a **VC issuer** of the confirmed-record credential (the interop play)?

**Sources:** [CCAB–ISC $3.4M funding agreement](https://www.ccab.com/canadian-council-for-aboriginal-business-announces-a-more-than-3-4-million-multi-year-funding-agreement-with-indigenous-services-canada/) · [ISC TIPS — what we learned](https://www.sac-isc.gc.ca/eng/1760990558055/1760990583301) · [CCIB CIB](https://www.ccib.ca/membership/certified-indigenous-business-cib/) · [ISC IBD registration](https://services.sac-isc.gc.ca/REA-IBD/?lang=eng) · [OrgBook BC / BC Digital Trust](https://decentralized-id.com/government/canada/bcgov/) · [DIACC Pan-Canadian Trust Framework](https://diacc.ca/trust-framework/)
