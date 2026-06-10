# Frontend — Remaining Work (Tong Wu / Wutong)

**Owner:** Tong Wu · **Cards:** RAP-9 (done), RAP-10 (re-assess) + new frontend items · **Date:** 2026-06-07
**Status:** Plan for review.

> Wutong built the demo (the repo): the scaffold, the `PortalRepo` seam, and the supplier + institute pages. En-Ping just added the company-side pages (report + coverage) in **PR #1 (open)**. This is what's left to reach the June 24 MVP and beyond.

---

## 1. Current state (verified against the repo)

**Built & working (on the mock):**
- `page.tsx` — landing role-switcher (company / supplier / Indigenomics)
- `confirm/page.tsx` — supplier confirm/dispute/correct inbox
- `record/page.tsx` — supplier "My Record" + OCAP export/withdraw
- `analytics/page.tsx` — Indigenomics macro Index (coverage %, by pillar, by identity tier)
- `register/page.tsx` — supplier self-registration (stretch)
- `api/export/route.ts` — OCAP JSON export
- `components/ui.tsx` — `money()`, `TierBadge`, `StatusBadge`
- `lib/repo/` — `types.ts` seam + fully-implemented `repo.mock.ts`

**Just added (PR #1, needs merge):**
- `report/page.tsx` (company questionnaire) + `coverage/page.tsx` + `createLineAction`

**Not built:** `repo.dynamo.ts` + AWS wiring (data group); real auth; dispute-resolution UI; cold-start invite flow.

**Card status:** RAP-9 "prototype RAP platform" = effectively **DONE** (this demo). RAP-10 "prototype consent-layer extension" = **OBSOLETE** — the RAP-platform direction is locked and the consent layer is a reused engine, not a separate prototype. Recommend closing RAP-10 (or repurposing it as "integrate confirmation-engine patterns," which is already done).

---

## 2. Must-do for the June 24 MVP demo

Mapped to the spec's Definition of Done (§2: a reviewer runs the app and watches the coverage number change after a confirmation):

1. **Review & merge PR #1** (En-Ping's company pages). Confirm style consistency with your pages; verify the report→coverage links.
2. **Prove the full walking skeleton end-to-end** and fix any seams:
   *act as a company → report a line naming a supplier → switch to that supplier → confirm it → coverage % and the Index rise → supplier withdraws → line reverts to pending, numbers drop.* This is the money demo; it must be flawless.
3. **Design-system consistency pass** across all 7 pages — shared spacing, the amber/cedar/rust tokens, `TierBadge`/`StatusBadge` used everywhere a tier/status appears, consistent headers/back-links.
4. **Landing/role-switcher polish** — make "act as…" obvious; it's the reviewer's entry point.
5. **Demo script / runbook** — a short `docs/DEMO.md`: exact click path for the one-sentence demo, which seeded company/supplier to use (e.g., Northway → Eagle River), and the "watch the number drop" withdraw beat.
6. **Demo README** — ensure `npm run dev` + the click path are documented (overlaps with RAP-7's README).

## 3. Integration tasks (when the data group ships `repo.dynamo.ts`)

- Flip `REPO_IMPL=dynamo` and **re-test every page** against DynamoDB Local (behavior must match the mock exactly).
- Handle **async/error states** the mock never surfaced: loading states, empty states, and errors (e.g., a Dynamo read failing) — currently pages assume instant in-memory success.
- Verify the **withdraw → revert → coverage drop** beat still works against real persistence.

## 4. Stretch / Horizon-2 frontend (from spec §13/§15)

- **Supplier registration UX** hardening (it's a stretch today; make the self-declared tier warning explicit).
- **Cold-start invite flow** — company names a not-yet-registered supplier → placeholder + invite (model supports it via `Party.registered`).
- **Dispute-resolution UI** — `dispute` is currently terminal; UBCIC's 2026 standard names dispute resolution as required.
- **Accessibility + responsive pass** — keyboard nav, labels/aria, color-contrast on the dark theme, mobile layout.
- **Privacy/visibility model** — per-supplier $ is sensitive; decide what the Index shows publicly vs aggregates only.

## 5. Prioritized checklist (pull onto the board)

- [ ] Review + merge PR #1 (company pages) — **P0**
- [ ] End-to-end walking-skeleton pass + fix seams — **P0**
- [ ] Design-system consistency across all pages — **P1**
- [ ] `docs/DEMO.md` runbook + landing polish — **P1**
- [ ] Close/repurpose RAP-10 (obsolete) — **P1**
- [ ] DynamoDB integration re-test + async/error states (after data group) — **P1**
- [ ] A11y/responsive pass — **P2 / H2**
- [ ] Registration hardening, cold-start invite, dispute UI, privacy model — **H2**
