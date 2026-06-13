"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { repo } from "./index";
import type { FlowType, FlowTag, VerificationSource } from "./types";

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
  revalidatePath("/");
  revalidatePath("/analytics");
  redirect(`/record?as=${supplier.id}`);
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
