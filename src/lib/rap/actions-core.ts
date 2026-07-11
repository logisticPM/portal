// Testable server-action "cores" — plain async functions with dependencies
// injected as arguments, no "use server" directive. actions.ts (which has a
// file-level "use server" and therefore turns every export into a Next.js
// Server Action) wraps these in thin FormData-parsing shims that provide the
// real dependencies (e.g. getRegistryProvider()). Server Actions can't accept
// non-serializable arguments like a RegistryProvider instance, so the
// resolvable, unit-testable logic lives here instead.
import { extractionRepo } from "./index";
import { isValidBN } from "./bn";
import type { RegistryProvider } from "./registry";

// Review-time BN resolution: validate the BN, verify it against the registry,
// and persist the result on the job. Never silently self-asserts — an unknown
// BN is an error unless the caller explicitly sets `selfAsserted`.
export async function resolveOrgForJob(
  reg: RegistryProvider,
  input: { jobId: string; bnRaw: string; selfAsserted?: boolean },
): Promise<{ ok: true; legalName: string | null } | { ok: false; error: string }> {
  const v = isValidBN(input.bnRaw);
  if (!v) return { ok: false, error: "Invalid Business Number" };
  const entity = await reg.verifyBN(v.bn9);
  if (entity) {
    await extractionRepo.setJobOrg(input.jobId, { businessNumber: v.bn9, businessNumberSource: "ised", registryLegalName: entity.legalName, registryStatus: entity.status });
    return { ok: true, legalName: entity.legalName };
  }
  if (input.selfAsserted) {
    await extractionRepo.setJobOrg(input.jobId, { businessNumber: v.bn9, businessNumberSource: "self_asserted", registryLegalName: null, registryStatus: null });
    return { ok: true, legalName: null };
  }
  return { ok: false, error: "BN not found in the federal registry. Mark self-asserted to proceed." };
}

// Publish gate: a job can only be published once its org identity (Business
// Number) has been resolved — either verified against the registry or
// explicitly self-asserted by a reviewer. Pure/sync so it can be called from
// both the Server Action (actions.ts) and unit tests without an async wrapper.
export function canPublish(job: { businessNumber: string | null }): boolean {
  return job.businessNumber != null;
}
