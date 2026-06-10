# RAP-4 · Data-Feasibility Memo — RAP Platform Sources

**Owner:** Mengshan Li · **Card:** RAP-4 · **Date:** 2026-06-07
**Status:** Proposal for team review.

> **Scope note (important):** the board's RAP-4 was originally framed around "E1 sources" (the Educational-platform direction the client **declined**). The team has since locked the **RAP platform** direction — verified Indigenous-economic data: a company reports itemized procurement spend naming Indigenous suppliers, each supplier confirms, output is a reported-vs-confirmed RAP Index (Canadian context). This memo therefore assesses **RAP-platform data sources**, not E1. See `08_RAP_Reference_Analysis.md` and `09_Questionnaire_Adaptation_AU_to_CA.md`.

---

## 1. Two horizons

- **(A) MVP demo (June 24):** the product runs on **synthetic seed data** end-to-end (per design spec §2). No real data ingestion is required to hit the demo's Definition of Done. The feasibility question for the MVP is just: *is our synthetic dataset realistic and complete enough?* (Yes — see §3.)
- **(B) Real data (Horizon 2+):** can we ingest real Canadian Indigenous-economic data to (a) prime the registry of suppliers and (b) seed "reported" procurement lines that suppliers then confirm? This is where source feasibility matters.

---

## 2. Source feasibility — at a glance

| Source | What it gives us | Access / format | Verdict |
|---|---|---|---|
| **Federal 5% Indigenous procurement open datasets** (Open Government Portal: planned procurement + results vs 5% target) | Aggregate + some contract-level federal spend to Indigenous businesses | Open data (CSV/portal), proactive disclosure of contracts > $10k | **GO** — open, licensed, ingestable; best starting "reported" data |
| **Indigenous Business Directory (IBD)** (ISC) — businesses with ≥51% Indigenous ownership/control | The supplier registry + an identity signal (registered = vetted) | Public directory; programmatic access needs checking (may be scrape/manual) | **GO (caution)** — great for the registry; confirm bulk/API access |
| **CCIB Certified Indigenous Business (CIB)** | Higher-assurance identity tier (third-party certified, 51%+) | Membership/certification list; not an open bulk dataset | **CAUTION** — ideal for the `ccab` identity tier, but access likely requires partnership |
| **Modern treaty beneficiary business lists** | Additional recognized-business source for the 5% definition | Varies by treaty/nation | **CAUTION** — fragmented; useful later |
| **Corporate self-reported Indigenous spend** (Enbridge/RBC/etc. ESG/RAP-style disclosures) | The *unverified* "reported" claims the product exists to confirm | PDFs / ESG reports; unstructured | **CAUTION** — this is the problem data, not a clean source; parse case-by-case |
| **Reconciliation Australia RAP Impact Survey** | Questionnaire *schema* reference (not Canadian data) | PDF (we have it) | **GO (reference only)** — mechanics, not data |

---

## 3. Synthetic dataset spec for the MVP (what to build now)

Mirror `repo.mock.ts` and make it convincing:
- **3–4 companies** (buyers being measured) — energy, bank, telecom flavors.
- **6–8 named Indigenous suppliers**, spread across all three identity tiers (`nation` > `ccab` > `self_declared`) so the Index's "confirmed $ by tier" integrity lens is meaningful.
- **12–18 itemized procurement lines** (CAD), spanning statuses: confirmed, pending, disputed, corrected — so coverage lands at a believable ~70–85%, not 100%.
- Amounts spanning the Australian survey's display buckets ($0–5k … >$10M) for realism.
- One **self-declared** supplier with a large amount = the visible "fraud-risk" beat for the demo.

This is sufficient for the June 24 DoD; no external data required.

---

## 4. Key risk (name it in the report)

The deepest data problem is **not** availability — it's that real corporate Indigenous-spend figures are **self-reported and unverified** (exactly what the product fixes), and **supplier identity** is the fraud surface ("rent-a-feather," front companies). So:
- The federal 5% open data is a clean *aggregate* source but is government-side, not the corporate self-report the product targets.
- Real ingestion value comes from pairing a **registry** (IBD/CCIB → the supplier identity tiers) with **reported lines** (from a willing company or the federal contract data), then running the confirmation loop.

---

## 5. Recommendation

1. **MVP:** ship on synthetic data (spec'd in §3). Feasibility = **GO**, no blockers.
2. **First real-data pilot (H2):** start with the **federal 5% open datasets + the IBD registry** — both are open/public and ingestable, and together they exercise the registry + reported-line flow without needing a corporate partner. Treat **CCIB certification** as the premium identity tier to integrate via partnership later.
3. Confirm **programmatic access** to the IBD (API vs scrape vs manual export) before committing — that's the one open question that gates real-data work.

> Caveat: live access/licensing details below were drawn from current public information; **re-verify access mechanics and licensing before the team builds an ingester.**

**Sources:** [Mandatory minimum 5% Indigenous procurement target — ISC](https://www.sac-isc.gc.ca/eng/1691786841904/1691786863431) · [Indigenous business & federal procurement / IBD — ISC](https://www.sac-isc.gc.ca/eng/1100100032802/1610723869356) · [Results vs 5% target (open dataset)](https://open.canada.ca/data/en/dataset/5d27d152-09d8-4303-adc4-0c46b4a9733b) · [Planned procurement vs 5% target (open dataset)](https://open.canada.ca/data/en/dataset/440a10df-4f65-47f4-851c-6acf30d37841) · plus `08`/`09` in this folder (CCIB / Supply Nation / RAP survey).
