# 06 · RAP Research — Data Verification & How Commitments Vary

This document explains **two things we learned while building the platform** that shape how the
data can and cannot be used:

1. **How we verify data sources** — the discipline that stops the AI from inventing facts, and how
   every figure on the dashboard traces back to a real, public document.
2. **How Reconciliation Action Plans (RAPs) actually vary** — in the words they use and, more
   importantly, in the *quality* of their commitments: many carry no due date and no measurable
   target, which has direct consequences for what a tracking platform can honestly report.

It closes with **how the platform is designed to cope with both**, and an honest account of where
the limits are.

Companion documents: [01 · Project Audit](./01-project-audit.md),
[02 · Deploy Runbook](./02-deploy-runbook.md),
[03 · Engine Comparison](./03-rap-engine-comparison.md),
[04 · Monitoring & Security](./04-monitoring-and-security-brief.md),
[05 · Design Decisions & User Journeys](./05-design-decisions-and-user-journeys.md).
Unfamiliar terms (Bedrock, Lambda, BN, …) are defined in the glossary in the [README](./README.md).

---

## 0 · What this document is based on (read this first)

Everything below is grounded in one of three kinds of evidence, and it matters which is which:

- **The data model and extraction rules** — how the software is *built* to handle RAPs. This is
  strong, first-hand evidence: the design was shaped, deliberately, around messy real documents.
- **Real spot-checks** — a small set of real, human-verified material: the **Bank of Canada RAP**
  (our one hand-verified "gold" set), a set of **hand-curated real figures** drawn from primary
  public sources (`real-fixtures.ts`), and the **live n=8 engine comparison** (see doc 03).
- **The curated dashboard dataset** — the ~100 organizations populating the running dashboard are
  **real Canadian organizations**, and their commitments were **hand-curated from those
  organizations' own public disclosures** (reconciliation / ESG pages, first-party news releases),
  with **every source link audited** (102 of 102 resolve; see A.8). They were **not** produced by
  running the AI extraction pipeline on RAP PDFs, and the figures are *illustrative snapshots* from
  the cited sources (confirm against the source before quoting a number as exact). Separately,
  **3 fictional demo company accounts** contribute 9 self-submitted commitments purely to
  demonstrate the self-report flow — those are the only fabricated records.

We are careful throughout to say *"the model and our real spot-checks confirm this,"* not *"we
measured this across a large real corpus."* We have **not** run the extraction pipeline across a
large body of real RAPs — that requires the client's own AWS account (see doc 02). The observations
here are nonetheless well-grounded: where we make a claim about real RAPs, we point to a real
example.

---

## Part A · How we verify data sources

The platform holds two very different kinds of data, and "verification" means something different
for each. Keeping them separate is the first honesty rule.

### A.1 · Two data regimes

- **The curated public-disclosure dataset** (behind the RAP Index dashboard). Each record is drawn
  from an **organization's own public disclosure** — its reconciliation/ESG page or a first-party
  news release — and stores the source link. This is deliberately **not** sensitive Indigenous
  community data.
- **The AI extraction pipeline** (uploading a RAP PDF and reading commitments out of it). This is
  where the risk of AI "hallucination" lives, and where most of the verification machinery is
  aimed.

### A.2 · The core rule: the AI must *quote*, or the value is thrown away

The single most important design decision is this: **the AI's job is to locate and quote, never to
know or compute.** Every field the model extracts is wrapped in a structure that requires a
**verbatim quote** and a **page number** from the source document. If the model cannot produce the
exact words it read a value from, **the value is discarded** (set to null) rather than kept.

In plain terms: the system would rather report *"we didn't find a due date"* than **invent** one. A
confident, made-up citation is treated as worse than an honest gap.

### A.3 · A deterministic check proves the quote is really in the document

A quote alone isn't enough — a model can fabricate a quote too. So after extraction, a piece of
**ordinary, non-AI code** checks that the quoted text **actually appears in the document the model
was shown**. It matches on words (so harmless whitespace or OCR punctuation differences don't cause
false alarms) but still catches fabricated or "welded-together" quotes.

This check earned its place. During development it caught a real, dangerous bug: on two-column
pages, an earlier extraction produced **21 of 32 quotes that were fabricated** — plausible-looking
citations stitched from fragments, with off-by-one page numbers. The verbatim-quote gate is what
now stops that class of error. On the validated run it produced **zero false positives across ~180
quotes**.

### A.4 · A human confirms before anything becomes official

Nothing an AI extracts reaches the live dashboard automatically. Every extraction lands in a
**Pending Review** state; a human reviewer must confirm it (field by field) before it becomes a
canonical record. And any number that matters — a target value, a due date, a percentage — is
**parsed and calculated in code, never by the language model.** The AI finds the words; the
software does the arithmetic.

### A.5 · Sources are ranked honestly: confirmed > research > self-reported

Not all data deserves equal trust, and the platform never pretends otherwise. Each record carries a
**basis**:

- **Confirmed** — independently corroborated (e.g. procurement dollars attested by the supplier on
  the other side of the transaction). Only these can raise a commitment to "confirmed."
- **Research** — curated by our team from an organization's public disclosure. This is the default
  for the seed dataset.
- **Self-reported** — entered by a company about itself. These are **opt-in** and **do not count
  toward the headline figures** unless the organization's identity is registry-verified and it
  chooses to be shown.

A self-report can **never** be silently promoted to "confirmed." Identity itself is anchored to the
organization's **CRA Business Number** (with a checksum pre-filter and a registry lookup), so
records attach to a real legal entity rather than a name that might be spelled three different ways.

### A.6 · The engine choice was measured, not guessed

Which AI reading engine to trust was settled by a **live, billed comparison across 8 documents**
(full detail in [doc 03](./03-rap-engine-comparison.md)). The recommendation — **Textract-LAYOUT** —
won because it produced **real page numbers that were read from the document** (not inferred),
solid quote grounding, and was the only engine to process all 8 documents without crashing. A
cheaper text-layer engine is the residency-friendly fallback.

### A.7 · We proved that "let a second AI check the first" does **not** work here

A tempting shortcut is to have a second AI judge whether the first AI's findings are correct. **We
tested this and it failed.** Two independent judge models agreed with each other essentially only
by chance (statistical agreement **κ ≈ 0**) — because both simply assented to almost everything.
On real, unlabeled RAP data, AI cross-checking gives **no reliable signal**. When humans
adjudicated the handful of genuine disagreements, the split fell exactly on the
*vague-and-inferred* vs *specific-and-grounded* line — which is precisely why a **human**, not an
automated AI check, is the right reviewer. This is why the human-in-the-loop gate in A.4 is not
bureaucratic caution; it is the only instrument that actually works.

### A.8 · The curated dataset is link-audited

For the public-disclosure dataset, **every source URL was HTTP-checked** — 102 of 102 unique links
resolve to a live first-party page, with no fabricated URLs and no status ever inflated beyond what
the source supports. Figures in that dataset are **illustrative snapshots** taken from the cited
sources; the standing instruction is to confirm against the source before quoting a number as
exact.

### A.9 · Honest limitations of the verification story

A client should know these plainly:

- **AI inference leaves Canada.** Data can rest in Canada, but Amazon's Bedrock models are not
  hosted in Canada, so the reading step routes to a US/global region regardless of engine. (See
  doc 03; a Canadian-hosted model such as TELUS's would close this gap.)
- **Our one human "gold" reference is a single document** (Bank of Canada). Broader accuracy is
  measured *relative to the combined output of all engines* — a defect every engine misses is
  invisible.
- **The production default engine (BDA) infers page numbers** rather than reading them, and is
  brittle on unusual PDFs. A back-fill step recovers verbatim quotes for it, but not trustworthy
  pages. Textract-LAYOUT is the recommendation precisely to avoid this.
- **Scanned / image-only PDFs are untested** — the corpus was all "born-digital," and the
  text-layer engine has no OCR.
- **The business-registry (ISED) integration is coded but not yet activated** against the live API;
  today it runs as a stub.

---

## Part B · How RAPs actually vary

Reconciliation Action Plans are **not** a standardized filing. They vary enormously — first in
vocabulary, and more consequentially in the *substance* of what they commit to. This is the single
biggest challenge for any platform that tries to track them, and it is worth the client
understanding it directly.

### B.1 · They don't even agree on what the document is called

Across real organizations, the same kind of artifact goes by different names:

- **Bank of Canada** — "Reconciliation Action Plan"
- **TELUS** — "Indigenous Reconciliation & Connectivity Report"
- **Suncor** — "Report on Sustainability — Indigenous Relations"
- **TC Energy** — "Indigenous Relations & Reconciliation"
- **Government of Canada** — "Mandatory Minimum 5% Indigenous Procurement Target"

The internal structure varies just as much: Bank of Canada organizes commitments into **"pathways"**
("People pathway," "Learning pathway"); OPG uses a **5-pillar** structure; the Australian *Reflect
RAP* format (Populous) mandates a rigid **"Action / Deliverable / Timeline / Responsibility"** table
with maturity tiers (*reflect / innovate / stretch / elevate*) that have **no Canadian equivalent
at all**.

**How the platform copes:** every commitment stores **both** the document's own wording *and* a
normalized value mapped onto a single canonical vocabulary (18 sectors, a fixed set of commitment
types and themes). Nothing is lost — the original words are always kept beside the standardized
one, so the dashboard can compare across organizations without erasing how each one actually spoke.

**Be precise about how this works:** the mapping from idiosyncratic wording to the canonical
vocabulary is done by the **AI at extraction time and confirmed by the human reviewer** — it is not
a fixed dictionary of synonyms. So terminology unification, like everything else, ultimately rests
on the human-in-the-loop review gate.

### B.2 · The commitments themselves vary in structure

The extraction data model is built, deliberately, to **absorb** this variation rather than force
every RAP into one shape:

- **Only two things are effectively required** of a commitment: an **action** and a **deliverable**.
- **Everything else is optional** and frequently absent: the **owner**, the **timeline / due date**,
  and any **quantitative target**.
- Sector-specific fields are filled in only when relevant, and a genuinely novel field surfaces in
  an "extras" bucket rather than being force-fit or invented — **absence is treated as meaningful
  information**, not an error.

### B.3 · Many commitments have **no due date**

This is real and common. A great many RAP commitments are phrased as an **ongoing cadence**
("Annual," "Ongoing," "Every three years") or carry **no timeline at all**. Real examples from our
verified material:

- **TELUS** — *"Maintain a public Indigenous reconciliation action plan"* (no date)
- **Agnico Eagle** — *"Publish a Reconciliation Action Plan"* (no date)
- The **entire Bank of Canada** commitment set is stored with no dates, because the document states
  none.

These are governance- or announcement-style statements. Read strictly, a commitment with **no date
and no measure is not trackable** — there is no moment at which it can be said to be met or missed.
From an accountability standpoint, an undated "maintain / publish / continue" pledge does little to
demonstrate progress, however sincere the intent behind it. We note this as a **data-quality and
accountability observation**, grounded in the documents themselves — not an accusation of motive.

*(Design note: the platform stores the verbatim timeline wording next to the parsed date precisely
so that a real cadence like "Annual" isn't silently destroyed into "no timeline." An earlier
version made that mistake.)*

### B.4 · Many commitments have **no measurable target**

Alongside missing dates, many commitments carry **no metric, KPI, or numeric target** — they are
purely qualitative. Our verified examples (Bank of Canada, RBC, TELUS, Agnico) are dominated by
qualitative action verbs: *"Develop a framework…," "Engage in regular dialogue…," "Seek guidance
from…," "Maintain…"* The Bank of Canada set is explicitly a set of **"qualitative pathways with no
headline dollar targets."**

A commitment with neither a target nor a date offers a tracking platform **nothing to track**. This
is the crux of the accountability gap: the plan can be published and celebrated without ever
exposing a checkpoint against which follow-through could be judged.

### B.5 · An honest caveat about these two patterns

The platform **records** whether a date or target is present (an empty value beside the preserved
verbatim text), but it does **not yet flag or score** undated / unmeasurable commitments as a
quality problem. In other words: the data to surface "how many of this organization's commitments
are actually trackable?" exists, but there is currently **no feature that presents it that way**.
That is an honest gap — and, as Part C notes, a natural next step.

---

## Part C · How the platform is designed to address this

Pulling Parts A and B together, here is how the product responds to messy sources and uneven
commitments today, and where it can go next.

**Already built:**

- **Normalization that never erases the original.** Canonical vocabulary for cross-organization
  comparison, with each document's own words retained alongside (B.1).
- **Grounding + human review** that absorbs structural variation safely: nullable-by-contract
  fields mean a RAP that omits owners, dates, or targets is handled honestly rather than
  hallucinated into completeness (A.2–A.4, B.2).
- **A progress and risk engine.** Commitments carry a status (on-track / delayed / met / missed /
  stalled) and an append-only history; the platform computes **overdue** and **at-risk** flags and
  produces plain-language digests ("N commitments are past their target year without
  confirmation").
- **A confirmation-integrity view.** The dashboard measures the gap between what is *self-reported*
  and what is *independently confirmed* — the very gap the platform exists to surface — and never
  inflates a self-report into a confirmation.

**Natural next step (not yet built):**

- **A "trackability" signal.** Because the platform already records whether each commitment has a
  date and a measurable target, it could surface, per organization, *how many of its commitments
  are actually trackable* versus undated/unmeasurable — turning the observation in B.3–B.4 into a
  first-class, at-a-glance accountability indicator. This would be a modest, high-value addition
  built entirely on data the system already captures.

---

## Part D · Evidence base & references

**Real, verified material (safe to rely on):**

- **Bank of Canada gold set** — `scripts/fixtures/gold-commitments-bankofcanada.json` (one
  human-verified RAP; the source of the "qualitative, undated" examples).
- **Hand-curated real figures** — `src/lib/rap/real-fixtures.ts` (real public figures drawn from
  primary sources by the team; real-world-true, but hand-curated, *not* produced by running the
  extraction pipeline).
- **Live engine comparison** — `docs/rap-engine-comparison.md` (billed n=8 run; the κ ≈ 0 finding
  and the Textract-LAYOUT recommendation).
- **Extraction findings** — `docs/rap-extraction-findings.md` (the fabricated-quote bug, the
  verbatim-quote gate, over-extraction fixes).
- **Curated-dataset verification** — `DATA_VERIFICATION.md` (the 102/102 URL audit and the
  status-integrity rules).
- **Real RAP corpus (11 documents / ~250 pages)** — inventory in
  `Week 7/rap_samples/README.md`. These are readable source PDFs; extracting them at scale requires
  the client's AWS account (doc 02), as the local demo returns canned data.

**Where the mechanisms live in code (for a technical reader):**

- The locate-and-quote contract and the canonical/optional field model — `src/lib/rap/types.ts`.
- The extraction rules (including "normalize themes" and "forward-looking only") —
  `src/lib/rap/extraction-schema.ts`.
- The verbatim-quote gate — `src/lib/rap/validate.ts`.
- Source ranking (confirmed > research > self-reported) — `src/lib/index-evidence/resolver.ts`,
  `status-map.ts`.
- The overdue / at-risk risk engine — `src/lib/rap/insights.ts`.

**Honesty summary for the client:** the *design* evidence is strong and first-hand; the *real-RAP*
evidence is small but genuine (one gold set + curated real figures + a live 8-document run). The
organizations populating the running dashboard are **real, hand-curated from public disclosures**
(only 3 demo login accounts are fictional). What we have **not** done is run the AI extraction
pipeline across a large body of real RAP *PDFs* — so the fine-grained, commitment-level observations
in Part B (undated / unmeasurable commitments) rest on the extraction data model plus real
spot-checks (the Bank of Canada gold set and curated real figures), not on a large extracted corpus.
Every claim in Parts A and B about real RAPs is backed by a real example above; none of it should be
read as "measured across a large real corpus."

---

*Point-in-time handoff document. The living technical sources are in the repository at the paths
cited above; the engine comparison (doc 03) is a live n=8 billed run, and the κ ≈ 0 result
reproduces a published "ecological boundary" finding — LLM cross-checking gives no decorrelated
verification signal on this kind of real, unlabeled data, which is why human review is retained by
design.*
