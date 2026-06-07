# 09 · Adapting the Questionnaire — Australia → Canada

**Sprint:** 1 (Week 4) · **Author:** En-Ping Su (Sprint Lead) · **Type:** Questionnaire design input (feeds the report flow + Direction Decision)
**Source survey:** Reconciliation Australia *2025 RAP Impact Survey* (41 questions). **Target context:** Canadian Indigenous economy (Indigenomics Institute).

> **Principle:** keep the RAP framework's *structure and economic questions*; drop its *self-report-only model*; localize everything Australia-specific. The five areas below are the adaptation work.

---

## 1. Terminology & peoples (get this right first)

| Australian survey | Canadian equivalent | Note |
|---|---|---|
| "Aboriginal and Torres Strait Islander" | **First Nations, Métis, and Inuit** (or "Indigenous") | Canada has **three** constitutionally distinct groups — a single bucket is wrong. Use a **distinctions-based** breakdown when collecting counts. |
| "Reconciliation Australia" (central body) | **No single equivalent** — anchor to **TRC Call to Action #92** (business + reconciliation) and **UNDRIP / UNDA (Bill C-15)** | Indigenomics Institute plays the convening role in our model. |
| "Traditional Owners / Country / Welcome to Country" | "Traditional territory / the land / **territorial acknowledgement**" | "Elders past, present and emerging" is fine in Canada too. |

## 2. Certification & ownership bodies

| Australian survey | Canadian equivalent | Note |
|---|---|---|
| "Supply Nation certified" (Q32) | **CCIB Certified Indigenous Business (CIB)** | CCAB rebranded to **CCIB**. |
| Ownership threshold **50%** | **51%** Indigenous owned/controlled | Different threshold — affects who qualifies. |
| "Supply Nation member" (Q34) | **CCIB member** | |
| Supply Nation — Indigenous Business Direct (registry) | **Indigenous Business Directory (ISC)** + CCIB; federal **5% Indigenous procurement target** | Strong pull for Canadian firms to want confirmed data. |
| RAP maturity ladder (Reflect→Elevate) | Map to **CCIB PAIR** (Partnership Accreditation in Indigenous Relations, formerly PAR) | PAIR already does **independent third-party verification** of *corporate* reports; we add **supplier-side transaction confirmation** PAIR does *not* do → complement, don't compete. [4] |

## 3. Calendar, currency, indices

| Australian survey | Canadian equivalent |
|---|---|
| Reporting year **1 Jul – 30 Jun** (AU FY) | Canadian fiscal year (calendar, or **Apr 1 – Mar 31**) |
| AUD | **CAD** |
| "ASX200" (Q4) | **S&P/TSX 60 / Composite** |
| "National Reconciliation Week (NRW)" (Q17–18) | **National Day for Truth and Reconciliation (Sep 30)**, **National Indigenous Peoples Day (Jun 21)**, National Indigenous History Month |
| Partner orgs: CareerTrackers, Jawun, Supply Nation (Q16) | **CCIB, NACCA / Aboriginal Financial Institutions, Indspire**, CareerTrackers (also operates in Canada) |

## 4. Structural additions Canada needs (absent from the AU survey)

- **Data sovereignty: OCAP® + CARE principles** baked into the schema — consent, ownership, the right to **withdraw**. Central to our deck; absent from the RAP survey.
- **The confirmation layer** — for each procurement line, the named Indigenous supplier **confirms / disputes / corrects**; non-response = "unconfirmed," never "yes."
- **Identity tiering** — `nation` > `ccab` > `self_declared`, shown explicitly. Directly answers the live Canadian fraud problem ("rent-a-feather," front companies, phantom JVs) that the AU survey ignores.

## 5. The economic slice = the MVP questionnaire

Australia spreads economic data across Q30–37 and collects only **aggregate totals**. Our MVP narrows to **procurement, itemized per named supplier**, so each line is confirmable:

| Field (MVP `report` flow) | From the AU survey | Canadian change |
|---|---|---|
| Supplier (picker over registry, shows tier badge) | implicit in Q31/Q33 | registry of CIB/nation-verified suppliers; 51% threshold |
| Amount (CAD) | Q31 (full dollar value) | currency CAD; display buckets reusable |
| Period | annual cadence | CA fiscal year |
| Pillar | — (AU uses social pillars) | **Indigenomics pillars**: procurement (MVP) · equity · capital · innovation |
| Identity tier (auto, on the supplier) | Q32 (certified vs not) | `nation` / `ccab` / `self_declared` → tier breakdown comes free |

> **Bottom line:** the adaptation is mostly (1) peoples/terminology, (2) Supply Nation → CCIB/CIB at a **51%** threshold, (3) Canadian calendar/index/events, (4) adding **OCAP/CARE + the supplier-confirmation layer**, (5) narrowing to the **procurement** economic slice for the MVP. Items 1–3 are find-and-replace; 4–5 are the genuine product work and are already reflected in the portal's data model (`identityTier`, the confirmation engine, Indigenomics pillars).

**Sources:** see `08_RAP_Reference_Analysis.md` (same reference set; [4] = [CCAB/CCIB PAIR](https://par.ccab.com/)).
