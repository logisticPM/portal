# Overdue-milestone notifications — demo runbook (Aug 10 showcase)

Practical steps to record the notifications feature. The feature is delivered on
branch `feat/overdue-notifications` (spec `docs/superpowers/specs/2026-07-25-…`,
plan `docs/superpowers/plans/2026-07-25-…`).

> **Current state (2026-07-27):** the SES setup in step 1 below has **not** been done —
> no identity is verified in `ca-central-1`, and `DIGEST_SENDER`/`DIGEST_RECIPIENT` are
> empty on the deployed `ca` stage, so digests currently record `email: skipped`.
> Do step 1 before recording. See `docs/notifications-delivery-status.md`.

## What the demo shows
The institute logs in, clicks one button, and an overdue-milestone digest
(overdue / at-risk counts + per-org breakdown) appears **in-app** *and* arrives
as an **email** — turning the client's Idea #5 "compute-only" signal into a
delivered notification.

## Where to demo
- **`ca` stage (recommended for the video):** shows the real thing, including a
  real email arriving. `ca` is the demo stage — deploying here does NOT touch prod.
- **Local (`npm run dev`):** fastest, but the email channel shows `skipped` (no
  SES locally); only the in-app inbox is demoable.

## One-time setup (off-camera, ~10 min) — `ca` path
1. **Verify SES identities in `ca-central-1`** (SES starts in sandbox → both ends
   must be verified):
   - `DIGEST_SENDER` — an address you control, verified in the SES console (ca-central-1).
   - `DIGEST_RECIPIENT` — the inbox you'll show on camera (e.g. your own Gmail),
     also verified (sandbox requires the recipient be verified too).
2. **Deploy the branch to `ca`** with the digest env vars set:
   ```
   AWS_PROFILE=isb SST_AWS_REGION=ca-central-1 CASES_EMBED_PROVIDER=stub \
   DIGEST_SENDER=<verified-sender> DIGEST_RECIPIENT=<your-inbox> \
   npx sst deploy --stage ca
   ```
   Creates the `Notifications` table in ca and wires the button's `ses:SendEmail`
   permission. The weekly cron stays **prod-only** — it will NOT fire on ca.
3. **Have an institute login ready.** The page is institute-only
   (`kind === "indigenomics"`). Use the real institute account on ca or register
   one — do NOT rely on `institute@demo` (not auto-seeded).

## On-camera flow (~30 sec)
1. Sign in as the institute → the nav now shows a **Notifications** tab.
2. Open **Notifications** — inbox (empty, or prior weeks).
3. Click **Generate & send now** → button disables and shows **"Generating…"**,
   page refreshes.
4. A **Week 2026-Wxx** entry appears: totals (overdue / at-risk / orgs), an
   **email: sent** badge, and an expandable **per-organization breakdown**.
5. Cut to your inbox → the digest email has arrived (subject e.g.
   *"RAP Index: 34 overdue, 45 at-risk across N organizations (week 2026-Wxx)"*).

## Gotchas
- **Idempotent per ISO week:** clicking again re-generates + re-sends for the
  *same* week and updates the same inbox row (no duplicate). Safe to retake —
  rows won't pile up. A double-click is also guarded (button disables while pending).
- **Skip SES setup?** Everything still works but the badge reads **`skipped`**
  (in-app only) — a fine fallback if you'd rather not do SES; just don't promise
  an email on camera.
- **`DIGEST_SENDER` unset but recipient set** → badge reads **`failed`** (send
  errors every time). Verify the *sender* too.
- **Substance:** current real ca data has plenty of overdue/at-risk, so the digest
  won't be empty.
- **Residency:** the email is sent from the stage region (ca-central-1), so the
  recipient address stays in-region; digest content is aggregate/public only.
