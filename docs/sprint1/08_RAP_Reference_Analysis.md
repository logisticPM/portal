# 08 · Australian RAP Platform — Reference Analysis (pros/cons + what we integrate)

**Sprint:** 1 (Week 4) · **Author:** En-Ping Su (Sprint Lead) · **Type:** Research input for the Direction Decision + questionnaire design
**Inputs:** Reconciliation Australia *2025 RAP Impact Survey Reporting Guide* (41 Qs), McKinsey *Innovate RAP* (Aug 2023–25), the Data Portal MVP design + pitch deck, and external research on RAP outcomes and Canadian equivalents (CCAB/CCIB).

---

## 1. What "the Australian RAP platform" actually is

Not one app — a **program run by Reconciliation Australia** with four parts our project draws on:

1. **The RAP framework** — a maturity ladder of four plan types (**Reflect → Innovate → Stretch → Elevate**) across four pillars (**Relationships, Respect, Opportunities, Governance**).
2. **The annual RAP Impact Survey** — the 41-question self-report every RAP org files yearly (new orgs file a 17-question baseline).
3. **The RAP Hub** — knowledge, templates, convening (the layer Indigenomics' own Hub resembles today).
4. **Supply Nation** — a *separate* body that certifies Indigenous business ownership (≥50%), referenced by the survey but not run by it.

> The McKinsey brochure in the project space is one company's *Innovate RAP plan* — a concrete example of a filled-in commitment, not the platform itself.

## 2. Pros (worth adopting)

- **Proven at scale, voluntary** — ~2,200+ orgs, ~3M people in a RAP org; a "coveted logo + maturity ladder" creates pull without a mandate. [1]
- **A clean, reusable data model** — 4 pillars × a standardized question battery. The economic questions (Q30–37: procurement $, # Indigenous businesses contracted, donations, education, pro bono) map directly onto our *Opportunities/economic* slice.
- **Tiered onboarding** — the 17-question baseline for new orgs is a good pattern for our MVP (don't force a first-timer through 41 questions).
- **Standardized definitions** — every question ships with a definition (what counts as a "partnership," "50% owned"), which is what makes aggregation meaningful.

## 3. Cons (where our product differentiates)

- **Entirely self-reported, no verification** — confidential self-report; only aggregates published; no one confirms a single number. [1][2]
- **Box-ticking / weak accountability** — widely criticized as PR over outcomes, with little public impact data. [2][3]
- **High-profile failures expose the gap** — **Rio Tinto held the top "Elevate" RAP when it destroyed Juukan Gorge; Telstra had a RAP while being fined $50M for exploiting Indigenous customers.** A plan and a logo, nothing confirming behavior. [2]
- **Social lens, not economic** — measures activities (events, cultural learning, strategies) more than verified economic flows.
- **Certification bolted on, not integrated** — Supply Nation status is a checkbox, not linked to the actual transactions.

> **Our thesis sits exactly in these cons:** keep the proven questionnaire, add the named-supplier **confirmation layer** it never had, and shift to an **economic lens**.

## 4. What we integrate into the Data Portal

| Take from Australian RAP | How we use it |
|---|---|
| 4-pillar question schema | Base the questionnaire structure on it (esp. the economic questions) so it's familiar and benchmarkable |
| Economic questions (Q30–33) | Become our **confirmable line items** — procurement $, # businesses, per-supplier breakdown |
| Tiered survey (17 → 41) | Mirror as MVP scope: start with the **procurement** metric only (matches the June 24 demo) |
| Per-question definitions | Reuse the rigor — the confirmation step needs unambiguous definitions |
| Maturity-ladder concept | Optional "confirmation coverage" tier instead of a self-assessed plan tier |
| **Do NOT copy** | Confidential aggregate-only reporting · self-report without confirmation · the social-activity emphasis |

## 5. How this lands in the build (the portal repo)

- The MVP report flow itemizes **one line per named supplier** (Australia collects only an aggregate total — itemizing so each supplier can confirm is *our addition*). See `06.1` of the portal design spec.
- The **certified-vs-self distinction comes free**: every line carries its supplier's `identityTier`, so the Index can show "confirmed $ by CCAB-certified vs nation-verified vs self-declared" with no extra question.
- Pillars in the build are **Indigenomics' economic pillars** (equity / capital / procurement / innovation), *not* Australia's four — "Australia for mechanics, Indigenomics for taxonomy."

---

**Sources:** [1] [Reconciliation Action Plans — Reconciliation Australia](https://www.reconciliation.org.au/reconciliation-action-plans/) · [2] [The fundamental flaws of Reconciliation Action Plans — Barayamal](https://barayamal.com.au/the-fundamental-flaws-of-reconciliation-action-plans/) · [3] [Real reconciliation is more than box-ticking — Reconciliation Australia](https://www.reconciliation.org.au/real-reconciliation-is-more-than-box-ticking/) · [4] [PAIR/PAR & Certified Indigenous Business — CCAB/CCIB](https://par.ccab.com/)
