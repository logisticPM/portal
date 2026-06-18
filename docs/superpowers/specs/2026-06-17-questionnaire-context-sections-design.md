# Questionnaire context sections (read-only) — design

**Date:** 2026-06-17 · **Owner:** En-Ping Su (company side) · **Card:** follows RAP-34

## Problem

The demo deck (`Week 5/rap_demo_intro_12min.html`, slides 5–7) sells the collect layer
as *"a structured questionnaire on Indigenomics' RAP framework."* The live `/report`
page is a single confirmable-line entry form (flow + counterparty + amount + period +
innovation tag). It reads as a transaction form, not a questionnaire — the deck's
narrative overshoots what's on screen.

Separately, the 41-question RAP Impact Survey is already modelled in `src/lib/survey/`
(`Organization` Q1–7 + `SurveyResponse` Q8–41, with mock + dynamo repos, fixtures, seed),
but nothing surfaces it in the company report form.

## Insight

Sorted by the `02_Questionnaire_Expansion_Design` "one rule" (is there a named Indigenous
counterparty who can confirm it?), ~35 of the 41 survey questions are **self-report
context** (demographics, relationships, employment counts, cultural learning, governance).
Only Q30–34 (procurement) are confirmable — and those already exist as confirmable lines.
So the survey domain *is* the missing context layer (`02` sections A / C / D).

## Decision — option (a): read-only context

Surface the survey domain as a **structured, read-only** wrapper around the existing
confirmable lines. Do **not** build 41 editable inputs, and do **not** wire survey data
into coverage/Index (it must never count as confirmed — that's the moat).

The page becomes a four-section questionnaire:

- **A · Organisation profile** — from `Organization` (industry, latest RAP type, employees,
  listed status, primary contact). Read-only card near the top.
- **B · Confirmable economic lines** — the existing flow selector + line list. Unchanged.
- **C · Workforce & culture** — from `SurveyResponse` (Indigenous staff total + by level,
  cultural learning hours, protocols). Read-only, stamped **"self-reported · unverified."**
- **D · Governance & relationships** — governance structures, senior-leader engagement,
  partnerships. Read-only, stamped **"self-reported · unverified."**

Seeing the confirmable lines (tier badges, flow to Index) next to the context blocks
(unverified stamp, go nowhere) is the on-screen embodiment of the confirmability rule.

## Mapping

Portal company → survey org by prefix convention: `c-<x>` → `org-<x>`
(`c-cedartrust` → `org-cedartrust`). Only Cedar Trust Bank has full survey data today;
companies with no matching org render without the context sections (graceful absence).
Survey year is fixed to `"2025"` for the demo.

## Scope / non-goals

- No edits to the `survey` data layer, the `repo` seam, coverage, or the Index.
- No new write paths — context is display-only this iteration.
- Editable profile / context is a possible follow-up, explicitly out of scope here.

## Files

- `src/app/report/ContextSections.tsx` (new) — `ProfileCard` (A) + `ContextBlocks` (C/D),
  read-only server components, with enum→label maps and an "unverified" stamp.
- `src/app/report/page.tsx` — fetch `surveyRepo.getOrganization` + `getResponse`, render
  the four sections around the existing form.

## Verification

- `tsc --noEmit` clean; `npm run build` green.
- `/report?as=c-cedartrust` renders A/C/D populated from fixtures with the unverified stamp;
  confirmable lines unchanged. A company with no survey org renders cleanly without C/D.
