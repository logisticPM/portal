"use server";

// Record a progress observation on a RAP commitment from the RAP Index list.
// Same effect as Nate's /rap recordProgressAction, but revalidates /commitments
// (this page) instead of /rap. Reuses the rap repo + rollup computation.
import { revalidatePath } from "next/cache";
import { rapRepo } from "@/lib/rap";
import { computeRollup } from "@/lib/rap/rollup";
import type { Observation, ProgressStatus } from "@/lib/rap";

export async function recordProgressAction(formData: FormData) {
  const commitId = String(formData.get("commitId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim() as ProgressStatus;
  if (!commitId || !status) return;

  const raw = String(formData.get("observedValue") ?? "").trim();
  const parsed = raw === "" ? null : Number(raw);

  const obs: Observation = {
    commitId,
    observedAt: new Date().toISOString(),
    status,
    observedValue: parsed === null || Number.isNaN(parsed) ? null : parsed,
    note: null,
    recordedBy: "admin",
  };
  await rapRepo.putObservation(obs);
  await rapRepo.putRollup(computeRollup(commitId, await rapRepo.listObservations(commitId)));
  revalidatePath("/commitments");
}
