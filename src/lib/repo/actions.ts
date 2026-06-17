"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { repo } from "./index";
import { SESSION_COOKIE, personaHome, type Session, type SessionKind } from "@/lib/auth";
import type { FlowType, FlowTag, VerificationSource } from "./types";

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function writeSession(session: Session) {
  const value = session.partyId ? `${session.kind}:${session.partyId}` : session.kind;
  cookies().set(SESSION_COOKIE, value, {
    path: "/",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
  });
}

// Mock login: the chosen account determines the persona, which determines the
// portal we route to. Value is "company:<id>" / "supplier:<id>" / "indigenomics".
export async function signIn(formData: FormData) {
  const account = String(formData.get("account") ?? "");
  let session: Session | null = null;
  if (account === "indigenomics") {
    session = { kind: "indigenomics" };
  } else {
    const [kind, partyId] = account.split(":");
    if ((kind === "company" || kind === "supplier") && partyId) {
      session = { kind: kind as SessionKind, partyId };
    }
  }
  if (!session) return; // invalid → no-op, login page re-renders
  writeSession(session);
  redirect(personaHome(session.kind));
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
  redirect(`/report?as=${companyId}`);
}

// OCAP: supplier withdraws their confirmations → lines revert to 'pending'.
export async function withdrawConfirmations(formData: FormData) {
  const supplierId = String(formData.get("supplierId"));
  await repo.withdraw(supplierId);

  revalidatePath("/record");
  revalidatePath("/confirm");
  revalidatePath("/analytics");
}

// Supplier self-registration: new suppliers start self_declared; tier rises only via verified certifications.
export async function registerSupplierAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const supplier = await repo.registerSupplier({ name });
  // auto-sign-in the new supplier so they land straight in their portal
  writeSession({ kind: "supplier", partyId: supplier.id });
  revalidatePath("/analytics");
  redirect("/confirm");
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
  redirect(`/profile?as=${supplierId}`);
}
