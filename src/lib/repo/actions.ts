"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { repo } from "./index";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, type Session } from "@/lib/auth";
import { verifyPassword } from "@/lib/auth/password";
import { assertNotLocked, clearFailures, recordFailure } from "@/lib/auth/rate-limit";
import type { FlowType, FlowTag, VerificationSource } from "./types";

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

export async function signOut() {
  cookies().delete(SESSION_COOKIE);
  redirect("/login");
}

// Supplier responds to a claim naming them (confirm / dispute / correct).
export async function respondToLine(formData: FormData) {
  const lineId = String(formData.get("lineId"));
  const byPartyId = String(formData.get("byPartyId"));
  const status = String(formData.get("status")) as "confirmed" | "disputed" | "corrected";
  const correctedRaw = formData.get("correctedAmount");
  const correctedAmount = correctedRaw ? Number(correctedRaw) : undefined;

  await repo.recordConfirmation({ lineId, status, correctedAmount, byPartyId });

  revalidatePath("/confirm");
  revalidatePath("/record");
  revalidatePath("/analytics");
}

// Company reports one itemized procurement line naming a supplier.
// Australia collects only an aggregate total; we itemize per named supplier so each
// line is confirmable. New lines start 'pending' until the supplier acts.
export async function createLineAction(formData: FormData) {
  const companyId = String(formData.get("companyId") ?? "").trim();
  const supplierId = String(formData.get("supplierId") ?? "").trim();
  const amount = Number(formData.get("amount"));
  const flowType = String(formData.get("flowType") || "procurement") as FlowType;
  const tags = formData.getAll("tags").map(String).filter(Boolean) as FlowTag[];
  const period = String(formData.get("period") ?? "").trim();

  // Light validation — silently no-op on bad input so the page just re-renders.
  if (!companyId || !supplierId || !period) return;
  if (!Number.isFinite(amount) || amount <= 0) return;

  await repo.createReportedLine({ companyId, supplierId, amount, flowType, tags, period });

  revalidatePath("/report");
  revalidatePath("/coverage");
  revalidatePath("/confirm"); // a new line appears in the named supplier's inbox
  revalidatePath("/analytics");
  redirect("/report");
}

// OCAP: supplier withdraws their confirmations → lines revert to 'pending'.
export async function withdrawConfirmations(formData: FormData) {
  const supplierId = String(formData.get("supplierId"));
  await repo.withdraw(supplierId);

  revalidatePath("/record");
  revalidatePath("/confirm");
  revalidatePath("/analytics");
}

// Self-registration for any role. company/supplier create a party (new suppliers
// start self_declared; tier rises only via verified certifications); indigenomics
// is the singleton institute (no entity). Auto-signs-in and routes to that portal.
export async function registerAction(formData: FormData) {
  const role = String(formData.get("role") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (role === "indigenomics") {
    writeSession({ kind: "indigenomics" });
    redirect("/home");
  }

  if (!name) return; // company/supplier need a name
  if (role === "company") {
    const company = await repo.registerCompany({ name });
    writeSession({ kind: "company", partyId: company.id });
    revalidatePath("/analytics");
    redirect("/home");
  }
  if (role === "supplier") {
    const supplier = await repo.registerSupplier({ name });
    writeSession({ kind: "supplier", partyId: supplier.id });
    revalidatePath("/analytics");
    redirect("/home");
  }
  // unknown role → no-op (form re-renders)
}

// Supplier links an external certification (claim → pending; reviewer resolves to verified/revoked).
export async function claimVerificationAction(formData: FormData) {
  const supplierId = String(formData.get("supplierId") ?? "").trim();
  const source = String(formData.get("source") ?? "") as VerificationSource;
  const reference = String(formData.get("reference") ?? "").trim() || undefined;
  if (!supplierId || !source) return;
  await repo.claimVerification(supplierId, { source, reference });
  revalidatePath("/profile");
}

// Reviewer resolves a pending certification claim (verified → tier rises; revoked → stays self_declared).
export async function resolveVerificationAction(formData: FormData) {
  const supplierId = String(formData.get("supplierId") ?? "").trim();
  const source = String(formData.get("source") ?? "") as VerificationSource;
  const status = String(formData.get("status") ?? "") as "verified" | "revoked";
  if (!supplierId || !source) return;
  await repo.resolveVerification(supplierId, source, {
    status,
    verifiedBy: status === "verified" ? "Indigenomics (demo verifier)" : undefined,
    expiresAt: status === "verified" ? new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10) : undefined,
  });
  revalidatePath("/verify");
  revalidatePath("/profile");
}

// Supplier edits their showcase profile (self-described fields + the public toggle).
export async function updateSupplierProfileAction(formData: FormData) {
  const supplierId = String(formData.get("supplierId") ?? "").trim();
  if (!supplierId) return;
  await repo.updateSupplierProfile(supplierId, {
    sector: String(formData.get("sector") ?? "").trim(),
    region: String(formData.get("region") ?? "").trim(),
    website: String(formData.get("website") ?? "").trim(),
    blurb: String(formData.get("blurb") ?? "").trim(),
    profilePublic: formData.get("profilePublic") === "true",
  });
  revalidatePath("/profile");
  revalidatePath(`/s/${supplierId}`);
  redirect("/profile");
}
