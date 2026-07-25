"use server";
// Institute-only on-demand digest trigger (the showcase-demo path). Re-checks
// the session server-side (never trust the middleware alone for a mutation).
import { getSession } from "@/lib/auth";
import { runDigest } from "@/lib/notifications/run";
import { revalidatePath } from "next/cache";

export async function runDigestAction(): Promise<void> {
  const session = getSession();
  if (session?.kind !== "indigenomics") return; // silently no-op for non-institute
  await runDigest();
  revalidatePath("/notifications");
}
