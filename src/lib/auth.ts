// ===========================================================================
// Mock session (demo — no real auth; real auth is Horizon-2, see spec §13).
// A login picks an "account"; we store which persona you are in a cookie and
// route you to that portal. company/supplier carry a partyId; indigenomics
// (the institute viewer) has none.
// ===========================================================================
import { cookies } from "next/headers";

export const SESSION_COOKIE = "portal_session";

export type SessionKind = "company" | "supplier" | "indigenomics";
export type Session = { kind: SessionKind; partyId?: string };

export function personaHome(kind: SessionKind): string {
  if (kind === "company") return "/report";
  if (kind === "supplier") return "/confirm";
  return "/analytics"; // indigenomics
}

// Cookie value is a cookie-safe "kind:partyId" string (e.g. "company:c-northway",
// "indigenomics"). Avoids JSON commas/quotes in the Set-Cookie value.
export function getSession(): Session | null {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const [kind, partyId] = raw.split(":");
  if (kind === "company" || kind === "supplier") {
    return partyId ? { kind, partyId } : null;
  }
  if (kind === "indigenomics") return { kind };
  return null;
}

// Identity source for company/supplier pages: an explicit ?as= (dev override /
// the existing picker links) wins; otherwise the logged-in session's party.
// Keeps every page working with or without a session.
export function partyIdFrom(searchParams?: { as?: string }): string | undefined {
  return searchParams?.as ?? getSession()?.partyId;
}
