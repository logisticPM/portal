"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { repo } from "./index";
import type { IdentityTier, Pillar } from "./types";

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
  const pillar = String(formData.get("pillar") || "procurement") as Pillar;
  const period = String(formData.get("period") ?? "").trim();

  // Light validation — silently no-op on bad input so the page just re-renders.
  if (!companyId || !supplierId || !period) return;
  if (!Number.isFinite(amount) || amount <= 0) return;

  await repo.createReportedLine({ companyId, supplierId, amount, pillar, period });

  revalidatePath("/report");
  revalidatePath("/coverage");
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

// Supplier self-registration (stretch): declare name + tier, join the registry.
// NOTE: the tier is SELF-DECLARED here — not verified. Real verification (nation / CCAB)
// is Horizon 2 (spec §15 #1). The form makes that limitation explicit.
export async function registerSupplierAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const identityTier = String(formData.get("identityTier")) as IdentityTier;
  if (!name) return;
  const supplier = await repo.registerSupplier({ name, identityTier });
  revalidatePath("/");
  revalidatePath("/analytics");
  redirect(`/record?as=${supplier.id}`);
}
