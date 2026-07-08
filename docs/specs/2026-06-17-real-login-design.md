# Real login (email + password) — design spec

**Date:** 2026-06-17 · **Author:** Shiting Huang · **Status:** Design approved — pending implementation plan
**Sprint:** 3 (Week 6) · **Type:** Feature design (auth) · **Tier:** "real-enough" v1 (NOT Cognito/MFA/identity-proofing — see §9)

> Replaces the mock passwordless "sign in as…" picker with a real email + password
> credential + signed-session layer, running entirely in the existing SST / Lambda /
> DynamoDB stack. No external identity provider. The clean `writeSession`/`getSession`
> seam is where this plugs in.

---

## 1. Goal & scope

Today login is a dropdown: pick an account, get a **plaintext** `portal_session`
cookie (`company:c-northway`) — trivially forgeable, no credentials. This spec makes
login *real*: users authenticate with email + password, sessions are
**cryptographically signed and time-bounded**, and a company can only ever see its own
data.

**In scope (v1):**
- Email + password login and registration; password **hashing** (scrypt).
- **HMAC-signed, expiring** session cookie with hardened flags.
- Identity strictly from the session (drop `?as=` as an identity source).
- A `User` record per entity; **seeded demo accounts** for the existing demo entities.
- **Basic login rate limiting** (the demo URL is public).

**Out of scope — documented future work (§9):** AWS Cognito, password reset via email,
email verification, MFA, change-password-while-logged-in.

---

## 2. Decisions (from brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Auth tier | Email + password over our own stack | Demo-ready, owned end-to-end, no Cognito ops |
| Identity model | **1:1** account ↔ entity; seeded demo creds | Matches today's model; lets us log in as demo entities at the showcase |
| `?as=` override | **Removed** as an identity source | Makes auth actually enforced — no URL-edit bypass |
| Session | HMAC-signed, stateless cookie | No per-request DB read; right for Lambda |
| Password hash | Node built-in `crypto.scrypt` | No native dep (bcrypt is painful on Lambda) |
| v1 extras | Rate limiting only | Public URL; reset/verify/change-pw deferred |

---

## 3. Security model (the core)

- **Session cookie value** = `<payload>.<signature>` where
  `payload` = base64url(JSON `{ kind, partyId?, email, iat, exp }`) and
  `signature` = `HMAC-SHA256(payload, AuthSecret)`.
- **`getSession()` is the security boundary.** It runs in the Node runtime (server
  components + server actions), recomputes the HMAC, and returns `null` for any
  cookie whose signature doesn't match or whose `exp` has passed. Every page that
  renders entity data already calls it.
- **Middleware stays UX-only.** It reads `kind` from the payload segment for route
  gating/redirects but does **not** enforce security — a forged or expired cookie is
  simply bounced to `/login` when the page's `getSession()` rejects it. (Standard
  Next.js pattern; avoids edge-runtime crypto and keeps the secret out of the edge.)
- **Secret management:** `AuthSecret` is an SST `Secret`, set per stage via
  `npx sst secret set AuthSecret <value> --stage <stage>`, linked to the site so it
  reaches the Node runtime via env. Never in code, never `NEXT_PUBLIC_`.

### 3a. Cookie security flags (required)

`writeSession` must set, in addition to today's `path` / `sameSite`:

| Flag | Value | Why |
|---|---|---|
| `httpOnly` | `true` | JS can't read the cookie → mitigates XSS token theft |
| `secure` | `true` in production (`false` allowed on local http) | Cookie only sent over HTTPS |
| `sameSite` | `lax` (unchanged) | CSRF mitigation; `lax` keeps top-level nav working |
| `path` | `/` (unchanged) | App-wide |
| `maxAge` | matches session `exp` (see §3b) | Cookie lifetime tracks the token |

### 3b. Session expiry

- Signed payload carries `iat` (issued-at) and `exp` (expiry). **`exp` = `iat` + TTL**,
  default **7 days** (configurable constant).
- **`exp` is enforced server-side** in `verifySession` — a tampered/extended cookie is
  rejected regardless of the client-side cookie `maxAge`.
- Cookie `maxAge` is set to the same TTL so the browser drops it on schedule.
- No sliding/refresh in v1 (re-login after expiry); documented as possible future work.

---

## 4. Data model & password storage

- **New `User` entity** in the existing single-table `DataPortal`:
  - `PK = USER#<email-lowercased>`, `SK = USER#<email-lowercased>` (single-item
    collection — keyed entirely by email).
  - Attributes: `{ email, passwordHash, kind, partyId?, createdAt }`.
  - Lookup by email is a single `GetItem` (email is the key — no GSI needed).
- **Password hashing** (`src/lib/auth/password.ts`, new):
  - `hashPassword(pw)` → `crypto.scrypt` with a random per-user salt; stored as
    `<salt-hex>:<hash-hex>`.
  - `verifyPassword(pw, stored)` → re-derive and compare with `crypto.timingSafeEqual`.
- **Repo seam:** add `getUserByEmail(email)` and `createUser(user)` to the `PortalRepo`
  interface, with **mock and dynamo** implementations, so the existing `npm run verify`
  parity harness covers them (same contract-first pattern as parties/lines).

---

## 5. Components & files touched

| File | Change |
|---|---|
| `src/lib/auth.ts` | Add `signSession()` / `verifySession()`; `getSession()` verifies HMAC + `exp`; `partyIdFrom()` returns `session.partyId` only (drop `?as=`). `Session` type gains `email`. |
| `src/lib/auth/password.ts` *(new)* | `hashPassword` / `verifyPassword` via scrypt. |
| `src/lib/repo/*` (interface + mock + dynamo) | `getUserByEmail`, `createUser`. |
| `src/lib/repo/actions.ts` | `signIn`: email+password → **rate-limit gate** → lookup → verify → (on fail: record attempt; on success: clear + signed session). `registerAction`: email+password+role+name → create party + user → signed session. `writeSession`: add hardened flags (§3a) + signed value. `signOut` unchanged. |
| `src/app/login/page.tsx` | Add email + password fields; show error via `?error=`. |
| `src/app/register/page.tsx` | Add email + password fields; show error via `?error=`. |
| `src/middleware.ts` | Logic unchanged; read `kind` from the new payload segment. |
| `src/lib/seed/fixtures.ts` + seed | A `User` per seeded party (`northway@demo` → `company:c-northway`, `institute@demo` → `indigenomics`, …) sharing a known demo password. |
| `sst.config.ts` | Declare `AuthSecret`; link to the site. |
| rate-limit helper | `LOGINFAIL#<email>` counter in DynamoDB with short TTL; default **5 failed attempts per 15-min window → 15-min lockout** (tunable constants). The lockout **check runs before `getUserByEmail`/`verifyPassword`** so a locked-out or attacker request never triggers the (deliberately expensive) scrypt hash; the counter is incremented only on a *failed* verify and cleared on success. |

---

## 6. Data flow

- **Login:** form POST → `signIn` → **rate-limit gate** (locked out? → reject before
  any lookup/hash) → `getUserByEmail` → `verifyPassword` → on failure: record the
  attempt (may trip the lockout); on success: clear the counter →
  `writeSession(signed)` → redirect `/home`.
- **Register:** form POST → `registerAction` → create party (company/supplier) or
  singleton institute → `createUser` (hashed) → `writeSession(signed)` → `/home`.
- **Authenticated request:** middleware presence/persona routing → page server
  component calls `getSession()` → `verifySession` (HMAC + `exp`) → `partyId` drives
  the data fetch (session only).
- **Logout:** `signOut` deletes the cookie → `/login`.

---

## 7. Error handling

| Case | Behaviour |
|---|---|
| Invalid email/password | Redirect back to `/login?error=invalid` (generic — don't reveal which field) |
| Duplicate email on register | Redirect to `/register?error=exists` |
| Rate limit exceeded | Redirect to `/login?error=throttled` with a cool-down message |
| Tampered / expired cookie | `getSession()` → `null` → middleware/page redirects to `/login` |
| Missing `AuthSecret` | Fail fast at startup (don't sign with an empty/default key) |

---

## 8. Testing

- **Unit:** `hashPassword`/`verifyPassword` roundtrip; `signSession`/`verifySession`
  for valid / tampered-payload / wrong-secret / **expired** tokens.
- **Parity:** `getUserByEmail` + `createUser` mock ↔ dynamo via the existing `verify`
  harness (extends the current 18/18).
- **Flow (manual / smoke):** seeded login works; wrong password fails; `?as=` no longer
  changes identity; expired cookie redirects to login.

---

## 9. Future work (documented, not built)

- **AWS Cognito** — the original Horizon-2 plan (`SH_RAP8_AWS_Architecture §6`): managed
  pools, MFA, token rotation. This v1 is the "real-enough" tier; Cognito supersedes it
  if/when production identity-proofing is needed.
- **Password reset via email** + **email verification** — both need SES + token tables.
- **Change password while logged in.**
- **Sliding/refresh sessions.**

---

## 10. Demo-data safety (constraint)

**Seeded demo accounts (`*@demo`, shared password) exist only where the data is
synthetic.** They are acceptable on the demo/showcase deployment precisely because the
portal runs on synthetic, reversible data and commits no partner-gated data. The rules:

- Demo accounts are seeded **only** by `seed-sst` (the synthetic-data seeder) and must
  **never** be created against an environment holding real partner data.
- The seeded password is obviously demo-only and documented as such; if a real-data
  environment is ever stood up, demo accounts are excluded and real credentials are
  required.
- This keeps the "known credentials in production" trade-off scoped to the synthetic
  demo, consistent with the project's standing synthetic-data posture.
