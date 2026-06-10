# 02 · Questionnaire Expansion — AU 2025 → Indigenomics four-pillar (RAP-34 design)

**Sprint:** 2 · **Type:** Design / hand-off doc · **Card:** RAP-34
**Source:** Reconciliation Australia *2025 RAP Impact Survey* (41 Qs, latest published — 2026 opens Jul 2026), analysed against `06_? / 08_RAP_Reference_Analysis` + `09_Questionnaire_Adaptation_AU_to_CA`.
**Status:** Design agreed (demo scope locked below). **This doc is a hand-off** — it is the build spec for the *company-side report form* (owner: **company / Nate**), the *equity seed* + the *Indigenomics Index display* (owner: **Data group**, per the 2026-06-10 reassignment). Jack's only build here is the *supplier inbox* showing the line pillar.

> Why this doc exists: Jack owns the **supplier portal only**. The questionnaire *lives on the company report form* (Nate); it is *fed by seed data* and *surfaced on the Index* by the **Data group** (who now own the Indigenomics portal + AWS). So the analysis is captured here for those owners rather than built by Jack. See `../specs/2026-06-05-data-portal-demo-design.md §10` + `01_Sprint2_Backlog_board` notes.

---

## 1. The one rule that governs the whole expansion

**Confirmability = does this data point have a *named Indigenous counterparty* who can verify it?**

Australia's 41 questions are almost entirely **self-report** (no one confirms a number — the documented failure mode: Rio Tinto held the top *Elevate* RAP while destroying Juukan Gorge; see `08 §3`). Our differentiator is the **confirmation layer**. But not every question can be confirmed:

| Has a named Indigenous counterparty? | → treatment |
|---|---|
| **Yes** — procurement line (supplier), equity/JV stake (partner), financing (AFI) | **Confirmable** → becomes a `ReportedLine`, flows `confirm → coverage → Index` |
| **No** — employment counts, cultural learning, governance, policies | **Context** → company self-report, displayed but **never shown as "verified"** |

**Do not blur this line.** It is the product's moat. A richer questionnaire that quietly treats self-report as verified would reproduce exactly the AU weakness we critique.

## 2. The 41 AU questions, bucketed

| AU section | Qs | Bucket | Notes |
|---|---|---|---|
| Org demographics | 1–7 | **Context (A: profile)** | industry, size, RAP type, ASX→**TSX**, employees/students |
| Engagement w/ RA | 8–13 | **Drop** | Australia-specific (satisfaction w/ Reconciliation Australia) |
| Relationships | 14–20 | **Context (D)** | partnerships, NRW→**Sep 30 / Jun 21**, anti-discrimination |
| Respect | 21–25 | **Context (C)** | cultural learning strategy, # staff trained, protocols |
| Opportunities — employment | 26–29 | **Context (C)** | **distinctions-based**: First Nations / Métis / Inuit, not one bucket |
| **Opportunities — procurement** | **30–34** | **Confirmable (B1)** | **the economic heart**: $ buckets, exact $, # businesses, certified-vs-self |
| Opportunities — giving | 35–37 | Context (C) / optional confirmable | donations, education, pro bono (recipient *could* confirm — out of demo scope) |
| Governance | 38–41 | **Context (D)** | First-Nations governance structures, senior-leader engagement |

## 3. Key finding — pillar mismatch (why this isn't just "copy more AU questions")

AU's four pillars are **social** (Relationships / Respect / Opportunities / Governance). Indigenomics' four are **economic** (`equity / capital / procurement / innovation`, already in `types.ts`). Cross-referenced:

| Indigenomics pillar | In AU survey? | Source for our questions |
|---|---|---|
| **procurement** | ✅ Q30–34, fully developed | borrow AU mechanics directly |
| **equity / ownership** | ❌ essentially absent (Q15 only asks vague "# partners") | **our differentiator + fraud target** (phantom JV) — design from Indigenomics' thesis |
| **capital / financing** | ❌ none | design (NACCA / AFI) — out of demo scope |
| **innovation / capacity** | ❌ none | design — out of demo scope |

**So:** procurement borrows AU's proven mechanics; equity/capital/innovation are *our* economic lens, which AU never had.

## 4. The expanded questionnaire (demo scope — LOCKED)

Decisions from planning (2026-06-10): **B = procurement + equity confirmable; C/D = a read-only "self-reported · unverified" block.**

| Section | Content | Bucket | Demo |
|---|---|---|---|
| **A. Organisation profile** | industry, size, CA fiscal year, **CCIB/CIB cert + PAIR status**, TSX listing | Context | ✅ build (small) |
| **B1. Procurement** | itemized lines per named supplier (built today) | **Confirmable** | ✅ already built |
| **B2. Equity / JV** | ownership/JV stakes per named Indigenous partner | **Confirmable** | ✅ **add this sprint** |
| B3. Capital · B4. Innovation | financing / capacity lines | Confirmable | ⛔ H2 (design only) |
| **C. Workforce & culture** | Indigenous employment (FN/Métis/Inuit), cultural learning | Context | ✅ read-only display |
| **D. Governance & relationships** | governance structures, senior-leader engagement, partner orgs | Context | ✅ read-only display |

## 5. Build hand-off — who does what

### → Nate (company report form, `report/page.tsx` + new profile/context)
- **B1+B2:** add a **pillar selector** (`procurement` | `equity`) to the report form. Relabel the amount field per pillar:
  - procurement → "Amount paid (CAD)"
  - equity → "Equity value / stake (CAD)" + (optional) a free-text "stake description"
- **No `types.ts` change.** An equity claim is a normal `ReportedLine` with `pillar: "equity"` — `createReportedLine` already takes `pillar`. The seam was built for all four pillars (`types.ts:35`). Touching `types.ts` would trigger the §11 cross-group sync — **not needed.**
- **A (profile)** + **C/D (context):** render as company-level self-report. Mark C/D visibly **"self-reported · unverified."** For the demo these can read from a small presentational lookup keyed by `companyId` (no repo/seam change) — they do **not** flow into coverage/Index.

### → Data group (seed + Indigenomics Index)
- **Seed:** a handful of **equity `ReportedLine`s** alongside the procurement ones, including **one self-declared-tier equity line** = the phantom-JV fraud signal the Index should surface. No schema change. Mirror in the dynamo seed for parity.
- **Index/`analytics`:** surface the **equity** pillar next to procurement, keep **by-tier** (self-declared equity = the flag), and add the **confirmable-vs-context framing** so viewers see the moat. (Data group owns the Indigenomics portal as of 2026-06-10.)

### → Jack (supplier inbox) — *built by me*
- Supplier `confirm`/`record`: already pillar-generic — ensure the line's `pillar` is shown so an equity claim reads correctly in the inbox.

## 6. Out of scope (record so we build forward-compatibly)
- Capital (B3) + Innovation (B4) confirmable lines → H2.
- Giving (AU Q35–37) as confirmable → H2.
- The McKinsey *Innovate RAP* Action→Deliverable→Timeline→Responsibility table is the **commitments layer** format (spec §15 gap 2, H2), not this questionnaire.

**Sources:** [2025 RAP Impact Survey](https://www.reconciliation.org.au/wp-content/uploads/2025/06/2025-RAP-Impact-Survey-Reporting-Guide.pdf) · `08_RAP_Reference_Analysis.md` · `09_Questionnaire_Adaptation_AU_to_CA.md` · portal `types.ts:35`.
