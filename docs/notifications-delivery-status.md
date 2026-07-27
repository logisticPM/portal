# Overdue-milestone notifications — email delivery status

**Date:** 2026-07-27 · Audited against live AWS (account `106189426706`, profile `isb`) in `ca-central-1` + `us-east-1`.

Companion to `docs/notifications-demo-runbook.md` (how to demo it) and the feature itself
(PR #189, `src/lib/notifications/`). This records what is actually deployed, what the
email channel is currently doing, and exactly which part is gated on AWS rather than on us.

---

## Status (TL;DR)

**The notification pipeline is deployed and working end to end except the final SES delivery hop, which is
unconfigured — not broken.** Digests compute correctly, persist correctly, and render correctly in the
institute inbox on both `ca` and `production`. No email has been sent on any stage, because no sender or
recipient is configured and no SES identity is verified in the account.

**This is a configuration gap, not a sandbox limitation.** The two are easy to conflate. SES sandbox does
**not** prevent the demo from sending real email — sandbox permits verified-sender → verified-recipient
delivery at 200/day. What it prevents is sending to *arbitrary* recipients, i.e. real institute staff.
So the showcase path is unblocked by ~10 minutes of identity verification plus a redeploy; only
production rollout to real users needs AWS production access.

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
| `DIGEST_SENDER` / `DIGEST_RECIPIENT` | ❌ both `''` | ❌ both `''` |
| Verified SES identities | ❌ none | ❌ none |
| SES production access | ❌ sandbox | ❌ sandbox |

Both stages are in the same state on the two rows that matter. The infrastructure is complete;
the credentials for the last hop are not set.

---

## Evidence

**`ca` — the one digest on record** (`indigenomics-portal-ca-NotificationsTable-okmntofc`):

```
week=2026-W30  generated=2026-07-26T19:32:25Z  emailStatus=skipped  recipient=null  emailError=none
```

**`production` — the weekly cron fired on schedule** on Monday 2026-07-27 and produced real numbers:

```
2026-07-27T13:00:38Z  [notify-digest] week=2026-W31 overdue=31 atRisk=43 email=skipped
```

Both prod records (`2026-W30`, `2026-W31`) carry `emailStatus=skipped`. The cron is healthy —
402ms, 110MB, no errors. It computes the digest correctly every week and then has nowhere to send it.

**SES account state**, both regions:

```
ProductionAccessEnabled: false        # sandbox
SendingEnabled:          true
Max24HourSend:           200.0
SentLast24Hours:         0.0
list-email-identities:   []           # zero verified identities, ca-central-1 AND us-east-1
```

No identity has ever been verified anywhere in this account, which is independent confirmation that no
digest email has ever successfully sent.

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

### `ca` (demo path)

1. **Verify both identities in SES, region `ca-central-1`.** Verification is per-region — verifying in
   `us-east-1` does nothing for this stage. Sandbox requires the recipient be verified too, not just the sender.
   Plus-aliases verify independently but land in one inbox (`you+rapindex@gmail.com` as sender,
   `you@gmail.com` as recipient), so one mailbox covers both ends.
2. **Redeploy with the vars exported:**
   ```
   AWS_PROFILE=isb SST_AWS_REGION=ca-central-1 CASES_EMBED_PROVIDER=stub \
   DIGEST_SENDER=<verified-sender> DIGEST_RECIPIENT=<verified-recipient> \
   npx sst deploy --stage ca
   ```
3. Sign in as the institute → **Notifications** → **Generate & send now**. The `2026-W30` row regenerates
   in place (idempotent per ISO week — no duplicate rows) and the badge should flip to `sent`.

### `production`

Same two ingredients, `us-east-1` identities and a prod redeploy with the vars set. Until then the cron
will keep firing every Monday at 13:00 UTC and writing `skipped` records — harmless and accurate, but it
means the feature reads as inactive to anyone browsing the prod inbox.

---

## Verification caveats

- Everything above about live state comes from direct AWS queries on 2026-07-27, not inference.
- The local harness (`npm run verify:notifications`) passes **44 of 45** checks. The one gap is the
  DynamoDB repo round-trip parity section, which needs DynamoDB Local and did not run in this audit
  (Docker was not running on the auditing machine). It is not a known failure — it is unexercised here.
- No test covers the live SES path. The first real send will be the first real test of it, which is
  another reason to do step 1 above before demo day rather than on it.
