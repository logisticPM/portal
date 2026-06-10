# Sprint 1 — Retrospective

**Date:** Jun 7, 2026 · **Facilitator (lead):** En-Ping Su · **Attendees:** all 4 (En-Ping Su, Tong Wu, Shiting Huang, Mengshan Li)

Filled at sprint end. Kept honest and short — the value is the *change* we commit to, not the volume.

## 1. Sprint snapshot (metrics)

| Metric | Result | Notes |
|---|---|---|
| Sprint Goal met? | **Partly** | Direction chosen (RAP platform); client validation still pending |
| Commitment reliability (done ÷ committed) | Discovery cards done; **4 build tasks deferred to S2** | Deferral was deliberate, not a slip — building pre-validation would commit eng. to an unconfirmed direction |
| Avg. cycle time per card | per Jira report | discovery sprint — we read decision coverage, not velocity |
| Assumptions validated / invalidated | **E1 invalidated; RAP feasibility + Consent-Layer reuse validated** | |
| Client questions resolved | **0 / 11** | client response outstanding (slow turnaround) |
| Directions scored | **3 strands + comparators** | RAP platform 30/35 (scorecard in doc 10) |
| Risks closed | **0 / 4** | scope narrowed, not closed — pending client greenlight |

## 2. What went well
- Treated the unlocked scope as the work itself: scored every direction and de-risked the leading one with a running prototype + AWS / data / questionnaire spikes.
- Reused the Tech-Jam **Consent Layers** confirmation engine instead of starting from zero — a declined idea (E1) and a "tangential" hackathon both became load-bearing inputs.
- Contract-first build (the PortalRepo seam) let frontend and backend explore in parallel without blocking each other.

## 3. What didn't go well
- The client's slow response left direction validation (and all 11 questions) open, so we couldn't lock scope this sprint.
- We felt the pull to start building anyway and had to consciously resist it — deferring implementation to Sprint 2 was the right call but cost us a "shippable slice" feeling.

## 4. What we'll change next sprint (action items — owner + due)
| Action | Owner | By |
|---|---|---|
| Chase the client greenlight early and in parallel (don't let it gate the whole sprint) | En-Ping Su | Sprint 2, day 2 |
| Only begin implementation (DynamoDB / AWS / frontend slice) once the direction is confirmed | Mengshan Li (S2 lead) | after greenlight |
| Carry gating items: client green light, consent-app LICENSE / spec review, advisor confirmation | All | Sprint 2 |

## 5. Decision recorded
- **Chosen direction:** RAP platform (consent-based, Indigenous-governed infrastructure for verified economic data) — presented as best candidate, **pending client confirmation**.
- **Why (one line):** Highest on the scorecard (30/35), reuses the Consent-Layer confirmation engine, and open RAP/procurement data makes the supplier-confirmation slice feasible without partner-gated data.
- **Sprint 2 lead:** Mengshan Li · **Sprint 2 focus:** build the chosen vertical slice once the direction is greenlit.

## 6. Per-member one-liner (each person writes one)
- **En-Ping Su:** Running this as a *discovery* sprint — scoring directions instead of forcing a build — kept us from committing engineering to an idea the client hasn't validated; next time I'll start the client chase on day 1, not mid-sprint.
- **Tong Wu:** Standing up the prototype behind the PortalRepo seam early gave the whole team something concrete to react to; the contract-first split paid off and I'd do it again.
- **Shiting Huang:** The AWS / DynamoDB spikes were worth doing now so Sprint 2 can build immediately on greenlight, but I learned to verify AI-suggested AWS tooling against current docs rather than trust the draft.
- **Mengshan Li:** Re-scoping the data-feasibility work from the declined E1 sources to the RAP-platform data saved us from analyzing the wrong thing — confirming scope before deep analysis is the habit I'll carry into leading Sprint 2.
