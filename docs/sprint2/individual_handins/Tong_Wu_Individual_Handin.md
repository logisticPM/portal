# Part 1B — Individual Hand-in · Tong Wu

> *Prepared by the Sprint Lead from sprint artifacts (git author `logisticPM` = Tong, the repo owner) — Tong, confirm hours against your own tracker. NOTE: RAP-42/43 aren't on the Jira board yet — add them so this matches Jira.*

**Sprint:** 2 (Week 5) · **Role:** Frontend / UX — supplier + institute side ("Jack") + repo owner / integration
**Dates:** Jun 8–14, 2026 · **Time tool:** Toggl/Jira

## A. Hours, mapped to backlog items

| Task (RAP-#) | Activity | Hours |
|---|---|---:|
| RAP-40 | Supplier portal shell + pillar-aware confirm inbox; OCAP export/withdraw intact | 4.0 |
| RAP-42 *(off-board)* | Verified supplier showcase — public `/s/[supplierId]` route + supplier profile editor (`/profile`) + public toggle + review fixes | 5.0 |
| RAP-43 *(off-board)* | Indigenous-business verification system — model + claim/resolve/list, derived tier, reviewer verify queue, showcase cert provenance, Index integrity flag (T1–T4) + P2 design | 6.5 |
| (pillar model) | `Pillar → FlowType` procurement-centric refactor (PR #15) | 2.5 |
| — | Integration: reviewed + merged PRs #13–#16; deploy CI trigger | 1.25 |
| — | Team ceremonies + advisor/class meetings (Hao, Lino) — **demoed the slice Thu + Fri**; fuller version for **client + class Jun 17** | 1.25 |
| **Total** | | **20.5** |

> RAP-31 (Index/analytics) is a **Data-group** card on the board; the Index integrity flag I built lands under RAP-43 T4.

## B. AI usage & value-add

The supplier-side surface is large, so I leaned on an AI-agent workflow for the repetitive build-out — but **I designed the UX, set the acceptance criteria for each task, and reviewed/fixed the output task-by-task** (the RAP-42 "review findings" and RAP-43 seed-consistency commits are me catching and correcting AI output before merge).

| What I owned / decided | Where AI assisted (reviewed by me) |
|---|---|
| The supplier-facing UX — making the showcase a credible *verified-revenue ownership* artifact, not just a data dump | Generated page/route/component scaffolds — I reviewed each and fixed review findings before merge |
| The verification flow: claim → reviewer queue → derived/locked tier, and surfacing a **status × substance integrity flag** on the Index | Drafted the claim/resolve UI + rollup — I corrected the seed/tier consistency myself |
| Integration discipline — reviewing and merging the team's PRs into a coherent `main` | — (human review is the whole point here) |

## C. One-paragraph reflection

I built most of the supplier and institute side this sprint — the portal inbox, the public verified-supplier showcase, and the verification claim/review flow — and as repo owner I integrated everyone's work. An AI-agent workflow let me move fast on boilerplate, but speed only worked because I reviewed each task against its acceptance criteria and fixed what was wrong (several of my commits are exactly those corrections). The judgment that's mine is the UX and integrity framing: showing *why* a tier is trusted, not just listing suppliers. Next sprint I want RAP-42/43 properly tracked on Jira and tighter per-PR review ownership across the team.
