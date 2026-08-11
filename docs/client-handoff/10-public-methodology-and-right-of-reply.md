# 10 · Public Methodology & Right-of-Reply

The RAP Index publicly names real organizations and characterizes their reconciliation commitments.
That carries a duty — and some reputational and legal exposure for the Institute — to be transparent
about **how** the data is produced and to offer named organizations a **way to respond**. This
document provides two things:

1. A plain-language **methodology statement** the Institute can publish alongside the Index.
2. A **correction / right-of-reply process** — including an honest account of the gap that exists
   today and a recommended way to close it.

Companion documents: [06 · RAP Research](./06-rap-research-data-verification-and-commitment-variation.md)
(the evidence behind the methodology), [07 · Data Governance](./07-data-governance-and-ocap.md),
[08 · Content Stewardship](./08-content-stewardship-runbook.md) (how corrections are actually made).
Glossary in the [README](./README.md).

---

## Part A · Methodology statement (publishable)

*The following is written to be adapted and published on or beside the RAP Index.*

**What the RAP Index is.** The RAP Index is a public, read-only view of Canadian organizations'
**own publicly-disclosed** reconciliation commitments — drawn from their reconciliation action
plans, ESG and sustainability reports, supplier pages, and first-party announcements. It makes those
public promises comparable across organizations. It is **a data view, not a rating or a ranking.**

**Where the data comes from.** Every sourced commitment links to a **first-party public page** —
the organization's own disclosure. We do not use sensitive or community-held Indigenous data; that
stays with communities. Each sourced commitment stores the exact source it came from, and all source links
are periodically checked (last verified 2026-08-10).

**How we handle accuracy.** Figures shown are **illustrative snapshots** taken from the cited
sources at the time of collection — always confirm against the linked source before treating a
number as exact. Where the platform reads a document with AI, every extracted fact must quote the
source verbatim or it is discarded, and a human reviews anything uncertain before it is published
(details in [06](./06-rap-research-data-verification-and-commitment-variation.md)).

**What "confirmed" means here (and what it doesn't).** Commitments are shown at one of three levels
of evidence:

- **Self-reported** — the organization's own statement, shown as such.
- **Research** — curated by our team from the organization's public disclosure.
- **Confirmed** — independently corroborated (for example, procurement dollars attested by the
  supplier on the other side).

A self-reported claim is **never** silently upgraded to "confirmed." The Index reports **what an
organization said**, faithfully and with its source — it does **not** assert that a commitment is
true, adequate, or being met. Independent confirmation is a distinct, higher bar.

**What the Index is not.** It is not an endorsement, a certification, a compliance assessment, or a
judgment of any organization's reconciliation efforts. It is a transparent mirror of public
disclosures, provided to support economic reconciliation through visibility and accountability.

---

## Part B · The right-of-reply gap (be honest about this)

An organization named in the Index may reasonably want to correct or respond to how it appears.
Today the platform's ability to let them do so is **uneven**:

- **A *claimed* organization can respond.** A company that logs in and verifies its identity (by
  Business Number) can record its own progress on its published commitments and choose to have its
  RAP appear on the Index. It has a voice.
- **A *scraped* organization cannot.** The ~100 organizations sourced from public disclosures have
  **no login and no channel** on the platform to dispute, annotate, or contextualize their entry.
  Today, a complaint from one of them is handled entirely **off-platform** — a steward edits the
  underlying data by hand (see [08 · Content Stewardship](./08-content-stewardship-runbook.md)).

For a public index that names real organizations, this asymmetry is worth closing. It is tracked as
a roadmap item in [09 · Product Roadmap](./09-product-roadmap.md).

---

## Part C · Correction & right-of-reply process (recommended)

Until a self-service mechanism exists, we recommend the Institute adopt and publish a simple,
documented process. This is a **policy** the Institute owns; the platform mechanics that back it are
in [08](./08-content-stewardship-runbook.md).

**1. A public point of contact.** Publish a correction contact (an email or form) on the Index,
e.g. *"See an error, or want to respond to your organization's entry? Contact us."*

**2. Acknowledge and log.** Record each request (organization, the specific commitment, what is
disputed, who raised it, date). This log is also useful evidence of good-faith stewardship.

**3. Triage against the source.** Most disputes resolve at the source: the Index shows what a
public document said. Compare the entry to the cited source.
- If the entry **misreads** the source → correct it (edit the data, re-publish; see [08 §B/§D](./08-content-stewardship-runbook.md)).
- If the entry **faithfully reflects** an outdated or superseded disclosure → update to the current
  source, or note the update.
- If the organization **disputes the public disclosure itself** → this is not a data error; offer to
  add a short, dated note reflecting their response, and/or point them to claiming their organization
  so they can record their own current position.

**4. Respond and close.** Reply to the requester with the outcome, and update the log.

**5. Prefer transparency to deletion.** Where possible, correct or annotate rather than silently
remove — a dated correction preserves trust. Removal is appropriate for genuine errors or
sensitive-data concerns.

**Publishable one-liner (right-of-reply):**
> *"We aim to reflect organizations' public commitments accurately. If your organization is listed
> and you believe an entry is incorrect, out of date, or missing context, contact us — we will review
> it against the cited source and correct or annotate it, and you may also claim your organization to
> record your own current position."*

---

## Part D · Legal & reputational notes (for the Institute, not for publication)

- **Fair characterization.** The Index's safest posture is exactly the one already built in: report
  what organizations *said*, quote/link the source, and avoid asserting truth or adequacy. Keep that
  discipline in any future editorializing.
- **The "illustrative snapshot" disclaimer is load-bearing** — keep it visible next to figures.
- **Sample/test data must not ship.** The repository's test fixtures include **verbatim text excerpts
  from real RAPs** (e.g. RBC and Bank of Canada page excerpts in the extraction fixtures) used only for
  development; these are removed before real deployment (see
  [02 · Deploy Runbook §5.3](./02-deploy-runbook.md)). Published data should be limited to the curated
  public-disclosure sources.
- **This is not legal advice.** Before public launch, the Institute may wish to have counsel review
  the methodology statement, the disclaimer, and the correction policy — especially the right-of-reply
  posture toward named organizations.

---

*This document is a policy-and-communications complement to the technical docs: the *evidence* that
makes the methodology credible is in [06](./06-rap-research-data-verification-and-commitment-variation.md)
and [DATA_VERIFICATION.md](../../DATA_VERIFICATION.md); the *mechanics* of making a correction are in
[08](./08-content-stewardship-runbook.md). The through-line: the Index is trustworthy precisely
because it is modest about what it claims — a mirror of public disclosures, correctable on request.*
