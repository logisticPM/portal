# 04 · Pillar Model Proposal — procurement-centric: 2 flows + certification layer + tags

**Sprint:** 2 · **Type:** Design proposal + cross-team requirements · **Status:** **Implemented on this branch for review — not yet adopted.** The full `Pillar → FlowType` refactor is built + build-green; **adoption still needs team sign-off** (it changes the seam + reframes #13) **+ client confirmation.**
**Branch:** `pillar-model-proposal` — now carries the **full implementation** (15 files) + this doc. Does **not** touch `main` (open as a PR for review).

**Implemented on this branch [2026-06-12]** (build-green; rendering verified on mock):
- **`types.ts` (seam):** `Pillar → FlowType` (`procurement | capital`); equity → `Supplier.ownershipPct` + the existing tier; `ReportedLine.tags?: FlowTag[]`; `byPillar → byFlow` + new `byTag` on the Index.
- **Data layer:** repo.mock + repo.dynamo (reads/writes) + single-table marshalling + seed fixtures (ownership %, one `innovation`-tagged line, one `capital` line) + `verify.ts`.
- **UI:** `FlowBadge` / `TagChip` / `flowClaim`; supplier inbox + record show flow + tags + ownership %; the **company report form is reframed** to a Flow selector (procurement/capital) + an Innovation checkbox (was the procurement|equity selector, #13); Index shows by-flow + by-tag + the tier-as-equity lens; coverage by-flow.

---

## 0. Why this exists

The "four flat pillars" (`equity / capital / procurement / innovation`) have two problems we surfaced:

1. **The taxonomy source doesn't hold.** Spec §14 says the pillars were "confirmed on indigenomics.com" — but a live check of the site + search found **no enumerated economic-pillar framework** there (Indigenomics publishes a worldview, not a 4-metric scorecard). So the four pillars are a project artifact, not Indigenomics doctrine.
2. **They aren't at the same level.** Only **procurement** is a clean confirmable flow. **Innovation** has no counterparty (can't be confirmed). **Equity** is really *verification* (ownership), not a flow. **Capital** is a *different* flow (investing into, not buying from).

This proposal restructures them into one coherent model.

---

## 1. The model — 2 flows + 1 verification layer + tags

```
OWNERSHIP CERTIFICATION  (≙ "equity": ≥51% Indigenous-owned → identity tier)
   applied to every Indigenous counterparty — the anti-phantom-JV backbone
        │
        ├─ FLOW 1 · PROCUREMENT   company BUYS from a certified Indigenous supplier   [RAP core · confirmable · MVP]
        └─ FLOW 2 · CAPITAL       company INVESTS equity INTO a certified Indigenous business [Indigenomics extension · confirmable · H2]

   TAGS on a flow line:  innovation (R&D / capacity-building), … — attributes, NOT pillars
   INGESTED CONTEXT:     employment, GDP — from authoritative macro sources (StatCan), economy-level backdrop, never confirmed/aggregated from self-report
```

| Old pillar | New role |
|---|---|
| **procurement** | **Flow 1** — the confirmable core, the focus |
| **equity** | **Verification layer** — the ≥51%-ownership certification → identity tier. Not a flow you report; the gate that decides whether a flow counts as Indigenous. We **consume** CCIB/nation certification (complement, don't compete); `self_declared` = the fraud-risk tier. |
| **innovation** | **Tag** on a flow line ("this procurement was R&D / capacity"). Stays confirmable because the underlying line is a procurement transaction. |
| **capital** | **Flow 2** — company invests equity *into* an Indigenous business; recipient confirms. Indigenomics' ownership-frontier extension. **Not** in RAP. |

**Key reframes (from this conversation):**
- **"Procurement + equity" is really one thing, two layers:** *verified-ownership procurement* (how much spend + is the supplier a genuinely ≥51% Indigenous business). Equity ≠ a parallel pillar; it's what makes procurement trustworthy.
- **Indigenomics consumes the macro view only** — confirmed bottom-up where no authoritative source exists (procurement, capital), **ingested** where one does (employment/GDP from StatCan). Indigenomics never sees per-deal data (sovereignty + commercial confidentiality).
- **Capital's dilution tension:** outside equity can push Indigenous ownership below 51% → de-certify. Track **post-investment ownership %**, not just dollars.

---

## 2. Seam impact (`types.ts`) — needs a joint session (§11), NOT unilateral

| Change | Detail |
|---|---|
| `Pillar` → `FlowType` | shrink to `"procurement" \| "capital"` (drop `equity`, `innovation`) |
| equity → onto the party | `Supplier` gains ownership/cert fields: `ownershipPct`, `certSource: "ccib" \| "nation" \| "self_declared"` (the tier is already there) |
| innovation → a line tag | `ReportedLine.tags?: string[]` (or `category`) |
| capital flow | `ReportedLine` reused with `flowType: "capital"`, recipient = the Indigenous business, + `postInvestmentOwnershipPct` |

This is a **co-owned `types.ts` change** → both groups design it together before splitting. This doc proposes; it does not implement.

---

## 3. Supplier portal — concrete improvements *(Jack — build on `RAP-40` branch after the seam is agreed)*

Concrete, component-level so it's ready to implement once `types.ts` lands:

- **Confirm inbox (`/confirm`):** each line shows
  - **flow verb** by type — buy → "says they paid you"; invest → "**invested in you**";
  - a **FlowType badge** (Procurement / Capital);
  - any **tags** (e.g. an `Innovation` chip);
  - the supplier's **certification tier badge** stays prominent — it's now explicitly "the equity/ownership verification," not just a label.
- **Capital lines:** confirming reads "Company X **invested $Y for a Z% stake**" + a note that confirming attests to the **ownership change** (and that an outside stake may affect their ≥51% status).
- **My Record (`/record`):** group lines **by flow type**; surface the supplier's own **certification tier** as their "verified Indigenous-business status" (the equity layer), with a **path to upgrade** (self-declared → CCIB / nation). Keep OCAP export/withdraw.
- **Registration (`/register`):** capture **ownership %** + **cert source** (CCIB cert # / nation endorsement / self-declared). This is "equity = certification application" as an intake step (we record/link external certification, we don't issue it).

> Today's RAP-40 branch already has `PillarBadge` + `pillarClaim`; under this model `PillarBadge` becomes a **FlowType badge**, `innovation` moves to a **tag chip**, and the **tier badge** is reframed as the equity-verification. All of it waits on the `types.ts` decision.

---

## 4. Index (Indigenomics) — concrete improvements *(macro only; aggregated)*

- **Headline:** confirmed Indigenous **procurement** $ + coverage % (the core).
- **By verification tier = the integrity lens** (the equity layer made visible): confirmed $ at `nation` / `CCIB` / `self_declared`; **self-declared = phantom-JV risk, highlighted**. This is the differentiator on screen.
- **By tag:** % of confirmed procurement that's `innovation`-tagged (and other tags).
- **Capital panel (H2):** confirmed equity invested into Indigenous businesses — separate block, labeled **"beyond RAP · ownership frontier."**
- **Ingested-context band:** StatCan macro Indigenous **employment / GDP** as economy backdrop, clearly marked **"authoritative source · economy-level,"** visually separated from the confirmed bottom-up numbers.
- **Stays macro/aggregate only** — no per-deal drill-down (sovereignty + commercial confidentiality). Indigenomics sees the economy, not the deals.

---

## 5. Data layer — requirements *(asks for the Data group)*

1. **`types.ts` (joint session):** implement §2 — `FlowType`, equity→party (`ownershipPct`, `certSource`), `tags` on the line, capital fields.
2. **Repo:** extend `createReportedLine` / `getCoverage` / `getIndexSummary` to handle `flowType` + `tags`; add capital-flow handling; keep the by-tier rollup (it's now the equity lens).
3. **Seed — revises RAP-39:** instead of separate "equity lines," seed **suppliers with varied cert tiers** including a **self-declared, high-procurement supplier = the phantom-JV signal**; a couple of **innovation-tagged** procurement lines; (H2) one **capital** line.
4. **Ingest (H2):** StatCan macro Indigenous **employment / GDP** as a context dimension (per `ML_RAP4` feasibility — already rated ingestable).
5. **Parity:** mirror everything in mock + dynamo.

## 6. Company layer — requirements *(asks for the Company owner / Nate)*

1. **Report form:** pick **flow type** (buy = procurement / invest = capital [H2]); supplier picker shows the **cert tier**; **innovation tag** checkbox per line; amount labeled per flow.
2. **Certification capture** at supplier onboarding: ownership % + cert source (the equity intake).
3. **Employment:** if collected at all → a **self-report context field on the company profile, clearly "unverified," NEVER aggregated into the Index** (the macro employment number comes from StatCan, not from summed self-reports).
4. **Company profile (A):** industry / size / CA fiscal year / **CCIB + PAIR status** / TSX.

---

## 7. Client confirmation items *(Indigenomics)*

- [ ] Confirm the model (procurement focus + ownership-certification layer + capital extension + tags) vs the old four pillars.
- [ ] Confirm the **canonical taxonomy source** — the old §14 "confirmed on indigenomics.com" claim is unverified; where did the four pillars actually come from (client deck? team synthesis)?
- [ ] Confirm **employment = ingested StatCan macro context**, not a confirmed pillar.
- [ ] Confirm we **consume CCIB/nation certification** (complement) rather than issue it.
- [ ] Confirm **capital** belongs (ownership frontier) and how to treat dilution.

## 8. Impact on existing Sprint 2 cards

| Card | Change under this model |
|---|---|
| **RAP-39** (seed) | reframed: cert tiers + phantom-JV signal + innovation tags, not separate "equity lines" |
| **RAP-34** (questionnaire) | report form gains flow-type + tag + certification capture |
| **RAP-40** (supplier portal, Jack) | the §3 improvements land here, **after** the `types.ts` change is agreed |
| **RAP-31** (Index, Data group) | the §4 macro improvements |

---

**Refs:** spec §6.1 / §10 / §14 / §15 · `02_Questionnaire_Expansion_Design` · `08_RAP_Reference_Analysis` · `09_Questionnaire_Adaptation_AU_to_CA` · `ML_RAP4_Data_Feasibility_Memo`.
