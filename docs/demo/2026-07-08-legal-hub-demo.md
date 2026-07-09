# Indigenomics Economic Justice Legal Cases — Activation Hub
## End-to-End Demo Script & Results Summary

**Date:** 2026-07-08 · **Audience:** Carol Anne Hilton / Indigenomics Institute (economic-activation narrative) **and** a credibility-focused reviewer (methodology & limits) · **Environment:** live portal, `/cases` (production).

This one document does double duty: **Part A** is a presenter's walkthrough of the live app; **Part B** is a leave-behind that states plainly what was built, how it is kept honest, and where its limits are.

> **Framing in one line:** the hub turns Canada's Indigenous economic-justice case law into something you can *search, understand, quantify, and act on* — without ever inventing a fact. Every AI output is anchored to the verbatim court record; where the record is silent, the hub stays silent.

---

## Demo prep checklist (do before presenting)

- [ ] **Log in.** Production `/cases` is behind sign-in (it 307-redirects to `/login`). Have a logged-in session ready — lenses default and the briefing generator both key off the account. *(If public browse is desired for the audience, confirm the access-control intent separately — it is out of scope for this demo doc.)*
- [ ] **Spot-check the anchor cases** (below) render with their summary + figures + nations before you present. Case URLs use slug-citation ids, e.g. `/cases/2004-scc-73`.
- [ ] Have the **three anchor cases** open in tabs: Haida Nation (`2004-scc-73`), Tsilhqot'in (`2014-scc-44`), Southwind (`2021-scc-28`).
- [ ] Know the **honest-limits** talking points (Part B) — leading with them *builds* credibility with a skeptical reviewer.

---

## Part A — End-to-end walkthrough (the live demo)

A single narrative arc: **from a raw corpus of court decisions → to a searchable, plain-language, economically-quantified, audience-aware, action-ready knowledge base.** Seven stops; each names the client Idea it demonstrates, what to do, the line to say, and what it proves.

### 0. The corpus at a glance — `/cases` *(Idea #1: economic-classified intake & labeling)*
- **Do:** Land on `/cases`. Point out the corpus size and the tier badges (`core` / `full text` / `index only`) and the theme/court/nation/year filters.
- **Say:** "This is ~5,000 Canadian decisions ingested from open legal data, with ~540 promoted to a curated *core* of economic-justice precedents — each classified by economic theme (land rights, duty to consult, treaty, fiduciary, self-determination, resource revenue) by two independent AI models that must *agree* before a case is promoted."
- **Proves:** Idea #1 — automated economic classification with a transparent, conservative inclusion process (nothing enters core on one model's say-so).

### 1. Search a concept — `/cases?q=duty+to+consult` *(Idea #2: retrieval)*
- **Do:** Search a natural-language concept ("duty to consult resource development" or "resource revenue sharing"). Show ranked results; note the tier badges and highlighted snippets.
- **Say:** "Search is hybrid — keyword *and* semantic — and it routes automatically: a citation or case name goes to exact lookup, a concept goes to semantic retrieval. Adding semantics lifted conceptual-query quality materially in our evaluation."
- **Proves:** Idea #2 (retrieval half) — you can find the right precedent by *idea*, not just by name.

### 2. Open a landmark — Haida Nation (`/cases/2004-scc-73`) *(Idea #2: plain-language summaries)*
- **Do:** Open Haida Nation. Show the **AI plain-language summary** with its "AI-generated · plain language" badge, then scroll to the verbatim full-text reader with in-text highlights.
- **Say:** "The summary is written in plain language, but every claim it makes is *mechanically verified to appear verbatim in the judgment* — if a sentence can't be anchored to the actual text, it's dropped, not shown. The full official text is one scroll away."
- **Proves:** Idea #2 (summary half) — accessible *without* sacrificing fidelity; the AI can't drift from the record.

### 3. The money, on the record — same case, figures block *(Idea #3: recorded economic figures)*
- **Do:** On a case with figures (e.g. Southwind `2021-scc-28`, equitable compensation), show the **recorded economic figures** block — each dollar figure with its verbatim quote and paragraph anchor — and the "AI-extracted · verify against source" note.
- **Say:** "We deliberately do **not** estimate or project economic impact. We surface only the dollar figures the court actually stated, each tied to the exact sentence it came from. A court-granted-vs-mentioned filter keeps background numbers out of the awarded totals."
- **Proves:** Idea #3 — quantified economic outcomes with zero fabrication (the credibility-critical choice).

### 4. Same record, different reader — audience lens *(Idea #5: audience-layered access)*
- **Do:** Switch the lens (Indigenous government / legal advisor / corporate). Show the ordering change on a browse view.
- **Say:** "Same public record, re-ordered for who's reading — an Indigenous government, a legal advisor, or a corporate counterpart. Nothing is hidden or filtered; anyone can switch. It's a lens, not a gate."
- **Proves:** Idea #5 — tailored relevance without fragmenting the truth.

### 5. The economic picture, aggregated honestly — `/cases/activation` *(Idea #3: aggregation)*
- **Do:** Open the activation dashboard. Show the economic-figures aggregation: **ranges (min/median/max) by category over a stated coverage denominator**, not a single headline total.
- **Say:** "Aggregation shows ranges over how many cases actually carry a figure — never a single dramatic sum, because summing incomparable awards across years would be a number we couldn't defend."
- **Proves:** the discipline behind Idea #3 — honest quantification a reviewer can trust.

### 6. Precedent → policy, grounded — `/cases/briefings` *(Idea #6: briefing note)*
- **Do:** Pose a policy/business question (e.g. "What do courts require before approving a mining project on treaty land?"). Show the generated briefing: background, precedents, principles, considerations — each precedent a real case in the retrieval set.
- **Say:** "Ask a policy or business question, get a structured briefing grounded in real precedents. If the model tries to cite a case that isn't in the retrieved set, that citation is mechanically dropped — and if fewer than two real precedents survive, the hub *refuses to answer* rather than bluff."
- **Proves:** Idea #6 — the precedent-to-policy bridge, with fabrication made mechanically impossible.

### 7. Staying current — `/cases/monitoring` *(Idea #4: new-case monitoring)*
- **Do:** Open the monitoring page; show the recent automated scan report.
- **Say:** "A weekly job scans open legal data for new economic-justice decisions and adds them to the corpus for review — the hub keeps growing without manual trawling."
- **Proves:** Idea #4 — the corpus is a living asset, not a one-time build.

**Close:** "Search → understand → quantify → target the audience → turn into policy → keep current. Six capabilities on one corpus, and not one of them invents a fact."

---

## Part B — Results & methodology summary (leave-behind)

### What was built (all six client Ideas, live)
| # | Idea | Where |
|---|---|---|
| 1 | Economic-classified intake + dual-LLM labeling | `/cases` (tiers, themes, filters) |
| 2 | Hybrid search + AI plain-language summaries | `/cases?q=…`, case pages |
| 3 | Recorded economic figures (not estimates) | case pages + `/cases/activation` |
| 4 | Automated new-case monitoring | `/cases/monitoring` |
| 5 | Audience-layered access (lenses) | lens switch on browse |
| 6 | Precedent → policy briefing notes | `/cases/briefings` |

### Corpus at a glance (2026-07-08)
- **~5,049 decisions** ingested (two-tier: **~541 curated core** + substrate).
- **Full text** held for the core and a large substrate share; provincial coverage deepened this cycle — **BC courts 1,740/1,740 full text**, Ontario CA 109/207, SCC 166/1,280.
- Core is grown only by **two-model consensus** on economic relevance + theme; zero-consensus cases stay in substrate (not shown as core).

### Governance — why the outputs are trustworthy (the spine)
- **Extractive, citation-anchored, never free-form.** Summaries, figures, nations, and briefings are all verified to appear **verbatim in the source** (whitespace/punctuation-normalized re-anchoring); anything that can't be anchored is dropped, not shown.
- **No fabricated economic figures.** Only dollar amounts stated in the judgment, each with its quote + paragraph; no estimates, no projections, no cross-case totals.
- **Fabrication-proof briefings.** A briefing can only cite cases in its retrieved set; it refuses to answer on fewer than two real precedents.
- **Conservative promotion.** Dual independent models (different families) must agree before a case becomes core.
- **Indigenous data sovereignty.** OCAP / CARE / UNDRIP / FPIC respected; sources are **official + open** (open legal data + official court sites), reproduced under Crown-copyright reproduction terms with a standing unofficial-reproduction disclaimer; **no CanLII scraping**.
- **Not legal advice** — stated throughout.

### Honest limitations (stated deliberately — this is what earns a skeptic's trust)
- **Coverage is source-bounded.** The open data source doesn't return full text for every case; some official court sites (the Lexum/Decisia family — SCC, Ontario CA, federal courts) **rate-limit/captcha bulk automated access**, so a portion of those judgments remain metadata-only for now. Getting them fully needs a slow trickle or an official API agreement.
- **Provincial gaps remain.** Alberta / Saskatchewan / Manitoba / Quebec / Ontario Superior Court are thin — they aren't yet in the corpus and need a dedicated data-source step.
- **The economic-figures layer is partial.** ~8% of cases yield unparseable model output and get no figures (safe-fail, no wrong numbers); a handful of very long bilingual Supreme Court judgments exceed the summarizer's context and get no summary.
- **Semantic search on the newest additions is pending.** The most recently backfilled full texts are keyword-searchable now; their semantic (vector) index is a scheduled follow-up.
- **Access.** `/cases` is currently behind login.

### Evidence the retrieval works (not just vibes)
Retrieval was measured against a hand-adjudicated gold set: hybrid (keyword+semantic) beats keyword-only overall, with the largest gains on **conceptual** questions — exactly the queries a policy user asks. Citation/case-name lookups are routed to exact search so semantics don't dilute a known-item query.

### Suggested next steps (optional, post-demo)
1. **Finish semantic indexing** of the newly backfilled full texts (a quiet-window embed + index rebuild).
2. **Official CanLII API** (key + ToS) to lift the Lexum/Decisia coverage ceiling — *verify first whether the API returns full text.*
3. **Missing-province harvest** (AB/SK/MB/QC/ONSC) as its own data-source sub-project.
4. Have counsel (Kay) validate a flagship subset and promote high-value figures to an authoritative tier.

---

*Anchor cases for the walkthrough (spot-check logged-in before presenting): Haida Nation v. British Columbia `2004-scc-73`; Tsilhqot'in Nation v. British Columbia `2014-scc-44`; Southwind v. Canada `2021-scc-28` (equitable compensation). Substitute any core case that shows a summary + figures if an anchor doesn't render.*
