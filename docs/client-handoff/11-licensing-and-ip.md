# 11 · Licensing & Intellectual Property

When a client takes ownership of a platform, they need to know **what they own, what they're
licensed to use, and what obligations come attached.** Today the repository does **not** answer that
cleanly — there is no license file and no license declared — so this document sets out the current
state and the decisions to make before the platform is distributed or launched.

This is an informational summary, **not legal advice.** The Institute should have counsel confirm the
license choice and any data/trademark questions before public launch.

Companion documents: [01 · Project Audit](./01-project-audit.md),
[02 · Deploy Runbook](./02-deploy-runbook.md),
[07 · Data Governance](./07-data-governance-and-ocap.md). Glossary in the [README](./README.md).

---

## Part A · The code — ownership and license (decision needed)

**Current state:** the repository has **no `LICENSE` file**, and `package.json` sets `"private":
true` with **no `license` field**. In practice that means the code is **"all rights reserved" by
default** and not licensed to anyone — which is fine for a private handoff to one client, but it
leaves ownership and reuse **undefined in writing.**

**Decisions to make (with the team and, if relevant, the university):**

- **Who owns the copyright?** Capstone/student work, university, the Institute, or shared? This
  should be stated explicitly in a short IP-assignment or handoff letter — verbal understanding is
  not enough for an asset the Institute will operate publicly.
- **What license governs the client's use and any future distribution?** Options, roughly:
  - *Private / all-rights-reserved to the Institute* — simplest; the Institute owns and uses it, no
    public reuse. Keep `private: true`, add a short proprietary `LICENSE` naming the owner.
  - *A permissive open-source license* (MIT / Apache-2.0) — if the intent is to let others reuse or
    contribute (common for mission-driven civic tech). Requires the copyright holders' agreement.
  - *A source-available / non-commercial license* — if the Institute wants visibility but not
    commercial reuse by others.
- **Add the chosen `LICENSE` file** (and, if open-sourcing, a `NOTICE`/attribution file). This is a
  small task once the decision is made.

**Recommendation:** decide ownership first (an IP-assignment/handoff letter), then add a matching
`LICENSE` file before any public repository or distribution.

---

## Part B · Third-party dependencies (low risk, but audit before distribution)

The platform's **21 direct runtime dependencies** are the usual, permissively-licensed building
blocks:

- **AWS SDK** (`@aws-sdk/*`, `aws-xray-sdk-core`) — Apache-2.0
- **Next.js, React, React-DOM** — MIT
- **Nivo charts** (`@nivo/*`) — MIT
- **pdf-lib, pdf-parse, robots-parser** — MIT

These are all **permissive (MIT / Apache-2.0)** — no copyleft (GPL-style) obligations that would
force the Institute to open-source its own code, and no per-seat commercial licensing. Apache-2.0
carries a lightweight attribution/NOTICE obligation if the code is redistributed.

**One caveat: this is a review of *direct* dependencies only.** The full **transitive** dependency
tree (hundreds of packages) has not been machine-audited. Before distributing the code or publishing
the repository, run a license scan — e.g. `npx license-checker --summary` — to confirm nothing
copyleft or restrictive has slipped in transitively, and to generate an attributions list. No
license-checker tool is currently in the repo; adding one to the pre-distribution checklist is
prudent.

---

## Part C · Data & content IP

The platform involves several distinct bodies of content, each with its own IP posture:

- **The RAP Index data (curated commitments).** These are **facts drawn from organizations' public
  disclosures**, each stored with a link back to its first-party source. Factual data compiled from
  public sources is generally low-risk to index, but **how the Institute republishes it** (verbatim
  excerpts vs. summarized facts, with source attribution) is worth a deliberate policy — the platform
  already stores and displays the source link for every entry (see [10 · Methodology](./10-public-methodology-and-right-of-reply.md)).
- **Legal cases corpus.** Public **court decisions** — public records by construction. Any per-source
  reproduction terms (some court sites impose crawling/reuse conditions) should be respected; the
  platform already honors `robots.txt` (`robots-parser` dependency).
- **Sample / test fixtures — must be removed before distribution.** The repository's test data
  (`scripts/fixtures/`) contains derived JSON, some of which holds **verbatim text excerpts from real
  RAPs** (RBC and Bank of Canada page excerpts in the `textlayer-geometry-*` fixtures) used only for
  development. These must be purged before real deployment or any public repository —
  this is already on the pre-launch checklist ([02 · Deploy Runbook §5.3](./02-deploy-runbook.md),
  [08 · Content Stewardship §G](./08-content-stewardship-runbook.md)).
- **Institute-generated content** (framing, methodology, briefings) — owned by the Institute.

---

## Part D · AI model & cloud service terms

The platform's AI features run on **Amazon Bedrock**, invoking third-party and Amazon models
(Anthropic Claude, Meta Llama, Amazon Titan/BDA). Two things to be aware of:

- **Usage is governed by AWS's and the model providers' terms.** When the Institute runs the platform
  in its **own** AWS account, it accepts those terms directly. Model availability, pricing, and
  acceptable-use are set by AWS/the providers, not by this code.
- **Output ownership.** Under current AWS/Anthropic terms, customers generally own the inputs and
  outputs of their model calls, but the Institute should confirm the current terms for its account —
  particularly if outputs (extracted commitments, briefings) are republished.
- See [07 · Data Governance](./07-data-governance-and-ocap.md) for the residency implications of
  where that inference runs.

---

## Part E · Trademarks

- **OCAP® is a registered trademark of the First Nations Information Governance Centre (FNIGC).** The
  platform uses the mark (with the ® symbol) to describe alignment with the OCAP principles. Continue
  to use it correctly and attributed; if the platform ever *claims* OCAP compliance or certification
  (as opposed to describing alignment with the principles), confirm the appropriate usage/permission
  with FNIGC. Note that [07](./07-data-governance-and-ocap.md) is candid that the OCAP *enforcement*
  layer is partly designed-not-built — so describe alignment, not certification.
- **Third-party names** in the data (company names, "CCAB", "PAR", organization marks) are used
  nominatively to identify real organizations and their programs — standard for a public index, but
  keep usage factual and non-endorsing (see [10 · Methodology](./10-public-methodology-and-right-of-reply.md)).
- **Institute branding** (name, logo) is the Institute's own.

---

## Part F · Pre-distribution IP checklist

Before the platform is published, distributed, or launched publicly:

- [ ] **Decide and document code ownership** (IP-assignment / handoff letter).
- [ ] **Add a `LICENSE` file** matching that decision (+ `NOTICE` if open-sourcing).
- [ ] **Run a dependency license scan** (`npx license-checker`) and keep the attribution output.
- [ ] **Remove the sample fixtures containing verbatim RAP excerpts** from `scripts/fixtures/` (also a data-hygiene
      step in [08 §G](./08-content-stewardship-runbook.md)).
- [ ] **Confirm AWS/Bedrock model terms** for the Institute's own account.
- [ ] **Confirm OCAP® usage** posture (alignment, not certification) and any court-source reuse terms.
- [ ] **Have counsel review** the above and the [methodology/right-of-reply](./10-public-methodology-and-right-of-reply.md) posture.

---

*This document reflects the repository as handed off: no license is declared today (`package.json`
`"private": true`, no `LICENSE` file), direct dependencies are permissively licensed, and the only
known copyright-sensitive content — real RAP PDFs used as test fixtures — is already flagged for
removal before launch. The main action is a deliberate ownership-and-license decision, which only the
team and Institute can make.*
