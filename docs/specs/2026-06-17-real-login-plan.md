# Real Login (email + password) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock passwordless "sign in as…" picker with real email+password auth, an HMAC-signed expiring session, and session-only identity, entirely within the existing SST/Lambda/DynamoDB stack.

**Architecture:** A new `User` entity (keyed by email) lives in the existing single-table `DataPortal` behind the `PortalRepo` seam (mock + dynamo). Passwords are scrypt-hashed. The session cookie becomes `<base64url(payload)>.<hmac>` verified server-side in `getSession()`; middleware stays UX-only. Identity comes from the session (the `?as=` override is removed). Rate limiting gates login before the expensive hash.

**Tech Stack:** Next.js App Router (server actions + RSC), DynamoDB (single-table), Node `crypto` (scrypt + HMAC), SST v4 (`sst.Secret`), `tsx` verification harness (no unit-test framework in this repo — tests are assertions in `scripts/verify*.ts`).

**Spec:** `docs/specs/2026-06-17-real-login-design.md`

---

## File Structure

**Create:**
- `src/lib/auth/password.ts` — `hashPassword` / `verifyPassword` (scrypt).
- `src/lib/auth/rate-limit.ts` — `assertNotLocked` / `recordFailure` / `clearFailures` (DynamoDB-backed when `REPO_IMPL=dynamo`, in-memory otherwise).
- `scripts/verify-auth.ts` — assertion harness for password, session, user-repo parity, rate-limit.

**Modify:**
- `src/lib/auth.ts` — `Session` gains `email`; add `signSession` / `verifySession` / `authSecret`; `getSession` verifies; `partyIdFrom` is session-only (no `?as=`).
- `src/lib/repo/types.ts` — add `User` type + `getUserByEmail` / `createUser` to `PortalRepo`.
- `src/lib/dynamo/single-table.ts` — `keys.user`, `toUserItem`, `itemToUser`.
- `src/lib/repo/repo.mock.ts` — in-memory `users` + impls.
- `src/lib/repo/repo.dynamo/writes.ts` — `createUser`.
- `src/lib/repo/repo.dynamo/reads.ts` — `getUserByEmail`.
- `src/lib/repo/repo.dynamo/index.ts` — wire the two methods.
- `src/lib/repo/actions.ts` — `signIn`, `registerAction`, `writeSession` (signed value + hardened flags); drop `?as=` from redirects.
- `src/app/login/page.tsx`, `src/app/register/page.tsx` — email + password fields + error display.
- `src/app/(supplier)/{record,confirm,profile}/page.tsx`, `src/app/{report,coverage}/page.tsx` — `partyIdFrom()` no-arg.
- `src/lib/seed/fixtures.ts`, `src/lib/seed/seed.ts`, `scripts/seed-sst.ts` — seed a `User` per party.
- `sst.config.ts` — declare `AuthSecret`, feed via `environment`.
- `src/middleware.ts` — read `kind` from the signed payload segment.
- `package.json` — add `verify:auth` script.
- `docs/deploy.md` — document `AuthSecret`.

---

## Task 1: Password hashing module

**Files:**
- Create: `src/lib/auth/password.ts`
- Create: `scripts/verify-auth.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the `verify:auth` npm script**

In `package.json` scripts, after the `"verify"` line add:

```json
    "verify:auth": "tsx scripts/verify-auth.ts",
```

- [ ] **Step 2: Write the failing test harness (password section)**

Create `scripts/verify-auth.ts`:

```ts
// ===========================================================================
// Auth verification harness — `npm run verify:auth`.
// Pure checks (password, session) need no DB. The user-repo parity + rate-limit
// sections (added later) need DynamoDB Local (`npm run ddb:up`).
// ===========================================================================
import { hashPassword, verifyPassword } from "../src/lib/auth/password";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
}

async function main() {
  // --- password ---
  const stored = await hashPassword("correct horse");
  check("password: format is salt:hash", /^[0-9a-f]+:[0-9a-f]+$/.test(stored), stored.slice(0, 16) + "…");
  check("password: correct verifies", await verifyPassword("correct horse", stored));
  check("password: wrong rejected", !(await verifyPassword("wrong", stored)));
  check("password: malformed rejected", !(await verifyPassword("x", "not-a-hash")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run verify:auth`
Expected: FAIL — `Cannot find module '../src/lib/auth/password'` (or a TS resolution error).

- [ ] **Step 4: Implement `password.ts`**

Create `src/lib/auth/password.ts`:

```ts
// ===========================================================================
// Password hashing — Node built-in scrypt (no native dependency; clean on
// Lambda). Stored as "<salt-hex>:<hash-hex>". Server-side only.
// ===========================================================================
import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run verify:auth`
Expected: PASS — 4 passed, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/password.ts scripts/verify-auth.ts package.json
git commit -m "feat(auth): scrypt password hashing + verify:auth harness"
```

---

## Task 2: Signed, expiring session in `auth.ts`

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `scripts/verify-auth.ts`

- [ ] **Step 1: Write the failing session tests**

In `scripts/verify-auth.ts`, add the import at the top:

```ts
import { signSession, verifySession, type Session } from "../src/lib/auth";
```

And inside `main()`, before the final summary `console.log`, add:

```ts
  // --- session sign/verify ---
  const NOW = 1_700_000_000;
  const sess: Session = { kind: "company", partyId: "c-northway", email: "northway@demo" };
  const token = signSession(sess, NOW);
  const ok = verifySession(token, NOW + 10);
  check("session: round-trips", !!ok && ok.kind === "company" && ok.partyId === "c-northway" && ok.email === "northway@demo");
  check("session: expired rejected", verifySession(token, NOW + 60 * 60 * 24 * 8) === null);
  check("session: tampered payload rejected", verifySession("x" + token, NOW + 10) === null);
  check("session: bad signature rejected", verifySession(token.split(".")[0] + ".deadbeef", NOW + 10) === null);
  const inst = signSession({ kind: "indigenomics", email: "institute@demo" }, NOW);
  check("session: indigenomics has no partyId", verifySession(inst, NOW + 10)?.partyId === undefined);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run verify:auth`
Expected: FAIL — `signSession`/`verifySession` not exported from `auth.ts`.

- [ ] **Step 3: Rewrite `auth.ts` session core**

Replace the entire contents of `src/lib/auth.ts` with:

```ts
// ===========================================================================
// Real session (email + password). The cookie value is "<payload>.<sig>" where
// payload = base64url(JSON {kind, partyId?, email, iat, exp}) and sig =
// HMAC-SHA256(payload, AUTH_SECRET). getSession() is the security boundary: it
// re-computes the HMAC and enforces exp. Middleware is UX-only (see middleware.ts).
// ===========================================================================
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "portal_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type SessionKind = "company" | "supplier" | "indigenomics";
export type Session = { kind: SessionKind; partyId?: string; email: string };

type Payload = { kind: SessionKind; partyId?: string; email: string; iat: number; exp: number };

// Server secret. Required in production; a clearly-fake fallback keeps local dev
// (`npm run dev`, `npm run verify:auth`) working without SST.
export function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is not set");
  return "dev-insecure-secret-change-me";
}

const enc = (s: string) => Buffer.from(s).toString("base64url");
const dec = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const hmac = (body: string) => createHmac("sha256", authSecret()).update(body).digest("base64url");

export function personaHome(kind: SessionKind): string {
  if (kind === "company") return "/report";
  if (kind === "supplier") return "/confirm";
  return "/analytics"; // indigenomics
}

export function signSession(session: Session, nowSec: number): string {
  const payload: Payload = {
    kind: session.kind,
    partyId: session.partyId,
    email: session.email,
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS,
  };
  const body = enc(JSON.stringify(payload));
  return `${body}.${hmac(body)}`;
}

export function verifySession(raw: string, nowSec: number): Session | null {
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = hmac(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let p: Payload;
  try {
    p = JSON.parse(dec(body));
  } catch {
    return null;
  }
  if (typeof p.exp !== "number" || p.exp < nowSec) return null;
  if (p.kind === "company" || p.kind === "supplier") {
    return p.partyId ? { kind: p.kind, partyId: p.partyId, email: p.email } : null;
  }
  if (p.kind === "indigenomics") return { kind: p.kind, email: p.email };
  return null;
}

// Read + verify the session from the request cookie. Returns null if absent,
// tampered, or expired.
export function getSession(): Session | null {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return verifySession(raw, Math.floor(Date.now() / 1000));
}

// Identity for company/supplier pages comes SOLELY from the verified session
// (the old ?as= override is gone — see design §2).
export function partyIdFrom(): string | undefined {
  return getSession()?.partyId;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run verify:auth`
Expected: PASS — all password + session checks pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts scripts/verify-auth.ts
git commit -m "feat(auth): HMAC-signed expiring session (sign/verify + secret)"
```

---

## Task 3: Make `partyIdFrom` session-only at every call site

**Files:**
- Modify: `src/app/(supplier)/record/page.tsx:13`, `src/app/(supplier)/confirm/page.tsx:13`, `src/app/(supplier)/profile/page.tsx:24`, `src/app/report/page.tsx:14`, `src/app/coverage/page.tsx:12`
- Modify: `src/lib/repo/actions.ts` (drop `?as=` from redirects)

- [ ] **Step 1: Update the 5 page call sites**

In each of the five pages, change the call from `partyIdFrom(searchParams)` to `partyIdFrom()`. Exact replacements:

- `src/app/(supplier)/record/page.tsx:13`: `const supplierId = partyIdFrom();`
- `src/app/(supplier)/confirm/page.tsx:13`: `const supplierId = partyIdFrom();`
- `src/app/(supplier)/profile/page.tsx:24`: `const supplierId = partyIdFrom();`
- `src/app/report/page.tsx:14`: `const companyId = partyIdFrom();`
- `src/app/coverage/page.tsx:12`: `const companyId = partyIdFrom();`

Leave the `searchParams` page prop in place (other params may use it); only the `partyIdFrom` argument is removed.

- [ ] **Step 2: Drop `?as=` from action redirects**

In `src/lib/repo/actions.ts`, change the two redirects that append `?as=` so identity is no longer URL-carried:

- `createLineAction`: `redirect(\`/report?as=${companyId}\`);` → `redirect("/report");`
- `updateSupplierProfileAction`: `redirect(\`/profile?as=${supplierId}\`);` → `redirect("/profile");`

- [ ] **Step 3: Verify the app type-checks / builds**

Run: `npm run build`
Expected: build succeeds (no `partyIdFrom` arity errors). If `signIn`/`registerAction` already error here because they reference the not-yet-updated session shape, that's expected — they are rewritten in Tasks 9–10; for now ensure no NEW errors from the call-site changes. If the build is blocked only by Tasks 9–10 code, run `npx tsc --noEmit 2>&1 | grep -E "partyIdFrom|page.tsx"` and confirm there are zero matches.

- [ ] **Step 4: Commit**

```bash
git add src/app src/lib/repo/actions.ts
git commit -m "refactor(auth): identity from session only (drop ?as= override)"
```

---

## Task 4: `User` entity — types + single-table marshallers

**Files:**
- Modify: `src/lib/repo/types.ts`
- Modify: `src/lib/dynamo/single-table.ts`

- [ ] **Step 1: Add the `User` type + repo methods to the seam**

In `src/lib/repo/types.ts`, add this type just above `export interface PortalRepo {`:

```ts
// An authentication account. 1:1 with an entity: company/supplier carry partyId;
// indigenomics is the singleton institute (no partyId). Keyed by email.
export interface User {
  email: string; // lowercased; the identity key
  passwordHash: string; // "<salt-hex>:<hash-hex>" (see auth/password.ts)
  kind: "company" | "supplier" | "indigenomics";
  partyId?: string;
  createdAt: string; // ISO 8601
}
```

Then inside `PortalRepo`, add to the `--- parties / registry ---` group:

```ts
  // --- auth / accounts ---
  getUserByEmail(email: string): Promise<User | null>;
  createUser(input: User): Promise<User>;
```

- [ ] **Step 2: Write the failing marshaller test**

In `scripts/verify-auth.ts`, add near the top:

```ts
import { itemToUser, keys, toUserItem } from "../src/lib/dynamo/single-table";
import type { User } from "../src/lib/repo/types";
```

And in `main()` before the summary, add:

```ts
  // --- user marshalling ---
  const u: User = { email: "northway@demo", passwordHash: "a:b", kind: "company", partyId: "c-northway", createdAt: "2025-01-15T00:00:00.000Z" };
  const item = toUserItem(u);
  check("user: PK is USER#<email>", item.PK === keys.user("northway@demo").PK);
  check("user: round-trips via itemToUser", JSON.stringify(itemToUser(item)) === JSON.stringify(u));
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run verify:auth`
Expected: FAIL — `toUserItem`/`itemToUser`/`keys.user` not exported.

- [ ] **Step 4: Implement the marshallers**

In `src/lib/dynamo/single-table.ts`:

(a) Add `"User"` to the `EntityType` union:

```ts
export type EntityType = "Party" | "Line" | "Conf" | "User";
```

(b) Add a `user` key builder inside the `keys` object (after `line`):

```ts
  // an auth account, keyed entirely by (lowercased) email
  user: (email: string) => ({ PK: `USER#${email.toLowerCase()}`, SK: "USER" }),
```

(c) Add the `User` import to the existing `import type { ... }` from `../repo/types`:

```ts
  User,
```

(d) Append the marshallers at the end of the file:

```ts
// --- User (auth account) ---
export function toUserItem(u: User) {
  return {
    ...keys.user(u.email),
    et: "User" as EntityType,
    email: u.email.toLowerCase(),
    passwordHash: u.passwordHash,
    kind: u.kind,
    partyId: u.partyId,
    createdAt: u.createdAt,
  };
}

export function itemToUser(it: Record<string, any>): User {
  return {
    email: it.email,
    passwordHash: it.passwordHash,
    kind: it.kind,
    partyId: it.partyId,
    createdAt: it.createdAt,
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run verify:auth`
Expected: PASS — user marshalling checks pass. (Note: `removeUndefinedValues` on the doc client means `partyId: undefined` is dropped for the indigenomics user; `itemToUser` returns `partyId: undefined` either way, so the round-trip for a company user with a partyId is exact.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/repo/types.ts src/lib/dynamo/single-table.ts scripts/verify-auth.ts
git commit -m "feat(auth): User entity type + single-table marshallers"
```

---

## Task 5: Mock repo — users

**Files:**
- Modify: `src/lib/repo/repo.mock.ts`

- [ ] **Step 1: Add an in-memory users store + impls**

In `src/lib/repo/repo.mock.ts`:

(a) Add `User` to the `import type { ... } from "./types"` list.

(b) After the `const parties: Party[] = [ ... ]` block, add:

```ts
// auth accounts (seeded in Task 12 via the same fixture the dynamo seed uses)
const users: User[] = [];
```

(c) In the object returned/exported as `mockRepo`, add these two methods (place them next to `registerCompany`/`registerSupplier`):

```ts
  async getUserByEmail(email) {
    return users.find((u) => u.email === email.toLowerCase()) ?? null;
  },
  async createUser(input) {
    const user: User = { ...input, email: input.email.toLowerCase() };
    users.push(user);
    return user;
  },
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors about `mockRepo` missing `getUserByEmail`/`createUser`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/repo/repo.mock.ts
git commit -m "feat(auth): mock repo user store (getUserByEmail/createUser)"
```

---

## Task 6: Dynamo repo — users

**Files:**
- Modify: `src/lib/repo/repo.dynamo/writes.ts`
- Modify: `src/lib/repo/repo.dynamo/reads.ts`
- Modify: `src/lib/repo/repo.dynamo/index.ts`

- [ ] **Step 1: Add `createUser` to writes.ts**

In `src/lib/repo/repo.dynamo/writes.ts`:

(a) Add `toUserItem` to the existing import from `../../dynamo/single-table`, and `User` to the import from `../types`.

(b) Append:

```ts
// AUTH — create an account (idempotent overwrite on the same email key)
export async function createUser(input: User): Promise<User> {
  const user: User = { ...input, email: input.email.toLowerCase() };
  await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: toUserItem(user) }));
  return user;
}
```

- [ ] **Step 2: Add `getUserByEmail` to reads.ts**

In `src/lib/repo/repo.dynamo/reads.ts`, add `GetCommand` to the `@aws-sdk/lib-dynamodb` import if not present, add `itemToUser` and `keys` to the `single-table` import, add `User` to the `../types` import, then append:

```ts
// AUTH — fetch an account by email (single GetItem; email is the key)
export async function getUserByEmail(email: string): Promise<User | null> {
  const res = await ddbDoc.send(
    new GetCommand({ TableName: TABLE, Key: keys.user(email) }),
  );
  return res.Item ? itemToUser(res.Item as Record<string, any>) : null;
}
```

- [ ] **Step 3: Wire both into the dynamo repo**

In `src/lib/repo/repo.dynamo/index.ts`, add to the assembled object:

```ts
  getUserByEmail: reads.getUserByEmail,
  createUser: writes.createUser,
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors; `dynamoRepo` now satisfies `PortalRepo`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/repo/repo.dynamo
git commit -m "feat(auth): dynamo repo users (createUser/getUserByEmail)"
```

---

## Task 7: User-repo mock↔dynamo parity check

**Files:**
- Modify: `scripts/verify-auth.ts`

- [ ] **Step 1: Add the parity check (needs DynamoDB Local)**

In `scripts/verify-auth.ts`:

(a) Add imports:

```ts
import { createSingleTable } from "../src/lib/dynamo/create";
import { mockRepo } from "../src/lib/repo/repo.mock";
import { dynamoRepo } from "../src/lib/repo/repo.dynamo";
```

(b) In `main()`, before the summary, add:

```ts
  // --- user repo parity (DynamoDB Local) ---
  if (process.env.DYNAMO_ENDPOINT) {
    await createSingleTable("DataPortal");
    const acct: User = { email: "Parity@Demo", passwordHash: "s:h", kind: "supplier", partyId: "s-eagle", createdAt: "2025-01-15T00:00:00.000Z" };
    await mockRepo.createUser(acct);
    await dynamoRepo.createUser(acct);
    const m = await mockRepo.getUserByEmail("parity@demo");
    const d = await dynamoRepo.getUserByEmail("parity@demo");
    check("user: email lowercased on create", m?.email === "parity@demo" && d?.email === "parity@demo");
    check("user: mock ≡ dynamo", JSON.stringify(m) === JSON.stringify(d));
    check("user: unknown email → null", (await dynamoRepo.getUserByEmail("nobody@demo")) === null);
  } else {
    check("user: parity skipped (no DYNAMO_ENDPOINT)", true, "run with ddb:up for full coverage");
  }
```

- [ ] **Step 2: Run with DynamoDB Local**

Run: `npm run ddb:up && DYNAMO_ENDPOINT=http://localhost:8000 npm run verify:auth`
Expected: PASS — parity checks pass (mock ≡ dynamo, lowercased email, unknown → null).

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-auth.ts
git commit -m "test(auth): user repo mock↔dynamo parity check"
```

---

## Task 8: Login rate-limit module

**Files:**
- Create: `src/lib/auth/rate-limit.ts`
- Modify: `scripts/verify-auth.ts`

- [ ] **Step 1: Write the failing rate-limit test**

In `scripts/verify-auth.ts` add the import:

```ts
import { assertNotLocked, clearFailures, recordFailure, MAX_FAILS } from "../src/lib/auth/rate-limit";
```

And in `main()` before the summary:

```ts
  // --- rate limit (in-memory path; email isolated per test run) ---
  const rlEmail = `rl-${NOW}@demo`;
  check("rl: starts unlocked", (await assertNotLocked(rlEmail)) === true);
  for (let i = 0; i < MAX_FAILS; i++) await recordFailure(rlEmail);
  check("rl: locks after MAX_FAILS", (await assertNotLocked(rlEmail)) === false);
  await clearFailures(rlEmail);
  check("rl: clear unlocks", (await assertNotLocked(rlEmail)) === true);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run verify:auth`
Expected: FAIL — module `../src/lib/auth/rate-limit` not found.

- [ ] **Step 3: Implement `rate-limit.ts`**

Create `src/lib/auth/rate-limit.ts`:

```ts
// ===========================================================================
// Login rate limiting. A small counter per email: { count, firstFailAt }. The
// window is logical (no DynamoDB TTL needed) — once WINDOW_MS since firstFailAt
// elapses, the counter resets. Backed by DynamoDB when REPO_IMPL=dynamo, else
// an in-memory map (local dev / verify). The lockout CHECK runs before the
// password hash, so locked-out/attacker requests never trigger scrypt.
// ===========================================================================
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE } from "../dynamo/client";

export const MAX_FAILS = 5;
export const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

type Record_ = { count: number; firstFailAt: number };

const useDynamo = () => process.env.REPO_IMPL === "dynamo";
const mem = new Map<string, Record_>();
const key = (email: string) => ({ PK: `LOGINFAIL#${email.toLowerCase()}`, SK: "LOGINFAIL" });

async function read(email: string): Promise<Record_ | null> {
  if (!useDynamo()) return mem.get(email.toLowerCase()) ?? null;
  const res = await ddbDoc.send(new GetCommand({ TableName: TABLE, Key: key(email) }));
  return res.Item ? { count: res.Item.count, firstFailAt: res.Item.firstFailAt } : null;
}

async function write(email: string, rec: Record_): Promise<void> {
  if (!useDynamo()) { mem.set(email.toLowerCase(), rec); return; }
  await ddbDoc.send(new PutCommand({ TableName: TABLE, Item: { ...key(email), ...rec } }));
}

export async function clearFailures(email: string): Promise<void> {
  if (!useDynamo()) { mem.delete(email.toLowerCase()); return; }
  await ddbDoc.send(new DeleteCommand({ TableName: TABLE, Key: key(email) }));
}

// true = allowed to attempt; false = currently locked out.
export async function assertNotLocked(email: string): Promise<boolean> {
  const rec = await read(email);
  if (!rec) return true;
  if (Date.now() - rec.firstFailAt > WINDOW_MS) { await clearFailures(email); return true; }
  return rec.count < MAX_FAILS;
}

export async function recordFailure(email: string): Promise<void> {
  const rec = await read(email);
  const now = Date.now();
  if (!rec || now - rec.firstFailAt > WINDOW_MS) {
    await write(email, { count: 1, firstFailAt: now });
  } else {
    await write(email, { count: rec.count + 1, firstFailAt: rec.firstFailAt });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run verify:auth`
Expected: PASS — rate-limit checks pass via the in-memory path (`REPO_IMPL` unset).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/rate-limit.ts scripts/verify-auth.ts
git commit -m "feat(auth): login rate limiting (logical window, ddb or in-memory)"
```

---

## Task 9: Wire `signIn` (rate-limit gate → lookup → verify → session)

**Files:**
- Modify: `src/lib/repo/actions.ts`

- [ ] **Step 1: Update imports + `writeSession`**

In `src/lib/repo/actions.ts`:

(a) Replace the auth import line with:

```ts
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, type Session } from "@/lib/auth";
```

(b) Add at the top of the file (with the other imports):

```ts
import { verifyPassword } from "@/lib/auth/password";
import { assertNotLocked, clearFailures, recordFailure } from "@/lib/auth/rate-limit";
```

(c) Replace the existing `writeSession` function and `SESSION_MAX_AGE` constant with:

```ts
function writeSession(session: Session) {
  const value = signSession(session, Math.floor(Date.now() / 1000));
  cookies().set(SESSION_COOKIE, value, {
    path: "/",
    httpOnly: true, // JS can't read it → mitigates XSS token theft
    secure: process.env.NODE_ENV === "production", // HTTPS-only in prod
    sameSite: "lax", // CSRF mitigation; lax keeps top-level nav working
    maxAge: SESSION_TTL_SECONDS, // tracks the signed token's exp
  });
}
```

- [ ] **Step 2: Rewrite `signIn`**

Replace the existing `signIn` function with:

```ts
// Real login: email + password. Rate-limit gate runs BEFORE the lookup/hash so a
// locked-out or attacker request never triggers the expensive scrypt verify.
export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) redirect("/login?error=invalid");

  if (!(await assertNotLocked(email))) redirect("/login?error=throttled");

  const user = await repo.getUserByEmail(email);
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    await recordFailure(email);
    redirect("/login?error=invalid");
  }

  await clearFailures(email);
  writeSession({ kind: user.kind, partyId: user.partyId, email: user.email });
  redirect("/home");
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors in `actions.ts` related to `signIn`/`writeSession`. (`registerAction` is rewritten next.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/repo/actions.ts
git commit -m "feat(auth): real signIn (rate-limit gate, verify, signed session)"
```

---

## Task 10: Wire `registerAction` (create party + user)

**Files:**
- Modify: `src/lib/repo/actions.ts`

- [ ] **Step 1: Add the password-hash import**

Ensure `src/lib/repo/actions.ts` imports `hashPassword`:

```ts
import { hashPassword, verifyPassword } from "@/lib/auth/password";
```

- [ ] **Step 2: Rewrite `registerAction`**

Replace the existing `registerAction` with:

```ts
// Self-registration for any role. Creates the entity (company/supplier) or the
// singleton institute, then a 1:1 User account with a hashed password, then signs in.
export async function registerAction(formData: FormData) {
  const role = String(formData.get("role") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || password.length < 8) redirect("/register?error=weak");
  if ((role === "company" || role === "supplier") && !name) redirect("/register?error=name");
  if (await repo.getUserByEmail(email)) redirect("/register?error=exists");

  const passwordHash = await hashPassword(password);
  const createdAt = new Date().toISOString();

  if (role === "indigenomics") {
    await repo.createUser({ email, passwordHash, kind: "indigenomics", createdAt });
    writeSession({ kind: "indigenomics", email });
    redirect("/home");
  }
  if (role === "company") {
    const company = await repo.registerCompany({ name });
    await repo.createUser({ email, passwordHash, kind: "company", partyId: company.id, createdAt });
    writeSession({ kind: "company", partyId: company.id, email });
    redirect("/home");
  }
  if (role === "supplier") {
    const supplier = await repo.registerSupplier({ name });
    await repo.createUser({ email, passwordHash, kind: "supplier", partyId: supplier.id, createdAt });
    writeSession({ kind: "supplier", partyId: supplier.id, email });
    redirect("/home");
  }
  redirect("/register?error=role");
}
```

- [ ] **Step 3: Verify it type-checks + builds**

Run: `npm run build`
Expected: build succeeds — `actions.ts`, all pages, middleware compile.

- [ ] **Step 4: Commit**

```bash
git add src/lib/repo/actions.ts
git commit -m "feat(auth): register creates entity + hashed-password account"
```

---

## Task 11: Login + register pages — credential fields & errors

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/register/page.tsx`

- [ ] **Step 1: Replace the login form**

Replace the entire contents of `src/app/login/page.tsx` with:

```tsx
import { signIn } from "@/lib/repo/actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "Incorrect email or password.",
  throttled: "Too many attempts. Try again in a few minutes.",
};

export default function LoginPage({ searchParams }: { searchParams?: { error?: string } }) {
  const error = searchParams?.error ? ERRORS[searchParams.error] ?? "Sign-in failed." : null;
  return (
    <div className="max-w-md mx-auto space-y-6">
      <div>
        <h1 className="font-serif text-3xl mb-1">Sign in</h1>
        <p className="text-ink3 text-sm">Enter your email and password.</p>
      </div>

      {error && (
        <p role="alert" className="bg-rose-50 text-rose-800 border border-rose-200 rounded px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <form action={signIn} className="space-y-4 bg-panel rounded border border-line shadow-card p-5">
        <label className="block">
          <span className="block text-ink3 text-xs uppercase tracking-widest mb-1">Email</span>
          <input name="email" type="email" autoComplete="email" required
            className="w-full bg-bg border border-ink/15 rounded px-3 py-2" />
        </label>
        <label className="block">
          <span className="block text-ink3 text-xs uppercase tracking-widest mb-1">Password</span>
          <input name="password" type="password" autoComplete="current-password" required
            className="w-full bg-bg border border-ink/15 rounded px-3 py-2" />
        </label>
        <button className="w-full bg-cedar/20 text-cedar border border-cedar/40 rounded px-4 py-2 hover:bg-cedar/30">
          Sign in
        </button>
      </form>

      <p className="text-ink3 text-sm">
        New here?{" "}
        <a href="/register" className="text-cedar underline">create an account</a>{" "}
        — company, supplier, or Indigenomics.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Add email/password + errors to the register form**

In `src/app/register/page.tsx`:

(a) Change the signature to accept the error param and compute the message — replace `export default function RegisterPage() {` with:

```tsx
const ERRORS: Record<string, string> = {
  weak: "Enter an email and a password of at least 8 characters.",
  name: "A company or supplier needs a name.",
  exists: "An account with that email already exists.",
  role: "Pick a role.",
};

export default function RegisterPage({ searchParams }: { searchParams?: { error?: string } }) {
  const error = searchParams?.error ? ERRORS[searchParams.error] ?? "Registration failed." : null;
```

(b) Immediately after the opening `<div className="max-w-md mx-auto space-y-6">` wrapper's header block (right before the `<form ...>`), add the error banner:

```tsx
      {error && (
        <p role="alert" className="bg-rose-50 text-rose-800 border border-rose-200 rounded px-3 py-2 text-sm">
          {error}
        </p>
      )}
```

(c) Inside the `<form>`, after the existing "Name" `<label>` block and before the submit `<button>`, add email + password fields:

```tsx
        <label className="block">
          <span className="block text-ink3 text-xs uppercase tracking-widest mb-1">Email</span>
          <input name="email" type="email" autoComplete="email" required
            className="w-full bg-bg border border-ink/15 rounded px-3 py-2" />
        </label>
        <label className="block">
          <span className="block text-ink3 text-xs uppercase tracking-widest mb-1">Password</span>
          <input name="password" type="password" autoComplete="new-password" minLength={8} required
            className="w-full bg-bg border border-ink/15 rounded px-3 py-2" />
          <span className="block text-ink3 text-xs mt-1">At least 8 characters.</span>
        </label>
```

(d) Update the page's intro copy: change `demo · no password — pick your role…` to `Pick your role and set a password; we'll take you to your portal.`

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/login/page.tsx src/app/register/page.tsx
git commit -m "feat(auth): email+password fields + error display on login/register"
```

---

## Task 12: Seed a `User` per demo entity

**Files:**
- Modify: `src/lib/seed/fixtures.ts`
- Modify: `src/lib/seed/seed.ts`
- Modify: `scripts/seed-sst.ts`

- [ ] **Step 1: Add a `users` fixture**

In `src/lib/seed/fixtures.ts`:

(a) Add `User` to the `import type { ... } from "../repo/types"`.

(b) At the end of the file add a fixture deriving one demo account per party plus the institute. The hash is computed at seed time (Step 2 calls `hashPassword`); the fixture just declares email→identity mapping and the shared demo password:

```ts
// --- demo auth accounts (synthetic-data only — see design §10) ---
// Shared, obviously-fake password so the team can sign in as any seeded entity
// at the showcase. NEVER seed these against a real-data environment.
export const DEMO_PASSWORD = "demo-portal-2026";

export const demoUsers: { email: string; kind: "company" | "supplier" | "indigenomics"; partyId?: string }[] = [
  ...parties.map((p) => ({
    email: `${p.id.replace(/^[cs]-/, "")}@demo`, // c-northway → northway@demo
    kind: p.role,
    partyId: p.id,
  })),
  { email: "institute@demo", kind: "indigenomics" as const },
];
```

- [ ] **Step 2: Seed the users (hashing at load time)**

In `src/lib/seed/seed.ts`:

(a) Add imports:

```ts
import { hashPassword } from "../auth/password";
import { DEMO_PASSWORD, demoUsers } from "./fixtures";
import { toUserItem } from "../dynamo/single-table";
import type { User } from "../repo/types";
```

(b) Extend `seedAll`'s return type and body so it also writes users. Change the signature return to include `users`, and inside — after building the existing `items` array — add the hashed user items:

```ts
  const hash = await hashPassword(DEMO_PASSWORD);
  const T = "2025-01-15T00:00:00.000Z";
  const userItems = demoUsers.map((u) =>
    toUserItem({ email: u.email, passwordHash: hash, kind: u.kind, partyId: u.partyId, createdAt: T } as User),
  );
  items.push(...userItems);
```

(c) Update the returned object:

```ts
  return {
    parties: parties.length,
    lines: lines.length,
    confirmations: confirmations.length,
    users: demoUsers.length,
  };
```

(Note: all demo users share one hash — fine, the salt makes it a valid stored hash; they all authenticate with `DEMO_PASSWORD`.)

- [ ] **Step 3: Report users in the SST seed log**

In `scripts/seed-sst.ts`, update the portal log line to include users:

```ts
  const p = await seedAll();
  console.log(
    `✅ portal → ${process.env.DYNAMO_TABLE}: ${p.parties} parties, ${p.lines} lines, ${p.confirmations} confirmations, ${p.users} users`,
  );
```

- [ ] **Step 4: Verify seeded login works locally (DynamoDB Local)**

Run:
```bash
npm run ddb:up
npm run ddb:create
DYNAMO_ENDPOINT=http://localhost:8000 npm run ddb:seed
DYNAMO_ENDPOINT=http://localhost:8000 REPO_IMPL=dynamo tsx -e "import('./src/lib/repo/index.ts').then(async ({repo})=>{const u=await repo.getUserByEmail('northway@demo');console.log('seeded user:', u?.email, u?.kind, u?.partyId);})"
```
Expected: prints `seeded user: northway@demo company c-northway`.

- [ ] **Step 5: Confirm the existing data parity harness still passes**

Run: `npm run ddb:up && npm run verify`
Expected: PASS — the existing portal/survey checks still pass (seed now also writes users; counts of parties/lines/confirmations are unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/lib/seed/fixtures.ts src/lib/seed/seed.ts scripts/seed-sst.ts
git commit -m "feat(auth): seed a demo account per entity (shared demo password)"
```

---

## Task 13: `AuthSecret` in SST + docs

**Files:**
- Modify: `sst.config.ts`
- Modify: `docs/deploy.md`

- [ ] **Step 1: Declare the secret and feed it to the site**

In `sst.config.ts`, inside `run()`:

(a) Before `new sst.aws.Nextjs("Web", {`, add:

```ts
    // HMAC key for signing session cookies (auth.ts). Set per stage with:
    //   npx sst secret set AuthSecret <random-string> --stage <stage>
    const authSecret = new sst.Secret("AuthSecret");
```

(b) In the `environment` object of the `Nextjs` component, add (server-side only — no `NEXT_PUBLIC_`):

```ts
        AUTH_SECRET: authSecret.value,
```

- [ ] **Step 2: Set the secret for production**

Run:
```bash
aws sso login
npx sst secret set AuthSecret "$(openssl rand -base64 32)" --stage production
```
Expected: `✓ Set AuthSecret`.

- [ ] **Step 3: Document it in deploy.md**

In `docs/deploy.md`, under "Prerequisites (one-time)", add a line:

```markdown
4. **Session secret set:** `npx sst secret set AuthSecret "$(openssl rand -base64 32)" --stage <stage>`
   (HMAC key for login sessions; required — the app throws in production if unset).
```

- [ ] **Step 4: Commit**

```bash
git add sst.config.ts docs/deploy.md
git commit -m "feat(auth): AuthSecret via SST secret + deploy docs"
```

---

## Task 14: Middleware payload parsing + full verification

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Read `kind` from the signed payload segment**

In `src/middleware.ts`, replace the kind-extraction line:

```ts
  const kind = req.cookies.get(SESSION_COOKIE)?.value?.split(":")[0];
```

with a decode of the base64url payload (UX routing only — `getSession()` is the real verifier):

```ts
  // Cookie value is "<base64url(payload)>.<sig>"; read kind from the payload for
  // routing only. Real verification (HMAC + exp) happens in getSession() on the page.
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  let kind: string | undefined;
  if (raw) {
    try {
      const body = raw.slice(0, raw.indexOf("."));
      kind = JSON.parse(Buffer.from(body, "base64url").toString("utf8")).kind;
    } catch {
      kind = undefined;
    }
  }
```

Update the comment above it that currently reads `// cookie value is "kind:partyId"…` to describe the new format.

- [ ] **Step 2: Full build + auth harness**

Run:
```bash
npm run build
npm run ddb:up && DYNAMO_ENDPOINT=http://localhost:8000 npm run verify:auth
npm run verify
```
Expected: build succeeds; `verify:auth` all pass (incl. parity); `verify` (existing data loop) all pass.

- [ ] **Step 3: Manual smoke (local dev)**

Run: `npm run dev`, then:
- Visit `/login`, sign in as `northway@demo` / `demo-portal-2026` → lands on the company home.
- Wrong password → `/login?error=invalid` shows the error banner.
- While signed in as `northway@demo`, visit `/coverage?as=c-mapletel` → you still see **Northway's** data (the `?as=` override is gone).
- Sign out → `/login`; visiting `/coverage` redirects to `/login`.

Expected: all behaviors as described.

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(auth): middleware reads kind from signed session payload"
```

---

## Self-Review Notes (completed by plan author)

- **Spec coverage:** §3 security model → Tasks 2,9,14; §3a cookie flags → Task 9 Step 1c; §3b expiry → Task 2 (`exp` in payload, enforced in `verifySession`) + Task 9 (`maxAge`); §4 data model/hashing/seam → Tasks 1,4,5,6; §5 files → all tasks; §6 flows → Tasks 9,10; §7 errors → Tasks 9,10,11; §8 testing → Tasks 1,2,4,7,8 + Task 14 smoke; §9 future work → not built (correct); §10 demo-data safety → Task 12 (DEMO_PASSWORD comment + synthetic-only). Rate limiting before hash → Task 9 Step 2.
- **Type consistency:** `Session = {kind, partyId?, email}` used identically in auth.ts, actions.ts, verify-auth.ts; `User` fields match across types.ts, marshallers, mock, dynamo, seed; `signSession(session, nowSec)` / `verifySession(raw, nowSec)` signatures consistent; `assertNotLocked`/`recordFailure`/`clearFailures`/`MAX_FAILS` names consistent between rate-limit.ts and its callers.
- **No placeholders:** every code step shows full code; commands have expected output.
```
