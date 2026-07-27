# Overdue-milestone notifications — email delivery status

**Date:** 2026-07-27 · Audited against live AWS (account `106189426706`, profile `isb`) in `ca-central-1` + `us-east-1`.

Companion to `docs/notifications-demo-runbook.md` (how to demo it) and the feature itself
(PR #189, `src/lib/notifications/`). This records what is actually deployed, what the
email channel is currently doing, and exactly which part is gated on AWS rather than on us.

---

## Status (TL;DR)

**`ca` sends real email as of 2026-07-27. `production` does not yet.**

The audit found the pipeline deployed and correct everywhere except the final SES delivery hop, which was
unconfigured on both stages — no sender/recipient set, and no verified SES identity anywhere in the
account. `ca` has since been fixed and verified end to end with a real delivered email (§Evidence).
`production` is unchanged and still records `skipped` every Monday.

**The gap was configuration, not the sandbox.** The two are easy to conflate, and conflating them
understates working code. SES sandbox does **not** prevent real email — it permits verified-sender →
verified-recipient delivery at 200/day, which is what `ca` now does. What sandbox prevents is sending to
*arbitrary* recipients, i.e. real institute staff. So the showcase path needed ~10 minutes of identity
verification plus a redeploy; only rollout to real users needs AWS production access, which we have
**not** requested.

---

## What is deployed

| Component | `ca` (ca-central-1) | `production` (us-east-1) |
| --- | --- | --- |
| Feature code (PR #189) | ✅ merged to `main` | ✅ merged to `main` |
| Last deploy | 2026-07-26 20:09 UTC | — |
| `Notifications` table | ✅ ACTIVE | ✅ ACTIVE |
| `REPO_IMPL=dynamo` on Web fn | ✅ | ✅ |
| `ses:SendEmail` IAM grant | ✅ on `WebServerCacentral1Role` | ✅ |
| Weekly cron (`NotifyDigest`) | ✅ correctly absent (prod-only) | ✅ ENABLED, `cron(0 13 ? * MON *)` |
| `DIGEST_SENDER` / `DIGEST_RECIPIENT` | ✅ set (redeployed 2026-07-27) | ❌ both `''` |
| Verified SES identities | ✅ sender + recipient | ❌ none in `us-east-1` |
| SES production access | ❌ sandbox (fine — see below) | ❌ sandbox |
| **Email actually delivering** | ✅ **yes, verified** | ❌ records `skipped` |

`ca` is fully wired. `production` still has both gaps and will keep writing `skipped` records until it
gets the same treatment — note its identities must be verified in **`us-east-1`**; SES verification does
not cross regions.

---

## Evidence

**`ca` — before and after the fix** (`indigenomics-portal-ca-NotificationsTable-okmntofc`):

```
week=2026-W30  2026-07-26T19:32:25Z  emailStatus=skipped  recipient=null            # pre-fix
week=2026-W31  2026-07-27T20:05:51Z  emailStatus=sent     recipient=<institute inbox>
```

The `sent` record is corroborated independently by CloudWatch `AWS/SES` over the same window:

```
Send=3  Delivery=3  Bounce=0  Complaint=0  Reject=0
```

Three sends = two identity-verification emails + one digest; all three delivered. The per-minute series
puts one `Send` at 20:05 UTC, matching the digest's `generatedAt` exactly, and arrival in the recipient
inbox was confirmed by hand.

> `SendQuota.SentLast24Hours` still read `2.0` immediately afterward. That field lags; the CloudWatch
> `Send`/`Delivery` metrics are the real-time signal. Do not read the quota number as a contradiction.

**`production` — the weekly cron fired on schedule** on Monday 2026-07-27 and produced real numbers:

```
2026-07-27T13:00:38Z  [notify-digest] week=2026-W31 overdue=31 atRisk=43 email=skipped
```

Both prod records (`2026-W30`, `2026-W31`) carry `emailStatus=skipped`. The cron is healthy —
402ms, 110MB, no errors. It computes the digest correctly every week and then has nowhere to send it.

**SES account state at audit time**, both regions:

```
ProductionAccessEnabled: false        # sandbox — still true today
SendingEnabled:          true
Max24HourSend:           200.0
list-email-identities:   []           # zero verified identities, ca-central-1 AND us-east-1
```

That empty identity list was independent confirmation that no digest email had ever successfully sent
anywhere in this account. Two identities have since been verified in **`ca-central-1`** only.
`us-east-1` still has none, which is why `production` cannot send.

---

## Why the badge reads `skipped`

`skipped` is a **designed state**, not an error. The orchestrator (`src/lib/notifications/run.ts:22-23`)
resolves the recipient from `DIGEST_RECIPIENT`, and only constructs an SES client if a recipient exists:

```ts
const recipient = deps.recipient !== undefined ? deps.recipient : (process.env.DIGEST_RECIPIENT ?? null);
const emailer   = deps.emailer   !== undefined ? deps.emailer   : (recipient ? makeSesEmailer() : null);
```

With `DIGEST_RECIPIENT=''`, recipient is `null`, `emailer` is `null`, and the send branch never runs.
Nothing is attempted, so nothing fails — hence `emailStatus=skipped` and `emailError` absent. This is the
documented fallback mode in the runbook: in-app inbox only, no email.

Note the distinct failure mode: recipient set but **sender** empty gives `emailStatus=failed`, because a
send is attempted and SES rejects the empty `FromEmailAddress`. `skipped` and `failed` mean different things.

### The digest itself is unaffected

`runDigest` persists the record **before** attempting any send (`run.ts:27-29`), so the in-app inbox is
correct regardless of email outcome. On the failure path it stores `e.name` rather than `e.message`,
specifically because raw SES sandbox/verification errors embed the recipient address and would otherwise
leak it into a persisted, inbox-rendered record (`run.ts:37-40`).

---

## The configuration gap

`DIGEST_SENDER` and `DIGEST_RECIPIENT` are read from the **deploy-time shell environment**
(`sst.config.ts:358-359`, and `:297-298` for the cron), defaulting to `''`:

```ts
DIGEST_SENDER:    process.env.DIGEST_SENDER    ?? "",
DIGEST_RECIPIENT: process.env.DIGEST_RECIPIENT ?? "",
```

They are **not** SST secrets — they are baked into the Lambda environment at deploy time. Two consequences:

1. Setting them requires a **redeploy**. There is no durable console fix.
2. A deploy that forgets to export them degrades **silently** to `skipped`. There is no warning at deploy
   time and no reason recorded at runtime. This has now happened on both `ca` and `production`.

We deliberately did **not** add a deploy-time assertion. Both-empty is a legitimate supported
configuration (the in-app-only mode the runbook endorses), so failing a deploy on it would be wrong, and
a hard gate risks blocking deploys during showcase prep. The lower-risk improvement, if we want one, is to
record *why* a digest was skipped (`no recipient configured` vs `no sender configured`) in the status and
log line — a runtime fix rather than a deploy-time one.

---

## What the sandbox does and does not block

| | Sandbox (today) | Needs production access |
| --- | --- | --- |
| Send to a **verified** address | ✅ yes | — |
| Send to an **arbitrary** address | ❌ no | ✅ |
| Volume | 200/day, 1/sec | higher quota |

A weekly digest to one verified inbox fits inside sandbox limits with enormous headroom. **The Aug 10
showcase demo does not need production access.** Only rollout to real institute recipients does, and that
request takes AWS a day or more to review — worth filing well ahead of any such need.

---

## Enabling delivery

### `ca` — **done 2026-07-27**, recorded here so it can be repeated

1. **Verified both identities in SES, region `ca-central-1`.** Verification is per-region — verifying in
   `us-east-1` does nothing for this stage. Sandbox requires the recipient be verified too, not just the
   sender. Both ends confirm via a clicked link; the link expires in 24h.
2. **Redeployed from `main` with the vars exported:**
   ```
   AWS_PROFILE=isb SST_AWS_REGION=ca-central-1 CASES_EMBED_PROVIDER=stub \
   DIGEST_SENDER=<verified-sender> DIGEST_RECIPIENT=<verified-recipient> \
   npx sst deploy --stage ca
   ```
   Deploy these from `main`, not a feature branch — the env vars are baked into the Lambda alongside
   whatever code is checked out.
3. Triggered a digest and confirmed `emailStatus=sent` plus SES `Delivery=1` for that minute.

To repeat on demo day: sign in as the institute → **Notifications** → **Generate & send now**. The current
week's row regenerates **in place** (idempotent per ISO week — no duplicate rows), so retakes are safe.

### `production` — still to do

Same two ingredients: `us-east-1` identities and a prod redeploy with the vars set. Until then the cron
fires every Monday at 13:00 UTC and writes `skipped` — harmless and accurate, but the feature reads as
inactive to anyone browsing the prod inbox. Decide deliberately whether prod *should* email, and to whom:
a real institute distribution list needs SES production access **and** a sender on a project-controlled
domain with DKIM, not a personal address. Those are one piece of work, not two.

---

## Verification caveats

- Everything above about live state comes from direct AWS queries on 2026-07-27, not inference.
- The local harness (`npm run verify:notifications`) passes **44 of 45** checks. The one gap is the
  DynamoDB repo round-trip parity section, which needs DynamoDB Local and did not run in this audit
  (Docker was not running on the auditing machine). It is not a known failure — it is unexercised here.
- No automated test covers the live SES path, and none has been added. The 2026-07-27 send was a manual
  one-off; nothing prevents this configuration from silently regressing on a future deploy that forgets
  to export the vars. Re-check the badge before relying on it.
- That send was triggered by a throwaway script calling `runDigest()` directly against the `ca` tables,
  not by the institute button in the deployed app. It proves the code path, the SES identities and the
  region wiring; it does **not** prove the deployed Lambda's own environment. That env was verified
  separately (`get-function-configuration` shows both `DIGEST_*` vars set) and the role carries
  `ses:SendEmail`, so the button is expected to work — but the button itself remains unexercised.
