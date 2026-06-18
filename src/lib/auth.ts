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
