"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { repo } from "./index";
import type { IdentityTier } from "./types";

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
